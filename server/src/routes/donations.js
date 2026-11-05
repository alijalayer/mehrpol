import { randomUUID } from 'node:crypto';
import { CATEGORIES, publicCase } from '../domain.js';
import { audit, tx } from '../db.js';
import { HttpError, requireUser } from '../guards.js';
import { toAsciiDigits } from '../security.js';
import { afterPayment, revenueSettings } from '../revenue.js';

export const MIN_DONATION = 100_000; // rial = ۱۰ هزار تومان

/**
 * Applies a verified donation to its case inside one transaction. Whatever does
 * not fit in the remaining amount (e.g. two donors paid at the same moment)
 * goes to the general fund, which admins allocate to other approved cases.
 */
export function applyDonation(db, donationId, refId) {
  return tx(db, () => {
    const d = db.prepare('SELECT * FROM donations WHERE id = ?').get(donationId);
    if (!d || d.status !== 'initiated') return { donation: d, funded: null, fresh: false };
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
    // closed_case marks the donation that completed a request (the «گره‌گشا» medal).
    db.prepare("UPDATE donations SET status = 'succeeded', applied = ?, closed_case = ?, ref_id = ?, verified_at = ? WHERE id = ?")
      .run(applied, funded ? 1 : 0, refId, Date.now(), d.id);
    audit(db, d.donor_id, 'donation.succeeded', d.case_id, { donation: d.id, amount: d.amount, applied });
    return { donation: db.prepare('SELECT * FROM donations WHERE id = ?').get(d.id), funded, fresh: true };
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

/**
 * Opens a gateway payment for amount (the donation) + extra (platform income) and records it.
 * Used by case donations, gift cards, the monthly circle and campaigns.
 */
export async function startPayment(ctx, { user, kind, amount, extra = 0, caseId = null, ref = null, anonymous = true, description }) {
  // Outside demo mode the test gateway would record donations nobody paid, so it is closed.
  if (ctx.payment.name === 'mock' && !ctx.config.demoMode && !ctx.config.allowTestPayments) throw new HttpError(503, 'پرداخت آنلاین به‌زودی فعال می‌شود؛ درگاه بانکی هنوز وصل نشده است');
  const id = randomUUID();
  const callbackUrl = `${ctx.config.publicUrl}/payment/callback?donation=${id}`;
  const { authority, redirectUrl } = await ctx.payment.start({ amountRial: amount + extra, description, callbackUrl });
  ctx.db.prepare(`INSERT INTO donations (id, case_id, donor_id, amount, extra, kind, ref, status, gateway, authority, anonymous, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'initiated', ?, ?, ?, ?)`)
    .run(id, caseId, user.id, amount, extra, kind, ref, ctx.payment.name, authority, anonymous ? 1 : 0, Date.now());
  return { id, redirectUrl };
}

/** Parses a toman amount typed in a form into rial; throws a readable error on nonsense. */
export function rialFrom(tomanText, { min = MIN_DONATION, label = 'مبلغ' } = {}) {
  const toman = Number(toAsciiDigits(String(tomanText ?? '')).replace(/[,،\s]/g, ''));
  if (!Number.isSafeInteger(toman) || toman * 10 < min) throw new HttpError(400, `حداقل ${label} ${(min / 10).toLocaleString('fa-IR')} تومان است`);
  if (toman * 10 > 2_000_000_000) throw new HttpError(400, 'مبلغ بیش از حد مجاز است');
  return toman * 10;
}

export default async function donationRoutes(app, ctx) {
  const { db, payment, limiter } = ctx;

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
      extra: d.extra,
      kind: d.kind,
      giftCode: d.kind === 'gift' ? db.prepare('SELECT code FROM gift_cards WHERE donation_id = ?').get(d.id)?.code ?? null : null,
      campaign: d.kind === 'campaign' ? db.prepare('SELECT slug, title FROM campaigns WHERE id = ?').get(d.ref) ?? null : null,
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
          tipPercent: { type: 'integer', minimum: 0, maximum: 30, default: 0 },
          campaign: { type: 'string', pattern: '^[a-z0-9-]{3,40}$' },
          anonymous: { type: 'boolean', default: true },
        },
      },
    },
  }, async (req) => {
    const user = requireUser(req);
    if (!limiter.take(`donate:${user.id}`, 20, 3600_000)) throw new HttpError(429, 'تعداد تلاش‌های پرداخت زیاد است');
    const amount = rialFrom(req.body.amountToman, { label: 'مبلغ کمک' });
    // The optional tip for Mehrpol is charged on top; the full donation still reaches the family.
    if (!revenueSettings(db).tipOptions.includes(req.body.tipPercent)) throw new HttpError(400, 'درصد حمایت نامعتبر است');
    const extra = Math.round((amount * req.body.tipPercent) / 100 / 10) * 10;

    let campaign = null;
    if (req.body.campaign) {
      campaign = db.prepare('SELECT * FROM campaigns WHERE slug = ? AND active = 1').get(req.body.campaign);
      if (!campaign || (campaign.ends_at && campaign.ends_at < Date.now())) throw new HttpError(409, 'این کمپین به پایان رسیده است');
    }

    let caseRow = null;
    if (req.body.caseCode) {
      caseRow = db.prepare("SELECT * FROM cases WHERE code = ? AND status = 'approved'").get(req.body.caseCode);
      if (!caseRow) throw new HttpError(409, 'این درخواست دیگر نیاز به کمک ندارد');
      const remaining = caseRow.amount - caseRow.raised;
      if (amount > remaining) throw new HttpError(400, `باقی‌ماندهٔ این درخواست ${(remaining / 10).toLocaleString('fa-IR')} تومان است`);
      // A remainder below the gateway minimum could never be paid, so the donor covers it fully.
      if (remaining - amount > 0 && remaining - amount < MIN_DONATION) throw new HttpError(400, 'لطفاً کل مبلغ باقی‌مانده را پرداخت کنید');
    }

    return startPayment(ctx, {
      user, amount, extra, anonymous: req.body.anonymous,
      kind: caseRow ? 'case' : campaign ? 'campaign' : 'fund',
      caseId: caseRow?.id ?? null,
      ref: campaign?.id ?? null,
      description: caseRow ? `کمک به درخواست ${caseRow.code}` : campaign ? `کمپین ${campaign.title}` : 'کمک به صندوق عمومی',
    });
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
        result = await payment.verify({ authority: d.authority, amountRial: d.amount + d.extra, query: req.query });
      }
      if (result.ok) {
        const { funded, fresh, donation } = applyDonation(db, d.id, result.refId);
        await settleFundedCase(ctx, funded);
        // Tips and fees are booked, gift cards activated, circle and campaign money spread over cases.
        if (fresh) for (const c of afterPayment(db, donation)) await settleFundedCase(ctx, c);
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
      const d = db.prepare('SELECT amount + extra AS total FROM donations WHERE authority = ?').get(req.params.authority);
      if (!d) throw new HttpError(404, 'تراکنش پیدا نشد');
      return { amount: d.total };
    });
  }
}
