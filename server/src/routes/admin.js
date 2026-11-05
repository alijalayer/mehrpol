import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATEGORIES, publicCase } from '../domain.js';
import { audit, tx } from '../db.js';
import { HttpError, requireAdmin } from '../guards.js';
import { cleanText, decryptBuffer, decryptText, toAsciiDigits } from '../security.js';
import { settleFundedCase } from './donations.js';

export default async function adminRoutes(app, ctx) {
  const { db, config } = ctx;

  const getCase = (id) => {
    const row = db.prepare('SELECT * FROM cases WHERE id = ?').get(id);
    if (!row) throw new HttpError(404, 'درخواست پیدا نشد');
    return row;
  };

  // Full view with decrypted identity. Every read is written to the audit log.
  const adminView = (row) => {
    const owner = db.prepare('SELECT phone, full_name_enc, national_code_enc, created_at FROM users WHERE id = ?').get(row.user_id);
    const history = db.prepare("SELECT COUNT(*) AS n FROM cases WHERE user_id = ? AND status IN ('funded','paid')").get(row.user_id);
    return {
      ...publicCase(row),
      id: row.id,
      billId: row.bill_id,
      paymentId: row.payment_id,
      payee: decryptText(config.dataKey, row.payee_enc),
      reviewNote: row.review_note,
      owner: {
        id: row.user_id,
        phone: owner.phone,
        fullName: decryptText(config.dataKey, owner.full_name_enc),
        nationalCode: decryptText(config.dataKey, owner.national_code_enc),
        memberSince: owner.created_at,
        previouslyHelped: history.n,
      },
      documents: db.prepare('SELECT id, mime, size, sha256, created_at AS createdAt FROM documents WHERE case_id = ?').all(row.id),
    };
  };

  app.get('/api/admin/cases', {
    schema: { querystring: { type: 'object', properties: { status: { type: 'string', enum: ['all', 'pending', 'approved', 'rejected', 'funded', 'paid'], default: 'pending' } } } },
  }, async (req) => {
    const admin = requireAdmin(req);
    const { status } = req.query;
    // The review queue is oldest first; every other view shows the newest first.
    const rows = db.prepare(`
      SELECT c.*, u.phone, u.full_name_enc FROM cases c JOIN users u ON u.id = c.user_id
      ${status === 'all' ? '' : 'WHERE c.status = ?'} ORDER BY c.created_at ${status === 'pending' ? 'ASC' : 'DESC'} LIMIT 300`)
      .all(...(status === 'all' ? [] : [status]));
    audit(db, admin.id, 'admin.cases.listed', null, { status });
    return {
      items: rows.map((r) => ({ ...publicCase(r), id: r.id, owner: { id: r.user_id, phone: r.phone, fullName: decryptText(config.dataKey, r.full_name_enc) } })),
    };
  });

  app.get('/api/admin/cases/:id', async (req) => {
    const admin = requireAdmin(req);
    const row = getCase(req.params.id);
    audit(db, admin.id, 'admin.case.viewed', row.id);
    return adminView(row);
  });

  app.get('/api/admin/documents/:id', async (req, reply) => {
    const admin = requireAdmin(req);
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
    if (!doc) throw new HttpError(404, 'فایل پیدا نشد');
    const plain = decryptBuffer(config.dataKey, readFileSync(join(config.uploadDir, doc.stored_name)));
    audit(db, admin.id, 'admin.document.viewed', doc.case_id, { doc: doc.id });
    // Sandboxed and never cached; PDFs are downloaded instead of rendered in our origin.
    reply.header('content-security-policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    reply.header('cache-control', 'no-store');
    reply.header('content-disposition', doc.mime === 'application/pdf' ? `attachment; filename="${doc.id}.pdf"` : 'inline');
    return reply.type(doc.mime).send(plain);
  });

  app.post('/api/admin/cases/:id/review', {
    schema: {
      body: {
        type: 'object',
        required: ['decision'],
        properties: { decision: { type: 'string', enum: ['approve', 'reject'] }, note: { type: 'string', maxLength: 300 } },
      },
    },
  }, async (req) => {
    const admin = requireAdmin(req);
    const note = cleanText(req.body.note, 300);
    return tx(db, () => {
      const row = getCase(req.params.id);
      if (row.status !== 'pending') throw new HttpError(409, 'این درخواست قبلاً بررسی شده است');
      if (req.body.decision === 'reject' && note.length < 5) throw new HttpError(400, 'دلیل رد را برای متقاضی بنویسید');
      if (req.body.decision === 'approve' && !CATEGORIES[row.category].bill) {
        const docs = db.prepare('SELECT COUNT(*) AS n FROM documents WHERE case_id = ?').get(row.id).n;
        if (docs === 0) throw new HttpError(409, 'برای این دسته، تأیید بدون مدرک ممکن نیست');
      }
      const status = req.body.decision === 'approve' ? 'approved' : 'rejected';
      db.prepare('UPDATE cases SET status = ?, review_note = ?, reviewed_at = ? WHERE id = ?').run(status, note, Date.now(), row.id);
      audit(db, admin.id, `admin.case.${status}`, row.id, { note });
      return { ok: true, status };
    });
  });

  // Manual payout for non-bill categories (loan, rent, medical) after the case is funded.
  app.post('/api/admin/cases/:id/payout', {
    schema: { body: { type: 'object', required: ['reference'], properties: { reference: { type: 'string', maxLength: 40 } } } },
  }, async (req) => {
    const admin = requireAdmin(req);
    const reference = cleanText(toAsciiDigits(req.body.reference), 40);
    if (reference.length < 4) throw new HttpError(400, 'شماره پیگیری واریز را وارد کنید');
    const res = db.prepare("UPDATE cases SET status = 'paid', payout_ref = ?, paid_at = ? WHERE id = ? AND status = 'funded'")
      .run(reference, Date.now(), req.params.id);
    if (res.changes === 0) throw new HttpError(409, 'فقط درخواست‌های تأمین‌شده قابل تسویه هستند');
    audit(db, admin.id, 'admin.case.paid', req.params.id, { reference });
    return { ok: true };
  });

  // Moves money from the general fund into an approved case.
  app.post('/api/admin/cases/:id/allocate', {
    schema: { body: { type: 'object', required: ['amountToman'], properties: { amountToman: { type: 'string', maxLength: 15 } } } },
  }, async (req) => {
    const admin = requireAdmin(req);
    const amount = Number(toAsciiDigits(req.body.amountToman).replace(/[,،\s]/g, '')) * 10;
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new HttpError(400, 'مبلغ نامعتبر است');
    const funded = tx(db, () => {
      const row = getCase(req.params.id);
      if (row.status !== 'approved') throw new HttpError(409, 'فقط به درخواست‌های تأییدشده می‌توان تخصیص داد');
      const fundIn = db.prepare("SELECT COALESCE(SUM(amount - applied),0) AS v FROM donations WHERE status = 'succeeded' AND gateway <> 'fund'").get().v;
      const fundOut = db.prepare("SELECT COALESCE(SUM(amount),0) AS v FROM donations WHERE status = 'succeeded' AND gateway = 'fund'").get().v;
      if (amount > fundIn - fundOut) throw new HttpError(409, 'موجودی صندوق عمومی کافی نیست');
      if (amount > row.amount - row.raised) throw new HttpError(400, 'مبلغ بیش از باقی‌ماندهٔ درخواست است');
      const raised = row.raised + amount;
      const status = raised >= row.amount ? 'funded' : 'approved';
      db.prepare('UPDATE cases SET raised = ?, status = ? WHERE id = ?').run(raised, status, row.id);
      db.prepare(`INSERT INTO donations (id, case_id, donor_id, amount, applied, status, gateway, anonymous, created_at, verified_at)
        VALUES (?, ?, NULL, ?, ?, 'succeeded', 'fund', 1, ?, ?)`).run(randomUUID(), row.id, amount, amount, Date.now(), Date.now());
      audit(db, admin.id, 'admin.fund.allocated', row.id, { amount });
      return status === 'funded' ? { ...row, raised, status } : null;
    });
    await settleFundedCase(ctx, funded);
    return { ok: true };
  });

  app.get('/api/admin/audit', async (req) => {
    requireAdmin(req);
    return { items: db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200').all() };
  });
}
