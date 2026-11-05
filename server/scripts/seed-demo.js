// Fills the database with clearly-labelled sample cases for presentations.
// Refuses to run unless DEMO_MODE=true. Every row gets is_demo = 1 and the UI marks it «نمونه».
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { makeBill } from '../src/bill.js';
import { newCaseCode } from '../src/domain.js';

const config = loadConfig();
if (!config.demoMode) {
  console.error('seed:demo only runs with DEMO_MODE=true');
  process.exit(1);
}
const db = openDb(config.dbFile);
const day = 86400_000;
if (db.prepare('SELECT COUNT(*) AS n FROM cases WHERE is_demo = 1').get().n === 0) seedCases();
if (db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_demo = 1 AND public_profile = 1').get().n === 0) seedDonors();
console.log('Demo data ready.');

function seedCases() {
const owner = randomUUID();
db.prepare("INSERT INTO users (id, phone, role, display_name, created_at) VALUES (?, '09000000000', 'member', 'نمونه', ?)").run(owner, Date.now());

const samples = [
  ['electricity', 2, 'قبض برق زمستان', 'مادری با دو فرزند دانش‌آموز که هزینهٔ گرمایش برقی در زمستان از توانش خارج شده است. (نمونهٔ نمایشی)', 'خراسان رضوی', 1_870_000, 'approved', 0.4],
  ['gas', 3, 'قبض گاز دو ماه', 'پدر خانواده به‌دلیل بیماری چند ماهی است کار نمی‌کند و قبض گاز معوق شده است. (نمونهٔ نمایشی)', 'آذربایجان شرقی', 2_430_000, 'approved', 0.15],
  ['water', 1, 'قبض آب معوق', 'سالمندی تنها که با مستمری اندک زندگی می‌کند و قبض آبش چند دوره پرداخت نشده است. (نمونهٔ نمایشی)', 'سیستان و بلوچستان', 640_000, 'approved', 0],
  ['loan', null, 'قسط عقب‌افتادهٔ وام ودیعه', 'کارگری که به‌خاطر تعطیلی کارگاه سه قسط وام ودیعهٔ مسکنش عقب افتاده است. پرداخت مستقیم به بانک انجام می‌شود. (نمونهٔ نمایشی)', 'تهران', 9_500_000, 'approved', 0.62],
  ['medical', null, 'هزینهٔ دارو و آزمایش', 'هزینهٔ داروی ماهانهٔ کودکی با بیماری خاص؛ پرداخت مستقیم به داروخانهٔ طرف قرارداد. (نمونهٔ نمایشی)', 'خوزستان', 4_200_000, 'approved', 0.3],
  ['electricity', 2, 'قبض برق تابستان', 'خانواده‌ای پنج‌نفره در هوای گرم جنوب که قبض کولر از توانشان خارج بود. (نمونهٔ نمایشی)', 'هرمزگان', 1_350_000, 'paid', 1],
  ['gas', 3, 'قبض گاز سرمای دی‌ماه', 'زن سرپرست خانوار در منطقه‌ای سردسیر. (نمونهٔ نمایشی)', 'اردبیل', 1_980_000, 'paid', 1],
];

let i = 0;
for (const [category, serviceDigit, title, story, province, toman, status, ratio] of samples) {
  const amount = toman * 10;
  const bill = serviceDigit ? makeBill(`${4100000 + i * 137}`, serviceDigit, amount) : null;
  const created = Date.now() - (10 - i) * day;
  db.prepare(`INSERT INTO cases (id, code, user_id, category, title, story, province, bill_id, payment_id, amount, raised, status,
      bill_verified, payout_ref, is_demo, created_at, reviewed_at, paid_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`)
    .run(randomUUID(), newCaseCode(), owner, category, title, story, province, bill?.billId ?? null, bill?.paymentId ?? null,
      amount, Math.round((amount * ratio) / 10000) * 10000, status, bill ? 1 : 0,
      status === 'paid' ? `TEST-${100000 + i}` : null, created, created + day / 2, status === 'paid' ? created + 2 * day : null);
  i++;
}
console.log(`Seeded ${samples.length} demo cases.`);
}

/** Sample donors for the honor wall. Their donations point at the sample cases only. */
function seedDonors() {
  const cases = db.prepare('SELECT id FROM cases WHERE is_demo = 1 ORDER BY created_at').all();
  const donors = [
    ['مهرآفرین نمونه ۱', 'هر ماه سهم کوچکی کنار می‌گذارم. (نمونه)', 240_000_000, 160, 7],
    ['مهرآفرین نمونه ۲', 'به یاد مادربزرگم که همیشه دست‌گیر بود. (نمونه)', 62_000_000, 55, 6],
    ['مهرآفرین نمونه ۳', '', 14_000_000, 24, 5],
    ['مهرآفرین نمونه ۴', 'گرمای خانهٔ هم‌وطن، گرمای دل من است. (نمونه)', 3_200_000, 8, 4],
    ['مهرآفرین نمونه ۵', '', 600_000, 2, 2],
  ];
  const ins = db.prepare(`INSERT INTO donations (id, case_id, donor_id, amount, applied, closed_case, status, gateway, authority, ref_id, anonymous, created_at, verified_at)
    VALUES (?, ?, ?, ?, ?, ?, 'succeeded', 'demo', NULL, ?, 1, ?, ?)`);
  donors.forEach(([name, bio, totalToman, count, spread], n) => {
    const id = randomUUID();
    db.prepare(`INSERT INTO users (id, phone, role, display_name, bio, public_profile, slug, is_demo, created_at)
      VALUES (?, ?, 'member', ?, ?, 1, ?, 1, ?)`).run(id, `0900000000${n + 1}`, name, bio, `demo000${n + 1}`, Date.now() - 400 * day);
    const each = Math.round((totalToman * 10) / count / 10000) * 10000;
    for (let k = 0; k < count; k++) {
      // Spread donations over past months (for the streak medal) and across sample cases.
      const at = Date.now() - (k * 9 + n) * day;
      ins.run(randomUUID(), cases[k % spread].id, id, each, each, k < count / 6 ? 1 : 0, `DEMO-${n}${k}`, at, at);
    }
  });
  console.log(`Seeded ${donors.length} demo donors.`);
}
