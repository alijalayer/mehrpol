import { randomUUID } from 'node:crypto';
import { CATEGORIES, publicCase } from '../domain.js';
import { audit, tx } from '../db.js';
import { HttpError, requireUser } from '../guards.js';
import { toAsciiDigits } from '../security.js';

const MIN_DONATION = 100_000; // rial = ۱۰ هزار تومان

/**
 * Applies a verified donation to its case inside one transaction. Whatever does
 * not fit in the remaining amount (e.g. two donors paid at the same moment)
 * goes to the general fund, which admins allocate to other approved cases.
 */
export function applyDonation(db, donationId, refId) {
  return tx(db, () => {
    const d = db.prepare('SELECT * FROM donations WHERE id = ?').get(donationId);
    if (!d || d.status !== 'initiated') return { donation: d, funded: null };
    let applied = 0;
    let funded = null;
    if (d.case_id) {
      const c = db.prepare('SELECT * FROM cases WHERE id = ?').get(d.case_id);
      if (c && c.status === 'approved') {
        applied = Math.min(d.amount, c.amount - c.raised);
        const raised = c.raised + applied;
        const status = raised >= c.amount ? 'funded' : 'approved';
        db.prepare('UPDATE cases SET raised = ?, status = ? WHERE id = ?').run(raised, status, c.id);
        if (status === 'funded') funded = { ...c, raised, status };
      }
    }
    db.prepare("UPDATE donations SET status = 'succeeded', applied = ?, ref_id = ?, verified_at = ? WHERE id = ?")
      .run(applied, refId, Date.now(), d.id);
    audit(db, d.donor_id, 'donation.succeeded', d.case_id, { donation: d.id, amount: d.amount, applied });
    return { donation: db.prepare('SELECT * FROM donations WHERE id = ?').get(d.id), funded };
  });
}

/** Pays a fully funded standard bill straight to its issuer. Other categories wait for a manual payout. */
export async function settleFundedCase(ctx, funded) {
  if (!funded || !CATEGORIES[funded.category].bill) return;
  const result = await ctx.billPay.pay({ billId: funded.bill_id, paymentId: funded.payment_id, amountRial: funded.amount });
  if (!result.ok) {
    audit(ctx.db, null, 'billpay.failed', funded.id);
    return;
  }
  ctx.db.prepare("UPDATE cases SET status = 'paid', payout_ref = ?, paid_at = ? WHERE id = ? AND status = 'funded'")
    .run(result.trackingCode, Date.now(), funded.id);
  audit(ctx.db, null, 'billpay.paid', funded.id, { trackingCode: result.trackingCode });
}

export default async function donationRoutes(app, ctx) {
  const { db, config, payment, limiter } = ctx;

  const donationView = (d) => {
    const c = d.case_id ? db.prepare('SELECT * FROM cases WHERE id = ?').get(d.case_id) : null;
    return {
      id: d.id,
      amount: d.amount,
      applied: d.applied,
      status: d.status,
      refId: d.ref_id,
      anonymous: Boolean(d.anonymous),
      createdAt: d.created_at,
      verifiedAt: d.verified_at,
      case: c ? publicCase(c) : null,
    };
  };

  app.post('/api/donations', {
    schema: {
      body: {
        type: 'object',
        required: ['amountToman'],
        properties: {
          caseCode: { type: 'string', pattern: '^[A-Z0-9]{7}$' },
          amountToman: { type: 'string', maxLength: 15 },
          anonymous: { type: 'boolean', default: true },
        },
      },
    },
  }, async (req) => {
    const user = requireUser(req);
    if (!limiter.take(`donate:${user.id}`, 20, 3600_000)) throw new HttpError(429, 'تعداد تلاش‌های پرداخت زیاد است');
    const toman = Number(toAsciiDigits(req.body.amountToman).replace(/[,،\s]/g, ''));
    if (!Number.isSafeInteger(toman) || toman * 10 < MIN_DONATION) throw new HttpError(400, 'حداقل مبلغ کمک ۱۰ هزار تومان است');
    let amount = toman * 10;
    if (amount > 2_000_000_000) throw new HttpError(400, 'مبلغ بیش از حد مجاز است');

    let caseRow = null;
    if (req.body.caseCode) {
      caseRow = db.prepare("SELECT * FROM cases WHERE code = ? AND status = 'approved'").get(req.body.caseCode);
      if (!caseRow) throw new HttpError(409, 'این درخواست دیگر نیاز به کمک ندارد');
      const remaining = caseRow.amount - caseRow.raised;
      if (amount > remaining) throw new HttpError(400, `باقی‌ماندهٔ این درخواست ${(remaining / 10).toLocaleString('fa-IR')} تومان است`);
      // A remainder below the gateway minimum could never be paid, so the donor covers it fully.
      if (remaining - amount > 0 && remaining - amount < MIN_DONATION) throw new HttpError(400, 'لطفاً کل مبلغ باقی‌مانده را پرداخت کنید');
    }

    const id = randomUUID();
    const callbackUrl = `${config.publicUrl}/payment/callback?donation=${id}`;
    const description = caseRow ? `کمک به درخواست ${caseRow.code}` : 'کمک به صندوق عمومی';
    const { authority, redirectUrl } = await payment.start({ amountRial: amount, description, callbackUrl });
    db.prepare(`INSERT INTO donations (id, case_id, donor_id, amount, status, gateway, authority, anonymous, created_at)
      VALUES (?, ?, ?, ?, 'initiated', ?, ?, ?, ?)`)
      .run(id, caseRow?.id ?? null, user.id, amount, payment.name, authority, req.body.anonymous ? 1 : 0, Date.now());
    return { id, redirectUrl };
  });

  // The gateway redirects the donor's browser here. The query is untrusted; verify() asks the gateway.
  app.get('/payment/callback', {
    schema: { querystring: { type: 'object', required: ['donation'], properties: { donation: { type: 'string', format: 'uuid' } } } },
  }, async (req, reply) => {
    const d = db.prepare('SELECT * FROM donations WHERE id = ?').get(req.query.donation);
    if (!d) return reply.redirect('/#/');
    if (d.status === 'initiated') {
      const queryAuthority = req.query.Authority ?? req.query.authority;
      let result = { ok: false };
      if (!queryAuthority || queryAuthority === d.authority) {
        result = await payment.verify({ authority: d.authority, amountRial: d.amount, query: req.query });
      }
      if (result.ok) {
        const { funded } = applyDonation(db, d.id, result.refId);
        await settleFundedCase(ctx, funded);
      } else {
        db.prepare("UPDATE donations SET status = 'failed', verified_at = ? WHERE id = ? AND status = 'initiated'").run(Date.now(), d.id);
      }
    }
    return reply.redirect(`/#/receipt/${d.id}`);
  });

  app.get('/api/my/donations', async (req) => {
    const user = requireUser(req);
    const rows = db.prepare("SELECT * FROM donations WHERE donor_id = ? AND status <> 'initiated' ORDER BY created_at DESC LIMIT 200").all(user.id);
    return { items: rows.map(donationView) };
  });

  app.get('/api/my/donations/:id', async (req) => {
    const user = requireUser(req);
    const d = db.prepare('SELECT * FROM donations WHERE id = ? AND donor_id = ?').get(req.params.id, user.id);
    if (!d) throw new HttpError(404, 'رسید پیدا نشد');
    return donationView(d);
  });

  if (payment.name === 'mock') {
    // Test gateway page actions. Exists only when PAYMENT_PROVIDER=mock (never in production).
    app.post('/api/mock-gateway/complete', {
      schema: {
        body: { type: 'object', required: ['authority', 'pay'], properties: { authority: { type: 'string', maxLength: 64 }, pay: { type: 'boolean' } } },
      },
    }, async (req) => {
      const d = db.prepare('SELECT id, amount FROM donations WHERE authority = ?').get(req.body.authority);
      if (!d) throw new HttpError(404, 'تراکنش پیدا نشد');
      if (req.body.pay) payment.markPaid(req.body.authority);
      return { redirect: `/payment/callback?donation=${d.id}&Authority=${req.body.authority}&Status=${req.body.pay ? 'OK' : 'NOK'}` };
    });
    app.get('/api/mock-gateway/:authority', async (req) => {
      const d = db.prepare('SELECT amount FROM donations WHERE authority = ?').get(req.params.authority);
      if (!d) throw new HttpError(404, 'تراکنش پیدا نشد');
      return { amount: d.amount };
    });
  }
}
