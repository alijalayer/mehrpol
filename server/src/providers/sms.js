/**
 * SMS providers. Add a real Iranian provider (Kavenegar, SMS.ir, Ghasedak, ...)
 * by implementing sendOtp(phone, code) and selecting it with SMS_PROVIDER.
 */
export function createSmsProvider(config, log) {
  switch (config.sms.provider) {
    case 'console':
      return {
        name: 'console',
        async sendOtp(phone, code) {
          log.info({ phone: phone.slice(0, 4) + '***' + phone.slice(-2), code }, 'DEV OTP (not sent by SMS)');
        },
      };
    case 'kavenegar':
      return {
        name: 'kavenegar',
        // TODO(operator): set SMS_API_KEY and SMS_TEMPLATE (a "verify lookup" template with %token).
        async sendOtp(phone, code) {
          const url = `https://api.kavenegar.com/v1/${encodeURIComponent(config.sms.apiKey)}/verify/lookup.json`;
          const body = new URLSearchParams({ receptor: phone, token: code, template: config.sms.template });
          const res = await fetch(url, { method: 'POST', body, signal: AbortSignal.timeout(10_000) });
          if (!res.ok) throw new Error(`SMS provider returned ${res.status}`);
        },
      };
    default:
      throw new Error(`Unknown SMS_PROVIDER: ${config.sms.provider}`);
  }
}
