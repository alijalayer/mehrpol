import { api, state } from '../api.js';
import { navigate } from '../app.js';
import { CATEGORY_ICONS, busy, field, h, icon, moneyInput, toAscii, toast, toman } from '../ui.js';

const SERVICE_BY_DIGIT = { 1: 'water', 2: 'electricity', 3: 'gas', 4: 'landline', 5: 'mobile' };

function mod11(digits) {
  let sum = 0;
  let w = 2;
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += Number(digits[i]) * w;
    w = w === 7 ? 2 : w + 1;
  }
  const r = sum % 11;
  return r < 2 ? 0 : 11 - r;
}

/** Same check-digit rules as the server, for instant feedback while typing. */
function previewBill(billRaw, payRaw) {
  const b = toAscii(billRaw).replace(/\D/g, '').replace(/^0+/, '');
  const p = toAscii(payRaw).replace(/\D/g, '').replace(/^0+/, '');
  if (b.length < 6 || p.length < 6) return null;
  if (mod11(b.slice(0, -1)) !== Number(b.at(-1))) return { error: 'شناسه قبض درست نیست' };
  if (mod11(p.slice(0, -2)) !== Number(p.at(-2)) || mod11(b + p.slice(0, -1)) !== Number(p.at(-1))) return { error: 'شناسه پرداخت با قبض هم‌خوانی ندارد' };
  return { service: SERVICE_BY_DIGIT[b.at(-2)], amount: Number(p.slice(0, -5) || 0) * 1000 };
}

export async function newRequestView(page) {
  const { categories, provinces } = state.meta;
  let category = 'electricity';

  const tiles = h('div', { class: 'cat-grid selectable', role: 'radiogroup', 'aria-label': 'نوع بدهی' });
  const renderTiles = () => tiles.replaceChildren(...Object.entries(categories).map(([key, c]) =>
    h('button', { type: 'button', role: 'radio', 'aria-checked': String(key === category), class: `cat-tile cat-${key} ${key === category ? 'selected' : ''}`, onclick: () => {
      category = key;
      renderTiles();
      renderDetails();
    } }, icon(CATEGORY_ICONS[key]), h('span', {}, c.label))));

  const billId = h('input', { class: 'input mono', inputmode: 'numeric', dir: 'ltr', maxlength: 13, autocomplete: 'off' });
  const paymentId = h('input', { class: 'input mono', inputmode: 'numeric', dir: 'ltr', maxlength: 13, autocomplete: 'off' });
  const billStatus = h('div', { class: 'bill-preview', 'aria-live': 'polite' });
  const amount = moneyInput({ placeholder: 'مثلاً ۲٬۵۰۰٬۰۰۰' });
  const payee = h('textarea', { class: 'input', rows: 2, maxlength: 300, placeholder: 'مثلاً: بانک ملی، شمارهٔ قرارداد وام ۱۲۳۴… یا شبای موجر' });
  const details = h('div', {});

  const updatePreview = () => {
    const p = previewBill(billId.value, paymentId.value);
    billStatus.className = 'bill-preview';
    if (!p) return billStatus.replaceChildren();
    if (p.error) {
      billStatus.classList.add('bad');
      return billStatus.replaceChildren(icon('x'), p.error);
    }
    if (p.service !== category) {
      billStatus.classList.add('bad');
      return billStatus.replaceChildren(icon('x'), `این شناسه مربوط به «${categories[p.service]?.label ?? 'خدمت دیگر'}» است`);
    }
    billStatus.classList.add('good');
    billStatus.replaceChildren(icon('check'), 'قبض معتبر است · مبلغ: ', h('strong', {}, toman(p.amount)));
  };
  billId.oninput = paymentId.oninput = updatePreview;

  const renderDetails = () => {
    if (categories[category].bill) {
      details.replaceChildren(
        h('div', { class: 'two-col' },
          field('شناسهٔ قبض', billId, 'روی قبض کاغذی یا پیامک قبض آمده است.'),
          field('شناسهٔ پرداخت', paymentId)),
        billStatus);
      updatePreview();
    } else {
      details.replaceChildren(
        field('مبلغ بدهی (تومان)', amount),
        field('اطلاعات طلبکار', payee, 'کمک مستقیم به همین حساب واریز می‌شود، نه به حساب شما. فقط کارشناس این را می‌بیند.'),
        h('div', { class: 'alert alert-info' }, icon('file'), 'پس از ثبت، نامهٔ بانک، قرارداد اجاره یا نسخه و فاکتور درمان را بارگذاری کنید.'));
    }
  };

  const title = h('input', { class: 'input', maxlength: 80, placeholder: 'مثلاً: قبض گاز دو ماه زمستان' });
  const story = h('textarea', { class: 'input', rows: 5, maxlength: 1500, placeholder: 'شرایط خود را صادقانه بنویسید. نام، تلفن یا آدرس ننویسید؛ این متن بدون نام به خیّرین نمایش داده می‌شود.' });
  const counter = h('small', { class: 'hint end' }, '۰ / ۱۵۰۰');
  story.oninput = () => (counter.textContent = `${story.value.length.toLocaleString('fa-IR')} / ۱۵۰۰`);
  const province = h('select', { class: 'input' }, h('option', { value: '' }, 'انتخاب استان'), provinces.map((p) => h('option', { value: p }, p)));

  const fullName = h('input', { class: 'input', maxlength: 80, autocomplete: 'name' });
  const nationalCode = h('input', { class: 'input mono', inputmode: 'numeric', dir: 'ltr', maxlength: 10 });
  // Documents are picked here and uploaded (encrypted) right after the request is created.
  const files = [];
  const fileInput = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,application/pdf', multiple: true, class: 'sr-only', id: 'new-docs' });
  const fileList = h('ul', { class: 'file-list' });
  const drawFiles = () => fileList.replaceChildren(...files.map((f, i) => h('li', {}, icon(f.type === 'application/pdf' ? 'file' : 'image'),
    h('span', { class: 'name' }, f.name), h('span', { class: 'muted small' }, `${(f.size / 1048576).toLocaleString('fa-IR', { maximumFractionDigits: 1 })} مگابایت`),
    h('button', { type: 'button', 'aria-label': 'حذف', onclick: () => { files.splice(i, 1); drawFiles(); } }, icon('x')))));
  fileInput.onchange = () => {
    for (const f of fileInput.files) {
      if (f.size > 5 * 1024 * 1024) toast(`«${f.name}» بیش از ۵ مگابایت است`, 'error');
      else if (files.length >= 6) toast('حداکثر ۶ فایل', 'error');
      else files.push(f);
    }
    fileInput.value = '';
    drawFiles();
  };
  const consent = h('input', { type: 'checkbox', id: 'consent' });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-block btn-lg' }, 'ثبت درخواست');

  const form = h('form', { class: 'stack', novalidate: true },
    h('section', { class: 'card' }, h('h2', {}, h('span', { class: 'num' }, '۱'), 'نوع بدهی'), tiles, details),
    h('section', { class: 'card' }, h('h2', {}, h('span', { class: 'num' }, '۲'), 'شرح وضعیت'),
      field('عنوان کوتاه', title), field('توضیحات', story), counter, field('استان', province)),
    state.user.hasIdentity ? null : h('section', { class: 'card' }, h('h2', {}, h('span', { class: 'num' }, '۳'), 'احراز هویت'),
      h('p', { class: 'muted small' }, icon('lock'), 'این اطلاعات رمزنگاری می‌شود و فقط کارشناس بررسی آن را می‌بیند.'),
      h('div', { class: 'two-col' }, field('نام و نام خانوادگی', fullName), field('کد ملی', nationalCode))),
    h('section', { class: 'card' }, h('h2', {}, h('span', { class: 'num' }, state.user.hasIdentity ? '۳' : '۴'), 'مدارک'),
      h('p', { class: 'muted small' }, icon('lock'), ' عکس قبض، کارت ملی، نامهٔ بانک، قرارداد اجاره یا نسخهٔ پزشک. رمزنگاری می‌شود و فقط کارشناس می‌بیند.'),
      fileInput, h('label', { class: 'dropzone', for: 'new-docs' }, icon('upload'), h('strong', {}, 'انتخاب فایل'),
        h('span', { class: 'muted small' }, 'تصویر یا PDF · حداکثر ۶ فایل، هر کدام ۵ مگابایت')), fileList),
    h('label', { class: 'check' }, consent, 'تأیید می‌کنم اطلاعات واقعی است و می‌دانم ثبت اطلاعات نادرست پیگرد قانونی دارد.'),
    submit);

  form.onsubmit = (e) => {
    e.preventDefault();
    send();
  };
  const send = busy(submit, async () => {
    if (!consent.checked) return toast('لطفاً تأییدیهٔ صحت اطلاعات را بزنید', 'error');
    if (!province.value) return toast('استان را انتخاب کنید', 'error');
    const body = { category, title: title.value, story: story.value, province: province.value };
    if (categories[category].bill) Object.assign(body, { billId: toAscii(billId.value), paymentId: toAscii(paymentId.value) });
    else Object.assign(body, { amountToman: amount.raw(), payee: payee.value });
    if (!state.user.hasIdentity) Object.assign(body, { fullName: fullName.value, nationalCode: toAscii(nationalCode.value) });
    try {
      const c = await api.post('/api/my/cases', body);
      state.user.hasIdentity = true;
      let failed = 0;
      for (const [i, f] of files.entries()) {
        toast(`در حال بارگذاری مدرک ${(i + 1).toLocaleString('fa-IR')} از ${files.length.toLocaleString('fa-IR')}…`);
        const fd = new FormData();
        fd.append('file', f);
        await api.post(`/api/my/cases/${c.id}/documents`, fd).catch(() => failed++);
      }
      if (failed) toast(`درخواست ثبت شد؛ ${failed.toLocaleString('fa-IR')} فایل بارگذاری نشد. از همین صفحه دوباره امتحان کنید.`, 'error');
      else toast(files.length ? 'درخواست و مدارک ثبت شد.' : 'درخواست ثبت شد. حالا مدارک را بارگذاری کنید.', 'success');
      navigate(`/request/${c.id}`);
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  renderTiles();
  renderDetails();
  page.append(
    h('div', { class: 'page-head' }, h('h1', {}, 'درخواست کمک'),
      h('p', { class: 'muted' }, 'ثبت درخواست رایگان است. هیچ‌کس از طرف ما برای ثبت یا تأیید درخواست، پول نمی‌خواهد.')),
    form);
}
