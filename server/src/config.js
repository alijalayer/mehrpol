import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Reads a minimal KEY=VALUE .env file (no dependency needed). */
function loadDotEnv() {
  const file = join(ROOT, '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

/**
 * Builds the runtime configuration. Production refuses to start with unsafe
 * defaults (missing encryption key, demo mode, mock payments).
 */
export function loadConfig(overrides = {}) {
  if (!overrides.skipDotEnv) loadDotEnv();
  const env = { ...process.env, ...overrides.env };
  const production = env.NODE_ENV === 'production';
  const dataDir = resolve(overrides.dataDir ?? env.DATA_DIR ?? join(ROOT, 'data'));
  mkdirSync(join(dataDir, 'uploads'), { recursive: true });
  mkdirSync(join(dataDir, 'public'), { recursive: true });

  let dataKey = env.DATA_KEY;
  if (!dataKey) {
    if (production) throw new Error('DATA_KEY (64 hex chars) is required in production');
    // Development only: generate a key once and keep it next to the database.
    const keyFile = join(dataDir, '.dev-data-key');
    if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32).toString('hex'), { mode: 0o600 });
    dataKey = readFileSync(keyFile, 'utf8').trim();
  }
  if (!/^[0-9a-f]{64}$/i.test(dataKey)) throw new Error('DATA_KEY must be 64 hex characters (32 bytes)');

  const config = {
    production,
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '127.0.0.1',
    publicUrl: (env.PUBLIC_URL ?? `http://localhost:${env.PORT ?? 3000}`).replace(/\/$/, ''),
    dataDir,
    dbFile: join(dataDir, 'mehrpol.db'),
    uploadDir: join(dataDir, 'uploads'),
    publicDir: join(dataDir, 'public'),
    dataKey: Buffer.from(dataKey, 'hex'),
    demoMode: env.DEMO_MODE === 'true',
    adminPhones: (env.ADMIN_PHONES ?? '').split(',').map((p) => p.trim()).filter(Boolean),
    // Demo mode only: admins must also enter this key before their login code is shown on screen.
    adminLoginKey: env.ADMIN_LOGIN_KEY ?? '',
    // Automated tests only: lets the test gateway run outside demo mode.
    allowTestPayments: env.ALLOW_TEST_PAYMENTS === 'true' && env.NODE_ENV !== 'production',
    // phone | email | both. The panel's mode switch overrides this.
    loginChannel: ['phone', 'email', 'both'].includes(env.LOGIN_CHANNEL) ? env.LOGIN_CHANNEL : undefined,
    trustProxy: env.TRUST_PROXY === 'true',
    sms: { provider: env.SMS_PROVIDER ?? 'console', apiKey: env.SMS_API_KEY ?? '', template: env.SMS_TEMPLATE ?? '' },
    payment: {
      provider: env.PAYMENT_PROVIDER ?? 'mock',
      merchantId: env.ZARINPAL_MERCHANT_ID ?? '',
      sandbox: env.ZARINPAL_SANDBOX === 'true',
    },
    billPay: { provider: env.BILLPAY_PROVIDER ?? 'mock', apiKey: env.BILLPAY_API_KEY ?? '' },
    upload: { maxFileBytes: 5 * 1024 * 1024, maxFilesPerCase: 6 },
    sessionDays: 30,
  };

  if (production) {
    if (config.demoMode) throw new Error('DEMO_MODE must be off in production');
    if (config.payment.provider === 'mock') throw new Error('PAYMENT_PROVIDER=mock is not allowed in production');
    if (config.sms.provider === 'console') throw new Error('SMS_PROVIDER=console is not allowed in production');
    if (!config.publicUrl.startsWith('https://')) throw new Error('PUBLIC_URL must be https in production');
  }
  return config;
}

/** Trust page content lives in config/trust.json so it can be filled in without touching code. */
export function loadTrust() {
  const file = join(ROOT, 'config', 'trust.json');
  return JSON.parse(readFileSync(file, 'utf8'));
}
