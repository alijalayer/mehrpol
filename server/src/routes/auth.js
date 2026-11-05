import { randomUUID } from 'node:crypto';
import { audit } from '../db.js';
import { HttpError, requireUser } from '../guards.js';
import { cleanText, hmac, newOtp, newToken, normalizePhone, safeEqual, sha256, toAsciiDigits } from '../security.js';

const OTP_TTL_MS = 2 * 60 * 1000;
const OTP_RESEND_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

export function userView(u) {
  return { id: u.id, phone: u.phone, role: u.role, displayName: u.display_name, hasIdentity: Boolean(u.has_identity) };
}

export default async function authRoutes(app, ctx) {
  const { db, config, limiter } = ctx;
  // OTP codes are stored as keyed hashes so a leaked database does not reveal live codes.
  const otpHash = (phone, code) => hmac(config.dataKey, `otp:${phone}:${code}`);

  app.post('/api/auth/otp', {
    schema: { body: { type: 'object', required: ['phone'], properties: { phone: { type: 'string', maxLength: 20 } } } },
  }, async (req) => {
    const phone = normalizePhone(req.body.phone);
    if (!phone) throw new HttpError(400, 'شماره موبایل معتبر نیست');
    if (!limiter.take(`otp-ip:${req.ip}`, 15, 60 * 60_000) || !limiter.take(`otp-phone:${phone}`, 6, 60 * 60_000)) {
      throw new HttpError(429, 'درخواست کد بیش از حد مجاز؛ یک ساعت دیگر تلاش کنید');
    }
    const existing = db.prepare('SELECT sent_at FROM otps WHERE phone = ?').get(phone);
    if (existing && Date.now() - existing.sent_at < OTP_RESEND_MS) {
      throw new HttpError(429, 'کد قبلی هنوز معتبر است؛ یک دقیقه صبر کنید');
    }
    const code = newOtp();
    const now = Date.now();
    db.prepare(`INSERT INTO otps (phone, code_hash, expires_at, attempts, sent_at) VALUES (?, ?, ?, 0, ?)
      ON CONFLICT(phone) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, sent_at = excluded.sent_at`)
      .run(phone, otpHash(phone, code), now + OTP_TTL_MS, now);
    await ctx.sms.sendOtp(phone, code);
    // Demo mode shows the code on screen so the app can be presented without an SMS panel.
    return { ok: true, ttl: OTP_TTL_MS / 1000, ...(config.demoMode ? { demoCode: code } : {}) };
  });

  app.post('/api/auth/verify', {
    schema: {
      body: {
        type: 'object',
        required: ['phone', 'code'],
        properties: { phone: { type: 'string', maxLength: 20 }, code: { type: 'string', maxLength: 10 } },
      },
    },
  }, async (req, reply) => {
    const phone = normalizePhone(req.body.phone);
    const code = toAsciiDigits(req.body.code).trim();
    if (!phone || !/^\d{6}$/.test(code)) throw new HttpError(400, 'کد یا شماره نامعتبر است');
    if (!limiter.take(`verify-ip:${req.ip}`, 30, 15 * 60_000)) throw new HttpError(429, 'تلاش بیش از حد؛ کمی بعد دوباره امتحان کنید');

    const otp = db.prepare('SELECT * FROM otps WHERE phone = ?').get(phone);
    if (!otp || otp.expires_at < Date.now() || otp.attempts >= OTP_MAX_ATTEMPTS) {
      throw new HttpError(400, 'کد منقضی شده است؛ دوباره درخواست کد بدهید');
    }
    if (!safeEqual(otp.code_hash, otpHash(phone, code))) {
      db.prepare('UPDATE otps SET attempts = attempts + 1 WHERE phone = ?').run(phone);
      throw new HttpError(400, 'کد واردشده اشتباه است');
    }
    db.prepare('DELETE FROM otps WHERE phone = ?').run(phone);

    const role = config.adminPhones.includes(phone) ? 'admin' : 'member';
    let user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
    if (!user) {
      const id = randomUUID();
      db.prepare('INSERT INTO users (id, phone, role, created_at) VALUES (?, ?, ?, ?)').run(id, phone, role, Date.now());
      audit(db, id, 'user.created');
    } else if (user.role !== role) {
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, user.id);
    }
    user = db.prepare('SELECT *, full_name_enc IS NOT NULL AS has_identity FROM users WHERE phone = ?').get(phone);
    // Shown to the admin as "who signed in, when, from where".
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(Date.now(), user.id);
    audit(db, user.id, 'user.login', null, { ip: req.ip, device: String(req.headers['user-agent'] ?? '').slice(0, 160) });

    const token = newToken();
    const maxAge = config.sessionDays * 86400;
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(sha256(token), user.id, Date.now() + maxAge * 1000, Date.now());
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    reply.setCookie(ctx.cookieName, token, { httpOnly: true, secure: config.production, sameSite: 'lax', path: '/', maxAge });
    return { user: userView(user) };
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
