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
    env: { NODE_ENV: 'test', DEMO_MODE: 'false', ADMIN_PHONES: '09120000001', PUBLIC_URL: 'http://localhost:3000', ALLOW_TEST_PAYMENTS: 'true' },
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

  test('donor earns level and medals from verified donations only', async () => {
    const p = (await app.inject({ method: 'GET', url: '/api/my/profile', headers: donor })).json();
    assert.equal(p.level.current.id, 'supporter');
    const earned = p.medals.filter((m) => m.earned).map((m) => m.id);
    assert.ok(earned.includes('first-step') && earned.includes('closer') && earned.includes('pioneer'));
    assert.ok(!earned.includes('big-heart'));
    assert.equal(p.stats.donations, 1, 'the failed donation does not count');
    assert.equal(p.canCertify, false);
  });

  test('certificate requires bronze level', async () => {
    await app.inject({ method: 'PATCH', url: '/api/my/profile', headers: donor, payload: { displayName: 'خیّر آزمایشی' } });
    const r = await app.inject({ method: 'POST', url: '/api/my/certificate', headers: donor });
    assert.equal(r.statusCode, 403);
    const fake = await app.inject({ method: 'GET', url: '/api/certificates/MPAAAAAAAAAA' });
    assert.equal(fake.statusCode, 404);
  });

  test('bronze donor gets a verifiable certificate', async () => {
    const { db } = app.ctx;
    const donorId = db.prepare("SELECT id FROM users WHERE phone = '09126666666'").get().id;
    const caseRow = db.prepare('SELECT id FROM cases LIMIT 1').get();
    for (let i = 0; i < 5; i++) {
      db.prepare(`INSERT INTO donations (id, case_id, donor_id, amount, applied, status, gateway, created_at, verified_at)
        VALUES (?, ?, ?, 2000000, 2000000, 'succeeded', 'mock', ?, ?)`).run(`00000000-0000-4000-8000-00000000000${i}`, caseRow.id, donorId, Date.now(), Date.now());
    }
    const r = await app.inject({ method: 'POST', url: '/api/my/certificate', headers: donor });
    assert.equal(r.statusCode, 200, r.body);
    const cert = (await app.inject({ method: 'GET', url: `/api/certificates/${r.json().code}` })).json();
    assert.equal(cert.valid, true);
    assert.equal(cert.level.id, 'bronze');
    assert.equal(cert.name, 'خیّر آزمایشی');
    const again = await app.inject({ method: 'POST', url: '/api/my/certificate', headers: donor });
    assert.equal(again.json().code, r.json().code, 'same level and name reuse the certificate');
  });

  test('honor wall shows only opted-in donors and never amounts or phones', async () => {
    let wall = (await app.inject({ method: 'GET', url: '/api/honor' })).json();
    assert.equal(wall.items.length, 0);
    await app.inject({ method: 'PATCH', url: '/api/my/profile', headers: donor, payload: { publicProfile: true } });
    const res = await app.inject({ method: 'GET', url: '/api/honor' });
    wall = res.json();
    assert.equal(wall.items.length, 1);
    assert.equal(wall.items[0].displayName, 'خیّر آزمایشی');
    assert.ok(!res.body.includes('09126666666') && !res.body.includes('totalToman'));
    const one = await app.inject({ method: 'GET', url: `/api/donors/${wall.items[0].slug}` });
    assert.equal(one.statusCode, 200);
  });
});

describe('admin panel', () => {
  let admin;
  let member;
  const multipart = (parts) => {
    const b = '----y';
    const chunks = parts.map(([name, value, filename]) => Buffer.concat([
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${name}"${filename ? `; filename="${filename}"` : ''}\r\n\r\n`),
      Buffer.isBuffer(value) ? value : Buffer.from(value), Buffer.from('\r\n')]));
    return { body: Buffer.concat([...chunks, Buffer.from(`--${b}--\r\n`)]), type: `multipart/form-data; boundary=${b}` };
  };

  before(async () => {
    admin = await login('09120000001');
    member = await login('09127777777');
  });

  test('members cannot open any admin panel route', async () => {
    for (const url of ['/api/admin/overview', '/api/admin/users', '/api/admin/donations', '/api/admin/events', '/api/admin/trust', '/api/admin/app']) {
      const res = await app.inject({ method: 'GET', url, headers: member });
      assert.equal(res.statusCode, 403, url);
    }
  });

  test('dashboard counts users and shows sign-ins with device and IP', async () => {
    const o = (await app.inject({ method: 'GET', url: '/api/admin/overview', headers: admin })).json();
    assert.ok(o.users.total >= 2);
    const login = o.events.find((e) => e.action === 'user.login' && e.phone === '09127777777');
    assert.ok(login && login.detail.ip, 'sign-in event with IP');
  });

  test('user list and profile reveal identity only to the admin, and the viewing is logged', async () => {
    const list = (await app.inject({ method: 'GET', url: '/api/admin/users?q=0912555', headers: admin })).json();
    assert.equal(list.items.length, 1);
    assert.equal(list.items[0].fullName, 'نام آزمایشی');
    const one = (await app.inject({ method: 'GET', url: `/api/admin/users/${list.items[0].id}`, headers: admin })).json();
    assert.equal(one.nationalCode, '0499370899');
    assert.equal(one.cases.length, 1);
    const ev = (await app.inject({ method: 'GET', url: '/api/admin/events?type=admin', headers: admin })).json();
    assert.ok(ev.items.some((e) => e.action === 'admin.user.viewed'));
  });

  test('trust page edits are cleaned before they go public', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/admin/trust', headers: admin, payload: {
      creator: { name: 'سازنده', role: 'ایده‌پرداز', link: 'javascript:alert(1)' },
      badges: [{ id: 'enamad', title: 'نماد', image: '/files/../../etc/passwd', link: 'https://enamad.ir/x' }],
    } });
    assert.equal(res.statusCode, 200, res.body);
    const pub = (await app.inject({ method: 'GET', url: '/api/trust' })).json();
    assert.equal(pub.creator.name, 'سازنده');
    assert.equal(pub.creator.link, '');
    assert.equal(pub.badges.length, 0, 'a badge without a valid image stays hidden outside demo mode');
    const meta = (await app.inject({ method: 'GET', url: '/api/meta' })).json();
    assert.equal(meta.creator.name, 'سازنده');
  });

  test('public files are type-checked and served safely', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
    const up = multipart([['file', png, 'badge.png']]);
    const res = await app.inject({ method: 'POST', url: '/api/admin/files', headers: { ...admin, 'content-type': up.type }, payload: up.body });
    assert.equal(res.statusCode, 200, res.body);
    const file = await app.inject({ method: 'GET', url: res.json().url });
    assert.equal(file.headers['content-type'], 'image/png');
    assert.match(file.headers['content-security-policy'], /sandbox/);
    const bad = multipart([['file', Buffer.from('<html>'.padEnd(64)), 'x.png']]);
    const r2 = await app.inject({ method: 'POST', url: '/api/admin/files', headers: { ...admin, 'content-type': bad.type }, payload: bad.body });
    assert.equal(r2.statusCode, 415);
  });

  test('a published APK is offered to older app versions and downloads', async () => {
    assert.equal((await app.inject({ method: 'GET', url: '/api/app/latest' })).json().available, false);
    const notApk = multipart([['version', '1.0.3'], ['versionCode', '3'], ['file', Buffer.from('not a zip at all'), 'x.apk']]);
    const r1 = await app.inject({ method: 'POST', url: '/api/admin/app', headers: { ...admin, 'content-type': notApk.type }, payload: notApk.body });
    assert.equal(r1.statusCode, 415);
    const apk = Buffer.concat([Buffer.from('PK\x03\x04', 'latin1'), Buffer.alloc(32), Buffer.from('AndroidManifest.xml'), Buffer.alloc(32)]);
    const good = multipart([['version', '1.0.3'], ['versionCode', '3'], ['notes', 'رنگ‌های تازه'], ['file', apk, 'mehrpol.apk']]);
    const r2 = await app.inject({ method: 'POST', url: '/api/admin/app', headers: { ...admin, 'content-type': good.type }, payload: good.body });
    assert.equal(r2.statusCode, 200, r2.body);
    const latest = (await app.inject({ method: 'GET', url: '/api/app/latest' })).json();
    assert.equal(latest.versionCode, 3);
    const dl = await app.inject({ method: 'GET', url: latest.url });
    assert.equal(dl.statusCode, 200);
    assert.match(dl.headers['content-disposition'], /mehrpol-1\.0\.3\.apk/);
    assert.equal(dl.rawPayload.length, apk.length);
  });
});

describe('revenue and management team', () => {
  let owner;
  let donor;
  let caseCode;
  const pay = async (res) => {
    assert.equal(res.statusCode, 200, res.body);
    const authority = new URL(res.json().redirectUrl).searchParams.get('authority');
    const done = await app.inject({ method: 'POST', url: '/api/mock-gateway/complete', headers: H, payload: { authority, pay: true } });
    await app.inject({ method: 'GET', url: done.json().redirect });
    return { id: res.json().id, authority };
  };
  const revenue = async () => (await app.inject({ method: 'GET', url: '/api/admin/revenue', headers: owner })).json();

  before(async () => {
    owner = await login('09120000001');
    donor = await login('09129999999');
    const requester = await login('09128888888');
    const bill = makeBill('2468024', 2, 2_000_000);
    const c = await app.inject({ method: 'POST', url: '/api/my/cases', headers: requester, payload: {
      category: 'electricity', title: 'قبض برق زمستان', story: 'توضیح کامل وضعیت خانواده برای بررسی کارشناس و خیّرین عزیز.', province: 'تهران',
      billId: bill.billId, paymentId: bill.paymentId, fullName: 'نام دوم', nationalCode: '0499370899' } });
    assert.equal(c.statusCode, 200, c.body);
    await app.inject({ method: 'POST', url: `/api/admin/cases/${c.json().id}/review`, headers: owner, payload: { decision: 'approve' } });
    caseCode = c.json().code;
  });

  test('a tip is charged on top and booked as income; the family gets the whole donation', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/donations', headers: donor, payload: { caseCode, amountToman: '30000', tipPercent: 10 } });
    const { authority } = await pay(res);
    assert.equal((await app.inject({ method: 'GET', url: `/api/mock-gateway/${authority}` })).json().amount, 330_000);
    const c = (await app.inject({ method: 'GET', url: `/api/cases/${caseCode}` })).json();
    assert.equal(c.raised, 300_000);
    assert.equal((await revenue()).all.tip, 30_000);
    const bad = await app.inject({ method: 'POST', url: '/api/donations', headers: donor, payload: { caseCode, amountToman: '30000', tipPercent: 7 } });
    assert.equal(bad.statusCode, 400);
  });

  test('a gift card goes to families automatically and its fee is income', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/gifts', headers: donor, payload: { kind: 'memory', theme: 'dawn', fromName: 'خانوادهٔ نمونه', toName: 'پدربزرگ', message: 'روحش شاد', amountToman: '50000' } });
    const code = res.json().code;
    assert.equal((await app.inject({ method: 'GET', url: `/api/gifts/${code}` })).statusCode, 404, 'unpaid cards stay hidden');
    await pay(res);
    const card = (await app.inject({ method: 'GET', url: `/api/gifts/${code}` })).json();
    assert.equal(card.toName, 'پدربزرگ');
    assert.ok(card.helped >= 1);
    assert.equal((await revenue()).all.gift_fee, 200_000);
  });

  test('the monthly circle starts after payment and spreads the gift over cases', async () => {
    await pay(await app.inject({ method: 'POST', url: '/api/circle/pay', headers: donor, payload: { amountToman: '100000', category: 'electricity' } }));
    const m = (await app.inject({ method: 'GET', url: '/api/my/circle', headers: donor })).json();
    assert.equal(m.member.active, true);
    assert.ok(m.thisMonth.cases >= 1);
    assert.equal((await revenue()).members, 1);
  });

  test('a sponsored campaign shows public giving plus the sponsor match', async () => {
    const c = await app.inject({ method: 'POST', url: '/api/admin/campaigns', headers: owner, payload: { slug: 'winter-light', title: 'زمستان روشن', sponsor: 'شرکت نمونه', goalToman: '1000000', matchPercent: 100, matchCapToman: '15000' } });
    assert.equal(c.statusCode, 200, c.body);
    await pay(await app.inject({ method: 'POST', url: '/api/donations', headers: donor, payload: { campaign: 'winter-light', amountToman: '20000' } }));
    const v = (await app.inject({ method: 'GET', url: '/api/campaigns/winter-light' })).json();
    assert.equal(v.raised, 200_000);
    assert.equal(v.matched, 150_000, 'match stops at the cap');
  });

  test('senior managers manage the team; plain admins cannot', async () => {
    assert.equal((await app.inject({ method: 'POST', url: '/api/admin/team', headers: donor, payload: { phone: '09121112222', level: 'admin' } })).statusCode, 403);
    const add = await app.inject({ method: 'POST', url: '/api/admin/team', headers: owner, payload: { phone: '09121112222', level: 'admin' } });
    assert.equal(add.statusCode, 200, add.body);
    const helper = await login('09121112222');
    const me = (await app.inject({ method: 'GET', url: '/api/me', headers: helper })).json().user;
    assert.equal(me.role, 'admin');
    assert.equal(me.isOwner, false);
    assert.equal((await app.inject({ method: 'GET', url: '/api/admin/overview', headers: helper })).statusCode, 200);
    assert.equal((await app.inject({ method: 'PUT', url: '/api/admin/trust', headers: helper, payload: {} })).statusCode, 403);
    assert.equal((await app.inject({ method: 'GET', url: '/api/admin/revenue', headers: helper })).statusCode, 403);
    const self = (await app.inject({ method: 'GET', url: '/api/me', headers: owner })).json().user;
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/admin/team/${self.id}`, headers: owner })).statusCode, 409);
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/admin/team/${add.json().id}`, headers: owner })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/api/admin/overview', headers: helper })).statusCode, 403);
  });

  test('companies and charities can ask to partner without an account', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/leads', headers: H, payload: { type: 'company', org: 'شرکت نمونه', contact: 'خانم نمونه', phone: '02188888888', plan: 'grow' } });
    assert.equal(r.statusCode, 200, r.body);
    const leads = (await app.inject({ method: 'GET', url: '/api/admin/leads', headers: owner })).json();
    assert.equal(leads.items[0].org, 'شرکت نمونه');
  });
});

describe('demo mode keeps the admin panel locked', () => {
  let demo;
  const dir = mkdtempSync(join(tmpdir(), 'mehrpol-demo-'));
  before(async () => {
    const config = loadConfig({ skipDotEnv: true, dataDir: dir, env: { NODE_ENV: 'test', DEMO_MODE: 'true', ADMIN_PHONES: '09120000001', ADMIN_LOGIN_KEY: 'k-7f3a91', PUBLIC_URL: 'http://localhost:3000' } });
    demo = await buildApp({ config, logger: false, sms: { name: 'test', sendOtp: async () => {} } });
  });
  after(async () => {
    await demo.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('members see their code; admins need the manager key first', async () => {
    const member = await demo.inject({ method: 'POST', url: '/api/auth/otp', headers: H, payload: { phone: '09125550000' } });
    assert.ok(member.json().demoCode);
    const noKey = await demo.inject({ method: 'POST', url: '/api/auth/otp', headers: H, payload: { phone: '09120000001' } });
    assert.equal(noKey.statusCode, 403);
    assert.equal(noKey.json().needsAdminKey, true);
    const wrong = await demo.inject({ method: 'POST', url: '/api/auth/otp', headers: H, payload: { phone: '09120000001', adminKey: 'guess' } });
    assert.equal(wrong.statusCode, 403);
    const right = await demo.inject({ method: 'POST', url: '/api/auth/otp', headers: H, payload: { phone: '09120000001', adminKey: 'k-7f3a91' } });
    assert.ok(right.json().demoCode);
  });
});

describe('real mode with email sign-in', () => {
  let live;
  const dir = mkdtempSync(join(tmpdir(), 'mehrpol-live-'));
  const mails = [];
  const codeFrom = (to) => [...mails].reverse().find((m) => [].concat(m.to).includes(to))?.text.match(/\d{6}/)?.[0];
  const signIn = async (body) => {
    const r1 = await live.inject({ method: 'POST', url: '/api/auth/otp', headers: H, payload: body });
    assert.equal(r1.statusCode, 200, r1.body);
    if (body.email && !live.ctx.config.demoMode) assert.equal(r1.json().demoCode, undefined, 'real mode never shows the code');
    const code = body.email ? codeFrom(body.email) : sentCodes.get(body.phone);
    const r2 = await live.inject({ method: 'POST', url: '/api/auth/verify', headers: H, payload: { ...body, code } });
    assert.equal(r2.statusCode, 200, r2.body);
    return { ...H, cookie: `sid=${r2.cookies.find((c) => c.name === 'sid').value}` };
  };
  let owner;

  before(async () => {
    const config = loadConfig({ skipDotEnv: true, dataDir: dir, env: { NODE_ENV: 'test', DEMO_MODE: 'true', ADMIN_PHONES: '09120000009', PUBLIC_URL: 'http://localhost:3000' } });
    live = await buildApp({
      config, logger: false,
      sms: { name: 'test', sendOtp: async (p, c) => sentCodes.set(p, c) },
      mailer: { configured: () => true, send: async (m) => mails.push(m) },
    });
  });
  after(async () => {
    await live.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('switching to email-only sign-in is refused until the owner has linked an email', async () => {
    // Demo mode: the founder (phone) signs in with the manager key flow disabled because no key is set,
    // so use the phone channel while it is still allowed.
    const r = await live.inject({ method: 'POST', url: '/api/auth/otp', headers: H, payload: { phone: '09120000009' } });
    assert.equal(r.statusCode, 403, 'admins get no on-screen code without a manager key');
    // Real mode on phone, then the founder signs in with the code that went "by SMS".
    live.ctx.config.demoMode = false;
    owner = await signIn({ phone: '09120000009' });
    const refused = await live.inject({ method: 'PUT', url: '/api/admin/settings/mode', headers: owner, payload: { live: true, channel: 'email' } });
    assert.equal(refused.statusCode, 409);
    const link = await live.inject({ method: 'POST', url: '/api/my/email', headers: owner, payload: { email: 'Owner@Example.com' } });
    assert.equal(link.statusCode, 200, link.body);
    const ok = await live.inject({ method: 'POST', url: '/api/my/email/verify', headers: owner, payload: { email: 'owner@example.com', code: codeFrom('owner@example.com') } });
    assert.equal(ok.json().email, 'owner@example.com');
    const on = await live.inject({ method: 'PUT', url: '/api/admin/settings/mode', headers: owner, payload: { live: true, channel: 'email' } });
    assert.equal(on.statusCode, 200, on.body);
    assert.equal((await live.inject({ method: 'GET', url: '/api/meta' })).json().loginChannel, 'email');
  });

  test('a real person signs up by email, the code is mailed (not shown), and phone sign-in is closed', async () => {
    assert.equal((await live.inject({ method: 'POST', url: '/api/auth/otp', headers: H, payload: { phone: '09125550001' } })).statusCode, 400);
    const maryam = await signIn({ email: 'maryam@example.com' });
    const me = (await live.inject({ method: 'GET', url: '/api/me', headers: maryam })).json().user;
    assert.equal(me.email, 'maryam@example.com');
    assert.equal(me.phone, null);

    // Her request needs a contact number; the admin team gets an email about it.
    const bill = makeBill('3579135', 3, 1_500_000);
    const base = { category: 'gas', title: 'قبض گاز زمستان', story: 'توضیح کامل وضعیت خانواده برای بررسی کارشناس و خیّرین عزیز.', province: 'تهران', billId: bill.billId, paymentId: bill.paymentId, fullName: 'مریم نمونه', nationalCode: '0499370899' };
    assert.equal((await live.inject({ method: 'POST', url: '/api/my/cases', headers: maryam, payload: base })).statusCode, 400);
    const before = mails.length;
    const c = await live.inject({ method: 'POST', url: '/api/my/cases', headers: maryam, payload: { ...base, contactPhone: '09125550001' } });
    assert.equal(c.statusCode, 200, c.body);
    await new Promise((r2) => setTimeout(r2, 20));
    assert.ok(mails.slice(before).some((m) => [].concat(m.to).includes('owner@example.com') && m.subject.includes('درخواست تازه')));
    const users = (await live.inject({ method: 'GET', url: '/api/admin/users?q=maryam', headers: owner })).json();
    assert.equal(users.items[0].fullName, 'مریم نمونه');
  });

  test('real mode closes the test payment gateway', async () => {
    const donor = await signIn({ email: 'donor@example.com' });
    const r = await live.inject({ method: 'POST', url: '/api/donations', headers: donor, payload: { amountToman: '50000' } });
    assert.equal(r.statusCode, 503);
    assert.equal((await live.inject({ method: 'GET', url: '/api/meta' })).json().paymentsOpen, false);
  });
});
