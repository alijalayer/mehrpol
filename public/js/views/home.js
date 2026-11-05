import { api, state } from '../api.js';
import { CATEGORY_ICONS, fa, h, icon, toman } from '../ui.js';
import { caseCard } from './cases.js';

export async function homeView(page) {
  const { brand, categories } = state.meta;
  const statsRow = h('div', { class: 'stats' });
  const featured = h('div', { class: 'grid' });

  page.append(
    h('section', { class: 'hero' },
      h('div', { class: 'hero-text' },
        h('span', { class: 'eyebrow' }, icon('shield'), 'شفاف، متن‌باز و بدون واسطهٔ نقدی'),
        h('h1', {}, 'قبض یک خانواده را ', h('em', {}, 'همین امروز'), ' پرداخت کنید'),
        h('p', { class: 'lead' }, `${brand.name} قبض‌ها و بدهی‌های تأییدشدهٔ خانواده‌های نیازمند را به خیّرین نشان می‌دهد. پول شما مستقیم به ادارهٔ برق، آب، گاز یا طلبکار می‌رسد؛ نه به دست هیچ واسطه‌ای.`),
        h('div', { class: 'hero-actions' },
          h('a', { class: 'btn btn-primary btn-lg', href: '#/cases' }, icon('heart'), 'می‌خواهم کمک کنم'),
          h('a', { class: 'btn btn-lg btn-ghost', href: '#/new' }, 'درخواست کمک دارم'))),
      h('div', { class: 'hero-art', 'aria-hidden': 'true' },
        h('div', { class: 'bill-card bill-1' }, icon('bolt'), h('div', {}, h('strong', {}, 'قبض برق'), h('small', {}, 'پرداخت شد')), icon('check', 'ok')),
        h('div', { class: 'bill-card bill-2' }, icon('flame'), h('div', {}, h('strong', {}, 'قبض گاز'), h('small', {}, '۶۸٪ تأمین شده'))),
        h('div', { class: 'bill-card bill-3' }, icon('bank'), h('div', {}, h('strong', {}, 'قسط وام'), h('small', {}, 'مستقیم به بانک'))))),
    statsRow,
    h('section', { class: 'section' },
      h('h2', {}, 'چطور کار می‌کند؟'),
      h('div', { class: 'steps' },
        step('upload', 'ثبت درخواست', 'متقاضی قبض یا مدرک بدهی را با هویت واقعی ثبت می‌کند.'),
        step('shield', 'بررسی و استعلام', 'کارشناس هویت و مدارک را بررسی و قبض را از بانک استعلام می‌کند.'),
        step('heart', 'انتخاب خیّر', 'شما پرونده‌ای بی‌نام را انتخاب و تمام یا بخشی از آن را پرداخت می‌کنید.'),
        step('receipt', 'پرداخت مستقیم', 'مبلغ مستقیم به سازمان یا طلبکار واریز و کد پیگیری برای شما ثبت می‌شود.'))),
    h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('h2', {}, 'نزدیک به تکمیل'), h('a', { href: '#/cases' }, 'همه', icon('arrow'))),
      featured),
    h('section', { class: 'section' },
      h('h2', {}, 'به چه چیزی کمک کنم؟'),
      h('div', { class: 'cat-grid' }, Object.entries(categories).map(([key, c]) =>
        h('a', { class: `cat-tile cat-${key}`, href: `#/cases?cat=${key}` }, icon(CATEGORY_ICONS[key]), h('span', {}, c.label))))),
    h('section', { class: 'section trust-strip' },
      trustItem('lock', 'رمزنگاری اطلاعات', 'نام، کد ملی و مدارک متقاضی با AES-256 رمزنگاری می‌شود.'),
      trustItem('eye', 'دفتر عمومی پرداخت‌ها', 'هر پرداخت با کد پیگیری در دفتر عمومی ثبت می‌شود.'),
      trustItem('code', 'کد متن‌باز', 'کد برنامه برای همه قابل بازبینی است.'),
      h('a', { class: 'btn btn-ghost', href: '#/trust' }, 'مجوزها و نمادها')));

  const [stats, cases] = await Promise.all([api.get('/api/stats'), api.get('/api/cases')]);
  statsRow.append(
    stat(toman(stats.paidTotal), 'پرداخت‌شده'),
    stat(fa(stats.paidCases), 'بدهی تسویه‌شده'),
    stat(fa(stats.openCases), 'درخواست باز'),
    stat(fa(stats.donors), 'خیّر'));
  if (cases.items.length) featured.append(...cases.items.slice(0, 3).map(caseCard));
  else featured.replaceWith(h('p', { class: 'muted' }, 'به‌زودی اولین درخواست‌های تأییدشده اینجا نمایش داده می‌شوند.'));
}

const step = (ic, title, text) => h('div', { class: 'step' }, h('div', { class: 'step-icon' }, icon(ic)), h('h3', {}, title), h('p', { class: 'muted' }, text));
const stat = (value, label) => h('div', { class: 'stat' }, h('strong', {}, value), h('span', {}, label));
const trustItem = (ic, title, text) => h('div', { class: 'trust-item' }, icon(ic), h('div', {}, h('strong', {}, title), h('p', { class: 'muted small' }, text)));
