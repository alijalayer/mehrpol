import { randomUUID } from 'node:crypto';
import { audit } from '../db.js';
import { HttpError, requireUser } from '../guards.js';
import { codeEmail } from '../providers/mail.js';
import { cleanText, hmac, newOtp, newToken, normalizePhone, safeEqual, sha256, toAsciiDigits } from '../security.js';

const OTP_TTL_MS = 2 * 60 * 1000;
const OTP_RESEND_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

export function userView(u) {
  return {
    id: u.id, phone: u.phone, email: u.email ?? null, role: u.role, isOwner: Boolean(u.is_owner),
    displayName: u.display_name, hasIdentity: Boolean(u.has_identity),
  };
}

export function normalizeEmail(v) {
  const e = String(v ?? '').trim().toLowerCase();
  return e.length <= 120 && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e) ? e : null;
}

const identityBody = {
  phone: { type: 'string', maxLength: 20 },
  email: { type: 'string', maxLength: 120 },
};

export default async function authRoutes(app, ctx) {
  const { db, config, limiter } = ctx;
  // OTP codes are stored as keyed hashes so a leaked database does not reveal live codes.
  const otpHash = (key, code) => hmac(config.dataKey, `otp:${key}:${code}`);

  /** Which address the person signs in with, checked against the login channel the site uses. */
  function who(body) {
    if (body.email) {
      if (config.loginChannel === 'phone') throw new HttpError(400, 'ورود با شمارهٔ موبایل انجام می‌شود');
      const email = normalizeEmail(body.email);
      if (!email) throw new HttpError(400, 'نشانی ایمیل معتبر نیست');
      return { field: 'email', value: email };
    }
    if (config.loginChannel === 'email') throw new HttpError(400, 'فعلاً ورود با ایمیل انجام می‌شود');
    const phone = normalizePhone(body.phone);
    if (!phone) throw new HttpError(400, 'شماره موبایل معتبر نیست');
    return { field: 'phone', value: phone };
  }

  /** Stores a fresh code for `key` (rate-limited, one per minute) and returns it. */
  function issueCode(key, ip) {
    if (!limiter.take(`otp-ip:${ip}`, 15, 60 * 60_000) || !limiter.take(`otp-to:${key}`, 6, 60 * 60_000)) {
      throw new HttpError(429, 'درخواست کد بیش از حد مجاز؛ یک ساعت دیگر تلاش کنید');
    }
    const existing = db.prepare('SELECT sent_at FROM otps WHERE phone = ?').get(key);
    if (existing && Date.now() - existing.sent_at < OTP_RESEND_MS) throw new HttpError(429, 'کد قبلی هنوز معتبر است؛ یک دقیقه صبر کنید');
    const code = newOtp();
    const now = Date.now();
    db.prepare(`INSERT INTO otps (phone, code_hash, expires_at, attempts, sent_at) VALUES (?, ?, ?, 0, ?)
      ON CONFLICT(phone) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, sent_at = excluded.sent_at`)
      .run(key, otpHash(key, code), now + OTP_TTL_MS, now);
    return code;
  }

  /** Checks a code for `key`; each wrong guess counts and five end the code. */
  function checkCode(key, code) {
    const otp = db.prepare('SELECT * FROM otps WHERE phone = ?').get(key);
    if (!otp || otp.expires_at < Date.now() || otp.attempts >= OTP_MAX_ATTEMPTS) throw new HttpError(400, 'کد منقضی شده است؛ دوباره درخواست کد بدهید');
    if (!safeEqual(otp.code_hash, otpHash(key, code))) {
      db.prepare('UPDATE otps SET attempts = attempts + 1 WHERE phone = ?').run(key);
      throw new HttpError(400, 'کد واردشده اشتباه است');
    }
    db.prepare('DELETE FROM otps WHERE phone = ?').run(key);
  }

  async function deliver({ field, value }, code) {
    if (field === 'phone') return ctx.sms.sendOtp(value, code);
    try {
      await ctx.mail.send({ to: value, ...codeEmail(code) });
    } catch (err) {
      db.prepare('DELETE FROM otps WHERE phone = ?').run(value);
      app.log.warn({ err: err.message }, 'login email failed');
      throw err instanceof HttpError ? err : new HttpError(502, 'ارسال ایمیل انجام نشد؛ کمی بعد دوباره امتحان کنید');
    }
  }

  app.post('/api/auth/otp', {
    schema: { body: { type: 'object', properties: { ...identityBody, adminKey: { type: 'string', maxLength: 100 } } } },
  }, async (req, reply) => {
    const id = who(req.body);
    // Demo mode puts the code on screen, so for admins that alone would let anyone in.
    // They must also give the manager key (ADMIN_LOGIN_KEY); without one set, admins get no on-screen code.
    const isAdmin = (id.field === 'phone' && config.adminPhones.includes(id.value)) || db.prepare(`SELECT 1 FROM users WHERE ${id.field} = ? AND role = 'admin'`).get(id.value);
    const showCode = config.demoMode && (!isAdmin || (config.adminLoginKey && safeEqual(sha256(String(req.body.adminKey ?? '')), sha256(config.adminLoginKey))));
    if (config.demoMode && isAdmin && !showCode) {
      if (!limiter.take(`admin-key:${req.ip}`, 10, 60 * 60_000)) throw new HttpError(429, 'تلاش بیش از حد؛ یک ساعت دیگر امتحان کنید');
      return reply.status(403).send({ error: req.body.adminKey ? 'کلید مدیریت درست نیست' : 'این حساب مدیر است؛ کلید مدیریت را وارد کنید', needsAdminKey: true });
    }
    const code = issueCode(id.value, req.ip);
    // In demo mode the code is only shown; outside it, it really goes out by SMS or email.
    if (!showCode) await deliver(id, code);
    else if (id.field === 'phone') await ctx.sms.sendOtp(id.value, code);
    return { ok: true, ttl: OTP_TTL_MS / 1000, channel: id.field, ...(showCode ? { demoCode: code } : {}) };
  });

  app.post('/api/auth/verify', {
    schema: { body: { type: 'object', required: ['code'], properties: { ...identityBody, code: { type: 'string', maxLength: 10 } } } },
  }, async (req, reply) => {
    const id = who(req.body);
    const code = toAsciiDigits(req.body.code).trim();
    if (!/^\d{6}$/.test(code)) throw new HttpError(400, 'کد نامعتبر است');
    if (!limiter.take(`verify-ip:${req.ip}`, 30, 15 * 60_000)) throw new HttpError(429, 'تلاش بیش از حد؛ کمی بعد دوباره امتحان کنید');
    checkCode(id.value, code);

    // ADMIN_PHONES are the founding senior managers and always get that role back. Everyone
    // else keeps the role a senior manager gave them in the panel (member by default).
    const founder = id.field === 'phone' && config.adminPhones.includes(id.value);
    let user = db.prepare(`SELECT * FROM users WHERE ${id.field} = ?`).get(id.value);
    if (!user) {
      const uid = randomUUID();
      db.prepare(`INSERT INTO users (id, ${id.field}, role, is_owner, created_at) VALUES (?, ?, ?, ?, ?)`).run(uid, id.value, founder ? 'admin' : 'member', founder ? 1 : 0, Date.now());
      audit(db, uid, 'user.created', null, { via: id.field });
    } else if (founder && (user.role !== 'admin' || !user.is_owner)) {
      db.prepare("UPDATE users SET role = 'admin', is_owner = 1 WHERE id = ?").run(user.id);
    }
    user = db.prepare(`SELECT *, full_name_enc IS NOT NULL AS has_identity FROM users WHERE ${id.field} = ?`).get(id.value);
    // Shown to the admin as "who signed in, when, from where".
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(Date.now(), user.id);
    audit(db, user.id, 'user.login', null, { ip: req.ip, device: String(req.headers['user-agent'] ?? '').slice(0, 160), via: id.field });

    const token = newToken();
    const maxAge = config.sessionDays * 86400;
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(sha256(token), user.id, Date.now() + maxAge * 1000, Date.now());
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    reply.setCookie(ctx.cookieName, token, { httpOnly: true, secure: config.production, sameSite: 'lax', path: '/', maxAge });
    return { user: userView(user) };
  });

  // Adds an email to the signed-in account (proven with a code sent to it), so the person can
  // sign in by email once the site switches to it.
  app.post('/api/my/email', { schema: { body: { type: 'object', required: ['email'], properties: { email: { type: 'string', maxLength: 120 } } } } }, async (req) => {
    const user = requireUser(req);
    const email = normalizeEmail(req.body.email);
    if (!email) throw new HttpError(400, 'نشانی ایمیل معتبر نیست');
    if (db.prepare('SELECT 1 FROM users WHERE email = ? AND id <> ?').get(email, user.id)) throw new HttpError(409, 'این ایمیل به حساب دیگری وصل است');
    const key = `link:${user.id}:${email}`;
    const code = issueCode(key, req.ip);
    try {
      await ctx.mail.send({ to: email, ...codeEmail(code) });
    } catch (err) {
      db.prepare('DELETE FROM otps WHERE phone = ?').run(key);
      throw err instanceof HttpError ? err : new HttpError(502, 'ارسال ایمیل انجام نشد؛ تنظیمات ایمیل را بررسی کنید');
    }
    return { ok: true, ttl: OTP_TTL_MS / 1000 };
  });

  app.post('/api/my/email/verify', {
    schema: { body: { type: 'object', required: ['email', 'code'], properties: { email: { type: 'string', maxLength: 120 }, code: { type: 'string', maxLength: 10 } } } },
  }, async (req) => {
    const user = requireUser(req);
    const email = normalizeEmail(req.body.email);
    if (!email) throw new HttpError(400, 'نشانی ایمیل معتبر نیست');
    checkCode(`link:${user.id}:${email}`, toAsciiDigits(req.body.code).trim());
    if (db.prepare('SELECT 1 FROM users WHERE email = ? AND id <> ?').get(email, user.id)) throw new HttpError(409, 'این ایمیل به حساب دیگری وصل است');
    db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, user.id);
    audit(db, user.id, 'user.email.linked');
    return { ok: true, email };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies?.[ctx.cookieName];
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    reply.clearCookie(ctx.cookieName, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', async (req) => ({ user: req.user ? userView(req.user) : null }));

  app.patch('/api/me', {
    schema: { body: { type: 'object', required: ['displayName'], properties: { displayName: { type: 'string', maxLength: 40 } } } },
  }, async (req) => {
    const user = requireUser(req);
    const name = cleanText(req.body.displayName, 40);
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(name, user.id);
    return { ok: true };
  });
}
