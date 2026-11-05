// Gift cards, the monthly circle, sponsored campaigns, partnership requests and platform income.
import { randomBytes, randomUUID } from 'node:crypto';
import { CATEGORIES, PROVINCES } from '../domain.js';
import { audit, setSetting } from '../db.js';
import { HttpError, requireAdmin, requireOwner, requireUser } from '../guards.js';
import { cleanText, normalizePhone } from '../security.js';
import { safeUrl } from '../trust.js';
import { DEFAULT_REVENUE, addRevenue, campaignView, revenueSettings } from '../revenue.js';
import { rialFrom, startPayment } from './donations.js';

const GIFT_KINDS = ['gift', 'memory', 'nazr'];
const GIFT_THEMES = ['dawn', 'garden', 'night', 'rose'];
const giftCode = () => randomBytes(6).toString('base64url').replace(/[-_]/g, 'x').slice(0, 8).toUpperCase();
const DAY = 86400_000;

export default async function revenueRoutes(app, ctx) {
  const { db, limiter } = ctx;

  /* ---------- Public settings ---------- */

  app.get('/api/revenue/config', async () => {
    const r = revenueSettings(db);
    return { tipOptions: r.tipOptions, tipDefault: r.tipDefault, giftFee: r.giftFee, circleFee: r.circleFee, circleMin: r.circleMin, csrPlans: r.csrPlans, charityPlans: r.charityPlans };
  });

  /* ---------- «کارت هدیهٔ مهر» ---------- */

  app.post('/api/gifts', {
    schema: {
      body: {
        type: 'object',
        required: ['kind', 'theme', 'fromName', 'toName', 'amountToman'],
        properties: {
          kind: { type: 'string', enum: GIFT_KINDS },
          theme: { type: 'string', enum: GIFT_THEMES },
          fromName: { type: 'string', maxLength: 60 },
          toName: { type: 'string', maxLength: 60 },
          message: { type: 'string', maxLength: 300 },
          amountToman: { type: 'string', maxLength: 15 },
        },
      },
    },
  }, async (req) => {
    const user = requireUser(req);
    if (!limiter.take(`gift:${user.id}`, 20, 3600_000)) throw new HttpError(429, 'تعداد تلاش‌ها زیاد است');
    const fromName = cleanText(req.body.fromName, 60);
    const toName = cleanText(req.body.toName, 60);
    if (fromName.length < 2 || toName.length < 2) throw new HttpError(400, 'نام فرستنده و نام روی کارت را بنویسید');
    const amount = rialFrom(req.body.amountToman, { min: 500_000, label: 'مبلغ کارت' });
    const fee = revenueSettings(db).giftFee * 10;
    const code = giftCode();
    const pay = await startPayment(ctx, { user, kind: 'gift', amount, extra: fee, ref: code, description: `کارت هدیهٔ مهر ${code}` });
    db.prepare('INSERT INTO gift_cards (code, donation_id, kind, theme, from_name, to_name, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(code, pay.id, req.body.kind, req.body.theme, fromName, toName, cleanText(req.body.message, 300), Date.now());
    return { ...pay, code };
  });

  // A paid card is public (it is meant to be shared); amounts are shown only as "families helped".
  app.get('/api/gifts/:code', { schema: { params: { type: 'object', properties: { code: { type: 'string', pattern: '^[A-Z0-9x]{8}$' } } } } }, async (req) => {
    const g = db.prepare('SELECT g.*, d.amount, d.created_at AS paidAt FROM gift_cards g JOIN donations d ON d.id = g.donation_id WHERE g.code = ? AND g.paid = 1').get(req.params.code);
    if (!g) throw new HttpError(404, 'این کارت پیدا نشد');
    const helped = db.prepare("SELECT COUNT(DISTINCT case_id) AS n FROM donations WHERE source = ? AND status = 'succeeded'").get(g.donation_id).n;
    return { code: g.code, kind: g.kind, theme: g.theme, fromName: g.from_name, toName: g.to_name, message: g.message, helped, createdAt: g.created_at };
  });

  /* ---------- «حلقهٔ مهر» ---------- */

  app.get('/api/my/circle', async (req) => {
    const user = requireUser(req);
    const m = db.prepare('SELECT * FROM circle_members WHERE user_id = ?').get(user.id);
    if (!m) return { member: null };
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
    const impact = db.prepare(`
      SELECT COUNT(DISTINCT a.case_id) AS cases, COALESCE(SUM(a.amount),0) AS amount
      FROM donations a JOIN donations s ON s.id = a.source
      WHERE s.donor_id = ? AND s.kind = 'circle' AND a.created_at >= ?`).get(user.id, monthStart);
    const total = db.prepare(`SELECT COUNT(DISTINCT a.case_id) AS cases FROM donations a JOIN donations s ON s.id = a.source WHERE s.donor_id = ? AND s.kind = 'circle'`).get(user.id);
    return {
      member: {
        monthlyAmount: m.monthly_amount, category: m.category, province: m.province, status: m.status,
        active: m.status === 'active' && m.paid_until > Date.now(), paidUntil: m.paid_until, startedAt: m.started_at,
      },
      thisMonth: impact,
      allTime: total,
    };
  });

  // Joining and each monthly renewal are one payment: the monthly gift (all to families) + the membership fee.
  app.post('/api/circle/pay', {
    schema: {
      body: {
        type: 'object',
        required: ['amountToman'],
        properties: {
          amountToman: { type: 'string', maxLength: 15 },
          category: { type: 'string', enum: ['', ...Object.keys(CATEGORIES)] },
          province: { type: 'string', enum: ['', ...PROVINCES] },
        },
      },
    },
  }, async (req) => {
    const user = requireUser(req);
    if (!limiter.take(`circle:${user.id}`, 20, 3600_000)) throw new HttpError(429, 'تعداد تلاش‌ها زیاد است');
    const r = revenueSettings(db);
    const amount = rialFrom(req.body.amountToman, { min: r.circleMin * 10, label: 'کمک ماهانه' });
    const existing = db.prepare('SELECT * FROM circle_members WHERE user_id = ?').get(user.id);
    // Preferences are saved now; the membership itself starts or extends only after the bank confirms.
    if (existing) {
      db.prepare('UPDATE circle_members SET category = ?, province = ? WHERE user_id = ?').run(req.body.category || null, req.body.province || null, user.id);
    } else {
      db.prepare("INSERT INTO circle_members (user_id, monthly_amount, category, province, status, paid_until, started_at) VALUES (?, ?, ?, ?, 'cancelled', 0, ?)")
        .run(user.id, amount, req.body.category || null, req.body.province || null, Date.now());
    }
    return startPayment(ctx, { user, kind: 'circle', amount, extra: r.circleFee * 10, description: 'عضویت ماهانهٔ حلقهٔ مهر' });
  });

  app.post('/api/circle/cancel', async (req) => {
    const user = requireUser(req);
    db.prepare("UPDATE circle_members SET status = 'cancelled' WHERE user_id = ?").run(user.id);
    audit(db, user.id, 'circle.cancelled');
    return { ok: true };
  });

  /* ---------- Campaigns ---------- */

  app.get('/api/campaigns', async () => ({
    items: db.prepare('SELECT * FROM campaigns WHERE active = 1 AND (ends_at IS NULL OR ends_at > ?) ORDER BY created_at DESC').all(Date.now()).map((c) => campaignView(db, c)),
  }));

  app.get('/api/campaigns/:slug', { schema: { params: { type: 'object', properties: { slug: { type: 'string', pattern: '^[a-z0-9-]{3,40}$' } } } } }, async (req) => {
    const c = db.prepare('SELECT * FROM campaigns WHERE slug = ?').get(req.params.slug);
    if (!c) throw new HttpError(404, 'این کمپین پیدا نشد');
    return campaignView(db, c);
  });

  const campaignBody = {
    type: 'object',
    required: ['slug', 'title', 'sponsor', 'goalToman'],
    properties: {
      slug: { type: 'string', pattern: '^[a-z0-9-]{3,40}$' },
      title: { type: 'string', maxLength: 100 },
      sponsor: { type: 'string', maxLength: 80 },
      sponsorLogo: { type: 'string', maxLength: 300 },
      sponsorLink: { type: 'string', maxLength: 300 },
      description: { type: 'string', maxLength: 1500 },
      category: { type: 'string', enum: ['', ...Object.keys(CATEGORIES)] },
      province: { type: 'string', enum: ['', ...PROVINCES] },
      goalToman: { type: 'string', maxLength: 15 },
      matchPercent: { type: 'integer', minimum: 0, maximum: 300, default: 0 },
      matchCapToman: { type: 'string', maxLength: 15 },
      endsAt: { type: ['integer', 'null'] },
      active: { type: 'boolean', default: true },
    },
  };
  const campaignRow = (b) => ({
    slug: b.slug, title: cleanText(b.title, 100), sponsor: cleanText(b.sponsor, 80), logo: safeUrl(b.sponsorLogo), link: safeUrl(b.sponsorLink),
    description: cleanText(b.description, 1500), category: b.category || null, province: b.province || null,
    goal: rialFrom(b.goalToman, { label: 'هدف کمپین' }), matchPercent: b.matchPercent,
    matchCap: b.matchCapToman ? rialFrom(b.matchCapToman, { min: 0, label: 'سقف' }) : 0, endsAt: b.endsAt ?? null, active: b.active ? 1 : 0,
  });

  app.get('/api/admin/campaigns', async (req) => {
    requireAdmin(req);
    return { items: db.prepare('SELECT * FROM campaigns ORDER BY created_at DESC').all().map((c) => campaignView(db, c)) };
  });

  app.post('/api/admin/campaigns', { schema: { body: campaignBody } }, async (req) => {
    const owner = requireOwner(req);
    const r = campaignRow(req.body);
    if (r.title.length < 3 || r.sponsor.length < 2) throw new HttpError(400, 'عنوان کمپین و نام حامی را بنویسید');
    if (db.prepare('SELECT 1 FROM campaigns WHERE slug = ?').get(r.slug)) throw new HttpError(409, 'این نشانی قبلاً استفاده شده است');
    const id = randomUUID();
    db.prepare(`INSERT INTO campaigns (id, slug, title, sponsor, sponsor_logo, sponsor_link, description, category, province, goal, match_percent, match_cap, active, ends_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, r.slug, r.title, r.sponsor, r.logo, r.link, r.description, r.category, r.province, r.goal, r.matchPercent, r.matchCap, r.active, r.endsAt, Date.now());
    audit(db, owner.id, 'admin.campaign.created', null, { slug: r.slug });
    return campaignView(db, db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id));
  });

  app.put('/api/admin/campaigns/:id', { schema: { body: campaignBody } }, async (req) => {
    const owner = requireOwner(req);
    const c = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
    if (!c) throw new HttpError(404, 'کمپین پیدا نشد');
    const r = campaignRow(req.body);
    if (r.slug !== c.slug && db.prepare('SELECT 1 FROM campaigns WHERE slug = ?').get(r.slug)) throw new HttpError(409, 'این نشانی قبلاً استفاده شده است');
    db.prepare(`UPDATE campaigns SET slug = ?, title = ?, sponsor = ?, sponsor_logo = ?, sponsor_link = ?, description = ?, category = ?, province = ?,
      goal = ?, match_percent = ?, match_cap = ?, active = ?, ends_at = ? WHERE id = ?`)
      .run(r.slug, r.title, r.sponsor, r.logo, r.link, r.description, r.category, r.province, r.goal, r.matchPercent, r.matchCap, r.active, r.endsAt, c.id);
    audit(db, owner.id, 'admin.campaign.updated', null, { slug: r.slug });
    return campaignView(db, db.prepare('SELECT * FROM campaigns WHERE id = ?').get(c.id));
  });

  /* ---------- Partnership requests (companies, charities) ---------- */

  app.post('/api/leads', {
    schema: {
      body: {
        type: 'object',
        required: ['type', 'org', 'contact', 'phone'],
        properties: {
          type: { type: 'string', enum: ['company', 'charity'] },
          org: { type: 'string', maxLength: 100 },
          contact: { type: 'string', maxLength: 80 },
          phone: { type: 'string', maxLength: 20 },
          email: { type: 'string', maxLength: 120 },
          plan: { type: 'string', maxLength: 40 },
          message: { type: 'string', maxLength: 1000 },
        },
      },
    },
  }, async (req) => {
    if (!limiter.take(`lead:${req.ip}`, 5, 3600_000)) throw new HttpError(429, 'درخواست شما ثبت شده است؛ به‌زودی تماس می‌گیریم');
    const org = cleanText(req.body.org, 100);
    const contact = cleanText(req.body.contact, 80);
    const phone = normalizePhone(req.body.phone) ?? cleanText(req.body.phone, 20).replace(/[^\d+]/g, '');
    if (org.length < 2 || contact.length < 2 || phone.length < 8) throw new HttpError(400, 'نام مجموعه، نام شما و شمارهٔ تماس را کامل بنویسید');
    const id = randomUUID();
    db.prepare('INSERT INTO leads (id, type, org, contact, phone, email, plan, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, req.body.type, org, contact, phone, cleanText(req.body.email, 120), cleanText(req.body.plan, 40), cleanText(req.body.message, 1000), Date.now());
    audit(db, req.user?.id ?? null, 'lead.created', null, { type: req.body.type, org });
    return { ok: true };
  });

  app.get('/api/admin/leads', async (req) => {
    requireAdmin(req);
    return { items: db.prepare('SELECT * FROM leads ORDER BY created_at DESC LIMIT 300').all() };
  });

  app.patch('/api/admin/leads/:id', {
    schema: { body: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['new', 'contacted', 'won', 'lost'] } } } },
  }, async (req) => {
    const admin = requireAdmin(req);
    const res = db.prepare('UPDATE leads SET status = ? WHERE id = ?').run(req.body.status, req.params.id);
    if (!res.changes) throw new HttpError(404, 'پیدا نشد');
    audit(db, admin.id, 'admin.lead.updated', null, { status: req.body.status });
    return { ok: true };
  });

  /* ---------- Income (senior managers only) ---------- */

  app.get('/api/admin/revenue', async (req) => {
    requireOwner(req);
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
    const sums = (since) => Object.fromEntries(db.prepare('SELECT kind, COALESCE(SUM(amount),0) AS v FROM revenue WHERE created_at >= ? GROUP BY kind').all(since).map((r) => [r.kind, r.v]));
    const monthly = db.prepare(`SELECT strftime('%Y-%m', created_at / 1000, 'unixepoch') AS month, SUM(amount) AS v FROM revenue
      WHERE created_at >= ? GROUP BY month ORDER BY month`).all(Date.now() - 365 * DAY);
    return {
      all: sums(0),
      month: sums(monthStart),
      monthly,
      members: db.prepare("SELECT COUNT(*) AS n FROM circle_members WHERE status = 'active' AND paid_until > ?").get(Date.now()).n,
      gifts: db.prepare('SELECT COUNT(*) AS n FROM gift_cards WHERE paid = 1').get().n,
      recent: db.prepare(`SELECT r.*, u.phone, u.display_name AS displayName FROM revenue r LEFT JOIN users u ON u.id = r.user_id
        ORDER BY r.created_at DESC LIMIT 100`).all(),
      settings: revenueSettings(db),
    };
  });

  // Contracts paid outside the site (company packages, charity licences) are recorded by hand.
  app.post('/api/admin/revenue', {
    schema: { body: { type: 'object', required: ['kind', 'amountToman'], properties: { kind: { type: 'string', enum: ['csr', 'license', 'other'] }, amountToman: { type: 'string', maxLength: 15 }, note: { type: 'string', maxLength: 200 } } } },
  }, async (req) => {
    const owner = requireOwner(req);
    const amount = rialFrom(req.body.amountToman, { min: 10, label: 'مبلغ' });
    addRevenue(db, { kind: req.body.kind, amount, userId: owner.id, note: cleanText(req.body.note, 200) });
    audit(db, owner.id, 'admin.revenue.added', null, { kind: req.body.kind, amount });
    return { ok: true };
  });

  app.put('/api/admin/revenue/settings', async (req) => {
    const owner = requireOwner(req);
    const b = req.body ?? {};
    const int = (v, min, max) => (Number.isSafeInteger(v) && v >= min && v <= max ? v : null);
    const tipOptions = Array.isArray(b.tipOptions) ? [...new Set(b.tipOptions.map((v) => int(v, 0, 30)).filter((v) => v !== null))].sort((a, z) => a - z) : null;
    const plans = (list) => (Array.isArray(list) ? list.slice(0, 6).map((p, i) => ({
      id: cleanText(p.id, 20) || `p${i}`, name: cleanText(p.name, 40), price: cleanText(p.price, 60), featured: !!p.featured,
      features: (Array.isArray(p.features) ? p.features : []).slice(0, 8).map((f) => cleanText(f, 120)).filter(Boolean),
    })).filter((p) => p.name) : null);
    const next = {
      tipOptions: tipOptions?.length ? (tipOptions.includes(0) ? tipOptions : [0, ...tipOptions]) : DEFAULT_REVENUE.tipOptions,
      tipDefault: int(b.tipDefault, 0, 30) ?? DEFAULT_REVENUE.tipDefault,
      giftFee: int(b.giftFee, 0, 10_000_000) ?? DEFAULT_REVENUE.giftFee,
      circleFee: int(b.circleFee, 0, 10_000_000) ?? DEFAULT_REVENUE.circleFee,
      circleMin: int(b.circleMin, 10_000, 100_000_000) ?? DEFAULT_REVENUE.circleMin,
      csrPlans: plans(b.csrPlans) ?? DEFAULT_REVENUE.csrPlans,
      charityPlans: plans(b.charityPlans) ?? DEFAULT_REVENUE.charityPlans,
    };
    if (!next.tipOptions.includes(next.tipDefault)) next.tipDefault = next.tipOptions[0];
    setSetting(db, 'revenue', next);
    audit(db, owner.id, 'admin.revenue.settings');
    return next;
  });
}
