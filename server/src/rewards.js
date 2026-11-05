import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.js';

/**
 * Donor recognition: levels, medals and perks. Everything is derived from the
 * donor's verified donations on every request, so it can never drift from the
 * real ledger and cannot be granted by editing a counter.
 */

// A level is reached by total given OR by number of distinct requests helped.
export const LEVELS = [
  { id: 'supporter', name: 'حامی', color: 'teal', minToman: 1, minCases: 1 },
  { id: 'bronze', name: 'مهرآفرین برنزی', color: 'bronze', minToman: 1_000_000, minCases: 5 },
  { id: 'silver', name: 'مهرآفرین نقره‌ای', color: 'silver', minToman: 10_000_000, minCases: 20 },
  { id: 'gold', name: 'مهرآفرین طلایی', color: 'gold', minToman: 50_000_000, minCases: 50 },
  { id: 'diamond', name: 'سفیر مهر', color: 'diamond', minToman: 200_000_000, minCases: 150 },
];
export const levelIndex = (id) => LEVELS.findIndex((l) => l.id === id);
export const CERTIFICATE_MIN_LEVEL = 'bronze';

const count = (rows, pred) => rows.filter(pred).length;
const distinct = (rows, key) => new Set(rows.map(key).filter(Boolean)).size;

/** Longest run of consecutive calendar months (Gregorian, UTC) with at least one donation. */
function longestMonthStreak(rows) {
  const months = [...new Set(rows.map((r) => {
    const d = new Date(r.created_at);
    return d.getUTCFullYear() * 12 + d.getUTCMonth();
  }))].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  for (let i = 0; i < months.length; i++) {
    run = i > 0 && months[i] === months[i - 1] + 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

export const MEDALS = [
  { id: 'first-step', title: 'نخستین گام', icon: 'heart', tier: 'bronze', hint: 'اولین کمک خود را ثبت کنید', test: (s) => s.donations >= 1 },
  { id: 'closer', title: 'گره‌گشا', icon: 'check', tier: 'silver', hint: 'با کمک شما یک درخواست کامل شود', test: (s) => s.closed >= 1 },
  { id: 'closer-10', title: 'گره‌گشای بزرگ', icon: 'trophy', tier: 'gold', hint: '۱۰ درخواست با کمک شما کامل شود', test: (s) => s.closed >= 10 },
  { id: 'warmth', title: 'گرمای خانه', icon: 'flame', tier: 'bronze', hint: 'به ۳ قبض گاز کمک کنید', test: (s) => s.byCategory.gas >= 3 },
  { id: 'light', title: 'روشنایی', icon: 'bolt', tier: 'bronze', hint: 'به ۳ قبض برق کمک کنید', test: (s) => s.byCategory.electricity >= 3 },
  { id: 'spring', title: 'چشمهٔ مهر', icon: 'drop', tier: 'bronze', hint: 'به ۳ قبض آب کمک کنید', test: (s) => s.byCategory.water >= 3 },
  { id: 'healer', title: 'مرهم', icon: 'medical', tier: 'silver', hint: 'به ۳ هزینهٔ درمان کمک کنید', test: (s) => s.byCategory.medical >= 3 },
  { id: 'shelter', title: 'سرپناه', icon: 'house', tier: 'silver', hint: 'به ۳ اجاره یا قسط وام کمک کنید', test: (s) => s.byCategory.rent + s.byCategory.loan >= 3 },
  { id: 'all-round', title: 'همه‌جانبه', icon: 'sparkle', tier: 'silver', hint: 'در ۴ دستهٔ مختلف کمک کنید', test: (s) => s.categories >= 4 },
  { id: 'ambassador', title: 'سفیر ایران', icon: 'map', tier: 'gold', hint: 'به خانواده‌هایی در ۵ استان کمک کنید', test: (s) => s.provinces >= 5 },
  { id: 'loyal', title: 'همراه همیشگی', icon: 'clock', tier: 'gold', hint: 'سه ماه پشت‌سرهم کمک کنید', test: (s) => s.monthStreak >= 3 },
  { id: 'big-heart', title: 'دل دریایی', icon: 'star', tier: 'gold', hint: 'یک‌جا ۵ میلیون تومان یا بیشتر کمک کنید', test: (s) => s.maxSingleToman >= 5_000_000 },
  { id: 'backbone', title: 'پشتوانه', icon: 'shield', tier: 'bronze', hint: 'به صندوق عمومی کمک کنید', test: (s) => s.generalFund >= 1 },
  { id: 'pioneer', title: 'پیشگام', icon: 'badge', tier: 'gold', hint: 'جزو ۱۰۰ خیّر اول مهرپل باشید', test: (s) => s.pioneerRank > 0 && s.pioneerRank <= 100 },
  { id: 'hundred', title: 'صدتایی', icon: 'users', tier: 'diamond', hint: '۱۰۰ بار کمک کنید', test: (s) => s.donations >= 100 },
];

/** Aggregates a donor's verified donations into the numbers medals and levels read. */
export function donorStats(db, userId) {
  const rows = db.prepare(`
    SELECT d.amount, d.applied, d.closed_case, d.created_at, d.case_id, c.category, c.province
    FROM donations d LEFT JOIN cases c ON c.id = d.case_id
    WHERE d.donor_id = ? AND d.status = 'succeeded' AND d.gateway <> 'fund'`).all(userId);
  const caseRows = rows.filter((r) => r.case_id && r.applied > 0);
  const byCategory = { electricity: 0, water: 0, gas: 0, landline: 0, mobile: 0, loan: 0, rent: 0, medical: 0 };
  for (const cat of Object.keys(byCategory)) byCategory[cat] = distinct(caseRows.filter((r) => r.category === cat), (r) => r.case_id);

  let pioneerRank = 0;
  if (rows.length) {
    const first = Math.min(...rows.map((r) => r.created_at));
    pioneerRank = 1 + db.prepare(`
      SELECT COUNT(*) AS n FROM (
        SELECT donor_id, MIN(created_at) AS first FROM donations
        WHERE status = 'succeeded' AND gateway <> 'fund' AND donor_id IS NOT NULL GROUP BY donor_id
      ) WHERE first < ?`).get(first).n;
  }

  return {
    donations: rows.length,
    totalToman: Math.round(rows.reduce((s, r) => s + r.amount, 0) / 10),
    cases: distinct(caseRows, (r) => r.case_id),
    closed: count(rows, (r) => r.closed_case === 1),
    categories: distinct(caseRows, (r) => r.category),
    provinces: distinct(caseRows, (r) => r.province),
    byCategory,
    generalFund: count(rows, (r) => !r.case_id),
    maxSingleToman: rows.length ? Math.round(Math.max(...rows.map((r) => r.amount)) / 10) : 0,
    monthStreak: longestMonthStreak(rows),
    pioneerRank,
    firstAt: rows.length ? Math.min(...rows.map((r) => r.created_at)) : null,
  };
}

/** Current level, next level and 0–100 progress toward it (whichever path is closer). */
export function levelFor(stats) {
  let current = null;
  for (const l of LEVELS) if (stats.totalToman >= l.minToman || stats.cases >= l.minCases) current = l;
  const next = LEVELS[current ? levelIndex(current.id) + 1 : 0] ?? null;
  let progress = 100;
  if (next) {
    const base = current ?? { minToman: 0, minCases: 0 };
    const byAmount = (stats.totalToman - base.minToman) / (next.minToman - base.minToman);
    const byCases = (stats.cases - base.minCases) / (next.minCases - base.minCases);
    progress = Math.max(0, Math.min(99, Math.floor(Math.max(byAmount, byCases) * 100)));
  }
  return { current, next, progress };
}

export const medalsFor = (stats) => MEDALS.map(({ test, ...m }) => ({ ...m, earned: Boolean(test(stats)) }));

/** Perks per level from config/rewards.json. Inactive perks show as «به‌زودی». */
export function loadPerks() {
  const raw = JSON.parse(readFileSync(join(ROOT, 'config', 'rewards.json'), 'utf8'));
  return (raw.perks ?? []).filter((p) => levelIndex(p.level) >= 0).map((p) => ({
    level: p.level,
    title: String(p.title ?? '').slice(0, 120),
    description: String(p.description ?? '').slice(0, 300),
    partner: String(p.partner ?? '').slice(0, 80),
    active: p.active !== false,
  }));
}

export function perksFor(perks, level) {
  const reached = level.current ? levelIndex(level.current.id) : -1;
  return perks.map((p) => ({ ...p, unlocked: levelIndex(p.level) <= reached }));
}

export const levelView = (l) => (l ? { id: l.id, name: l.name, color: l.color, minToman: l.minToman, minCases: l.minCases } : null);
