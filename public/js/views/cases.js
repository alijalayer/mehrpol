import { api, state } from '../api.js';
import { currentQuery, navigate } from '../app.js';
import { CATEGORY_ICONS, busy, emptyState, fa, h, icon, moneyInput, progress, relTime, skeletonCards, toAscii, toast, toman } from '../ui.js';

export function caseCard(c) {
  const cat = state.meta.categories[c.category];
  const remaining = c.amount - c.raised;
  return h('a', { class: 'card case-card', href: `#/case/${c.code}` },
    h('div', { class: 'case-top' },
      h('span', { class: `cat-chip cat-${c.category}` }, icon(CATEGORY_ICONS[c.category]), cat.label),
      c.isDemo ? h('span', { class: 'pill pill-muted' }, 'نمونه') : null,
      c.status === 'paid' ? h('span', { class: 'pill pill-success' }, icon('check'), 'پرداخت شد') : null),
    h('h3', {}, c.title),
    h('p', { class: 'muted clamp' }, c.story),
    h('div', { class: 'case-meta' }, h('span', {}, icon('map'), c.province), h('span', {}, icon('clock'), relTime(c.createdAt))),
    progress(c.raised, c.amount),
    h('div', { class: 'case-amounts' },
      c.status === 'approved'
        ? [h('span', {}, 'باقی‌مانده ', h('strong', {}, toman(remaining))), h('span', { class: 'muted' }, `از ${toman(c.amount)}`)]
        : [h('span', {}, 'مبلغ ', h('strong', {}, toman(c.amount))), h('span', { class: 'muted' }, c.paidAt ? relTime(c.paidAt) : '')]));
}

export async function casesView(page) {
  const q = currentQuery();
  const category = q.get('cat') ?? '';
  const status = q.get('status') === 'done' ? 'done' : 'open';
  const go = (cat, st) => navigate(`/cases?${new URLSearchParams({ ...(cat ? { cat } : {}), ...(st === 'done' ? { status: 'done' } : {}) })}`);

  const chips = h('div', { class: 'chips', role: 'tablist' },
    h('button', { class: `chip ${!category ? 'active' : ''}`, onclick: () => go('', status) }, 'همه'),
    Object.entries(state.meta.categories).map(([key, c]) =>
      h('button', { class: `chip ${category === key ? 'active' : ''}`, onclick: () => go(key, status) }, icon(CATEGORY_ICONS[key]), c.label)));
  const seg = h('div', { class: 'segmented' },
    h('button', { class: status === 'open' ? 'active' : '', onclick: () => go(category, 'open') }, 'نیازمند کمک'),
    h('button', { class: status === 'done' ? 'active' : '', onclick: () => go(category, 'done') }, 'انجام‌شده'));
  const list = skeletonCards(6);
  page.append(
    h('div', { class: 'page-head' }, h('h1', {}, 'درخواست‌های تأییدشده'),
      h('p', { class: 'muted' }, 'همهٔ درخواست‌ها پیش از نمایش، توسط کارشناس بررسی و قبض‌ها استعلام شده‌اند. هویت متقاضیان محرمانه است.')),
    seg, chips, list);

  let offset = 0;
  const load = async () => {
    const params = new URLSearchParams({ offset, status, ...(category ? { category } : {}) });
    const data = await api.get(`/api/cases?${params}`);
    if (offset === 0) list.replaceChildren();
    list.classList.remove('skeleton-wrap');
    if (offset === 0 && data.items.length === 0) {
      list.replaceWith(emptyState('heart', status === 'open' ? 'فعلاً درخواست بازی نیست' : 'هنوز موردی ثبت نشده', 'می‌توانید به صندوق عمومی کمک کنید تا به اولین درخواست‌ها برسد.'));
      return;
    }
    list.append(...data.items.map(caseCard));
    offset += data.items.length;
    page.querySelector('.load-more')?.remove();
    if (data.more) {
      const more = h('button', { class: 'btn btn-ghost load-more' }, 'نمایش بیشتر');
      more.onclick = busy(more, load);
      page.append(more);
    }
  };
  list.className = 'grid';
  await load();
}

export async function caseView(page, code) {
  const c = await api.get(`/api/cases/${code}`);
  const cat = state.meta.categories[c.category];
  const remaining = c.amount - c.raised;
  const pct = Math.min(100, Math.round((c.raised / c.amount) * 100));

  page.append(
    h('a', { class: 'back', href: '#/cases' }, icon('back'), 'همهٔ درخواست‌ها'),
    h('div', { class: 'case-layout' },
      h('article', { class: 'card case-detail' },
        h('div', { class: 'case-top' },
          h('span', { class: `cat-chip cat-${c.category}` }, icon(CATEGORY_ICONS[c.category]), cat.label),
          c.isDemo ? h('span', { class: 'pill pill-muted' }, 'نمونهٔ نمایشی') : null),
        h('h1', {}, c.title),
        h('div', { class: 'case-meta' }, h('span', {}, icon('map'), c.province), h('span', {}, icon('clock'), relTime(c.createdAt)), h('span', { dir: 'ltr' }, `#${c.code}`)),
        h('p', { class: 'story' }, c.story),
        h('ul', { class: 'checks' },
          h('li', {}, icon('check'), 'هویت متقاضی توسط کارشناس بررسی شده است'),
          c.billVerified ? h('li', {}, icon('check'), 'شناسهٔ قبض و مبلغ آن استعلام شده است') : h('li', {}, icon('check'), 'مدارک بدهی (قرارداد/نامهٔ بانک) بررسی شده است'),
          h('li', {}, icon('lock'), cat.bill ? 'مبلغ مستقیم به سازمان صادرکنندهٔ قبض پرداخت می‌شود' : 'مبلغ مستقیم به طلبکار (بانک/موجر/مرکز درمانی) واریز می‌شود'))),
      h('aside', { class: 'card donate-box' },
        h('div', { class: 'big-amount' }, h('strong', {}, toman(c.raised)), h('span', { class: 'muted' }, ` از ${toman(c.amount)}`)),
        progress(c.raised, c.amount),
        h('div', { class: 'muted small' }, `${fa(pct)}٪ تأمین شده`),
        c.status === 'approved' ? donateForm(c, remaining) : doneBox(c))));
}

function doneBox(c) {
  return h('div', { class: 'done-box' }, icon('check', 'done-icon'),
    h('strong', {}, c.status === 'paid' ? 'این بدهی پرداخت شد' : 'مبلغ کامل شد؛ در حال تسویه'),
    c.payoutRef ? h('div', { class: 'muted small' }, 'کد پیگیری پرداخت: ', h('span', { dir: 'ltr', class: 'mono' }, c.payoutRef)) : null,
    h('a', { class: 'btn btn-ghost', href: '#/cases' }, 'کمک به درخواست دیگر'));
}

function donateForm(c, remaining) {
  const remainingToman = Math.round(remaining / 10);
  const amount = moneyInput({ placeholder: 'مبلغ دلخواه به تومان', 'aria-label': 'مبلغ کمک به تومان' });
  const presets = [50_000, 100_000, 200_000, 500_000].filter((v) => v < remainingToman);
  const setAmount = (v) => {
    amount.value = fa(v);
    for (const b of chips.children) b.classList.toggle('active', Number(b.dataset.v) === v);
  };
  const chips = h('div', { class: 'amount-chips' },
    presets.map((v) => h('button', { type: 'button', class: 'chip', dataset: { v }, onclick: () => setAmount(v) }, fa(v / 1000) + ' هزار')),
    h('button', { type: 'button', class: 'chip chip-strong', dataset: { v: remainingToman }, onclick: () => setAmount(remainingToman) }, 'کل باقی‌مانده'));
  const anon = h('input', { type: 'checkbox', checked: true, id: 'anon' });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, icon('heart'), 'پرداخت امن');
  const form = h('form', { class: 'donate-form' },
    h('label', { class: 'label' }, 'چقدر کمک می‌کنید؟'), chips, amount,
    h('label', { class: 'check' }, anon, 'نامم در هیچ‌جا نمایش داده نشود'),
    submit,
    h('p', { class: 'muted small center' }, icon('lock'), state.meta.paymentProvider === 'mock' ? 'درگاه آزمایشی — پولی جابه‌جا نمی‌شود' : 'انتقال به درگاه امن شاپرک'));
  form.onsubmit = (e) => {
    e.preventDefault();
    run();
  };
  const run = busy(submit, async () => {
    if (!state.user) return navigate(`/login?next=${encodeURIComponent('/case/' + c.code)}`);
    const v = amount.raw();
    if (!v) return toast('مبلغ را وارد کنید', 'error');
    try {
      const res = await api.post('/api/donations', { caseCode: c.code, amountToman: toAscii(v), anonymous: anon.checked });
      location.href = res.redirectUrl;
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  return form;
}
