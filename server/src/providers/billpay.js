import { randomBytes } from 'node:crypto';
import { parseBill } from '../bill.js';

/**
 * Bill inquiry and payment through a bank/fintech API (e.g. Finnotech, Jibit,
 * or your partner bank). Interface:
 *   inquire({ billId, paymentId }) -> { ok, amountRial, error? }
 *   pay({ billId, paymentId, amountRial }) -> { ok, trackingCode }
 * Money for a bill goes straight to the issuing organization, never to the requester.
 */
export function createBillPayProvider(config) {
  switch (config.billPay.provider) {
    case 'mock':
      return {
        name: 'mock',
        live: false,
        async inquire({ billId, paymentId }) {
          const parsed = parseBill(billId, paymentId);
          return parsed.ok ? { ok: true, amountRial: parsed.amountRial } : { ok: false, error: parsed.error };
        },
        async pay() {
          return { ok: true, trackingCode: 'TEST-' + randomBytes(5).toString('hex').toUpperCase() };
        },
      };
    case 'http':
      // TODO(operator): connect your provider's bill-inquiry and bill-payment endpoints here.
      throw new Error('BILLPAY_PROVIDER=http is not implemented yet; see docs/INTEGRATIONS.md');
    default:
      throw new Error(`Unknown BILLPAY_PROVIDER: ${config.billPay.provider}`);
  }
}
