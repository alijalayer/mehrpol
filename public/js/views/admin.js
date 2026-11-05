import { api, state } from '../api.js';
import { currentQuery, navigate } from '../app.js';
import { CATEGORY_ICONS, busy, emptyState, fa, faDate, faDateTime, field, h, icon, moneyInput, relTime, toAscii, toast, toman } from '../ui.js';
import { STATUS, statusPill } from './account.js';

const TABS = {
  overview: ['داشبورد', 'activity'],
  requests: ['درخواست‌ها', 'file'],
  users: ['کاربران', 'users'],
  donations: ['کمک‌ها', 'heart'],
  events: ['رویدادها', 'clock'],
  team: ['تیم مدیریت', 'shield'],
  revenue: ['درآمد', 'gift', true],
  campaigns: ['کمپین‌ها', 'trophy'],
  leads: ['همکاری‌ها', 'house'],
  trust: ['شفافیت و مدارک', 'badge', true],
  app: ['نسخهٔ اندروید', 'android', true],
};

/* ---------- Events in plain words ---------- */

const EVENTS = {
  'user.created': ['user', 'user', 'ثبت‌نام کرد'],
  'user.login': ['user', 'logout', 'وارد حساب شد'],
  'case.created': ['case', 'file', 'درخواست کمک جدید ثبت کرد'],
  'case.deleted': ['case', 'x', 'درخواستش را حذف کرد'],
  'document.uploaded': ['case', 'upload', 'مدرک بارگذاری کرد'],
  'donation.succeeded': ['donation', 'heart', 'کمک کرد'],
  'certificate.issued': ['donation', 'printer', 'گواهی قدردانی گرفت'],
  'billpay.paid': ['donation', 'receipt', 'قبض را خودکار به سازمان پرداخت کرد'],
  'billpay.failed': ['case', 'x', 'پرداخت خودکار قبض ناموفق بود؛ نیاز به پیگیری'],
  'admin.case.viewed': ['admin', 'eye', 'پروندهٔ درخواست را باز کرد'],
  'admin.case.approved': ['admin', 'check', 'درخواست را تأیید و منتشر کرد'],
  'admin.case.rejected': ['admin', 'x', 'درخواست را رد کرد'],
  'admin.case.paid': ['admin', 'receipt', 'واریز به طلبکار را ثبت کرد'],
  'admin.fund.allocated': ['admin', 'gift', 'از صندوق عمومی تخصیص داد'],
  'admin.document.viewed': ['admin', 'eye', 'مدرک محرمانه را دید'],
  'admin.cases.listed': ['admin', 'list', 'فهرست درخواست‌ها را دید'],
  'admin.users.listed': ['admin', 'users', 'فهرست کاربران را دید'],
  'admin.user.viewed': ['admin', 'user', 'پروفایل یک کاربر را دید'],
  'admin.trust.updated': ['admin', 'badge', 'صفحهٔ شفافیت را ویرایش کرد'],
  'admin.file.uploaded': ['admin', 'upload', 'فایل عمومی بارگذاری کرد'],
  'admin.app.published': ['admin', 'android', 'نسخهٔ جدید اندروید منتشر کرد'],
  'admin.team.set': ['admin', 'shield', 'سطح دسترسی یک عضو تیم را تعیین کرد'],
  'admin.team.removed': ['admin', 'x', 'دسترسی مدیریت یک نفر را برداشت'],
  'admin.revenue.added': ['admin', 'gift', 'درآمد بیرون از سایت ثبت کرد'],
  'admin.revenue.settings': ['admin', 'settings', 'قیمت‌ها را تغییر داد'],
  'admin.campaign.created': ['admin', 'trophy', 'کمپین تازه ساخت'],
  'admin.campaign.updated': ['admin', 'trophy', 'کمپین را ویرایش کرد'],
  'admin.lead.updated': ['admin', 'house', 'وضعیت درخواست همکاری را تغییر داد'],
  'circle.renewed': ['donation', 'users', 'عضویت حلقهٔ مهر را فعال یا تمدید کرد'],
  'circle.cancelled': ['donation', 'users', 'عضویت حلقهٔ مهر را لغو کرد'],
  'lead.created': ['user', 'house', 'درخواست همکاری فرستاد'],
};

/** "Android · Chrome" style summary of a user agent. */
function device(ua = '') {
  const os = /MehrpolApp/.test(ua) ? 'اپ اندروید مهرپل' : /iPhone|iPad/.test(ua) ? 'آیفون' : /Android/.test(ua) ? 'اندروید' : /Windows/.test(ua) ? 'ویندوز' : /Mac OS/.test(ua) ? 'مک' : /Linux/.test(ua) ? 'لینوکس' : '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return [os, browser].filter(Boolean).join(' · ');
}

function eventRow(e) {
  const [kind, ic, text] = EVENTS[e.action] ?? ['admin', 'activity', e.action];
  const who = e.actorId ? e.displayName || e.phone || 'کاربر حذف‌شده' : 'سامانهٔ مهرپل';
  const meta = [];
  if (e.caseTitle) meta.push(h('a', { href: `#/admin/case/${e.target}` }, `«${e.caseTitle}»`));
  if (e.detail?.amount) meta.push(toman(e.detail.amount));
  if (e.detail?.ip) meta.push(h('span', { dir: 'ltr' }, e.detail.ip));
  if (e.detail?.device) meta.push(device(e.detail.device));
  if (e.detail?.note) meta.push(`یادداشت: ${e.detail.note}`);
  if (e.detail?.version) meta.push(`نسخهٔ ${e.detail.version}`);
  return h('li', { class: 'event' },
    h('span', { class: `event-icon k-${kind}` }, icon(ic)),
    h('div', { class: 'event-body' },
      h('div', {}, e.actorId ? h('a', { class: 'who', href: `#/admin/user/${e.actorId}` }, who) : h('span', { class: 'who' }, who),
        e.role === 'admin' ? h('span', { class: 'pill pill-info' }, 'مدیر') : null, ' ', text),
      meta.length ? h('div', { class: 'meta' }, meta.flatMap((m, i) => (i ? [' · ', m] : [m]))) : null),
    h('time', { title: faDateTime(e.at) }, ago(e.at)));
}

function ago(ms) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return 'همین حالا';
  if (s < 3600) return `${fa(Math.floor(s / 60))} دقیقه پیش`;
  if (s < 86400) return `${fa(Math.floor(s / 3600))} ساعت پیش`;
  return faDate(ms);
}

const kv = (k, v, ltr) => h('div', { class: 'info-row' }, h('span', { class: 'muted' }, k), h('strong', ltr ? { dir: 'ltr', class: 'mono' } : {}, v || '—'));

/* ---------- Panel shell ---------- */

let refreshTimer;
window.addEventListener('hashchange', () => clearInterval(refreshTimer));

export async function adminView(page) {
  clearInterval(refreshTimer);
  const q = currentQuery();
  const visible = Object.entries(TABS).filter(([, t]) => !t[2] || state.user.isOwner);
  const tab = visible.some(([k]) => k === q.get('tab')) ? q.get('tab') : 'overview';
  const body = h('div', {});
  const reload = h('button', { class: 'btn btn-sm btn-ghost', title: 'به‌روزرسانی' }, icon('refresh'), 'به‌روزرسانی');
  reload.onclick = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
  page.append(
    h('div', { class: 'page-head admin-head' },
      h('div', {}, h('h1', {}, icon('shield'), ' پنل مدیریت', ' ', h('span', { class: `pill ${state.user.isOwner ? 'pill-success' : 'pill-info'}` }, state.user.isOwner ? 'مدیر ارشد' : 'ادمین')),
        h('p', { class: 'muted small' }, 'همهٔ اتفاقات مهرپل در یک جا. هر مشاهدهٔ اطلاعات هویتی در گزارش رویدادها ثبت می‌شود.')),
      reload),
    h('div', { class: 'segmented scroll' }, visible.map(([k, [label, ic]]) =>
      h('a', { class: tab === k ? 'active' : '', href: `#/admin?tab=${k}` }, icon(ic), ' ', label))),
    body);
  const views = { overview, requests, users, donations, events, team, revenue, campaigns, leads, trust, app: appRelease };
  await views[tab](body, q);
}

/* ---------- Dashboard ---------- */

async function overview(body) {
  const draw = async () => {
    const o = await api.get('/api/admin/overview');
    const pending = o.cases.pending ?? 0;
    const kpi = (label, ic, value, sub, href, hot) => h(href ? 'a' : 'div', { class: `kpi ${hot ? 'hot' : ''}`, href },
      h('span', {}, icon(ic), label), h('strong', {}, value), sub ? h('small', {}, sub) : null);
    body.replaceChildren(
      h('div', { class: 'kpis' },
        kpi('در انتظار بررسی', 'clock', fa(pending), 'درخواست منتظر شما', '#/admin?tab=requests&status=pending', pending > 0),
        kpi('درخواست‌های امروز', 'file', fa(o.newCasesToday), `در حال جمع‌آوری: ${fa(o.cases.approved ?? 0)}`, '#/admin?tab=requests&status=all'),
        kpi('کاربران', 'users', fa(o.users.total), `امروز +${fa(o.users.today)} · این هفته +${fa(o.users.week)}`, '#/admin?tab=users'),
        kpi('فعال امروز', 'activity', fa(o.activeToday), 'کاربرانی که امروز وارد شدند'),
        kpi('کمک‌های امروز', 'heart', toman(o.donations.today.total), `${fa(o.donations.today.n)} پرداخت`, '#/admin?tab=donations'),
        kpi('کل کمک‌ها', 'gift', toman(o.donations.all.total), `${fa(o.donations.all.n)} پرداخت · پرداخت‌شده: ${fa(o.cases.paid ?? 0)} پرونده`)),
      h('section', { class: 'card' },
        h('div', { class: 'row-between' }, h('h2', {}, icon('activity'), 'آخرین اتفاقات'),
          h('a', { class: 'small', href: '#/admin?tab=events' }, 'همهٔ رویدادها')),
        o.events.length ? h('ul', { class: 'events' }, o.events.map(eventRow)) : h('p', { class: 'muted' }, 'هنوز اتفاقی ثبت نشده است.'),
        h('p', { class: 'muted small' }, 'این صفحه هر ۲۰ ثانیه خودکار به‌روز می‌شود.')));
  };
  await draw();
  refreshTimer = setInterval(() => draw().catch(() => {}), 20_000);
}

/* ---------- Requests ---------- */

async function requests(body, q) {
  const status = q.get('status') ?? 'pending';
  const { items } = await api.get(`/api/admin/cases?status=${status}`);
  body.append(h('div', { class: 'chips' },
    [['all', 'همه'], ...Object.entries(STATUS).map(([k, [label]]) => [k, label])].map(([key, label]) =>
      h('a', { class: `chip ${key === status ? 'active' : ''}`, href: `#/admin?tab=requests&status=${key}` }, label))));
  if (!items.length) return body.append(emptyState('check', 'موردی در این وضعیت نیست'));
  body.append(h('div', { class: 'list' }, items.map((c) =>
    h('a', { class: 'card list-item', href: `#/admin/case/${c.id}` },
      h('span', { class: `cat-dot cat-${c.category}` }, icon(CATEGORY_ICONS[c.category])),
      h('div', { class: 'grow' },
        h('strong', {}, c.title),
        h('div', { class: 'small' }, icon('user'), ' ', c.owner.fullName || 'بدون نام', ' · ', h('span', { dir: 'ltr' }, c.owner.phone)),
        h('div', { class: 'muted small' }, `${c.province} · ${toman(c.amount)} · ${relTime(c.createdAt)}`)),
      c.isDemo ? h('span', { class: 'pill pill-muted' }, 'نمونه') : null,
      statusPill(c.status)))));
}

/* ---------- Users ---------- */

async function users(body, q) {
  const term = q.get('q') ?? '';
  const input = h('input', { class: 'input', inputmode: 'tel', dir: 'ltr', placeholder: 'جست‌وجوی شماره موبایل', value: term });
  const go = h('button', { class: 'btn' }, icon('search'), 'جست‌وجو');
  const search = () => navigate(`/admin?tab=users&q=${encodeURIComponent(input.value.trim())}`);
  go.onclick = search;
  input.onkeydown = (e) => e.key === 'Enter' && search();
  const { items } = await api.get(`/api/admin/users${term ? `?q=${encodeURIComponent(term)}` : ''}`);
  body.append(h('div', { class: 'search' }, input, go));
  if (!items.length) return body.append(emptyState('users', 'کاربری پیدا نشد'));
  body.append(h('p', { class: 'muted small' }, `${fa(items.length)} کاربر · جدیدترین بالا`),
    h('div', { class: 'card table-card' }, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, ['کاربر', 'موبایل', 'عضویت', 'آخرین ورود', 'درخواست', 'کمک'].map((t) => h('th', {}, t)))),
      h('tbody', {}, items.map((u) => h('tr', {},
        h('td', {}, h('a', { href: `#/admin/user/${u.id}` }, u.fullName || u.displayName || 'بدون نام'),
          u.role === 'admin' ? h('span', { class: 'pill pill-info' }, 'مدیر') : null, u.isDemo ? h('span', { class: 'pill pill-muted' }, 'نمونه') : null),
        h('td', { dir: 'ltr', class: 'mono' }, u.phone),
        h('td', {}, faDate(u.createdAt)),
        h('td', {}, u.lastLoginAt ? ago(u.lastLoginAt) : '—'),
        h('td', {}, fa(u.cases)),
        h('td', {}, u.gifts ? toman(u.given) : '—')))))));
}

export async function adminUserView(page, id) {
  const u = await api.get(`/api/admin/users/${id}`);
  page.append(
    h('a', { class: 'back', href: '#/admin?tab=users' }, icon('back'), 'کاربران'),
    h('div', { class: 'card' },
      h('h1', {}, u.fullName || u.displayName || 'کاربر بدون نام', u.role === 'admin' ? h('span', { class: 'pill pill-info' }, 'مدیر') : null),
      h('h2', {}, icon('lock'), 'مشخصات (محرمانه)'),
      kv('نام و نام خانوادگی', u.fullName), kv('کد ملی', u.nationalCode, true), kv('موبایل', u.phone, true), kv('نام نمایشی', u.displayName),
      kv('عضویت از', faDateTime(u.createdAt)), kv('آخرین ورود', u.lastLoginAt ? faDateTime(u.lastLoginAt) : ''),
      kv('پروفایل عمومی', u.publicProfile ? 'نمایش در تالار افتخار' : 'خصوصی'),
      u.bio ? kv('دربارهٔ من', u.bio) : null),
    h('section', { class: 'card' }, h('h2', {}, icon('file'), `درخواست‌ها (${fa(u.cases.length)})`),
      u.cases.length ? h('div', { class: 'list' }, u.cases.map((c) => h('a', { class: 'list-item', href: `#/admin/case/${c.id}` },
        h('span', { class: `cat-dot cat-${c.category}` }, icon(CATEGORY_ICONS[c.category])),
        h('div', { class: 'grow' }, h('strong', {}, c.title), h('div', { class: 'muted small' }, `${toman(c.amount)} · ${relTime(c.createdAt)}`)),
        statusPill(c.status)))) : h('p', { class: 'muted' }, 'درخواستی ثبت نکرده است.')),
    h('section', { class: 'card' }, h('h2', {}, icon('heart'), `کمک‌ها (${fa(u.donations.length)})`),
      u.donations.length ? h('div', { class: 'list' }, u.donations.map((d) => h('div', { class: 'list-item' },
        h('div', { class: 'grow' }, h('strong', {}, d.caseTitle ?? 'صندوق عمومی'), h('div', { class: 'muted small' }, faDateTime(d.createdAt))),
        h('div', { class: 'end' }, h('strong', {}, toman(d.amount)), donationPill(d.status))))) : h('p', { class: 'muted' }, 'کمکی ثبت نکرده است.')),
    h('section', { class: 'card' }, h('h2', {}, icon('clock'), 'رویدادهای این کاربر'),
      u.events.length ? h('ul', { class: 'events' }, u.events.map(eventRow)) : h('p', { class: 'muted' }, 'رویدادی ثبت نشده است.')));
}

const donationPill = (s) => h('span', { class: `pill ${s === 'succeeded' ? 'pill-success' : s === 'failed' ? 'pill-danger' : 'pill-warn'}` },
  s === 'succeeded' ? 'موفق' : s === 'failed' ? 'ناموفق' : 'در انتظار بانک');

/* ---------- Donations ---------- */

async function donations(body) {
  const { items } = await api.get('/api/admin/donations');
  if (!items.length) return body.append(emptyState('heart', 'هنوز کمکی ثبت نشده'));
  body.append(h('div', { class: 'card table-card' }, h('table', { class: 'table' },
    h('thead', {}, h('tr', {}, ['زمان', 'خیّر', 'برای', 'مبلغ', 'وضعیت', 'کد پیگیری بانک'].map((t) => h('th', {}, t)))),
    h('tbody', {}, items.map((d) => h('tr', {},
      h('td', {}, faDateTime(d.createdAt)),
      h('td', {}, d.donorId ? h('a', { href: `#/admin/user/${d.donorId}` }, d.displayName || d.phone) : d.gateway === 'fund' ? 'صندوق عمومی' : '—'),
      h('td', { class: 'wrap' }, d.caseId ? h('a', { href: `#/admin/case/${d.caseId}` }, d.caseTitle) : 'صندوق عمومی'),
      h('td', {}, toman(d.amount)),
      h('td', {}, donationPill(d.status)),
      h('td', { dir: 'ltr', class: 'mono' }, d.refId ?? '—')))))));
}

/* ---------- Events ---------- */

async function events(body, q) {
  const type = q.get('type') ?? 'all';
  const kinds = { all: 'همه', user: 'ثبت‌نام و ورود', case: 'درخواست‌ها', donation: 'کمک‌ها', admin: 'کار مدیران' };
  const list = h('ul', { class: 'events' });
  const more = h('button', { class: 'btn btn-ghost btn-block' }, 'رویدادهای قدیمی‌تر');
  let last;
  const load = async () => {
    const { items } = await api.get(`/api/admin/events?type=${type}${last ? `&before=${last}` : ''}`);
    list.append(...items.map(eventRow));
    last = items.at(-1)?.id;
    more.hidden = items.length < 100;
    if (!list.children.length) list.append(h('li', { class: 'muted' }, 'رویدادی نیست.'));
  };
  more.onclick = busy(more, load);
  body.append(
    h('div', { class: 'chips' }, Object.entries(kinds).map(([k, label]) =>
      h('a', { class: `chip ${k === type ? 'active' : ''}`, href: `#/admin?tab=events&type=${k}` }, label))),
    h('section', { class: 'card' }, list), more);
  await load();
}

/* ---------- Trust page editor ---------- */

/** A button that uploads an image or PDF and hands back its public URL. */
function uploadButton(label, onUploaded) {
  const input = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,application/pdf' });
  const btn = h('label', { class: 'btn btn-sm upload-btn' }, icon('upload'), label, input);
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    btn.classList.add('loading');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post('/api/admin/files', fd);
      onUploaded(res);
      toast('فایل بارگذاری شد', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.classList.remove('loading');
      input.value = '';
    }
  };
  return btn;
}

async function trust(body) {
  const t = await api.get('/api/admin/trust');
  const input = (obj, key, attrs = {}) => {
    const el = h(attrs.rows ? 'textarea' : 'input', { class: 'input', value: obj[key] ?? '', ...attrs });
    el.oninput = () => (obj[key] = el.value);
    return el;
  };

  const badgeList = h('div', {});
  const drawBadges = () => badgeList.replaceChildren(...t.badges.map((b, i) => {
    const preview = b.image ? h('img', { class: 'thumb', src: b.image, alt: '' }) : h('span', { class: 'thumb' });
    const remove = h('button', { class: 'btn btn-sm btn-danger-ghost', type: 'button' }, icon('x'), 'حذف');
    remove.onclick = () => { t.badges.splice(i, 1); drawBadges(); };
    return h('div', { class: 'editor-row' },
      h('div', { class: 'row-gap' }, preview,
        h('div', { class: 'grow' }, field('عنوان', input(b, 'title', { maxlength: 80 })))),
      field('توضیح', input(b, 'description', { maxlength: 300 })),
      field('لینک استعلام (مثلاً صفحهٔ نماد در enamad.ir)', input(b, 'link', { dir: 'ltr', placeholder: 'https://' })),
      h('div', { class: 'row-gap' },
        uploadButton('بارگذاری تصویر نماد', (f) => { b.image = f.url; drawBadges(); }),
        field('یا آدرس تصویر', input(b, 'image', { dir: 'ltr', placeholder: 'https://' })), remove));
  }));
  const addBadge = h('button', { class: 'btn btn-sm', type: 'button' }, icon('plus'), 'افزودن نماد یا مجوز');
  addBadge.onclick = () => { t.badges.push({ id: `b${Date.now()}`, title: '', description: '', image: '', link: '' }); drawBadges(); };

  const docList = h('div', {});
  const drawDocs = () => docList.replaceChildren(...t.documents.map((d, i) => {
    const remove = h('button', { class: 'btn btn-sm btn-danger-ghost', type: 'button' }, icon('x'), 'حذف');
    remove.onclick = () => { t.documents.splice(i, 1); drawDocs(); };
    return h('div', { class: 'editor-row' },
      h('div', { class: 'two-col' }, field('عنوان مدرک', input(d, 'title', { maxlength: 120 })), field('شماره', input(d, 'number', { maxlength: 80 }))),
      field('مرجع صدور', input(d, 'issuer', { maxlength: 120 })),
      h('div', { class: 'row-gap' },
        uploadButton('بارگذاری فایل مدرک', (f) => { d.link = f.url; drawDocs(); }),
        d.link ? h('a', { class: 'small', href: d.link, target: '_blank', rel: 'noopener' }, icon('file'), ' فایل فعلی') : h('span', { class: 'muted small' }, 'هنوز فایلی ندارد'),
        remove),
      field('یا لینک مدرک', input(d, 'link', { dir: 'ltr', placeholder: 'https://' })));
  }));
  const addDoc = h('button', { class: 'btn btn-sm', type: 'button' }, icon('plus'), 'افزودن مدرک');
  addDoc.onclick = () => { t.documents.push({ title: '', number: '', issuer: '', link: '' }); drawDocs(); };

  const save = h('button', { class: 'btn btn-primary btn-lg' }, icon('check'), 'ذخیرهٔ تغییرات');
  save.onclick = busy(save, async () => {
    try {
      const saved = await api.put('/api/admin/trust', t);
      state.meta.creator = saved.creator;
      toast('ذخیره شد و روی سایت نمایش داده می‌شود', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  drawBadges();
  drawDocs();
  body.append(
    h('section', { class: 'card' }, h('h2', {}, icon('sparkle'), 'سازندهٔ مهرپل'),
      h('p', { class: 'muted small' }, 'در پایین همهٔ صفحه‌ها و صفحهٔ شفافیت نمایش داده می‌شود.'),
      h('div', { class: 'two-col' }, field('نام', input(t.creator, 'name', { maxlength: 80 })), field('عنوان', input(t.creator, 'role', { maxlength: 120 }))),
      field('لینک (سایت، گیت‌هاب یا شبکهٔ اجتماعی)', input(t.creator, 'link', { dir: 'ltr', placeholder: 'https://' })),
      field('چند جمله دربارهٔ ایده', input(t.creator, 'about', { rows: 3, maxlength: 500 }))),
    h('section', { class: 'card' }, h('h2', {}, icon('badge'), 'نمادها و مجوزها'),
      h('p', { class: 'muted small' }, 'تصویر نماد اعتماد، نشان ساماندهی یا مجوز خیریه را بارگذاری کنید.'), badgeList, addBadge),
    h('section', { class: 'card' }, h('h2', {}, icon('file'), 'مدارک رسمی'),
      h('p', { class: 'muted small' }, 'مجوزها و قراردادها (تصویر یا PDF). فایل‌ها برای همه قابل مشاهده‌اند.'), docList, addDoc),
    h('section', { class: 'card' }, h('h2', {}, icon('house'), 'مشخصات حقوقی'),
      h('div', { class: 'two-col' },
        field('نام مجموعه', input(t.organization, 'name')), field('شمارهٔ ثبت', input(t.organization, 'registrationNo')),
        field('تلفن', input(t.organization, 'phone', { dir: 'ltr' })), field('ایمیل', input(t.organization, 'email', { dir: 'ltr' }))),
      field('نشانی', input(t.organization, 'address'))),
    h('section', { class: 'card' }, h('h2', {}, icon('heart'), 'مؤسسهٔ خیریهٔ همکار'),
      h('div', { class: 'two-col' },
        field('نام مؤسسه', input(t.partnerCharity, 'name')), field('شمارهٔ مجوز', input(t.partnerCharity, 'licenseNo'))),
      field('مرجع صدور مجوز', input(t.partnerCharity, 'licenseIssuer'))),
    h('div', { class: 'sticky-save' }, save));
}

/* ---------- Android releases ---------- */

async function appRelease(body) {
  const r = await api.get('/api/admin/app');
  const version = h('input', { class: 'input mono', dir: 'ltr', placeholder: '1.0.3' });
  const code = h('input', { class: 'input mono', dir: 'ltr', inputmode: 'numeric', placeholder: '3', value: r.versionCode ? String(r.versionCode + 1) : '' });
  const notes = h('textarea', { class: 'input', rows: 3, maxlength: 500, placeholder: 'تغییرات این نسخه (به کاربران نمایش داده می‌شود)' });
  const file = h('input', { type: 'file', accept: '.apk,application/vnd.android.package-archive', class: 'input' });
  const publish = h('button', { class: 'btn btn-primary' }, icon('upload'), 'انتشار نسخهٔ جدید');
  publish.onclick = busy(publish, async () => {
    if (!file.files[0]) return toast('فایل APK را انتخاب کنید', 'error');
    const fd = new FormData();
    // Fields before the file: the server reads them while the APK streams to disk.
    fd.append('version', version.value.trim());
    fd.append('versionCode', code.value.trim());
    fd.append('notes', notes.value);
    fd.append('file', file.files[0]);
    try {
      await api.post('/api/admin/app', fd);
      toast('منتشر شد؛ کاربران اپ پیام به‌روزرسانی می‌بینند', 'success');
      navigate('/admin?tab=app&t=' + Date.now());
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  body.append(
    h('section', { class: 'card' }, h('h2', {}, icon('android'), 'نسخهٔ فعلی'),
      r.version ? [kv('نسخه', r.version, true), kv('کد نسخه', String(r.versionCode), true), kv('حجم', `${fa(+(r.size / 1048576).toFixed(1))} مگابایت`),
        kv('انتشار', faDateTime(r.publishedAt)), r.notes ? kv('تغییرات', r.notes) : null,
        h('a', { class: 'btn btn-ghost', href: '/download/mehrpol.apk' }, icon('download'), 'دانلود همین نسخه')]
        : h('p', { class: 'muted' }, 'هنوز نسخه‌ای منتشر نشده است.')),
    h('section', { class: 'card' }, h('h2', {}, icon('upload'), 'انتشار نسخهٔ جدید'),
      h('p', { class: 'muted small' }, 'کد نسخه باید از نسخهٔ قبلی بزرگ‌تر باشد. اپ‌های نصب‌شده با دیدن کد بزرگ‌تر، پیام «نسخهٔ جدید» نشان می‌دهند و کاربر با یک لمس آن را دانلود و روی نسخهٔ قبلی نصب می‌کند.'),
      h('div', { class: 'two-col' }, field('نسخه', version), field('کد نسخه', code)),
      field('تغییرات', notes), field('فایل APK', file), publish));
}

/* ---------- One request ---------- */

export async function adminCaseView(page, id) {
  const c = await api.get(`/api/admin/cases/${id}`);
  const cat = state.meta.categories[c.category];

  page.append(
    h('a', { class: 'back', href: '#/admin?tab=requests' }, icon('back'), 'درخواست‌ها'),
    h('div', { class: 'card' },
      h('div', { class: 'case-top' }, h('span', { class: `cat-chip cat-${c.category}` }, icon(CATEGORY_ICONS[c.category]), cat.label), statusPill(c.status)),
      h('h1', {}, c.title),
      h('p', { class: 'story' }, c.story),
      kv('استان', c.province), kv('مبلغ', toman(c.amount)), kv('جمع‌شده', toman(c.raised)), kv('ثبت', faDateTime(c.createdAt)), kv('کد', c.code, true),
      cat.bill ? [kv('شناسهٔ قبض', c.billId, true), kv('شناسهٔ پرداخت', c.paymentId, true),
        h('div', { class: 'alert alert-success' }, icon('check'), 'ارقام کنترلی و مبلغ قبض معتبر است.')] : kv('طلبکار / حساب مقصد', c.payee)),
    h('div', { class: 'card' }, h('div', { class: 'row-between' }, h('h2', {}, icon('lock'), 'هویت متقاضی (محرمانه)'),
      h('a', { class: 'small', href: `#/admin/user/${c.owner.id}` }, 'همهٔ سوابق این شخص')),
      kv('نام', c.owner.fullName), kv('کد ملی', c.owner.nationalCode, true), kv('موبایل', c.owner.phone, true),
      kv('عضویت از', faDate(c.owner.memberSince)), kv('کمک‌های قبلی دریافت‌شده', fa(c.owner.previouslyHelped))),
    h('div', { class: 'card' }, h('h2', {}, icon('file'), `مدارک (${fa(c.documents.length)})`),
      c.documents.length ? h('div', { class: 'doc-grid' }, c.documents.map((d) => d.mime === 'application/pdf'
        ? h('a', { class: 'doc-thumb pdf', href: `/api/admin/documents/${d.id}` }, icon('file'), 'دانلود PDF')
        : h('a', { class: 'doc-thumb', href: `/api/admin/documents/${d.id}`, target: '_blank', rel: 'noopener' }, h('img', { src: `/api/admin/documents/${d.id}`, alt: 'مدرک', loading: 'lazy' }))))
        : h('p', { class: 'muted' }, 'مدرکی بارگذاری نشده است.')),
    actions(c, cat));
}

function actions(c, cat) {
  if (c.status === 'pending') {
    const note = h('textarea', { class: 'input', rows: 2, maxlength: 300, placeholder: 'یادداشت (برای رد الزامی است و به متقاضی نمایش داده می‌شود)' });
    const approve = h('button', { class: 'btn btn-primary' }, icon('check'), 'تأیید و انتشار');
    const reject = h('button', { class: 'btn btn-danger-ghost' }, icon('x'), 'رد درخواست');
    const review = (decision, btn) => busy(btn, async () => {
      try {
        await api.post(`/api/admin/cases/${c.id}/review`, { decision, note: note.value });
        toast(decision === 'approve' ? 'منتشر شد' : 'رد شد', 'success');
        navigate('/admin?tab=requests');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    approve.onclick = review('approve', approve);
    reject.onclick = review('reject', reject);
    return h('div', { class: 'card sticky-actions' }, field('یادداشت بررسی', note), h('div', { class: 'row-gap' }, approve, reject));
  }
  if (c.status === 'approved') {
    const amount = moneyInput({ placeholder: 'مبلغ به تومان' });
    const btn = h('button', { class: 'btn btn-primary' }, 'تخصیص از صندوق عمومی');
    btn.onclick = busy(btn, async () => {
      try {
        await api.post(`/api/admin/cases/${c.id}/allocate`, { amountToman: amount.raw() });
        toast('تخصیص انجام شد', 'success');
        navigate('/admin?tab=requests&status=approved');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    return h('div', { class: 'card' }, h('h2', {}, 'تخصیص از صندوق عمومی'), field(`باقی‌مانده: ${toman(c.amount - c.raised)}`, amount), btn);
  }
  if (c.status === 'funded' && !cat.bill) {
    const ref = h('input', { class: 'input mono', dir: 'ltr', maxlength: 40 });
    const btn = h('button', { class: 'btn btn-primary' }, 'ثبت واریز به طلبکار');
    btn.onclick = busy(btn, async () => {
      try {
        await api.post(`/api/admin/cases/${c.id}/payout`, { reference: ref.value });
        toast('تسویه ثبت شد', 'success');
        navigate('/admin?tab=requests&status=paid');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    return h('div', { class: 'card' }, h('h2', {}, 'تسویه با طلبکار'),
      h('p', { class: 'muted small' }, `مبلغ ${toman(c.amount)} را به «${c.payee}» واریز و شمارهٔ پیگیری را ثبت کنید.`), field('شمارهٔ پیگیری واریز', ref), btn);
  }
  return null;
}

/* ---------- Management team ---------- */

async function team(body) {
  const { items } = await api.get('/api/admin/team');
  const owner = state.user.isOwner;
  const list = h('div', {}, items.map((m) => {
    const level = h('select', { class: 'lead-status', disabled: !owner || m.founder || m.id === state.user.id },
      h('option', { value: 'owner', selected: m.isOwner }, 'مدیر ارشد'), h('option', { value: 'admin', selected: !m.isOwner }, 'ادمین'));
    level.onchange = async () => {
      try {
        await api.post('/api/admin/team', { phone: m.phone, level: level.value });
        toast('سطح دسترسی تغییر کرد', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    const remove = h('button', { class: 'btn btn-sm btn-danger-ghost' }, icon('x'), 'برداشتن دسترسی');
    remove.onclick = busy(remove, async () => {
      if (!confirm(`دسترسی مدیریت ${m.phone} برداشته شود؟`)) return;
      try {
        await api.del(`/api/admin/team/${m.id}`);
        toast('دسترسی برداشته شد');
        navigate(`/admin?tab=team&t=${Date.now()}`);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    return h('div', { class: 'team-row' },
      h('span', { class: 'avatar' }, icon(m.isOwner ? 'shield' : 'user')),
      h('div', { class: 'grow' },
        h('strong', {}, m.fullName || m.displayName || 'هنوز وارد نشده'), ' ',
        m.founder ? h('span', { class: 'pill pill-info' }, 'بنیان‌گذار') : null,
        m.id === state.user.id ? h('span', { class: 'pill pill-muted' }, 'شما') : null,
        h('div', { class: 'muted small' }, h('span', { dir: 'ltr' }, m.phone), ' · ', m.lastLoginAt ? `آخرین ورود ${ago(m.lastLoginAt)}` : 'هنوز وارد نشده')),
      level, owner && !m.founder && m.id !== state.user.id ? remove : null);
  }));

  const phone = h('input', { class: 'input', dir: 'ltr', inputmode: 'tel', placeholder: '09xx xxx xxxx' });
  const lvl = h('select', { class: 'input' }, h('option', { value: 'admin' }, 'ادمین (بررسی و پیگیری)'), h('option', { value: 'owner' }, 'مدیر ارشد (دسترسی کامل)'));
  const add = h('button', { class: 'btn btn-primary' }, icon('plus'), 'افزودن به تیم');
  add.onclick = busy(add, async () => {
    try {
      await api.post('/api/admin/team', { phone: phone.value, level: lvl.value });
      toast('اضافه شد؛ با همین شماره وارد شود تا پنل را ببیند', 'success');
      navigate(`/admin?tab=team&t=${Date.now()}`);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  body.append(
    h('section', { class: 'card' }, h('h2', {}, icon('users'), 'تیم مدیریت'),
      h('ul', { class: 'checks small' },
        h('li', {}, icon('check'), h('span', {}, h('strong', {}, 'مدیر ارشد: '), 'همه‌چیز، به‌علاوهٔ تیم، درآمد، کمپین‌ها، صفحهٔ شفافیت و نسخهٔ اندروید.')),
        h('li', {}, icon('check'), h('span', {}, h('strong', {}, 'ادمین: '), 'بررسی و تأیید درخواست‌ها، کاربران، کمک‌ها، رویدادها و درخواست‌های همکاری.'))),
      list),
    owner ? h('section', { class: 'card' }, h('h2', {}, icon('plus'), 'افزودن مدیر یا ادمین'),
      h('p', { class: 'muted small' }, 'شمارهٔ موبایل شخص را وارد کنید. اگر هنوز ثبت‌نام نکرده، حسابش ساخته می‌شود و با اولین ورود، پنل را می‌بیند.'),
      h('div', { class: 'two-col' }, field('شمارهٔ موبایل', phone), field('سطح دسترسی', lvl)), add) : '');
}

/* ---------- Income ---------- */

const REVENUE_KINDS = { tip: 'حمایت اختیاری خیّرین', gift_fee: 'کارت هدیهٔ مهر', circle_fee: 'عضویت حلقهٔ مهر', csr: 'قرارداد شرکت‌ها', license: 'اشتراک خیریه‌ها', other: 'سایر' };

async function revenue(body) {
  const r = await api.get('/api/admin/revenue');
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...r.monthly.map((m) => m.v));
  const s = r.settings;

  const kind = h('select', { class: 'input' }, ['csr', 'license', 'other'].map((k) => h('option', { value: k }, REVENUE_KINDS[k])));
  const amount = moneyInput({ placeholder: 'مبلغ به تومان' });
  const note = h('input', { class: 'input', maxlength: 200, placeholder: 'مثلاً: قرارداد سه‌ماههٔ شرکت فلان' });
  const addBtn = h('button', { class: 'btn btn-primary' }, icon('plus'), 'ثبت درآمد');
  addBtn.onclick = busy(addBtn, async () => {
    try {
      await api.post('/api/admin/revenue', { kind: kind.value, amountToman: amount.raw(), note: note.value });
      toast('ثبت شد', 'success');
      navigate(`/admin?tab=revenue&t=${Date.now()}`);
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  const num = (v) => h('input', { class: 'input mono', dir: 'ltr', inputmode: 'numeric', value: String(v) });
  const tips = h('input', { class: 'input mono', dir: 'ltr', value: s.tipOptions.join('، ') });
  const tipDefault = num(s.tipDefault);
  const giftFee = num(s.giftFee);
  const circleFee = num(s.circleFee);
  const circleMin = num(s.circleMin);
  const save = h('button', { class: 'btn' }, icon('check'), 'ذخیرهٔ قیمت‌ها');
  const n = (el) => Number(toAscii(el.value).replace(/\D/g, ''));
  save.onclick = busy(save, async () => {
    try {
      await api.put('/api/admin/revenue/settings', {
        ...s, tipOptions: toAscii(tips.value).split(/[^\d]+/).filter(Boolean).map(Number),
        tipDefault: n(tipDefault), giftFee: n(giftFee), circleFee: n(circleFee), circleMin: n(circleMin),
      });
      toast('قیمت‌ها ذخیره شد', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  body.append(
    h('div', { class: 'kpis' },
      h('div', { class: 'kpi hot' }, h('span', {}, icon('gift'), 'درآمد این ماه'), h('strong', {}, toman(sum(r.month))), h('small', {}, 'جدا از کمک‌ها')),
      h('div', { class: 'kpi' }, h('span', {}, icon('activity'), 'کل درآمد'), h('strong', {}, toman(sum(r.all)))),
      h('div', { class: 'kpi' }, h('span', {}, icon('users'), 'اعضای فعال حلقه'), h('strong', { 'data-count': r.members }, fa(r.members))),
      h('div', { class: 'kpi' }, h('span', {}, icon('gift'), 'کارت‌های هدیه'), h('strong', { 'data-count': r.gifts }, fa(r.gifts)))),
    h('section', { class: 'card' }, h('h2', {}, icon('activity'), 'درآمد به تفکیک'),
      Object.entries(REVENUE_KINDS).map(([k, label]) => kv(label, `${toman(r.month[k] ?? 0)} این ماه · ${toman(r.all[k] ?? 0)} از ابتدا`)),
      r.monthly.length ? h('div', { class: 'bar-chart', 'aria-label': 'درآمد ماهانه' }, r.monthly.map((m) =>
        h('div', { title: toman(m.v) }, h('span', { style: `height:${Math.round((m.v / max) * 110)}px` }), m.month.slice(2).replace('-', '/')))) : null),
    h('section', { class: 'card' }, h('h2', {}, icon('plus'), 'ثبت درآمد بیرون از سایت'),
      h('p', { class: 'muted small' }, 'قراردادهای شرکت‌ها و اشتراک خیریه‌ها را که بیرون از درگاه پرداخت می‌شوند، اینجا ثبت کنید.'),
      h('div', { class: 'two-col' }, field('نوع', kind), field('مبلغ (تومان)', amount)), field('توضیح', note), addBtn),
    h('section', { class: 'card' }, h('h2', {}, icon('settings'), 'قیمت‌ها'),
      h('div', { class: 'two-col' },
        field('درصدهای پیشنهادی حمایت', tips, 'مثلاً ۰، ۵، ۱۰، ۱۵'), field('درصد پیش‌فرض', tipDefault),
        field('هزینهٔ صدور کارت هدیه (تومان)', giftFee), field('حق عضویت ماهانهٔ حلقه (تومان)', circleFee),
        field('حداقل کمک ماهانهٔ حلقه (تومان)', circleMin)), save),
    h('section', { class: 'card table-card' }, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, ['زمان', 'نوع', 'مبلغ', 'از طرف', 'توضیح'].map((t) => h('th', {}, t)))),
      h('tbody', {}, r.recent.length ? r.recent.map((x) => h('tr', {},
        h('td', {}, faDateTime(x.created_at)), h('td', {}, REVENUE_KINDS[x.kind]), h('td', {}, toman(x.amount)),
        h('td', {}, x.user_id ? h('a', { href: `#/admin/user/${x.user_id}` }, x.displayName || x.phone) : '—'), h('td', { class: 'wrap' }, x.note || '—')))
        : h('tr', {}, h('td', { colspan: 5, class: 'muted' }, 'هنوز درآمدی ثبت نشده است.'))))));
}

/* ---------- Campaigns ---------- */

async function campaigns(body, q) {
  const { items } = await api.get('/api/admin/campaigns');
  const editing = items.find((c) => c.id === q.get('edit'));
  const c = editing ?? { slug: '', title: '', sponsor: '', sponsorLogo: '', sponsorLink: '', description: '', category: '', province: '', goal: 0, matchPercent: 0, matchCap: 0, endsAt: null, active: true };
  const { categories, provinces } = state.meta;
  const input = (v, attrs = {}) => h(attrs.rows ? 'textarea' : 'input', { class: 'input', value: v ?? '', ...attrs });
  const slug = input(c.slug, { dir: 'ltr', placeholder: 'winter-light', maxlength: 40 });
  const title = input(c.title, { maxlength: 100 });
  const sponsor = input(c.sponsor, { maxlength: 80 });
  const logo = input(c.sponsorLogo, { dir: 'ltr', placeholder: 'https:// یا بارگذاری' });
  const link = input(c.sponsorLink, { dir: 'ltr', placeholder: 'https://' });
  const desc = input(c.description, { rows: 3, maxlength: 1500 });
  const cat = h('select', { class: 'input' }, h('option', { value: '' }, 'همهٔ دسته‌ها'), Object.entries(categories).map(([k, v]) => h('option', { value: k, selected: c.category === k }, v.label)));
  const prov = h('select', { class: 'input' }, h('option', { value: '' }, 'همهٔ استان‌ها'), provinces.map((p) => h('option', { value: p, selected: c.province === p }, p)));
  const goal = moneyInput({ value: c.goal ? fa(Math.round(c.goal / 10)) : '' });
  const match = input(String(c.matchPercent), { dir: 'ltr', inputmode: 'numeric' });
  const cap = moneyInput({ value: c.matchCap ? fa(Math.round(c.matchCap / 10)) : '' });
  const ends = input(c.endsAt ? new Date(c.endsAt).toISOString().slice(0, 10) : '', { type: 'date', dir: 'ltr' });
  const active = h('input', { type: 'checkbox', checked: c.active });
  const saveBtn = h('button', { class: 'btn btn-primary' }, icon('check'), editing ? 'ذخیرهٔ تغییرات' : 'ساخت کمپین');
  saveBtn.onclick = busy(saveBtn, async () => {
    const payload = {
      slug: slug.value.trim(), title: title.value, sponsor: sponsor.value, sponsorLogo: logo.value, sponsorLink: link.value, description: desc.value,
      category: cat.value, province: prov.value, goalToman: goal.raw(), matchPercent: Number(toAscii(match.value)) || 0, matchCapToman: cap.raw(),
      endsAt: ends.value ? new Date(`${ends.value}T23:59:59`).getTime() : null, active: active.checked,
    };
    try {
      if (editing) await api.put(`/api/admin/campaigns/${editing.id}`, payload);
      else await api.post('/api/admin/campaigns', payload);
      toast('ذخیره شد', 'success');
      navigate(`/admin?tab=campaigns&t=${Date.now()}`);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  body.append(
    items.length ? h('div', { class: 'list mb' }, items.map((x) => h('div', { class: 'card list-item' },
      h('span', { class: 'cat-dot' }, icon('trophy')),
      h('div', { class: 'grow' }, h('strong', {}, x.title), h('div', { class: 'muted small' }, `${x.sponsor} · ${toman(x.total)} از ${toman(x.goal)} · ${fa(x.donors)} نفر`)),
      h('span', { class: `pill ${x.active ? 'pill-success' : 'pill-muted'}` }, x.active ? 'فعال' : 'متوقف'),
      h('a', { class: 'btn btn-sm', href: `#/campaign/${x.slug}` }, icon('eye')),
      state.user.isOwner ? h('a', { class: 'btn btn-sm', href: `#/admin?tab=campaigns&edit=${x.id}` }, 'ویرایش') : null))) : emptyState('trophy', 'هنوز کمپینی نساخته‌اید'),
    state.user.isOwner ? h('section', { class: 'card' }, h('h2', {}, icon(editing ? 'settings' : 'plus'), editing ? `ویرایش «${c.title}»` : 'کمپین جدید'),
      h('div', { class: 'two-col' }, field('عنوان', title), field('نشانی کوتاه (انگلیسی)', slug, 'در آدرس کمپین می‌آید')),
      h('div', { class: 'two-col' }, field('نام حامی', sponsor), field('سایت حامی', link)),
      h('div', { class: 'row-gap' }, field('لوگوی حامی', logo), uploadButton('بارگذاری لوگو', (f) => { logo.value = f.url; })),
      field('توضیح کمپین', desc),
      h('div', { class: 'two-col' }, field('دستهٔ بدهی', cat), field('استان', prov), field('هدف (تومان)', goal), field('تاریخ پایان', ends),
        field('درصد هم‌پوشانی حامی', match, '۱۰۰ یعنی حامی هم‌اندازهٔ کمک مردم اضافه می‌کند'), field('سقف تعهد حامی (تومان)', cap)),
      h('label', { class: 'check' }, active, 'کمپین فعال است'), saveBtn) : '');
}

/* ---------- Partnership requests ---------- */

const LEAD_STATUS = { new: 'جدید', contacted: 'تماس گرفته شد', won: 'قرارداد بسته شد', lost: 'منصرف شد' };

async function leads(body) {
  const { items } = await api.get('/api/admin/leads');
  if (!items.length) return body.append(emptyState('house', 'هنوز درخواست همکاری نرسیده', 'فرم همکاری در صفحهٔ «همکاری سازمان‌ها» است.', h('a', { class: 'btn', href: '#/business' }, 'دیدن صفحه')));
  body.append(h('div', { class: 'card table-card' }, h('table', { class: 'table' },
    h('thead', {}, h('tr', {}, ['زمان', 'نوع', 'مجموعه', 'تماس', 'طرح', 'پیام', 'وضعیت'].map((t) => h('th', {}, t)))),
    h('tbody', {}, items.map((l) => {
      const status = h('select', { class: 'lead-status' }, Object.entries(LEAD_STATUS).map(([k, label]) => h('option', { value: k, selected: l.status === k }, label)));
      status.onchange = async () => {
        try {
          await api.patch(`/api/admin/leads/${l.id}`, { status: status.value });
          toast('به‌روز شد', 'success');
        } catch (err) {
          toast(err.message, 'error');
        }
      };
      return h('tr', {},
        h('td', {}, faDateTime(l.created_at)), h('td', {}, l.type === 'company' ? 'شرکت' : 'خیریه'), h('td', {}, h('strong', {}, l.org)),
        h('td', {}, l.contact, h('div', { class: 'small', dir: 'ltr' }, l.phone), l.email ? h('div', { class: 'small', dir: 'ltr' }, l.email) : null),
        h('td', {}, l.plan || '—'), h('td', { class: 'wrap' }, l.message || '—'), h('td', {}, status));
    })))));
}
