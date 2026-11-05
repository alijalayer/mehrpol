import { api, state } from '../api.js';
import { CATEGORY_ICONS, fa, h, icon, toman } from '../ui.js';
import { caseCard } from './cases.js';
import { installCard } from '../install.js';
import { medal } from '../rewards-ui.js';

export async function homeView(page) {
  const { brand, categories } = state.meta;
  const statsRow = h('div', { class: 'stats' });
  const featured = h('div', { class: 'grid' });

  page.append(
    h('section', { class: 'hero' },
      h('div', { class: 'hero-text' },
        h('span', { class: 'eyebrow' }, icon('shield'), 'شفاف، متن‌باز و بدون واسطهٔ نقدی'),
        h('h1', {}, 'نگذاریم ', h('em', {}, 'چراغ هیچ خانه‌ای'), ' خاموش بماند'),
        h('p', { class: 'lead' }, `${brand.name} قبض‌ها و بدهی‌های تأییدشدهٔ خانواده‌های نیازمند را به خیّرین نشان می‌دهد. پول شما مستقیم به ادارهٔ برق، آب، گاز یا طلبکار می‌رسد؛ نه به دست هیچ واسطه‌ای.`),
        h('div', { class: 'hero-actions' },
          h('a', { class: 'btn btn-primary btn-lg', href: '#/cases' }, icon('heart'), 'می‌خواهم کمک کنم'),
          h('a', { class: 'btn btn-lg btn-ghost', href: '#/new' }, 'درخواست کمک دارم'))),
      h('div', { class: 'hero-art', 'aria-hidden': 'true' },
        h('div', { class: 'bill-card bill-1' }, icon('bolt'), h('div', {}, h('strong', {}, 'قبض برق'), h('small', {}, 'پرداخت شد')), icon('check', 'ok')),
        h('div', { class: 'bill-card bill-2' }, icon('flame'), h('div', {}, h('strong', {}, 'قبض گاز'), h('small', {}, '۶۸٪ تأمین شده'))),
        h('div', { class: 'bill-card bill-3' }, icon('bank'), h('div', {}, h('strong', {}, 'قسط وام'), h('small', {}, 'مستقیم به بانک'))))),
    installCard() ?? '',
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
    h('section', { class: 'section' },
      h('h2', {}, 'راه‌های بیشتر برای مهربانی'),
      h('div', { class: 'ways' },
        way('gift', 'کارت هدیهٔ مهر', 'به‌جای هدیهٔ تولد، به یاد عزیزی که رفته یا برای ادای نذر، قبض یک خانواده را بدهید و کارت زیبایش را بفرستید.', '#/gift', 'ساخت کارت'),
        way('users', 'حلقهٔ مهر', 'ماهی یک مبلغ ثابت؛ مهرپل آن را به پرونده‌های نزدیک به تکمیل می‌رساند و گزارش اثرش را می‌بینید.', '#/circle', 'عضویت ماهانه'),
        way('trophy', 'کمپین‌ها', 'کمپین‌هایی که شرکت‌ها حامی‌شان هستند؛ گاهی هر تومان شما دو برابر می‌شود.', '#/campaigns', 'دیدن کمپین‌ها'),
        way('house', 'سازمان‌ها و خیریه‌ها', 'مسئولیت اجتماعی شفاف برای شرکت‌ها و همین سامانه با نام خیریهٔ شما.', '#/business', 'همکاری'))),
    h('section', { class: 'section reward-teaser' },
      h('div', { class: 'teaser-text' },
        h('span', { class: 'eyebrow' }, icon('trophy'), 'دستاوردها'),
        h('h2', {}, 'هر کمک، یک قدم تا مدال بعدی'),
        h('p', { class: 'muted' }, 'از «حامی» تا «سفیر مهر» بالا بروید، مدال بگیرید، گواهی قدردانیِ قابل استعلام دریافت کنید و اگر خواستید نامتان در تالار افتخار بدرخشد.'),
        h('div', { class: 'row-gap' }, h('a', { class: 'btn btn-primary', href: '#/honor' }, icon('trophy'), 'تالار افتخار'), h('a', { class: 'btn btn-ghost', href: state.user ? '#/me' : '#/login' }, 'دستاوردهای من'))),
      h('div', { class: 'teaser-medals', 'aria-hidden': 'true' },
        [['heart', 'نخستین گام', 'bronze'], ['check', 'گره‌گشا', 'silver'], ['map', 'سفیر ایران', 'gold'], ['users', 'صدتایی', 'diamond']]
          .map(([ic, title, tier]) => medal({ icon: ic, title, tier, earned: true }, { size: 'md' })))),
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

const step = (ic, title, text) => h('div', { class: 'step reveal' }, h('div', { class: 'step-icon' }, icon(ic)), h('h3', {}, title), h('p', { class: 'muted' }, text));
const stat = (value, label) => h('div', { class: 'stat reveal' }, h('strong', {}, value), h('span', {}, label));
const way = (ic, title, text, href, cta) => h('a', { class: 'card way tilt reveal', href },
  h('span', { class: 'way-icon' }, icon(ic)), h('h3', {}, title), h('p', { class: 'muted small' }, text), h('span', { class: 'way-cta' }, cta, icon('arrow')));
const trustItem = (ic, title, text) => h('div', { class: 'trust-item' }, icon(ic), h('div', {}, h('strong', {}, title), h('p', { class: 'muted small' }, text)));
