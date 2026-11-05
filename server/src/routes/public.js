import { CATEGORIES, PROVINCES, publicCase } from '../domain.js';
import { HttpError } from '../guards.js';
import { currentTrust, publicTrust } from '../trust.js';

export default async function publicRoutes(app, ctx) {
  const { db, config } = ctx;

  app.get('/api/meta', async () => ({
    demoMode: config.demoMode,
    brand: ctx.trust.brand ?? { name: 'مهرپل', tagline: '' },
    categories: CATEGORIES,
    provinces: PROVINCES,
    paymentProvider: ctx.payment.name,
    billPayLive: ctx.billPay.live !== false,
    creator: currentTrust(ctx).creator,
  }));

  app.get('/api/trust', async () => publicTrust(ctx));

  app.get('/api/stats', async () => {
    const paid = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS total FROM cases WHERE status = 'paid'").get();
    const open = db.prepare("SELECT COUNT(*) AS n FROM cases WHERE status = 'approved'").get();
    const donors = db.prepare("SELECT COUNT(DISTINCT donor_id) AS n FROM donations WHERE status = 'succeeded' AND gateway <> 'fund'").get();
    const fundIn = db.prepare("SELECT COALESCE(SUM(amount - applied),0) AS v FROM donations WHERE status = 'succeeded' AND gateway <> 'fund'").get();
    const fundOut = db.prepare("SELECT COALESCE(SUM(amount),0) AS v FROM donations WHERE status = 'succeeded' AND gateway = 'fund'").get();
    return { paidCases: paid.n, paidTotal: paid.total, openCases: open.n, donors: donors.n, generalFund: fundIn.v - fundOut.v };
  });

  app.get('/api/cases', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: Object.keys(CATEGORIES) },
          status: { type: 'string', enum: ['open', 'done'], default: 'open' },
          offset: { type: 'integer', minimum: 0, maximum: 10000, default: 0 },
        },
      },
    },
  }, async (req) => {
    const { category, status, offset } = req.query;
    const statuses = status === 'done' ? ['funded', 'paid'] : ['approved'];
    const params = [...statuses];
    let where = `status IN (${statuses.map(() => '?').join(',')})`;
    if (category) {
      where += ' AND category = ?';
      params.push(category);
    }
    // Open cases: closest to being fully funded first, so donations finish cases.
    const order = status === 'done' ? 'COALESCE(paid_at, reviewed_at) DESC' : '(amount - raised) ASC, created_at ASC';
    const rows = db.prepare(`SELECT * FROM cases WHERE ${where} ORDER BY ${order} LIMIT 21 OFFSET ?`).all(...params, offset);
    return { items: rows.slice(0, 20).map(publicCase), more: rows.length > 20 };
  });

  app.get('/api/cases/:code', {
    schema: { params: { type: 'object', properties: { code: { type: 'string', pattern: '^[A-Z0-9]{7}$' } } } },
  }, async (req) => {
    const row = db.prepare("SELECT * FROM cases WHERE code = ? AND status IN ('approved','funded','paid')").get(req.params.code);
    if (!row) throw new HttpError(404, 'این درخواست پیدا نشد');
    return publicCase(row);
  });

  app.get('/api/ledger', async () => {
    const rows = db.prepare("SELECT * FROM cases WHERE status = 'paid' ORDER BY paid_at DESC LIMIT 100").all();
    return { items: rows.map(publicCase) };
  });
}
