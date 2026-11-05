import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** Converts Persian/Arabic digits to ASCII. */
export function toAsciiDigits(value) {
  return String(value ?? '')
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/** Normalizes an Iranian mobile number to 09xxxxxxxxx, or returns null. */
export function normalizePhone(value) {
  let p = toAsciiDigits(value).replace(/[\s\-()]/g, '');
  if (p.startsWith('+98')) p = '0' + p.slice(3);
  else if (p.startsWith('0098')) p = '0' + p.slice(4);
  else if (p.startsWith('98') && p.length === 12) p = '0' + p.slice(2);
  else if (p.startsWith('9') && p.length === 10) p = '0' + p;
  return /^09\d{9}$/.test(p) ? p : null;
}

/** Validates an Iranian national code (کد ملی) with its check digit. */
export function isValidNationalCode(value) {
  const code = toAsciiDigits(value);
  if (!/^\d{10}$/.test(code) || /^(\d)\1{9}$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(code[i]) * (10 - i);
  const r = sum % 11;
  const check = Number(code[9]);
  return r < 2 ? check === r : check === 11 - r;
}

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');

export function hmac(key, data) {
  return createHmac('sha256', key).update(data).digest('hex');
}

export function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export const newToken = () => randomBytes(32).toString('base64url');
export const newOtp = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

/** AES-256-GCM. Output layout: 12-byte IV | 16-byte tag | ciphertext. */
export function encryptBuffer(key, plain) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function decryptBuffer(key, blob) {
  const decipher = createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12));
  decipher.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]);
}

export const encryptText = (key, text) => (text == null || text === '' ? null : encryptBuffer(key, Buffer.from(text, 'utf8')).toString('base64'));
export const decryptText = (key, b64) => (b64 ? decryptBuffer(key, Buffer.from(b64, 'base64')).toString('utf8') : '');

/** Strips control characters and trims; rejects nothing, so validate length afterwards. */
export function cleanText(value, maxLen) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g, '')
    .trim()
    .slice(0, maxLen);
}
