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
if (db.prepare('SELECT COUNT(*) AS n FROM cases WHERE is_demo = 1').get().n > 0) {
  console.log('Demo data already present.');
  process.exit(0);
}

const owner = randomUUID();
db.prepare("INSERT INTO users (id, phone, role, display_name, created_at) VALUES (?, '09000000000', 'member', 'نمونه', ?)").run(owner, Date.now());

const day = 86400_000;
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
