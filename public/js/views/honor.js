import { api, state } from '../api.js';
import { emptyState, fa, faDate, h, icon, toman } from '../ui.js';
import { avatar, levelBadge, medal } from '../rewards-ui.js';

function donorCard(d, rank) {
  // The hover/focus card lists the donor's medals without leaving the wall.
  return h('a', { class: `card donor-card ring-card-${d.level?.color ?? 'none'}`, href: `#/donor/${d.slug}` },
    rank <= 3 ? h('span', { class: `rank rank-${rank}` }, fa(rank)) : null,
    avatar(d.displayName, d.level, 'lg'),
    h('strong', {}, d.displayName),
    levelBadge(d.level),
    h('div', { class: 'muted small' }, `${fa(d.cases)} خانواده · ${fa(d.medals.length)} مدال`),
    d.isDemo ? h('span', { class: 'pill pill-muted' }, 'نمونه') : null,
    h('div', { class: 'donor-pop', 'aria-hidden': 'true' },
      d.bio ? h('p', { class: 'small' }, d.bio) : null,
      d.medals.length
        ? h('div', { class: 'hc-medals' }, d.medals.slice(0, 8).map((m) => medal(m, { size: 'sm', showTitle: false })))
        : h('span', { class: 'muted small' }, 'هنوز مدالی ندارد'),
      h('span', { class: 'muted small' }, `در ${fa(d.provinces)} استان کمک کرده است`)));
}

export async function honorView(page) {
  const [{ items }, rewards] = await Promise.all([api.get('/api/honor'), api.get('/api/rewards')]);
  page.append(
    h('section', { class: 'honor-hero' },
      h('div', { class: 'honor-trophy' }, icon('trophy')),
      h('h1', {}, 'تالار افتخار'),
      h('p', { class: 'muted' }, 'خیّرینی که خواسته‌اند نامشان دیده شود. ترتیب بر اساس اثر کمک‌هاست، اما مبلغ‌ها هرگز نمایش داده نمی‌شوند.')),
    h('div', { class: 'level-ladder' }, rewards.levels.map((l) =>
      h('div', { class: `ladder-step lvl-${l.color}` }, icon('star'), h('strong', {}, l.name),
        h('small', {}, l.minToman < 1_000_000 ? 'با اولین کمک' : `${fa(l.minToman / 1_000_000)} میلیون تومان یا ${fa(l.minCases)} درخواست`)))));
  if (!items.length) {
    page.append(emptyState('trophy', 'اولین نام تالار افتخار باشید', 'در پروفایل خود «نمایش در تالار افتخار» را روشن کنید.',
      h('a', { class: 'btn btn-primary', href: state.user ? '#/me?tab=settings' : '#/login' }, 'تنظیم پروفایل')));
    return;
  }
  page.append(h('div', { class: 'donor-grid' }, items.map((d, i) => donorCard(d, i + 1))));
}

export async function donorView(page, slug) {
  const d = await api.get(`/api/donors/${slug}`);
  page.append(
    h('a', { class: 'back', href: '#/honor' }, icon('back'), 'تالار افتخار'),
    h('div', { class: `card profile-hero ring-card-${d.level?.color ?? 'none'}` },
      avatar(d.displayName, d.level, 'xl'),
      h('h1', {}, d.displayName, d.isDemo ? h('span', { class: 'pill pill-muted' }, 'نمونه') : null),
      levelBadge(d.level),
      d.bio ? h('p', { class: 'muted' }, d.bio) : null,
      h('div', { class: 'hc-stats' },
        h('div', {}, h('strong', {}, fa(d.cases)), h('span', {}, 'خانواده')),
        h('div', {}, h('strong', {}, fa(d.provinces)), h('span', {}, 'استان')),
        h('div', {}, h('strong', {}, fa(d.medals.length)), h('span', {}, 'مدال'))),
      d.since ? h('div', { class: 'muted small' }, `همراه مهرپل از ${faDate(d.since)}`) : null),
    h('section', { class: 'card' }, h('h2', {}, icon('badge'), 'مدال‌ها'),
      d.medals.length ? h('div', { class: 'medal-grid' }, d.medals.map((m) => medal(m))) : h('p', { class: 'muted' }, 'هنوز مدالی کسب نشده است.')));
}

export async function certificateView(page, mode, code) {
  const c = await api.get(`/api/certificates/${code}`);
  const print = h('button', { class: 'btn btn-primary' }, icon('printer'), 'چاپ یا ذخیره PDF');
  print.onclick = () => window.print();
  page.append(
    mode === 'verify'
      ? h('div', { class: `alert ${c.valid ? 'alert-success' : 'alert-danger'} no-print` }, icon(c.valid ? 'check' : 'x'),
        c.valid ? 'این گواهی معتبر است و توسط مهرپل صادر شده.' : 'این گواهی باطل شده است.')
      : h('div', { class: 'row-gap no-print mb' }, print, h('a', { class: 'btn btn-ghost', href: '#/me' }, 'بازگشت به پروفایل')),
    h('article', { class: `certificate cert-${c.level.color}` },
      h('div', { class: 'cert-border' },
        h('div', { class: 'cert-top' }, h('img', { src: '/icons/logo.svg', alt: '', width: 56, height: 56 }), h('span', {}, state.meta.brand.name)),
        h('div', { class: 'cert-kicker' }, 'گواهی قدردانی'),
        h('p', { class: 'cert-lead' }, 'بدین‌وسیله از'),
        h('h1', { class: 'cert-name' }, c.name),
        h('p', { class: 'cert-lead' }, 'به پاس همراهی در پرداخت بدهی خانواده‌های نیازمند، با رسیدن به سطح'),
        h('div', { class: 'cert-level' }, c.level.name),
        h('p', { class: 'cert-lead' }, `قدردانی می‌شود. تا تاریخ صدور، با کمک ایشان بار ${fa(c.cases)} خانواده سبک‌تر شده است.`),
        h('div', { class: 'cert-seal', 'aria-hidden': 'true' }, icon('heart')),
        h('div', { class: 'cert-foot' },
          h('div', {}, h('small', {}, 'تاریخ صدور'), h('strong', {}, faDate(c.issuedAt))),
          h('div', {}, h('small', {}, 'کد استعلام'), h('strong', { dir: 'ltr', class: 'mono' }, c.code)),
          h('div', {}, h('small', {}, 'مجموع کمک'), h('strong', {}, toman(c.totalToman * 10)))),
        h('p', { class: 'cert-verify', dir: 'ltr' }, c.verifyUrl))));
}
