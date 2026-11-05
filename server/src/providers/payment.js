import { randomBytes } from 'node:crypto';

/**
 * Payment gateway adapters. Every adapter exposes:
 *   start({ amountRial, description, callbackUrl }) -> { authority, redirectUrl }
 *   verify({ authority, amountRial, query })       -> { ok, refId }
 * The server never trusts the callback query alone: it always calls verify().
 */
export function createPaymentProvider(config) {
  switch (config.payment.provider) {
    case 'mock':
      return mockGateway(config);
    case 'zarinpal':
      return zarinpal(config);
    default:
      throw new Error(`Unknown PAYMENT_PROVIDER: ${config.payment.provider}`);
  }
}

/** Test-only gateway served by this app at /mock-gateway. Refused in production by config.js. */
function mockGateway(config) {
  const pending = new Map();
  return {
    name: 'mock',
    redirectHosts: [],
    async start({ amountRial }) {
      const authority = 'MOCK' + randomBytes(16).toString('hex');
      pending.set(authority, { amountRial, paid: false });
      return { authority, redirectUrl: `${config.publicUrl}/mock-gateway.html?authority=${authority}` };
    },
    markPaid(authority) {
      const p = pending.get(authority);
      if (p) p.paid = true;
      return Boolean(p);
    },
    async verify({ authority, amountRial }) {
      const p = pending.get(authority);
      if (!p || !p.paid || p.amountRial !== amountRial) return { ok: false };
      pending.delete(authority);
      return { ok: true, refId: 'TEST-' + randomBytes(5).toString('hex').toUpperCase() };
    },
  };
}

/**
 * Zarinpal REST v4. TODO(operator): set ZARINPAL_MERCHANT_ID after your
 * merchant account (which needs اینماد) is approved. Amounts are in rial.
 */
function zarinpal(config) {
  const base = config.payment.sandbox ? 'https://sandbox.zarinpal.com' : 'https://payment.zarinpal.com';
  const post = async (path, body) => {
    const res = await fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ merchant_id: config.payment.merchantId, ...body }),
      signal: AbortSignal.timeout(15_000),
    });
    return res.json();
  };
  return {
    name: 'zarinpal',
    redirectHosts: [new URL(base).host],
    async start({ amountRial, description, callbackUrl }) {
      const out = await post('/pg/v4/payment/request.json', { amount: amountRial, currency: 'IRR', description, callback_url: callbackUrl });
      if (out?.data?.code !== 100) throw new Error('Gateway refused the payment request');
      return { authority: out.data.authority, redirectUrl: `${base}/pg/StartPay/${out.data.authority}` };
    },
    async verify({ authority, amountRial, query }) {
      if (query?.Status !== 'OK') return { ok: false };
      const out = await post('/pg/v4/payment/verify.json', { amount: amountRial, authority });
      const code = out?.data?.code;
      return code === 100 || code === 101 ? { ok: true, refId: String(out.data.ref_id) } : { ok: false };
    },
  };
}
