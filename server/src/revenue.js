// How Mehrpol earns its keep without touching donations: every payment is split into the
// donation (all of it reaches families) and an optional/explicit extra that is platform income.
import { randomUUID } from 'node:crypto';
import { audit, getSetting, tx } from './db.js';

const DAY = 86400_000;

/** Prices and plans; the admin can change all of it from the panel. Amounts in toman. */
export const DEFAULT_REVENUE = {
  tipOptions: [0, 5, 10, 15],
  tipDefault: 5,
  giftFee: 20_000,
  circleFee: 39_000,
  circleMin: 100_000,
  csrPlans: [
    { id: 'seed', name: 'همراه', price: 'ماهانه ۵ میلیون تومان', features: ['یک کمپین فعال با نام و لوگوی شرکت', 'گزارش ماهانهٔ اثر برای روابط عمومی', 'معرفی در صفحهٔ حامیان'] },
    { id: 'grow', name: 'پشتیبان', price: 'ماهانه ۱۵ میلیون تومان', features: ['سه کمپین هم‌زمان', 'طرح «هر چه کارمندان بدهند، شرکت هم می‌دهد»', 'داشبورد اختصاصی و گزارش رسمی سالانه'], featured: true },
    { id: 'lead', name: 'سفیر', price: 'قرارداد سالانه', features: ['کمپین ملی با نام شرکت', 'گزارش مسئولیت اجتماعی برای مجمع و بورس', 'مدیر حساب اختصاصی'] },
  ],
  charityPlans: [
    { id: 'basic', name: 'خیریهٔ کوچک', price: 'ماهانه ۳ میلیون تومان', features: ['سامانهٔ مهرپل با نام و لوگوی خیریه', 'بررسی هویت و پرداخت مستقیم قبض', 'تا ۵۰۰ پرونده در ماه'] },
    { id: 'pro', name: 'خیریهٔ بزرگ', price: 'ماهانه ۹ میلیون تومان', features: ['دامنهٔ اختصاصی و اپ اندروید با نام خیریه', 'پرونده‌های نامحدود و چند کارشناس', 'پشتیبانی و آموزش'], featured: true },
  ],
};

export const revenueSettings = (db) => ({ ...DEFAULT_REVENUE, ...getSetting(db, 'revenue', {}) });

export function addRevenue(db, { kind, amount, donationId = null, userId = null, note = '' }) {
  if (!(amount > 0)) return;
  db.prepare('INSERT INTO revenue (id, kind, amount, donation_id, user_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), kind, amount, donationId, userId, note, Date.now());
}

/**
 * Spreads `amount` over approved cases (closest to completion first), optionally limited to a
 * category/province. Each share is recorded as a fund allocation pointing back at `sourceId`.
 * Whatever no matching case can take stays in the general fund. Returns the cases it fully funded.
 */
export function autoAllocate(db, amount, { category, province, sourceId }) {
  return tx(db, () => {
    const where = ["status = 'approved'"];
    const params = [];
    if (category) {
      where.push('category = ?');
      params.push(category);
    }
    if (province) {
      where.push('province = ?');
      params.push(province);
    }
    const cases = db.prepare(`SELECT * FROM cases WHERE ${where.join(' AND ')} ORDER BY (amount - raised) ASC, created_at ASC LIMIT 50`).all(...params);
    const funded = [];
    let left = amount;
    for (const c of cases) {
      if (left <= 0) break;
      const share = Math.min(left, c.amount - c.raised);
      if (share <= 0) continue;
      const raised = c.raised + share;
      const status = raised >= c.amount ? 'funded' : 'approved';
      db.prepare('UPDATE cases SET raised = ?, status = ? WHERE id = ?').run(raised, status, c.id);
      db.prepare(`INSERT INTO donations (id, case_id, donor_id, amount, applied, status, gateway, anonymous, kind, source, created_at, verified_at)
        VALUES (?, ?, NULL, ?, ?, 'succeeded', 'fund', 1, 'fund', ?, ?, ?)`).run(randomUUID(), c.id, share, share, sourceId, Date.now(), Date.now());
      if (status === 'funded') funded.push({ ...c, raised, status });
      left -= share;
    }
    return funded;
  });
}

/** Everything that happens after a payment is verified, beyond crediting a chosen case. Returns funded cases. */
export function afterPayment(db, d) {
  const fee = { case: 'tip', fund: 'tip', campaign: 'tip', gift: 'gift_fee', circle: 'circle_fee' }[d.kind] ?? 'tip';
  addRevenue(db, { kind: fee, amount: d.extra, donationId: d.id, userId: d.donor_id });

  if (d.kind === 'gift') {
    db.prepare('UPDATE gift_cards SET paid = 1 WHERE donation_id = ?').run(d.id);
    return autoAllocate(db, d.amount, { sourceId: d.id });
  }
  if (d.kind === 'circle') {
    const m = db.prepare('SELECT * FROM circle_members WHERE user_id = ?').get(d.donor_id);
    const from = Math.max(Date.now(), m?.paid_until ?? 0);
    db.prepare(`INSERT INTO circle_members (user_id, monthly_amount, category, province, status, paid_until, started_at) VALUES (?, ?, ?, ?, 'active', ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET status = 'active', paid_until = excluded.paid_until, monthly_amount = excluded.monthly_amount`)
      .run(d.donor_id, d.amount, m?.category ?? null, m?.province ?? null, from + 30 * DAY, m?.started_at ?? Date.now());
    audit(db, d.donor_id, 'circle.renewed', null, { amount: d.amount });
    return autoAllocate(db, d.amount, { category: m?.category, province: m?.province, sourceId: d.id });
  }
  if (d.kind === 'campaign') {
    const c = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(d.ref);
    return autoAllocate(db, d.amount, { category: c?.category, province: c?.province, sourceId: d.id });
  }
  return [];
}

/** Public numbers for a campaign: what people gave and what the sponsor has pledged to match. */
export function campaignView(db, c) {
  const raised = db.prepare("SELECT COALESCE(SUM(amount),0) AS v, COUNT(DISTINCT donor_id) AS n FROM donations WHERE kind = 'campaign' AND ref = ? AND status = 'succeeded'").get(c.id);
  const matched = Math.min(Math.floor((raised.v * c.match_percent) / 100), c.match_cap);
  return {
    id: c.id, slug: c.slug, title: c.title, sponsor: c.sponsor, sponsorLogo: c.sponsor_logo, sponsorLink: c.sponsor_link,
    description: c.description, category: c.category, province: c.province, goal: c.goal,
    matchPercent: c.match_percent, matchCap: c.match_cap, active: !!c.active, endsAt: c.ends_at,
    raised: raised.v, donors: raised.n, matched, total: raised.v + matched,
  };
}
