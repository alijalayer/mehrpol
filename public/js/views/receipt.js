import { api } from '../api.js';
import { faDateTime, h, icon, toman } from '../ui.js';

export async function receiptView(page, id) {
  const d = await api.get(`/api/my/donations/${id}`);
  const ok = d.status === 'succeeded';
  // Gift, circle and campaign money is spread over cases on purpose, so it is not "surplus".
  const surplus = ok && d.kind === 'case' ? d.amount - d.applied : 0;
  const target = d.case ? h('a', { href: `#/case/${d.case.code}` }, d.case.title)
    : d.kind === 'gift' ? 'کارت هدیهٔ مهر' : d.kind === 'circle' ? 'حلقهٔ مهر (کمک ماهانه)'
      : d.campaign ? h('a', { href: `#/campaign/${d.campaign.slug}` }, d.campaign.title) : 'صندوق عمومی';
  const extraLabel = { gift: 'هزینهٔ صدور کارت', circle: 'حق عضویت ماهانه' }[d.kind] ?? 'حمایت از مهرپل';
  page.append(h('div', { class: 'receipt-wrap' },
    h('div', { class: `card receipt ${ok ? 'ok' : 'fail'}` },
      h('div', { class: 'receipt-icon' }, icon(ok ? 'check' : 'x')),
      h('h1', {}, ok ? 'از شما سپاسگزاریم' : d.status === 'initiated' ? 'در انتظار تأیید بانک' : 'پرداخت انجام نشد'),
      h('p', { class: 'muted' }, ok
        ? 'کمک شما با موفقیت ثبت شد.'
        : 'اگر مبلغی از حسابتان کسر شده، طبق قوانین شاپرک حداکثر ظرف ۷۲ ساعت برمی‌گردد.'),
      h('dl', { class: 'receipt-rows' },
        row('مبلغ کمک', h('strong', {}, toman(d.amount))),
        d.extra ? row(extraLabel, toman(d.extra)) : null,
        d.extra ? row('جمع پرداخت', h('strong', {}, toman(d.amount + d.extra))) : null,
        row('برای', target),
        ok ? row('کد پیگیری بانک', h('span', { dir: 'ltr', class: 'mono' }, d.refId)) : null,
        row('زمان', faDateTime(d.verifiedAt ?? d.createdAt)),
        row('نمایش نام', d.anonymous ? 'ناشناس' : 'با نام')),
      surplus > 0 ? h('div', { class: 'alert alert-info' }, `هم‌زمان خیّر دیگری این درخواست را تکمیل کرد؛ ${toman(surplus)} از کمک شما به صندوق عمومی رفت و صرف نزدیک‌ترین درخواست بعدی می‌شود.`) : null,
      ok && d.case?.status === 'paid' ? h('div', { class: 'alert alert-success' }, icon('check'), 'این بدهی به‌طور کامل پرداخت شد. کد پیگیری پرداخت: ', h('span', { dir: 'ltr', class: 'mono' }, d.case.payoutRef)) : null,
      ok && d.giftCode ? h('a', { class: 'btn btn-primary btn-block mb', href: `#/card/${d.giftCode}` }, icon('gift'), 'مشاهده و ارسال کارت هدیه') : null,
      ok && d.kind === 'circle' ? h('a', { class: 'btn btn-primary btn-block mb', href: '#/circle' }, icon('users'), 'وضعیت عضویت حلقهٔ مهر') : null,
      h('div', { class: 'receipt-actions' },
        h('a', { class: 'btn btn-primary', href: '#/cases' }, icon('heart'), 'کمک به درخواست دیگر'),
        h('a', { class: 'btn btn-ghost', href: '#/me?tab=donations' }, 'همهٔ کمک‌های من')))));
}

const row = (k, v) => [h('dt', {}, k), h('dd', {}, v)];
