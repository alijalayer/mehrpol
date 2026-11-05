import { api, state } from '../api.js';
import { CATEGORY_ICONS, emptyState, faDate, h, icon, toman } from '../ui.js';

export async function trustView(page) {
  const [trust, stats] = await Promise.all([api.get('/api/trust'), api.get('/api/stats')]);
  const demo = state.meta.demoMode;
  const org = trust.organization;
  const charity = trust.partnerCharity;

  const badgeTile = (b) => b.image
    ? h('a', { class: 'badge-tile', href: b.link || '#/trust', target: '_blank', rel: 'noopener noreferrer', referrerpolicy: 'origin' },
      h('img', { src: b.image, alt: b.title, loading: 'lazy' }), h('span', {}, b.title))
    : h('div', { class: 'badge-tile placeholder' }, icon('badge'), h('strong', {}, b.title), h('small', {}, 'جایگاه نماد — پس از دریافت قرار می‌گیرد'));

  const info = (label, value) => h('div', { class: 'info-row' }, h('span', { class: 'muted' }, label), value ? h('strong', {}, value) : h('span', { class: 'placeholder-text' }, 'تکمیل می‌شود'));

  page.append(
    h('div', { class: 'page-head' }, h('h1', {}, 'شفافیت و اعتماد'),
      h('p', { class: 'muted' }, 'هر چیزی که برای اعتماد به ما لازم دارید: مجوزها، نمادها، دفتر پرداخت‌ها و کد متن‌باز.')),
    h('section', { class: 'card' }, h('h2', {}, icon('badge'), 'نمادها و مجوزها'),
      trust.badges.length ? h('div', { class: 'badge-grid' }, trust.badges.map(badgeTile)) : h('p', { class: 'muted' }, 'به‌زودی.')),
    (demo || org.name) ? h('section', { class: 'card' }, h('h2', {}, icon('house'), 'مشخصات حقوقی'),
      info('نام مجموعه', org.name), info('شمارهٔ ثبت', org.registrationNo), info('نشانی', org.address), info('تلفن', org.phone), info('ایمیل', org.email)) : '',
    (demo || charity.name) ? h('section', { class: 'card' }, h('h2', {}, icon('heart'), 'مؤسسهٔ خیریهٔ همکار'),
      info('نام مؤسسه', charity.name), info('شمارهٔ مجوز', charity.licenseNo), info('مرجع صدور', charity.licenseIssuer)) : '',
    trust.documents.length ? h('section', { class: 'card' }, h('h2', {}, icon('file'), 'مدارک رسمی'),
      h('ul', { class: 'docs' }, trust.documents.map((d) => h('li', {}, icon('file'),
        h('span', { class: 'grow' }, d.title, d.issuer ? h('small', { class: 'muted' }, ` — ${d.issuer}`) : null),
        d.link ? h('a', { href: d.link, target: '_blank', rel: 'noopener noreferrer' }, 'مشاهده') : h('span', { class: 'placeholder-text' }, d.number || 'در حال دریافت'))))) : '',
    h('section', { class: 'card' }, h('h2', {}, icon('shield'), 'چطور از پول و اطلاعات محافظت می‌کنیم'),
      h('ul', { class: 'checks' },
        h('li', {}, icon('check'), 'پول هیچ‌وقت به حساب متقاضی نمی‌رود؛ مستقیم به سازمان صادرکنندهٔ قبض یا طلبکار واریز می‌شود.'),
        h('li', {}, icon('check'), 'شناسهٔ هر قبض پیش از انتشار با ارقام کنترلی و استعلام بانکی بررسی می‌شود.'),
        h('li', {}, icon('check'), 'نام، کد ملی و مدارک با AES-256-GCM رمزنگاری می‌شوند و هر مشاهدهٔ کارشناس ثبت می‌شود.'),
        h('li', {}, icon('check'), 'تأیید پرداخت همیشه مستقیم از بانک گرفته می‌شود، نه از مرورگر کاربر.'),
        h('li', {}, icon('check'), `موجودی صندوق عمومی (مازاد کمک‌ها): ${toman(stats.generalFund)}`))),
    h('section', { class: 'card' }, h('h2', {}, icon('code'), 'کد متن‌باز'),
      h('p', { class: 'muted' }, 'کد کامل این برنامه منتشر شده تا هر متخصصی بتواند امنیت و درستی آن را بررسی کند.'),
      trust.sourceCodeUrl ? h('a', { class: 'btn btn-ghost', href: trust.sourceCodeUrl, target: '_blank', rel: 'noopener noreferrer' }, icon('code'), 'مشاهدهٔ کد در گیت‌هاب') : h('span', { class: 'placeholder-text' }, 'لینک مخزن کد تکمیل می‌شود')),
    creatorCard(trust.creator),
    h('a', { class: 'btn btn-primary btn-block', href: '#/ledger' }, icon('receipt'), 'دفتر عمومی پرداخت‌ها'));
}

function creatorCard(c) {
  if (!c?.name) return '';
  return h('section', { class: 'card creator-card' },
    h('span', { class: 'creator-mark', 'aria-hidden': 'true' }, c.name.trim().charAt(0)),
    h('div', { class: 'grow' },
      h('div', { class: 'muted small' }, c.role || 'ایده و ساخت'),
      h('h2', {}, c.name),
      c.about ? h('p', { class: 'small' }, c.about) : h('p', { class: 'small muted' }, 'مهرپل از یک ایدهٔ ساده شروع شد: کمک باید بی‌واسطه، شفاف و قابل پیگیری به دست صاحبش برسد.'),
      c.link ? h('a', { class: 'small', href: c.link, target: '_blank', rel: 'noopener noreferrer' }, 'ارتباط با سازنده') : null));
}

export async function ledgerView(page) {
  const { items } = await api.get('/api/ledger');
  page.append(h('a', { class: 'back', href: '#/trust' }, icon('back'), 'شفافیت'),
    h('div', { class: 'page-head' }, h('h1', {}, 'دفتر عمومی پرداخت‌ها'),
      h('p', { class: 'muted' }, 'همهٔ بدهی‌هایی که با کمک شما پرداخت شده، همراه با کد پیگیری پرداخت. اطلاعات هویتی نمایش داده نمی‌شود.')));
  if (!items.length) return page.append(emptyState('receipt', 'هنوز پرداختی ثبت نشده', 'اولین پرداخت‌ها اینجا نمایش داده می‌شوند.'));
  page.append(h('div', { class: 'card table-card' }, h('table', { class: 'table' },
    h('thead', {}, h('tr', {}, h('th', {}, 'نوع'), h('th', {}, 'استان'), h('th', {}, 'مبلغ'), h('th', {}, 'تاریخ'), h('th', {}, 'کد پیگیری'))),
    h('tbody', {}, items.map((c) => h('tr', {},
      h('td', {}, h('a', { href: `#/case/${c.code}`, class: 'inline-icon' }, icon(CATEGORY_ICONS[c.category]), state.meta.categories[c.category].label, c.isDemo ? h('span', { class: 'pill pill-muted' }, 'نمونه') : null)),
      h('td', {}, c.province),
      h('td', {}, toman(c.amount)),
      h('td', {}, faDate(c.paidAt)),
      h('td', { dir: 'ltr', class: 'mono' }, c.payoutRef)))))));
}
