import { randomInt } from 'node:crypto';
import { audit } from '../db.js';
import { HttpError, requireUser } from '../guards.js';
import { CERTIFICATE_MIN_LEVEL, LEVELS, donorStats, levelFor, levelIndex, levelView, loadPerks, medalsFor, perksFor } from '../rewards.js';
import { cleanText } from '../security.js';

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const randomCode = (n) => Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

/** What anyone may see about a donor who opted in to a public profile. No amounts, no phone. */
function publicDonor(db, u) {
  const stats = donorStats(db, u.id);
  const level = levelFor(stats);
  const medals = medalsFor(stats).filter((m) => m.earned);
  return {
    slug: u.slug,
    displayName: u.display_name,
    bio: u.bio,
    isDemo: Boolean(u.is_demo),
    level: levelView(level.current),
    medals,
    cases: stats.cases,
    provinces: stats.provinces,
    since: stats.firstAt,
  };
}

export default async function rewardRoutes(app, ctx) {
  const { db, config, limiter } = ctx;
  const perks = loadPerks();

  app.get('/api/rewards', async () => ({ levels: LEVELS.map(levelView), perks, certificateMinLevel: CERTIFICATE_MIN_LEVEL }));

  app.get('/api/my/profile', async (req) => {
    const user = requireUser(req);
    const u = db.prepare('SELECT display_name, bio, public_profile, slug, created_at FROM users WHERE id = ?').get(user.id);
    const stats = donorStats(db, user.id);
    const level = levelFor(stats);
    const cert = db.prepare('SELECT code, level, issued_at FROM certificates WHERE user_id = ? AND revoked = 0 ORDER BY issued_at DESC LIMIT 1').get(user.id);
    return {
      displayName: u.display_name,
      bio: u.bio,
      publicProfile: Boolean(u.public_profile),
      slug: u.public_profile ? u.slug : null,
      memberSince: u.created_at,
      stats: { donations: stats.donations, totalToman: stats.totalToman, cases: stats.cases, closed: stats.closed, provinces: stats.provinces, categories: stats.categories },
      level: { current: levelView(level.current), next: levelView(level.next), progress: level.progress },
      medals: medalsFor(stats),
      perks: perksFor(perks, level),
      certificate: cert ? { code: cert.code, level: cert.level, issuedAt: cert.issued_at } : null,
      canCertify: Boolean(level.current) && levelIndex(level.current.id) >= levelIndex(CERTIFICATE_MIN_LEVEL),
    };
  });

  app.patch('/api/my/profile', {
    schema: {
      body: {
        type: 'object',
        properties: { displayName: { type: 'string', maxLength: 40 }, bio: { type: 'string', maxLength: 160 }, publicProfile: { type: 'boolean' } },
      },
    },
  }, async (req) => {
    const user = requireUser(req);
    const b = req.body;
    const current = db.prepare('SELECT display_name, slug FROM users WHERE id = ?').get(user.id);
    const name = b.displayName !== undefined ? cleanText(b.displayName, 40) : current.display_name;
    if (b.publicProfile && name.length < 3) throw new HttpError(400, 'برای نمایش عمومی، یک نام نمایشی (دست‌کم ۳ حرف) بنویسید');
    let slug = current.slug;
    if (b.publicProfile && !slug) {
      // Random slug: the public URL reveals nothing about the phone number or real name.
      do slug = randomCode(8).toLowerCase();
      while (db.prepare('SELECT 1 FROM users WHERE slug = ?').get(slug));
    }
    db.prepare(`UPDATE users SET display_name = ?, bio = COALESCE(?, bio), public_profile = COALESCE(?, public_profile), slug = ? WHERE id = ?`)
      .run(name, b.bio !== undefined ? cleanText(b.bio, 160) : null, b.publicProfile === undefined ? null : b.publicProfile ? 1 : 0, slug, user.id);
    return { ok: true };
  });

  app.post('/api/my/certificate', async (req) => {
    const user = requireUser(req);
    if (!limiter.take(`cert:${user.id}`, 10, 24 * 3600_000)) throw new HttpError(429, 'تعداد درخواست گواهی امروز به حد مجاز رسیده است');
    const u = db.prepare('SELECT display_name FROM users WHERE id = ?').get(user.id);
    if ((u.display_name ?? '').length < 3) throw new HttpError(400, 'ابتدا نامی که روی گواهی چاپ شود را در پروفایل بنویسید');
    const stats = donorStats(db, user.id);
    const { current } = levelFor(stats);
    if (!current || levelIndex(current.id) < levelIndex(CERTIFICATE_MIN_LEVEL)) {
      throw new HttpError(403, 'گواهی از سطح «مهرآفرین برنزی» صادر می‌شود');
    }
    const last = db.prepare('SELECT * FROM certificates WHERE user_id = ? AND revoked = 0 ORDER BY issued_at DESC LIMIT 1').get(user.id);
    if (last && last.level === current.id && last.name === u.display_name) return { code: last.code };
    let code;
    do code = 'MP' + randomCode(10);
    while (db.prepare('SELECT 1 FROM certificates WHERE code = ?').get(code));
    db.prepare('INSERT INTO certificates (code, user_id, level, name, total_toman, cases, issued_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(code, user.id, current.id, u.display_name, stats.totalToman, stats.cases, Date.now());
    audit(db, user.id, 'certificate.issued', code, { level: current.id });
    return { code };
  });

  app.get('/api/certificates/:code', {
    schema: { params: { type: 'object', properties: { code: { type: 'string', pattern: '^MP[A-Z0-9]{10}$' } } } },
  }, async (req) => {
    const c = db.prepare('SELECT * FROM certificates WHERE code = ?').get(req.params.code);
    if (!c) throw new HttpError(404, 'گواهی با این کد وجود ندارد');
    const level = LEVELS.find((l) => l.id === c.level);
    return {
      code: c.code,
      name: c.name,
      level: levelView(level),
      totalToman: c.total_toman,
      cases: c.cases,
      issuedAt: c.issued_at,
      valid: c.revoked === 0,
      verifyUrl: `${config.publicUrl}/#/verify/${c.code}`,
    };
  });

  app.get('/api/honor', async () => {
    const rows = db.prepare(`
      SELECT u.id, u.slug, u.display_name, u.bio, u.is_demo, SUM(d.amount) AS total
      FROM users u JOIN donations d ON d.donor_id = u.id
      WHERE u.public_profile = 1 AND u.slug IS NOT NULL AND d.status = 'succeeded' AND d.gateway <> 'fund'
      GROUP BY u.id ORDER BY total DESC LIMIT 60`).all();
    return { items: rows.map((u) => publicDonor(db, u)) };
  });

  app.get('/api/donors/:slug', {
    schema: { params: { type: 'object', properties: { slug: { type: 'string', pattern: '^[a-z0-9]{8}$' } } } },
  }, async (req) => {
    const u = db.prepare('SELECT id, slug, display_name, bio, is_demo FROM users WHERE slug = ? AND public_profile = 1').get(req.params.slug);
    if (!u) throw new HttpError(404, 'این پروفایل عمومی نیست');
    return publicDonor(db, u);
  });
}
