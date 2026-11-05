import { api, state } from './api.js';
import { h, icon } from './ui.js';
import { homeView } from './views/home.js';
import { casesView, caseView } from './views/cases.js';
import { loginView } from './views/login.js';
import { accountView, myCaseView } from './views/account.js';
import { newRequestView } from './views/new-request.js';
import { receiptView } from './views/receipt.js';
import { ledgerView, trustView } from './views/trust.js';
import { adminView, adminCaseView, adminUserView } from './views/admin.js';
import { certificateView, donorView, honorView } from './views/honor.js';
import { profileMenu } from './rewards-ui.js';
import { latestRelease, updateNotice } from './update.js';
import { businessView, campaignView, campaignsView, cardView, circleView, giftView } from './views/giving.js';
import './motion.js';

const routes = [
  [/^\/$/, homeView, 'home'],
  [/^\/cases$/, casesView, 'cases'],
  [/^\/case\/([A-Z0-9]{7})$/, caseView, 'cases'],
  [/^\/login$/, loginView, 'me'],
  [/^\/me$/, accountView, 'me', { auth: true }],
  [/^\/new$/, newRequestView, 'new', { auth: true }],
  [/^\/request\/([\w-]{36})$/, myCaseView, 'me', { auth: true }],
  [/^\/receipt\/([\w-]{36})$/, receiptView, 'me', { auth: true }],
  [/^\/ledger$/, ledgerView, 'trust'],
  [/^\/trust$/, trustView, 'trust'],
  [/^\/honor$/, honorView, 'honor'],
  [/^\/gift$/, giftView, 'home'],
  [/^\/card\/([A-Z0-9x]{8})$/, cardView, 'home'],
  [/^\/circle$/, circleView, 'home'],
  [/^\/campaigns$/, campaignsView, 'home'],
  [/^\/campaign\/([a-z0-9-]{3,40})$/, campaignView, 'home'],
  [/^\/business$/, businessView, 'home'],
  [/^\/donor\/([a-z0-9]{8})$/, donorView, 'honor'],
  [/^\/(certificate|verify)\/(MP[A-Z0-9]{10})$/, certificateView, 'me'],
  [/^\/admin$/, adminView, 'me', { admin: true }],
  [/^\/admin\/case\/([\w-]{36})$/, adminCaseView, 'me', { admin: true }],
  [/^\/admin\/user\/([\w-]{36})$/, adminUserView, 'me', { admin: true }],
];

export function navigate(path) {
  location.hash = '#' + path;
}

export function currentQuery() {
  const q = location.hash.split('?')[1] ?? '';
  return new URLSearchParams(q);
}

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  const raw = location.hash.slice(1) || '/';
  const path = raw.split('?')[0];
  const main = document.getElementById('main');
  const match = routes.find(([re]) => re.test(path));
  if (!match) return navigate('/');
  const [re, view, tab, opts = {}] = match;
  if ((opts.auth || opts.admin) && !state.user) return navigate(`/login?next=${encodeURIComponent(raw)}`);
  if (opts.admin && state.user.role !== 'admin') return navigate('/');

  for (const a of document.querySelectorAll('[data-tab]')) a.classList.toggle('active', a.dataset.tab === tab);
  const params = path.match(re).slice(1);
  document.body.dataset.route = path.split('/')[1] || 'home';
  const page = h('div', { class: 'page' });
  main.replaceChildren(page);
  window.scrollTo({ top: 0 });
  try {
    await view(page, ...params);
  } catch (err) {
    if (seq !== renderSeq) return;
    page.replaceChildren(h('div', { class: 'empty' }, icon('x', 'empty-icon'), h('h3', {}, 'مشکلی پیش آمد'), h('p', {}, err.message),
      h('a', { class: 'btn', href: '#/' }, 'بازگشت به خانه')));
  }
  main.focus({ preventScroll: true });
}

function themeButton() {
  const btn = h('button', { class: 'theme-btn', type: 'button' });
  const draw = () => {
    const dark = window.mehrpolTheme.current() === 'dark';
    btn.replaceChildren(icon(dark ? 'sun' : 'moon'));
    btn.setAttribute('aria-label', dark ? 'حالت روز' : 'حالت شب');
    btn.title = dark ? 'حالت روز' : 'حالت شب';
  };
  btn.onclick = () => window.mehrpolTheme.toggle();
  document.addEventListener('themechange', draw);
  draw();
  return btn;
}

export function renderHeader() {
  const slot = document.getElementById('header-actions');
  if (!state.user) {
    slot.replaceChildren(themeButton(), h('a', { class: 'btn btn-sm', href: '#/login' }, 'ورود / ثبت‌نام'));
    return;
  }
  const logout = async () => {
    await api.post('/api/auth/logout');
    state.user = null;
    renderHeader();
    navigate('/');
  };
  // replaceChildren would print a null as text, so only real nodes are passed.
  const adminLink = state.user.role === 'admin' ? [h('a', { class: 'btn btn-sm btn-ghost hide-sm', href: '#/admin' }, icon('shield'), 'پنل مدیریت')] : [];
  slot.replaceChildren(themeButton(), ...adminLink, profileMenu(logout));
}

/** "ایده و ساخت: …" line; the name comes from the admin panel (trust settings). */
function creatorCredit() {
  const c = state.meta.creator;
  if (!c?.name) return '';
  const who = c.link ? h('a', { href: c.link, target: '_blank', rel: 'noopener noreferrer' }, c.name) : h('strong', {}, c.name);
  return h('div', { class: 'credit' }, icon('sparkle'), `${c.role || 'ایده و ساخت'}:`, who);
}

function shell() {
  const { brand } = state.meta;
  document.title = `${brand.name} | ${brand.tagline}`;
  const nav = [
    ['home', '#/', 'home', 'خانه'],
    ['cases', '#/cases', 'heart', 'کمک می‌کنم'],
    ['new', '#/new', 'plus', 'درخواست کمک'],
    ['trust', '#/trust', 'shield', 'شفافیت'],
    ['me', '#/me', 'user', 'حساب من'],
    ['honor', '#/honor', 'trophy', 'تالار افتخار'],
  ];
  document.getElementById('app').replaceChildren(
    state.meta.demoMode
      ? h('div', { class: 'demo-banner', role: 'note' }, icon('eye'), 'نسخهٔ نمایشی: پرداخت‌ها آزمایشی و پرونده‌ها نمونه‌اند.')
      : '',
    h('header', { class: 'topbar' },
      h('a', { class: 'brand', href: '#/' }, h('img', { src: '/icons/logo.svg', alt: '', width: 34, height: 34 }), h('span', {}, brand.name)),
      h('nav', { class: 'topnav', 'aria-label': 'منوی اصلی' }, [...nav.slice(0, 4), nav[5]].map(([tab, href, , label]) => h('a', { href, dataset: { tab } }, label))),
      h('div', { id: 'header-actions', class: 'header-actions' })),
    h('div', { id: 'notice', class: 'notice-slot' }),
    h('main', { id: 'main', tabindex: '-1' }),
    h('footer', { class: 'footer' },
      h('div', {}, h('strong', {}, brand.name), ' — ', brand.tagline),
      h('div', { class: 'footer-links' },
        h('a', { href: '#/trust' }, 'مجوزها و نمادها'),
        h('a', { href: '#/ledger' }, 'دفتر پرداخت‌ها'),
        h('a', { href: '#/honor' }, 'تالار افتخار'),
        h('a', { href: '#/gift' }, 'کارت هدیهٔ مهر'),
        h('a', { href: '#/circle' }, 'حلقهٔ مهر'),
        h('a', { href: '#/campaigns' }, 'کمپین‌ها'),
        h('a', { href: '#/business' }, 'همکاری سازمان‌ها'),
        h('a', { href: '#/trust' }, 'کد متن‌باز'),
        h('a', { id: 'apk-link', href: '/download/mehrpol.apk', hidden: true }, 'دریافت اپ اندروید')),
      creatorCredit(),
      h('small', {}, 'اطلاعات هویتی متقاضیان رمزنگاری می‌شود و هرگز به خیّرین نمایش داده نمی‌شود.')),
    h('nav', { class: 'tabbar', 'aria-label': 'منوی پایین' },
      nav.slice(0, 5).map(([tab, href, ic, label]) => h('a', { href, dataset: { tab } }, icon(ic), h('span', {}, label)))),
  );
  renderHeader();
  updateNotice().then((bar) => bar && document.getElementById('notice').replaceChildren(bar)).catch(() => {});
  latestRelease().then((r) => {
    if (r.available && /Android/.test(navigator.userAgent)) document.getElementById('apk-link').hidden = false;
  });
}

async function boot() {
  try {
    const [meta, me] = await Promise.all([api.get('/api/meta'), api.get('/api/me')]);
    state.meta = meta;
    state.user = me.user;
  } catch (err) {
    document.getElementById('app').replaceChildren(h('div', { class: 'empty' }, h('h3', {}, 'اتصال به سرور برقرار نشد'), h('p', {}, err.message)));
    return;
  }
  shell();
  window.addEventListener('hashchange', render);
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

boot();
