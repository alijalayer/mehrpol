import { api, state } from '../api.js';
import { currentQuery, navigate } from '../app.js';
import { CATEGORY_ICONS, busy, emptyState, fa, faDate, faDateTime, field, h, icon, moneyInput, relTime, toast, toman } from '../ui.js';
import { STATUS, statusPill } from './account.js';

export async function adminView(page) {
  const status = currentQuery().get('status') ?? 'pending';
  const [{ items }, stats] = await Promise.all([api.get(`/api/admin/cases?status=${status}`), api.get('/api/stats')]);
  page.append(
    h('div', { class: 'page-head' }, h('h1', {}, icon('shield'), 'پنل بررسی'),
      h('p', { class: 'muted' }, 'هر مشاهدهٔ اطلاعات هویتی و مدارک در گزارش ممیزی ثبت می‌شود.')),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('strong', {}, toman(stats.generalFund)), h('span', {}, 'صندوق عمومی')),
      h('div', { class: 'stat' }, h('strong', {}, fa(stats.openCases)), h('span', {}, 'درخواست باز')),
      h('div', { class: 'stat' }, h('strong', {}, toman(stats.paidTotal)), h('span', {}, 'پرداخت‌شده'))),
    h('div', { class: 'chips' }, Object.entries(STATUS).map(([key, [label]]) =>
      h('a', { class: `chip ${key === status ? 'active' : ''}`, href: `#/admin?status=${key}` }, label))));

  if (!items.length) return page.append(emptyState('check', 'موردی در این وضعیت نیست'));
  page.append(h('div', { class: 'list' }, items.map((c) =>
    h('a', { class: 'card list-item', href: `#/admin/case/${c.id}` },
      h('span', { class: `cat-dot cat-${c.category}` }, icon(CATEGORY_ICONS[c.category])),
      h('div', { class: 'grow' }, h('strong', {}, c.title), h('div', { class: 'muted small' }, `${c.province} · ${toman(c.amount)} · ${relTime(c.createdAt)}`)),
      c.isDemo ? h('span', { class: 'pill pill-muted' }, 'نمونه') : null,
      statusPill(c.status)))));
}

export async function adminCaseView(page, id) {
  const c = await api.get(`/api/admin/cases/${id}`);
  const cat = state.meta.categories[c.category];
  const kv = (k, v, ltr) => h('div', { class: 'info-row' }, h('span', { class: 'muted' }, k), h('strong', ltr ? { dir: 'ltr', class: 'mono' } : {}, v || '—'));

  page.append(
    h('a', { class: 'back', href: '#/admin' }, icon('back'), 'صف بررسی'),
    h('div', { class: 'card' },
      h('div', { class: 'case-top' }, h('span', { class: `cat-chip cat-${c.category}` }, icon(CATEGORY_ICONS[c.category]), cat.label), statusPill(c.status)),
      h('h1', {}, c.title),
      h('p', { class: 'story' }, c.story),
      kv('استان', c.province), kv('مبلغ', toman(c.amount)), kv('جمع‌شده', toman(c.raised)), kv('ثبت', faDateTime(c.createdAt)), kv('کد', c.code, true),
      cat.bill ? [kv('شناسهٔ قبض', c.billId, true), kv('شناسهٔ پرداخت', c.paymentId, true),
        h('div', { class: 'alert alert-success' }, icon('check'), 'ارقام کنترلی و مبلغ قبض معتبر است.')] : kv('طلبکار / حساب مقصد', c.payee)),
    h('div', { class: 'card' }, h('h2', {}, icon('lock'), 'هویت متقاضی (محرمانه)'),
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
        navigate('/admin');
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
        navigate('/admin?status=approved');
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
        navigate('/admin?status=paid');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    return h('div', { class: 'card' }, h('h2', {}, 'تسویه با طلبکار'),
      h('p', { class: 'muted small' }, `مبلغ ${toman(c.amount)} را به «${c.payee}» واریز و شمارهٔ پیگیری را ثبت کنید.`), field('شمارهٔ پیگیری واریز', ref), btn);
  }
  return null;
}
