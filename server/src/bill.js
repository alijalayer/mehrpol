import { toAsciiDigits } from './security.js';

/**
 * Iranian standard utility bills carry a bill ID (شناسه قبض) and a payment ID
 * (شناسه پرداخت), both protected by mod-11 check digits. Checking them offline
 * catches typos and most forged numbers before any bank API is called.
 */

export const BILL_SERVICES = {
  1: 'water',
  2: 'electricity',
  3: 'gas',
  4: 'landline',
  5: 'mobile',
  6: 'municipality',
  8: 'tax',
  9: 'traffic-fine',
};

export function mod11Check(digits) {
  let sum = 0;
  let weight = 2;
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += Number(digits[i]) * weight;
    weight = weight === 7 ? 2 : weight + 1;
  }
  const r = sum % 11;
  return r < 2 ? 0 : 11 - r;
}

/**
 * Returns { ok: true, service, amountRial } or { ok: false, error }.
 * amountRial is encoded in the payment ID (everything except its last 5 digits, ×1000).
 */
export function parseBill(rawBillId, rawPaymentId) {
  const billId = toAsciiDigits(rawBillId).replace(/^0+/, '');
  const paymentId = toAsciiDigits(rawPaymentId).replace(/^0+/, '');
  if (!/^\d{6,13}$/.test(billId)) return { ok: false, error: 'شناسه قبض باید ۶ تا ۱۳ رقم باشد' };
  if (!/^\d{6,13}$/.test(paymentId)) return { ok: false, error: 'شناسه پرداخت باید ۶ تا ۱۳ رقم باشد' };

  if (mod11Check(billId.slice(0, -1)) !== Number(billId.at(-1))) {
    return { ok: false, error: 'شناسه قبض معتبر نیست (رقم کنترل اشتباه است)' };
  }
  if (mod11Check(paymentId.slice(0, -2)) !== Number(paymentId.at(-2))) {
    return { ok: false, error: 'شناسه پرداخت معتبر نیست (رقم کنترل اول اشتباه است)' };
  }
  if (mod11Check(billId + paymentId.slice(0, -1)) !== Number(paymentId.at(-1))) {
    return { ok: false, error: 'شناسه پرداخت با شناسه قبض هم‌خوانی ندارد' };
  }

  const service = BILL_SERVICES[Number(billId.at(-2))];
  if (!service) return { ok: false, error: 'نوع خدمت این قبض شناخته نشد' };
  const amountRial = Number(paymentId.slice(0, -5) || '0') * 1000;
  if (amountRial <= 0) return { ok: false, error: 'مبلغ این قبض صفر است' };
  return { ok: true, billId, paymentId, service, amountRial };
}

/** Builds a valid bill/payment pair. Used by tests and demo seed data only. */
export function makeBill(baseBillDigits, serviceDigit, amountRial, yearDigit = 5, period = 1) {
  const billBody = `${baseBillDigits}${serviceDigit}`;
  const billId = billBody + mod11Check(billBody);
  const payBody = `${Math.floor(amountRial / 1000)}${yearDigit}${String(period).padStart(2, '0')}`;
  const c1 = mod11Check(payBody);
  const c2 = mod11Check(billId + payBody + c1);
  return { billId, paymentId: `${payBody}${c1}${c2}` };
}
