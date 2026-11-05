// Admin panel (dashboard, users, donations, events, trust page, app releases) and the public
// files those settings point to.
import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { publicCase } from '../domain.js';
import { audit, getSetting, setSetting } from '../db.js';
import { HttpError, requireAdmin, sniffFile } from '../guards.js';
import { cleanText, decryptText } from '../security.js';
import { cleanTrust, currentTrust } from '../trust.js';

const UUID = '^[0-9a-f-]{36}$';
const MAX_APK_BYTES = 150 * 1024 * 1024;
const DAY = 86400_000;

export default async function manageRoutes(app, ctx) {
  const { db, config } = ctx;
  const name = (enc) => decryptText(config.dataKey, enc);

  /* ---------- Public files and the Android app ---------- */

  app.get('/files/:id', { schema: { params: { type: 'object', properties: { id: { type: 'string', pattern: UUID } } } } }, async (req, reply) => {
    const file = db.prepare('SELECT * FROM public_files WHERE id = ?').get(req.params.id);
    if (!file || file.mime === 'application/vnd.android.package-archive') throw new HttpError(404, 'فایل پیدا نشد');
    reply.header('content-security-policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    reply.header('cache-control', 'public, max-age=86400');
    reply.header('content-disposition', file.mime === 'application/pdf' ? `attachment; filename="${file.id}.pdf"` : 'inline');
    return reply.type(file.mime).send(readFileSync(join(config.publicDir, file.stored_name)));
  });

  const release = () => getSetting(db, 'app', null);

  app.get('/api/app/latest', async () => {
    const r = release();
    if (!r) return { available: false };
    return { available: true, version: r.version, versionCode: r.versionCode, notes: r.notes, size: r.size, publishedAt: r.publishedAt, url: '/download/mehrpol.apk' };
  });

  app.get('/download/mehrpol.apk', async (req, reply) => {
    const r = release();
    const file = r && db.prepare('SELECT * FROM public_files WHERE id = ?').get(r.fileId);
    if (!file) throw new HttpError(404, 'نسخهٔ اندروید هنوز منتشر نشده است');
    reply.header('content-disposition', `attachment; filename="mehrpol-${r.version}.apk"`);
    reply.header('content-length', file.size);
    reply.header('cache-control', 'no-cache');
    return reply.type(file.mime).send(createReadStream(join(config.publicDir, file.stored_name)));
  });

  /* ---------- Dashboard ---------- */

  const actorEvents = (where, params, limit) => db.prepare(`
    SELECT a.id, a.action, a.target, a.detail, a.at, a.actor_id AS actorId, u.phone, u.display_name AS displayName, u.role,
           c.code AS caseCode, c.title AS caseTitle
    FROM audit_log a
    LEFT JOIN users u ON u.id = a.actor_id
    LEFT JOIN cases c ON c.id = a.target
    ${where} ORDER BY a.id DESC LIMIT ${limit}`).all(...params)
    .map((e) => ({ ...e, detail: e.detail ? JSON.parse(e.detail) : null }));

  app.get('/api/admin/overview', async (req) => {
    requireAdmin(req);
    const now = Date.now();
    const today = new Date().setHours(0, 0, 0, 0);
    const count = (sql, ...p) => db.prepare(sql).get(...p).n;
    const byStatus = Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS n FROM cases GROUP BY status').all().map((r) => [r.status, r.n]));
    const gifts = (since) => db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS total FROM donations WHERE status = 'succeeded' AND gateway <> 'fund' AND created_at >= ?").get(since);
    return {
      users: { total: count('SELECT COUNT(*) AS n FROM users'), today: count('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', today), week: count('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', now - 7 * DAY) },
      activeToday: count('SELECT COUNT(*) AS n FROM users WHERE last_login_at >= ?', today),
      cases: byStatus,
      newCasesToday: count('SELECT COUNT(*) AS n FROM cases WHERE created_at >= ?', today),
      donations: { all: gifts(0), today: gifts(today), week: gifts(now - 7 * DAY) },
      events: actorEvents("WHERE a.action NOT LIKE 'admin.%'", [], 25),
    };
  });

  /* ---------- Users ---------- */

  app.get('/api/admin/users', {
    schema: { querystring: { type: 'object', properties: { q: { type: 'string', maxLength: 20 } } } },
  }, async (req) => {
    const admin = requireAdmin(req);
    const q = (req.query.q ?? '').replace(/\D/g, '');
    const rows = db.prepare(`
      SELECT u.*, (SELECT COUNT(*) FROM cases WHERE user_id = u.id) AS cases,
             (SELECT COUNT(*) FROM donations WHERE donor_id = u.id AND status = 'succeeded') AS gifts,
             (SELECT COALESCE(SUM(amount),0) FROM donations WHERE donor_id = u.id AND status = 'succeeded') AS given
      FROM users u ${q ? 'WHERE u.phone LIKE ?' : ''} ORDER BY u.created_at DESC LIMIT 300`).all(...(q ? [`%${q}%`] : []));
    audit(db, admin.id, 'admin.users.listed', null, q ? { q } : null);
    return {
      items: rows.map((u) => ({
        id: u.id, phone: u.phone, role: u.role, displayName: u.display_name, fullName: name(u.full_name_enc),
        createdAt: u.created_at, lastLoginAt: u.last_login_at, cases: u.cases, gifts: u.gifts, given: u.given, isDemo: !!u.is_demo,
      })),
    };
  });

  app.get('/api/admin/users/:id', { schema: { params: { type: 'object', properties: { id: { type: 'string', pattern: UUID } } } } }, async (req) => {
    const admin = requireAdmin(req);
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!u) throw new HttpError(404, 'کاربر پیدا نشد');
    audit(db, admin.id, 'admin.user.viewed', u.id);
    return {
      id: u.id, phone: u.phone, role: u.role, displayName: u.display_name, bio: u.bio, publicProfile: !!u.public_profile, slug: u.slug,
      fullName: name(u.full_name_enc), nationalCode: name(u.national_code_enc), createdAt: u.created_at, lastLoginAt: u.last_login_at, isDemo: !!u.is_demo,
      cases: db.prepare('SELECT * FROM cases WHERE user_id = ? ORDER BY created_at DESC').all(u.id).map((r) => ({ ...publicCase(r), id: r.id })),
      donations: db.prepare(`SELECT d.id, d.amount, d.status, d.gateway, d.ref_id AS refId, d.created_at AS createdAt, c.title AS caseTitle, c.id AS caseId
        FROM donations d LEFT JOIN cases c ON c.id = d.case_id WHERE d.donor_id = ? ORDER BY d.created_at DESC LIMIT 100`).all(u.id),
      events: actorEvents('WHERE a.actor_id = ?', [u.id], 60),
    };
  });

  /* ---------- Donations and events ---------- */

  app.get('/api/admin/donations', async (req) => {
    requireAdmin(req);
    return {
      items: db.prepare(`
        SELECT d.id, d.amount, d.status, d.gateway, d.ref_id AS refId, d.created_at AS createdAt, d.anonymous,
               u.id AS donorId, u.phone, u.display_name AS displayName, c.id AS caseId, c.title AS caseTitle, c.code AS caseCode
        FROM donations d LEFT JOIN users u ON u.id = d.donor_id LEFT JOIN cases c ON c.id = d.case_id
        ORDER BY d.created_at DESC LIMIT 300`).all(),
    };
  });

  app.get('/api/admin/events', {
    schema: { querystring: { type: 'object', properties: { before: { type: 'integer', minimum: 1 }, type: { type: 'string', enum: ['all', 'user', 'case', 'donation', 'admin'] } } } },
  }, async (req) => {
    requireAdmin(req);
    const where = [];
    const params = [];
    if (req.query.before) {
      where.push('a.id < ?');
      params.push(req.query.before);
    }
    const prefix = { user: 'user.', case: 'case.', donation: 'donation.', admin: 'admin.' }[req.query.type];
    if (prefix) {
      where.push("a.action LIKE ? || '%'");
      params.push(prefix);
    }
    if (req.query.type === 'case') where.push("a.action NOT LIKE 'admin.%'");
    return { items: actorEvents(where.length ? `WHERE ${where.join(' AND ')}` : '', params, 100) };
  });

  /* ---------- Trust page and uploads ---------- */

  app.get('/api/admin/trust', async (req) => {
    requireAdmin(req);
    return currentTrust(ctx);
  });

  app.put('/api/admin/trust', { bodyLimit: 128 * 1024 }, async (req) => {
    const admin = requireAdmin(req);
    if (!req.body || typeof req.body !== 'object') throw new HttpError(400, 'اطلاعات ارسالی معتبر نیست');
    const saved = cleanTrust({ ...currentTrust(ctx), ...req.body });
    setSetting(db, 'trust', saved);
    audit(db, admin.id, 'admin.trust.updated');
    return saved;
  });

  app.post('/api/admin/files', async (req) => {
    const admin = requireAdmin(req);
    const part = await req.file();
    if (!part) throw new HttpError(400, 'فایلی ارسال نشد');
    const buffer = await part.toBuffer();
    if (part.file.truncated) throw new HttpError(413, 'حجم فایل بیش از ۵ مگابایت است');
    const kind = sniffFile(buffer);
    if (!kind) throw new HttpError(415, 'فقط تصویر (JPG، PNG، WEBP) یا PDF مجاز است');
    const id = randomUUID();
    const stored = `${id}.${kind.ext}`;
    writeFileSync(join(config.publicDir, stored), buffer);
    db.prepare('INSERT INTO public_files (id, stored_name, mime, size, created_at) VALUES (?, ?, ?, ?, ?)').run(id, stored, kind.mime, buffer.length, Date.now());
    audit(db, admin.id, 'admin.file.uploaded', null, { file: id, mime: kind.mime });
    return { id, url: `/files/${id}`, mime: kind.mime, size: buffer.length };
  });

  /* ---------- Android releases ---------- */

  app.get('/api/admin/app', async (req) => {
    requireAdmin(req);
    return release() ?? {};
  });

  // Multipart: fields version, versionCode, notes first, then the .apk file (streamed to disk).
  app.post('/api/admin/app', async (req) => {
    const admin = requireAdmin(req);
    const part = await req.file({ limits: { fileSize: MAX_APK_BYTES, files: 1, fields: 4 } });
    if (!part) throw new HttpError(400, 'فایل APK ارسال نشد');
    const field = (k) => (typeof part.fields[k]?.value === 'string' ? part.fields[k].value : '');
    const version = cleanText(field('version'), 20);
    const versionCode = Number(field('versionCode'));
    if (!/^\d+(\.\d+){0,3}$/.test(version) || !Number.isSafeInteger(versionCode) || versionCode < 1) {
      part.file.resume();
      throw new HttpError(400, 'شماره نسخه (مثلاً 1.0.3) و کد نسخه (عدد) را درست وارد کنید');
    }
    const id = randomUUID();
    const stored = `${id}.apk`;
    const tmp = join(config.publicDir, `${stored}.part`);
    await pipeline(part.file, createWriteStream(tmp));
    if (part.file.truncated) {
      rmSync(tmp, { force: true });
      throw new HttpError(413, 'حجم فایل APK بیش از حد مجاز است');
    }
    const bytes = readFileSync(tmp);
    if (bytes.subarray(0, 4).toString('latin1') !== 'PK\x03\x04' || !bytes.includes('AndroidManifest.xml')) {
      rmSync(tmp, { force: true });
      throw new HttpError(415, 'این فایل یک APK اندروید نیست');
    }
    renameSync(tmp, join(config.publicDir, stored));
    const size = statSync(join(config.publicDir, stored)).size;
    db.prepare('INSERT INTO public_files (id, stored_name, mime, size, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, stored, 'application/vnd.android.package-archive', size, Date.now());

    // Only the newest release is kept on disk.
    const previous = release();
    const next = { version, versionCode, notes: cleanText(field('notes'), 500), fileId: id, size, publishedAt: Date.now() };
    setSetting(db, 'app', next);
    if (previous?.fileId) {
      const old = db.prepare('SELECT stored_name FROM public_files WHERE id = ?').get(previous.fileId);
      if (old && existsSync(join(config.publicDir, old.stored_name))) rmSync(join(config.publicDir, old.stored_name));
      db.prepare('DELETE FROM public_files WHERE id = ?').run(previous.fileId);
    }
    audit(db, admin.id, 'admin.app.published', null, { version, versionCode });
    return next;
  });
}
