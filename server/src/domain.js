import { randomInt } from 'node:crypto';

/** Categories. `bill: true` means a standard bill paid straight to the issuer via the bill-pay API. */
export const CATEGORIES = {
  electricity: { label: 'قبض برق', bill: true },
  water: { label: 'قبض آب', bill: true },
  gas: { label: 'قبض گاز', bill: true },
  landline: { label: 'قبض تلفن ثابت', bill: true },
  mobile: { label: 'قبض موبایل', bill: true },
  loan: { label: 'قسط وام', bill: false },
  rent: { label: 'اجاره‌بها', bill: false },
  medical: { label: 'هزینه درمان', bill: false },
};

export const PROVINCES = [
  'آذربایجان شرقی', 'آذربایجان غربی', 'اردبیل', 'اصفهان', 'البرز', 'ایلام', 'بوشهر', 'تهران',
  'چهارمحال و بختیاری', 'خراسان جنوبی', 'خراسان رضوی', 'خراسان شمالی', 'خوزستان', 'زنجان',
  'سمنان', 'سیستان و بلوچستان', 'فارس', 'قزوین', 'قم', 'کردستان', 'کرمان', 'کرمانشاه',
  'کهگیلویه و بویراحمد', 'گلستان', 'گیلان', 'لرستان', 'مازندران', 'مرکزی', 'هرمزگان', 'همدان', 'یزد',
];

/** Amount limits in rial (۱۰ هزار تا ۲۰۰ میلیون تومان). */
export const MIN_AMOUNT = 100_000;
export const MAX_AMOUNT = 2_000_000_000;

const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export function newCaseCode() {
  let s = '';
  for (let i = 0; i < 7; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

/** The only shape of a case that anonymous visitors and donors ever see. */
export function publicCase(row) {
  return {
    code: row.code,
    category: row.category,
    title: row.title,
    story: row.story,
    province: row.province,
    amount: row.amount,
    raised: row.raised,
    status: row.status,
    billVerified: Boolean(row.bill_verified),
    isDemo: Boolean(row.is_demo),
    createdAt: row.created_at,
    paidAt: row.paid_at ?? null,
    payoutRef: row.status === 'paid' ? row.payout_ref : null,
  };
}
