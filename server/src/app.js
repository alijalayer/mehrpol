import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { join } from 'node:path';
import { ROOT, loadConfig, loadTrust } from './config.js';
import { getSetting, openDb } from './db.js';
import { HttpError, RateLimiter } from './guards.js';
import { sha256 } from './security.js';
import { createSmsProvider } from './providers/sms.js';
import { createPaymentProvider } from './providers/payment.js';
import { createBillPayProvider } from './providers/billpay.js';
import { createMailer } from './providers/mail.js';
import publicRoutes from './routes/public.js';
import authRoutes from './routes/auth.js';
import memberRoutes from './routes/member.js';
import donationRoutes from './routes/donations.js';
import adminRoutes from './routes/admin.js';
import rewardRoutes from './routes/rewards.js';
import manageRoutes from './routes/manage.js';
import revenueRoutes from './routes/revenue.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function buildApp(options = {}) {
  const config = options.config ?? loadConfig();
  const app = Fastify({
    logger: options.logger ?? { level: config.production ? 'info' : 'debug', redact: ['req.headers.cookie'] },
    trustProxy: config.trustProxy,
    bodyLimit: 64 * 1024,
  });

  const db = openDb(config.dbFile);
  // Founding senior managers (ADMIN_PHONES) get their role even before their next sign-in.
  for (const phone of config.adminPhones) db.prepare("UPDATE users SET role = 'admin', is_owner = 1 WHERE phone = ?").run(phone);
  const trust = loadTrust();
  // Demo/real mode and the sign-in channel are switched by a senior manager in the panel.
  const mode = getSetting(db, 'mode', null);
  if (mode) {
    config.demoMode = !mode.live;
    config.loginChannel = mode.channel;
  }
  config.loginChannel ??= 'phone';
  const ctx = {
    config,
    db,
    trust,
    limiter: new RateLimiter(),
    sms: options.sms ?? createSmsProvider(config, app.log),
    payment: createPaymentProvider(config),
    billPay: createBillPayProvider(config),
    cookieName: config.production ? '__Host-sid' : 'sid',
  };
  ctx.mail = options.mailer ?? createMailer(ctx);
  app.decorate('ctx', ctx);
  app.addHook('onClose', async () => db.close());

  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    // https: lets trust badges load from their issuers (e.g. enamad.ir); images cannot run code.
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; ');

  app.addHook('onSend', async (req, reply, payload) => {
    if (!reply.hasHeader('content-security-policy')) reply.header('content-security-policy', csp);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'same-origin');
    reply.header('cross-origin-opener-policy', 'same-origin');
    reply.header('permissions-policy', 'geolocation=(), microphone=(), payment=(), usb=()');
    if (config.production) reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    if (req.url.startsWith('/api/')) reply.header('cache-control', 'no-store');
    return payload;
  });

  app.addHook('onRequest', async (req) => {
    if (!ctx.limiter.take(`ip:${req.ip}`, 600, 60_000)) throw new HttpError(429, 'تعداد درخواست‌ها زیاد است؛ کمی صبر کنید');
    // CSRF: state-changing API calls must carry our custom header (forces a CORS
    // preflight we never approve) and, when present, a same-origin Origin header.
    if (req.url.startsWith('/api/') && !SAFE_METHODS.has(req.method)) {
      if (req.headers['x-mehrpol'] !== '1') throw new HttpError(403, 'درخواست نامعتبر');
      const origin = req.headers.origin;
      if (origin && origin !== config.publicUrl && origin !== `${req.protocol}://${req.headers.host}`) {
        throw new HttpError(403, 'درخواست از مبدأ نامعتبر');
      }
    }
  });

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: config.upload.maxFileBytes, files: 1, fields: 4, parts: 5 } });

  app.decorateRequest('user', null);
  app.addHook('preHandler', async (req) => {
    const token = req.cookies?.[ctx.cookieName];
    if (!token) return;
    const row = db.prepare(`
      SELECT u.id, u.phone, u.email, u.role, u.is_owner, u.display_name, u.full_name_enc IS NOT NULL AS has_identity
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`).get(sha256(token), Date.now());
    if (row) req.user = row;
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message });
    if (err.validation) return reply.status(400).send({ error: 'اطلاعات ارسالی کامل یا معتبر نیست' });
    if (err.code === 'FST_REQ_FILE_TOO_LARGE') return reply.status(413).send({ error: 'حجم فایل بیش از ۵ مگابایت است' });
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: 'درخواست نامعتبر' });
    req.log.error(err);
    return reply.status(500).send({ error: 'خطای داخلی؛ لطفاً دوباره تلاش کنید' });
  });

  await app.register(publicRoutes, ctx);
  await app.register(authRoutes, ctx);
  await app.register(memberRoutes, ctx);
  await app.register(donationRoutes, ctx);
  await app.register(adminRoutes, ctx);
  await app.register(rewardRoutes, ctx);
  await app.register(manageRoutes, ctx);
  await app.register(revenueRoutes, ctx);

  await app.register(fastifyStatic, {
    root: join(ROOT, 'public'),
    index: ['index.html'],
    setHeaders(res, path) {
      // @fastify/static passes a Fastify reply (header) or a raw response (setHeader) depending on version.
      const set = (k, v) => (typeof res.header === 'function' ? res.header(k, v) : res.setHeader(k, v));
      set('cache-control', /\.(woff2|svg|png)$/.test(path) ? 'public, max-age=604800' : 'no-cache');
    },
  });

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'یافت نشد' });
    return reply.redirect('/');
  });

  return app;
}
