import { randomUUID } from 'node:crypto';
import { unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseBill } from '../bill.js';
import { CATEGORIES, MAX_AMOUNT, MIN_AMOUNT, PROVINCES, newCaseCode, publicCase } from '../domain.js';
import { audit, getSetting, tx } from '../db.js';
import { HttpError, requireUser, sniffFile } from '../guards.js';
import { cleanText, encryptBuffer, encryptText, isValidNationalCode, normalizePhone, sha256, toAsciiDigits } from '../security.js';

const MAX_OPEN_CASES = 3;

export default async function memberRoutes(app, ctx) {
  const { db, config, limiter, billPay } = ctx;

  const ownCase = (user, id) => {
    const row = db.prepare('SELECT * FROM cases WHERE id = ? AND user_id = ?').get(id, user.id);
    if (!row) throw new HttpError(404, 'درخواست پیدا نشد');
    return row;
  };

  const ownerView = (row) => ({
    ...publicCase(row),
    id: row.id,
    billId: row.bill_id,
    paymentId: row.payment_id,
    reviewNote: row.review_note,
    documents: db.prepare('SELECT id, mime, size, created_at AS createdAt FROM documents WHERE case_id = ? ORDER BY created_at').all(row.id),
  });

  app.get('/api/my/cases', async (req) => {
    const user = requireUser(req);
    const rows = db.prepare('SELECT * FROM cases WHERE user_id = ? ORDER BY created_at DESC').all(user.id);
    return { items: rows.map(ownerView) };
  });

  app.get('/api/my/cases/:id', async (req) => ownerView(ownCase(requireUser(req), req.params.id)));

  app.post('/api/my/cases', {
    schema: {
      body: {
        type: 'object',
        required: ['category', 'title', 'story', 'province'],
        properties: {
          category: { type: 'string', enum: Object.keys(CATEGORIES) },
          title: { type: 'string', maxLength: 80 },
          story: { type: 'string', maxLength: 1500 },
          province: { type: 'string', enum: PROVINCES },
          billId: { type: 'string', maxLength: 20 },
          paymentId: { type: 'string', maxLength: 20 },
          amountToman: { type: 'string', maxLength: 15 },
          payee: { type: 'string', maxLength: 300 },
          fullName: { type: 'string', maxLength: 80 },
          nationalCode: { type: 'string', maxLength: 12 },
          contactPhone: { type: 'string', maxLength: 20 },
        },
      },
    },
  }, async (req) => {
    const user = requireUser(req);
    if (!limiter.take(`case:${user.id}`, 10, 24 * 3600_000)) throw new HttpError(429, 'تعداد درخواست‌های امروز شما به حد مجاز رسیده است');
    const b = req.body;
    const cat = CATEGORIES[b.category];
    const title = cleanText(b.title, 80);
    const story = cleanText(b.story, 1500);
    if (title.length < 5) throw new HttpError(400, 'عنوان باید دست‌کم ۵ حرف باشد');
    if (story.length < 30) throw new HttpError(400, 'توضیحات باید دست‌کم ۳۰ حرف باشد');

    // Identity is required once, stored encrypted, and visible only to reviewers.
    let identity = null;
    if (!user.has_identity) {
      const fullName = cleanText(b.fullName, 80);
      const nationalCode = toAsciiDigits(b.nationalCode ?? '').trim();
      if (fullName.length < 5) throw new HttpError(400, 'نام و نام خانوادگی را کامل وارد کنید');
      if (!isValidNationalCode(nationalCode)) throw new HttpError(400, 'کد ملی معتبر نیست');
      identity = [encryptText(config.dataKey, fullName), encryptText(config.dataKey, nationalCode)];
    }

    // Someone who signed up by email still needs a number the reviewer can call.
    let contactPhone = null;
    if (!user.phone) {
      contactPhone = normalizePhone(b.contactPhone);
      if (!contactPhone) throw new HttpError(400, 'شمارهٔ موبایل برای تماس کارشناس را وارد کنید');
      if (db.prepare('SELECT 1 FROM users WHERE phone = ? AND id <> ?').get(contactPhone, user.id)) throw new HttpError(409, 'این شماره به حساب دیگری وصل است؛ با همان حساب وارد شوید');
    }

    let amount;
    let billId = null;
    let paymentId = null;
    let billVerified = 0;
    let payeeEnc = null;
    if (cat.bill) {
      const parsed = await billPay.inquire({ billId: b.billId ?? '', paymentId: b.paymentId ?? '' });
      if (!parsed.ok) throw new HttpError(400, parsed.error);
      const local = parseBill(b.billId, b.paymentId);
      if (local.service !== b.category) throw new HttpError(400, `این شناسه مربوط به «${CATEGORIES[local.service]?.label ?? 'خدمت دیگری'}» است`);
      ({ billId, paymentId } = local);
      amount = parsed.amountRial;
      billVerified = 1;
      const dup = db.prepare("SELECT 1 FROM cases WHERE bill_id = ? AND payment_id = ? AND status <> 'rejected'").get(billId, paymentId);
      if (dup) throw new HttpError(409, 'این قبض قبلاً ثبت شده است');
    } else {
      const toman = Number(toAsciiDigits(b.amountToman ?? '').replace(/[,،\s]/g, ''));
      if (!Number.isSafeInteger(toman)) throw new HttpError(400, 'مبلغ را به عدد وارد کنید');
      amount = toman * 10;
      const payee = cleanText(b.payee, 300);
      if (payee.length < 10) throw new HttpError(400, 'اطلاعات دریافت‌کننده (بانک/شماره قرارداد/شبا) را وارد کنید');
      payeeEnc = encryptText(config.dataKey, payee);
    }
    if (amount < MIN_AMOUNT || amount > MAX_AMOUNT) throw new HttpError(400, 'مبلغ باید بین ۱۰ هزار و ۲۰۰ میلیون تومان باشد');

    const created = tx(db, () => {
      const open = db.prepare("SELECT COUNT(*) AS n FROM cases WHERE user_id = ? AND status IN ('pending','approved')").get(user.id);
      if (open.n >= MAX_OPEN_CASES) throw new HttpError(409, `حداکثر ${MAX_OPEN_CASES} درخواست باز می‌توانید داشته باشید`);
      if (identity) db.prepare('UPDATE users SET full_name_enc = ?, national_code_enc = ? WHERE id = ?').run(...identity, user.id);
      // Not confirmed by SMS yet, so it is marked unverified for the reviewer.
      if (contactPhone) db.prepare('UPDATE users SET phone = ?, phone_verified = 0 WHERE id = ?').run(contactPhone, user.id);
      const id = randomUUID();
      let code = newCaseCode();
      while (db.prepare('SELECT 1 FROM cases WHERE code = ?').get(code)) code = newCaseCode();
      db.prepare(`INSERT INTO cases (id, code, user_id, category, title, story, province, bill_id, payment_id, payee_enc, amount, status, bill_verified, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
        .run(id, code, user.id, b.category, title, story, b.province, billId, paymentId, payeeEnc, amount, billVerified, Date.now());
      audit(db, user.id, 'case.created', id);
      return ownerView(db.prepare('SELECT * FROM cases WHERE id = ?').get(id));
    });
    notifyManagers(created);
    return created;
  });

  /** Emails the admin team about a new request (when email is set up); never delays or fails the request. */
  function notifyManagers(c) {
    const mail = getSetting(db, 'mail', null);
    if (!ctx.mail.configured() || mail?.notify === false) return;
    const to = db.prepare("SELECT email FROM users WHERE role = 'admin' AND email IS NOT NULL").all().map((r) => r.email);
    if (!to.length) return;
    const link = `${config.publicUrl}/#/admin/case/${c.id}`;
    ctx.mail.send({
      to,
      subject: `درخواست تازه در مهرپل: ${c.title}`,
      text: `یک درخواست کمک تازه ثبت شد و منتظر بررسی است.\n\n${c.title}\nمبلغ: ${(c.amount / 10).toLocaleString('fa-IR')} تومان\n\nبررسی در پنل مدیریت:\n${link}`,
    }).catch((err) => app.log.warn({ err: err.message }, 'new-request email failed'));
  }

  app.post('/api/my/cases/:id/documents', async (req) => {
    const user = requireUser(req);
    const row = ownCase(user, req.params.id);
    if (row.status !== 'pending') throw new HttpError(409, 'پس از بررسی، امکان افزودن مدرک نیست');
    if (!limiter.take(`upload:${user.id}`, 30, 3600_000)) throw new HttpError(429, 'تعداد بارگذاری بیش از حد مجاز');
    const count = db.prepare('SELECT COUNT(*) AS n FROM documents WHERE case_id = ?').get(row.id).n;
    if (count >= config.upload.maxFilesPerCase) throw new HttpError(409, `حداکثر ${config.upload.maxFilesPerCase} فایل مجاز است`);

    const part = await req.file();
    if (!part) throw new HttpError(400, 'فایلی ارسال نشد');
    const buffer = await part.toBuffer();
    if (part.file.truncated) throw new HttpError(413, 'حجم فایل بیش از ۵ مگابایت است');
    const kind = sniffFile(buffer);
    if (!kind) throw new HttpError(415, 'فقط تصویر (JPG، PNG، WEBP) یا PDF مجاز است');

    // Files are encrypted at rest under a random name; the original filename is discarded.
    const id = randomUUID();
    const storedName = `${randomUUID()}.bin`;
    writeFileSync(join(config.uploadDir, storedName), encryptBuffer(config.dataKey, buffer), { mode: 0o600 });
    try {
      db.prepare('INSERT INTO documents (id, case_id, stored_name, mime, size, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, row.id, storedName, kind.mime, buffer.length, sha256(buffer), Date.now());
    } catch (err) {
      unlinkSync(join(config.uploadDir, storedName));
      throw err;
    }
    audit(db, user.id, 'document.uploaded', row.id, { doc: id });
    return { id, mime: kind.mime, size: buffer.length };
  });

  app.delete('/api/my/cases/:id', async (req) => {
    const user = requireUser(req);
    const row = ownCase(user, req.params.id);
    if (row.status !== 'pending') throw new HttpError(409, 'فقط درخواست‌های در انتظار بررسی قابل حذف هستند');
    const docs = db.prepare('SELECT stored_name FROM documents WHERE case_id = ?').all(row.id);
    db.prepare('DELETE FROM cases WHERE id = ?').run(row.id);
    for (const d of docs) {
      try {
        unlinkSync(join(config.uploadDir, d.stored_name));
      } catch {}
    }
    audit(db, user.id, 'case.deleted', row.id);
    return { ok: true };
  });
}
