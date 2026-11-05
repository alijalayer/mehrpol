import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { makeBill, parseBill } from '../src/bill.js';
import { isValidNationalCode, normalizePhone } from '../src/security.js';

const dataDir = mkdtempSync(join(tmpdir(), 'mehrpol-test-'));
const sentCodes = new Map();
let app;

const H = { 'x-mehrpol': '1' };

async function login(phone) {
  const r1 = await app.inject({ method: 'POST', url: '/api/auth/otp', headers: H, payload: { phone } });
  assert.equal(r1.statusCode, 200, r1.body);
  const r2 = await app.inject({ method: 'POST', url: '/api/auth/verify', headers: H, payload: { phone, code: sentCodes.get(normalizePhone(phone)) } });
  assert.equal(r2.statusCode, 200, r2.body);
  const cookie = r2.cookies.find((c) => c.name === 'sid');
  return { ...H, cookie: `sid=${cookie.value}` };
}

before(async () => {
  const config = loadConfig({
    skipDotEnv: true,
    dataDir,
    env: { NODE_ENV: 'test', DEMO_MODE: 'false', ADMIN_PHONES: '09120000001', PUBLIC_URL: 'http://localhost:3000' },
  });
  app = await buildApp({ config, logger: false, sms: { name: 'test', sendOtp: async (p, c) => sentCodes.set(p, c) } });
});

after(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('validators', () => {
  test('phone normalization', () => {
    assert.equal(normalizePhone('۰۹۱۲۳۴۵۶۷۸۹'), '09123456789');
    assert.equal(normalizePhone('+989123456789'), '09123456789');
    assert.equal(normalizePhone('0912345'), null);
  });
  test('national code', () => {
    assert.equal(isValidNationalCode('0499370899'), true);
    assert.equal(isValidNationalCode('0499370898'), false);
    assert.equal(isValidNationalCode('1111111111'), false);
  });
  test('bill ids round-trip and reject tampering', () => {
    const { billId, paymentId } = makeBill('7512345', 2, 1_250_000);
    const parsed = parseBill(billId, paymentId);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.service, 'electricity');
    assert.equal(parsed.amountRial, 1_250_000);
    const tampered = String(Number(paymentId.slice(0, -5)) + 1) + paymentId.slice(-5);
    assert.equal(parseBill(billId, tampered).ok, false);
  });
});

describe('security', () => {
  test('state-changing requests need the CSRF header', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/otp', payload: { phone: '09121111111' } });
    assert.equal(r.statusCode, 403);
  });
  test('cross-origin requests are rejected', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/otp', headers: { ...H, origin: 'https://evil.example' }, payload: { phone: '09121111111' } });
    assert.equal(r.statusCode, 403);
  });
  test('the app shell is served', async () => {
    const r = await app.inject({ method: 'GET', url: '/' });
    assert.equal(r.statusCode, 200);
    assert.match(r.body, /<script type="module" src="\/js\/app.js">/);
  });
  test('security headers are present', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/meta' });
    assert.match(r.headers['content-security-policy'], /script-src 'self'/);
    assert.equal(r.headers['x-frame-options'], 'DENY');
    assert.equal(r.headers['cache-control'], 'no-store');
  });
  test('OTP brute force is blocked after 5 wrong attempts', async () => {
    const phone = '09122222222';
    await app.inject({ method: 'POST', url: '/api/auth/otp', headers: H, payload: { phone } });
    for (let i = 0; i < 5; i++) {
      await app.inject({ method: 'POST', url: '/api/auth/verify', headers: H, payload: { phone, code: '000000' === sentCodes.get(phone) ? '111111' : '000000' } });
    }
    const r = await app.inject({ method: 'POST', url: '/api/auth/verify', headers: H, payload: { phone, code: sentCodes.get(phone) } });
    assert.equal(r.statusCode, 400);
  });
  test('demo code is not leaked when demo mode is off', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/otp', headers: H, payload: { phone: '09123333333' } });
    assert.equal(r.json().demoCode, undefined);
  });
  test('members cannot reach admin routes', async () => {
    const h = await login('09124444444');
    const r = await app.inject({ method: 'GET', url: '/api/admin/cases', headers: h });
    assert.equal(r.statusCode, 403);
  });
});

describe('full flow', () => {
  let requester, donor, admin, caseId, caseCode;
  const bill = makeBill('9876543', 3, 2_000_000);

  test('requester submits a gas bill', async () => {
    requester = await login('09125555555');
    const r = await app.inject({
      method: 'POST', url: '/api/my/cases', headers: requester,
      payload: { category: 'gas', title: 'قبض گاز زمستان', story: 'توضیح کامل وضعیت خانواده برای بررسی کارشناس و خیّرین عزیز.', province: 'تهران', billId: bill.billId, paymentId: bill.paymentId, fullName: 'نام آزمایشی', nationalCode: '0499370899' },
    });
    assert.equal(r.statusCode, 200, r.body);
    caseId = r.json().id;
    caseCode = r.json().code;
    assert.equal(r.json().amount, 2_000_000);
  });

  test('wrong category for the bill is refused', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/my/cases', headers: requester,
      payload: { category: 'water', title: 'قبض اشتباه', story: 'توضیح کامل وضعیت خانواده برای بررسی کارشناس و خیّرین.', province: 'تهران', billId: bill.billId, paymentId: bill.paymentId },
    });
    assert.equal(r.statusCode, 400);
  });

  test('uploads are type-checked by content and encrypted at rest', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
    const make = (buf, name, type) => {
      const b = '----x';
      const body = Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`), buf, Buffer.from(`\r\n--${b}--\r\n`)]);
      return { body, type: `multipart/form-data; boundary=${b}` };
    };
    const good = make(png, 'bill.png', 'image/png');
    const r1 = await app.inject({ method: 'POST', url: `/api/my/cases/${caseId}/documents`, headers: { ...requester, 'content-type': good.type }, payload: good.body });
    assert.equal(r1.statusCode, 200, r1.body);
    const evil = make(Buffer.from('<script>alert(1)</script>'.padEnd(64)), 'x.png', 'image/png');
    const r2 = await app.inject({ method: 'POST', url: `/api/my/cases/${caseId}/documents`, headers: { ...requester, 'content-type': evil.type }, payload: evil.body });
    assert.equal(r2.statusCode, 415);
    const stored = readdirSync(join(dataDir, 'uploads'));
    assert.equal(stored.length, 1);
    assert.equal(readFileSync(join(dataDir, 'uploads', stored[0])).includes(png.subarray(0, 8)), false);
  });

  test('other users cannot see or touch the case', async () => {
    donor = await login('09126666666');
    const r1 = await app.inject({ method: 'GET', url: `/api/my/cases/${caseId}`, headers: donor });
    assert.equal(r1.statusCode, 404);
    const r2 = await app.inject({ method: 'GET', url: `/api/cases/${caseCode}` });
    assert.equal(r2.statusCode, 404, 'pending cases are not public');
  });

  test('admin approves; public view hides identity', async () => {
    admin = await login('09120000001');
    const view = await app.inject({ method: 'GET', url: `/api/admin/cases/${caseId}`, headers: admin });
    assert.equal(view.json().owner.nationalCode, '0499370899');
    const r = await app.inject({ method: 'POST', url: `/api/admin/cases/${caseId}/review`, headers: admin, payload: { decision: 'approve' } });
    assert.equal(r.statusCode, 200, r.body);
    const pub = await app.inject({ method: 'GET', url: `/api/cases/${caseCode}` });
    assert.equal(pub.statusCode, 200);
    const text = pub.body;
    assert.ok(!text.includes('0499370899') && !text.includes('09125555555') && !text.includes(bill.billId));
  });

  test('a forged callback does not mark a donation paid', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/donations', headers: donor, payload: { caseCode, amountToman: '50000' } });
    assert.equal(r.statusCode, 200, r.body);
    const cb = await app.inject({ method: 'GET', url: `/payment/callback?donation=${r.json().id}&Status=OK` });
    assert.equal(cb.statusCode, 302);
    const d = await app.inject({ method: 'GET', url: `/api/my/donations/${r.json().id}`, headers: donor });
    assert.equal(d.json().status, 'failed');
  });

  test('paying the full amount funds the case and pays the bill', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/donations', headers: donor, payload: { caseCode, amountToman: '200000' } });
    const authority = new URL(r.json().redirectUrl).searchParams.get('authority');
    const done = await app.inject({ method: 'POST', url: '/api/mock-gateway/complete', headers: H, payload: { authority, pay: true } });
    await app.inject({ method: 'GET', url: done.json().redirect });
    const d = await app.inject({ method: 'GET', url: `/api/my/donations/${r.json().id}`, headers: donor });
    assert.equal(d.json().status, 'succeeded');
    assert.equal(d.json().case.status, 'paid');
    assert.ok(d.json().case.payoutRef);
    const replay = await app.inject({ method: 'GET', url: done.json().redirect });
    assert.equal(replay.statusCode, 302);
    const stats = await app.inject({ method: 'GET', url: '/api/stats' });
    assert.equal(stats.json().paidTotal, 2_000_000);
  });
});
