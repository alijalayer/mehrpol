import { api, state } from '../api.js';
import { currentQuery, navigate, renderHeader } from '../app.js';
import { CATEGORY_ICONS, busy, emptyState, fa, faDate, h, icon, progress, relTime, toast, toman } from '../ui.js';

export const STATUS = {
  pending: ['در انتظار بررسی', 'pill-warn'],
  approved: ['در حال جمع‌آوری کمک', 'pill-info'],
  rejected: ['رد شد', 'pill-danger'],
  funded: ['تأمین شد، در حال تسویه', 'pill-info'],
  paid: ['پرداخت شد', 'pill-success'],
};

export const statusPill = (s) => h('span', { class: `pill ${STATUS[s][1]}` }, STATUS[s][0]);

export async function accountView(page) {
  const tab = currentQuery().get('tab') === 'donations' ? 'donations' : 'requests';
  const body = h('div', {});
  const logout = h('button', { class: 'btn btn-ghost btn-sm' }, icon('logout'), 'خروج');
  logout.onclick = busy(logout, async () => {
    await api.post('/api/auth/logout');
    state.user = null;
    renderHeader();
    navigate('/');
  });
  page.append(
    h('div', { class: 'profile card' },
      h('div', { class: 'avatar avatar-lg' }, icon('user')),
      h('div', { class: 'grow' }, h('strong', {}, state.user.displayName || 'کاربر گرامی'), h('div', { class: 'muted small', dir: 'ltr' }, state.user.phone)),
      logout),
    h('div', { class: 'segmented' },
      h('a', { class: tab === 'requests' ? 'active' : '', href: '#/me' }, 'درخواست‌های من'),
      h('a', { class: tab === 'donations' ? 'active' : '', href: '#/me?tab=donations' }, 'کمک‌های من')),
    body);

  if (tab === 'requests') {
    const { items } = await api.get('/api/my/cases');
    if (!items.length) {
      body.append(emptyState('file', 'هنوز درخواستی ثبت نکرده‌اید', 'اگر برای پرداخت قبض یا بدهی نیاز به کمک دارید، درخواست خود را ثبت کنید.',
        h('a', { class: 'btn btn-primary', href: '#/new' }, icon('plus'), 'ثبت درخواست')));
      return;
    }
    body.append(h('a', { class: 'btn btn-primary btn-block mb', href: '#/new' }, icon('plus'), 'درخواست جدید'),
      h('div', { class: 'list' }, items.map((c) =>
        h('a', { class: 'card list-item', href: `#/request/${c.id}` },
          h('span', { class: `cat-dot cat-${c.category}` }, icon(CATEGORY_ICONS[c.category])),
          h('div', { class: 'grow' }, h('strong', {}, c.title), h('div', { class: 'muted small' }, `${toman(c.amount)} · ${relTime(c.createdAt)}`)),
          statusPill(c.status)))));
  } else {
    const { items } = await api.get('/api/my/donations');
    if (!items.length) {
      body.append(emptyState('heart', 'هنوز کمکی ثبت نشده', 'اولین قبض را همین امروز پرداخت کنید.', h('a', { class: 'btn btn-primary', href: '#/cases' }, 'دیدن درخواست‌ها')));
      return;
    }
    const total = items.filter((d) => d.status === 'succeeded').reduce((s, d) => s + d.amount, 0);
    body.append(h('div', { class: 'card highlight' }, h('span', {}, 'مجموع کمک‌های شما'), h('strong', {}, toman(total))),
      h('div', { class: 'list' }, items.map((d) =>
        h('a', { class: 'card list-item', href: `#/receipt/${d.id}` },
          h('span', { class: 'cat-dot' }, icon('receipt')),
          h('div', { class: 'grow' }, h('strong', {}, d.case ? d.case.title : 'صندوق عمومی'), h('div', { class: 'muted small' }, faDate(d.createdAt))),
          h('div', { class: 'end' }, h('strong', {}, toman(d.amount)),
            d.status === 'succeeded' ? h('span', { class: 'pill pill-success' }, 'موفق') : h('span', { class: 'pill pill-danger' }, 'ناموفق'))))));
  }
}

export async function myCaseView(page, id) {
  const c = await api.get(`/api/my/cases/${id}`);
  const cat = state.meta.categories[c.category];
  const steps = [
    ['ثبت درخواست', true],
    ['بررسی کارشناس', c.status !== 'pending'],
    ['جمع‌آوری کمک', ['funded', 'paid'].includes(c.status)],
    ['پرداخت به سازمان/طلبکار', c.status === 'paid'],
  ];
  page.append(
    h('a', { class: 'back', href: '#/me' }, icon('back'), 'درخواست‌های من'),
    h('div', { class: 'card' },
      h('div', { class: 'case-top' }, h('span', { class: `cat-chip cat-${c.category}` }, icon(CATEGORY_ICONS[c.category]), cat.label), statusPill(c.status)),
      h('h1', {}, c.title),
      h('div', { class: 'muted small' }, `کد پیگیری: `, h('span', { dir: 'ltr', class: 'mono' }, c.code), ` · ثبت ${faDate(c.createdAt)}`),
      c.status === 'rejected' ? h('div', { class: 'alert alert-danger' }, h('strong', {}, 'دلیل رد: '), c.reviewNote) : null,
      h('ol', { class: 'timeline' }, steps.map(([label, done]) => h('li', { class: done ? 'done' : '' }, h('span', { class: 'dot' }, done ? icon('check') : null), label))),
      ['approved', 'funded', 'paid'].includes(c.status)
        ? [progress(c.raised, c.amount), h('div', { class: 'row-between small' }, h('span', {}, `${toman(c.raised)} جمع شده`), h('span', { class: 'muted' }, `از ${toman(c.amount)}`))]
        : h('div', { class: 'row-between' }, h('span', { class: 'muted' }, 'مبلغ'), h('strong', {}, toman(c.amount))),
      c.payoutRef ? h('div', { class: 'alert alert-success' }, 'پرداخت انجام شد. کد پیگیری: ', h('span', { dir: 'ltr', class: 'mono' }, c.payoutRef)) : null,
      c.status === 'approved' ? h('a', { class: 'btn btn-ghost btn-block', href: `#/case/${c.code}` }, icon('eye'), 'صفحهٔ عمومی درخواست (بدون نام شما)') : null),
    documentsCard(c));

  if (c.status === 'pending') {
    const del = h('button', { class: 'btn btn-danger-ghost btn-block' }, icon('x'), 'انصراف و حذف درخواست');
    del.onclick = busy(del, async () => {
      if (!confirm('این درخواست و مدارکش حذف شود؟')) return;
      try {
        await api.del(`/api/my/cases/${c.id}`);
        toast('درخواست حذف شد');
        navigate('/me');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    page.append(del);
  }
}

function documentsCard(c) {
  const list = h('ul', { class: 'docs' }, c.documents.map(docRow));
  const card = h('div', { class: 'card' },
    h('h2', {}, icon('file'), 'مدارک'),
    h('p', { class: 'muted small' }, 'مدارک فقط برای کارشناس بررسی قابل مشاهده است و رمزنگاری‌شده ذخیره می‌شود.'),
    list);
  if (!c.documents.length) list.append(h('li', { class: 'muted small' }, 'هنوز مدرکی بارگذاری نشده است.'));
  if (c.status === 'pending') card.append(uploader(c.id, (doc) => {
    list.querySelector('.muted')?.remove();
    list.append(docRow(doc));
  }));
  return card;
}

const docRow = (d) => h('li', {}, icon('file'), h('span', { class: 'grow' }, d.mime === 'application/pdf' ? 'فایل PDF' : 'تصویر'), h('span', { class: 'muted small' }, `${fa(Math.ceil(d.size / 1024))} کیلوبایت`), icon('lock', 'muted'));

export function uploader(caseId, onDone) {
  const input = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,application/pdf', class: 'sr-only', id: `up-${caseId}`, multiple: true });
  const label = h('label', { class: 'dropzone', for: input.id }, icon('upload'), h('strong', {}, 'افزودن مدرک'),
    h('span', { class: 'muted small' }, 'عکس قبض، کارت ملی، نامهٔ بانک یا قرارداد · حداکثر ۵ مگابایت'));
  input.onchange = async () => {
    for (const file of input.files) {
      if (file.size > 5 * 1024 * 1024) {
        toast(`«${file.name}» بیش از ۵ مگابایت است`, 'error');
        continue;
      }
      label.classList.add('loading');
      try {
        const fd = new FormData();
        fd.append('file', file);
        const doc = await api.post(`/api/my/cases/${caseId}/documents`, fd);
        onDone(doc);
        toast('مدرک بارگذاری شد', 'success');
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        label.classList.remove('loading');
      }
    }
    input.value = '';
  };
  return h('div', {}, input, label);
}
