import { api, state } from '../api.js';
import { currentQuery, navigate, renderHeader } from '../app.js';
import { busy, fa, field, h, icon, toAscii, toast } from '../ui.js';

export async function loginView(page) {
  const next = currentQuery().get('next') ?? '/me';
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/me';
  if (state.user) return navigate(safeNext);

  const card = h('div', { class: 'card auth-card' });
  page.append(h('div', { class: 'auth-wrap' }, card));

  const phoneStep = () => {
    const phone = h('input', { class: 'input', type: 'tel', inputmode: 'numeric', autocomplete: 'tel', dir: 'ltr', placeholder: '09xx xxx xxxx', maxlength: 14, required: true });
    const btn = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'دریافت کد تأیید');
    // Shown only when the server says this number belongs to a manager (demo mode).
    const adminKey = h('input', { class: 'input', type: 'password', autocomplete: 'off', dir: 'ltr' });
    const keyField = field('کلید مدیریت', adminKey, 'این شماره مدیر است. کلیدی را که برای مدیران تعیین شده وارد کنید.');
    keyField.hidden = true;
    const form = h('form', {}, field('شماره موبایل', phone, 'کد تأیید ۶ رقمی برایتان پیامک می‌شود.'), keyField, btn);
    form.onsubmit = (e) => {
      e.preventDefault();
      send();
    };
    const send = busy(btn, async () => {
      try {
        const res = await api.post('/api/auth/otp', { phone: toAscii(phone.value), ...(keyField.hidden ? {} : { adminKey: adminKey.value }) });
        codeStep(toAscii(phone.value), res);
      } catch (err) {
        if (err.data?.needsAdminKey) {
          keyField.hidden = false;
          adminKey.focus();
        }
        toast(err.message, 'error');
      }
    });
    card.replaceChildren(h('div', { class: 'auth-icon' }, icon('user')), h('h1', {}, 'ورود یا ثبت‌نام'),
      h('p', { class: 'muted' }, 'با یک حساب هم می‌توانید کمک کنید و هم درخواست کمک ثبت کنید.'), form);
    phone.focus();
  };

  const codeStep = (phone, res) => {
    const code = h('input', { class: 'input otp', inputmode: 'numeric', autocomplete: 'one-time-code', dir: 'ltr', maxlength: 6, placeholder: '------' });
    const btn = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'ورود');
    let left = res.ttl;
    const timer = h('span', { class: 'muted small' }, `اعتبار کد: ${fa(left)} ثانیه`);
    const tick = setInterval(() => {
      left -= 1;
      timer.textContent = left > 0 ? `اعتبار کد: ${fa(left)} ثانیه` : 'کد منقضی شد';
      if (left <= 0 || !document.body.contains(timer)) clearInterval(tick);
    }, 1000);
    const form = h('form', {}, field('کد تأیید', code), btn);
    const verify = busy(btn, async () => {
      try {
        const out = await api.post('/api/auth/verify', { phone, code: toAscii(code.value) });
        state.user = out.user;
        renderHeader();
        toast('خوش آمدید', 'success');
        navigate(safeNext);
      } catch (err) {
        toast(err.message, 'error');
        code.select();
      }
    });
    form.onsubmit = (e) => {
      e.preventDefault();
      verify();
    };
    code.addEventListener('input', () => {
      code.value = toAscii(code.value).replace(/\D/g, '');
      if (code.value.length === 6) verify();
    });
    card.replaceChildren(h('div', { class: 'auth-icon' }, icon('lock')), h('h1', {}, 'کد تأیید'),
      h('p', { class: 'muted' }, 'کد ارسال‌شده به ', h('span', { dir: 'ltr' }, phone), ' را وارد کنید.'),
      res.demoCode ? h('div', { class: 'demo-code' }, 'نسخهٔ نمایشی — کد شما: ', h('strong', { dir: 'ltr' }, res.demoCode)) : '',
      form, h('div', { class: 'row-between' }, timer, h('button', { class: 'link', onclick: phoneStep }, 'تغییر شماره')));
    code.focus();
  };

  phoneStep();
}
