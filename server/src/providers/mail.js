// Email through any SMTP account (Gmail app password, Zoho, a mail host …). The settings live in
// the database and are entered by a senior manager in the panel; the password is stored encrypted.
import nodemailer from 'nodemailer';
import { getSetting } from '../db.js';
import { HttpError } from '../guards.js';
import { decryptText } from '../security.js';

export function createMailer(ctx) {
  const settings = () => getSetting(ctx.db, 'mail', null);
  return {
    configured: () => Boolean(settings()?.host && settings()?.fromAddress),
    async send({ to, subject, text, html }) {
      const m = settings();
      if (!m?.host || !m?.fromAddress) throw new HttpError(503, 'ارسال ایمیل هنوز تنظیم نشده است');
      const transport = nodemailer.createTransport({
        host: m.host,
        port: m.port,
        secure: m.secure,
        auth: m.user ? { user: m.user, pass: decryptText(ctx.config.dataKey, m.passEnc) ?? '' } : undefined,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
      });
      await transport.sendMail({ from: { name: m.fromName || 'مهرپل', address: m.fromAddress }, to, subject, text, html });
    },
  };
}

/** The login code email, readable in plain text and laid out right-to-left in HTML. */
export function codeEmail(code) {
  const text = `کد ورود شما به مهرپل: ${code}\nاین کد تا ۲ دقیقه معتبر است. اگر شما درخواست نداده‌اید، این ایمیل را نادیده بگیرید.`;
  const html = `<div dir="rtl" style="font-family:Tahoma,sans-serif;line-height:1.9;color:#1f2430">
    <h2 style="color:#08806b;margin:0 0 8px">مهرپل</h2>
    <p>کد ورود شما:</p>
    <p style="font-size:28px;font-weight:bold;letter-spacing:6px;direction:ltr;text-align:center;background:#e0f4ef;border-radius:12px;padding:12px">${code}</p>
    <p style="color:#6b6f7a;font-size:13px">این کد تا ۲ دقیقه معتبر است. اگر شما درخواست نداده‌اید، این ایمیل را نادیده بگیرید.</p></div>`;
  return { subject: `کد ورود مهرپل: ${code}`, text, html };
}
