import { api, state } from '../api.js';
import { currentQuery, navigate, renderHeader } from '../app.js';
import { CATEGORY_ICONS, busy, emptyState, fa, faDate, field, h, icon, progress, relTime, toast, toman, tomanShort } from '../ui.js';
import { avatar, levelBadge, levelProgress, medal } from '../rewards-ui.js';
import { downloadButton, faVersion, installedVersion, latestRelease } from '../update.js';

export const STATUS = {
  pending: ['در انتظار بررسی', 'pill-warn'],
  approved: ['در حال جمع‌آوری کمک', 'pill-info'],
  rejected: ['رد شد', 'pill-danger'],
  funded: ['تأمین شد، در حال تسویه', 'pill-info'],
  paid: ['پرداخت شد', 'pill-success'],
};

export const statusPill = (s) => h('span', { class: `pill ${STATUS[s][1]}` }, STATUS[s][0]);

const TABS = { overview: 'دستاوردها', donations: 'کمک‌های من', requests: 'درخواست‌های من', settings: 'تنظیمات' };

export async function accountView(page) {
  const q = currentQuery().get('tab');
  const tab = TABS[q] ? q : 'overview';
  const [p, rewards] = await Promise.all([api.get('/api/my/profile'), api.get('/api/rewards')]);
  const body = h('div', {});
  page.append(
    h('section', { class: `card profile-hero ring-card-${p.level.current?.color ?? 'none'}` },
      avatar(p.displayName || state.user.displayName, p.level.current, 'xl'),
      h('h1', {}, p.displayName || 'کاربر مهرپل'),
      levelBadge(p.level.current),
      p.bio ? h('p', { class: 'muted' }, p.bio) : null,
      h('div', { class: 'hc-stats' },
        h('div', {}, h('strong', {}, p.stats.totalToman ? tomanShort(p.stats.totalToman * 10) : '۰'), h('span', {}, 'تومان کمک')),
        h('div', {}, h('strong', {}, fa(p.stats.cases)), h('span', {}, 'خانواده')),
        h('div', {}, h('strong', {}, fa(p.medals.filter((m) => m.earned).length)), h('span', {}, 'مدال'))),
      levelProgress(p.level),
      h('div', { class: 'muted small', dir: 'ltr' }, state.user.phone ?? state.user.email)),
    h('div', { class: 'segmented scroll' }, Object.entries(TABS).map(([k, label]) =>
      h('a', { class: tab === k ? 'active' : '', href: `#/me?tab=${k}` }, label))),
    body);

  if (tab === 'overview') return overviewTab(body, p, rewards);
  if (tab === 'settings') return settingsTab(body, p);
  if (tab === 'requests') return requestsTab(body);
  return donationsTab(body);
}

function overviewTab(body, p, rewards) {
  const level = (id) => rewards.levels.find((l) => l.id === id);
  const earned = p.medals.filter((m) => m.earned);
  const certBtn = h('button', { class: 'btn btn-primary' }, icon('printer'), p.certificate ? 'مشاهدهٔ گواهی' : 'صدور گواهی');
  certBtn.onclick = busy(certBtn, async () => {
    try {
      const { code } = await api.post('/api/my/certificate');
      navigate(`/certificate/${code}`);
    } catch (err) {
      toast(err.message, 'error');
      if (err.status === 400) navigate('/me?tab=settings');
    }
  });
  body.append(
    h('section', { class: 'card' },
      h('div', { class: 'row-between' }, h('h2', {}, icon('badge'), 'مدال‌ها'), h('span', { class: 'muted small' }, `${fa(earned.length)} از ${fa(p.medals.length)}`)),
      h('div', { class: 'medal-grid' }, [...earned, ...p.medals.filter((m) => !m.earned)].map((m) => medal(m)))),
    h('section', { class: 'card' },
      h('h2', {}, icon('gift'), 'امتیازها و خدمات ویژه'),
      h('p', { class: 'muted small' }, 'با بالا رفتن سطح، امتیازهای بیشتری برایتان باز می‌شود.'),
      h('ul', { class: 'perk-list' }, p.perks.map((k) => h('li', { class: `perk ${k.unlocked ? 'unlocked' : 'locked'}` },
        h('span', { class: 'perk-icon' }, icon(k.unlocked ? 'check' : 'lock')),
        h('div', { class: 'grow' },
          h('strong', {}, k.title, !k.active ? h('span', { class: 'pill pill-muted' }, 'به‌زودی') : null),
          h('p', { class: 'muted small' }, k.description, k.partner ? ` — با همکاری ${k.partner}` : '')),
        h('span', { class: `level-chip lvl-${level(k.level)?.color}` }, level(k.level)?.name))))),
    h('section', { class: 'card cert-cta' },
      h('div', { class: 'grow' }, h('h2', {}, icon('printer'), 'گواهی قدردانی'),
        h('p', { class: 'muted small' }, p.canCertify
          ? 'گواهی شما با کد یکتا صادر می‌شود و هر کسی می‌تواند درستی آن را روی سایت استعلام کند.'
          : 'از سطح «مهرآفرین برنزی» (۱ میلیون تومان کمک یا کمک به ۵ درخواست) می‌توانید گواهی بگیرید.')),
      p.canCertify ? certBtn : h('span', { class: 'pill pill-muted' }, icon('lock'), 'قفل')));
}

function settingsTab(body, p) {
  const name = h('input', { class: 'input', maxlength: 40, value: p.displayName, placeholder: 'مثلاً: مریم از شیراز' });
  const bio = h('textarea', { class: 'input', rows: 2, maxlength: 160, placeholder: 'یک جمله دربارهٔ انگیزه‌تان (اختیاری)' });
  bio.value = p.bio;
  const pub = h('input', { type: 'checkbox' });
  pub.checked = p.publicProfile;
  const save = h('button', { class: 'btn btn-primary' }, 'ذخیره');
  save.onclick = busy(save, async () => {
    try {
      await api.patch('/api/my/profile', { displayName: name.value, bio: bio.value, publicProfile: pub.checked });
      state.user.displayName = name.value.trim();
      renderHeader();
      toast('ذخیره شد', 'success');
      navigate('/me');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  const logout = h('button', { class: 'btn btn-danger-ghost' }, icon('logout'), 'خروج از حساب');
  logout.onclick = busy(logout, async () => {
    await api.post('/api/auth/logout');
    state.user = null;
    renderHeader();
    navigate('/');
  });
  body.append(h('section', { class: 'card' },
    h('h2', {}, icon('settings'), 'پروفایل'),
    field('نام نمایشی', name, 'روی گواهی و (اگر بخواهید) در تالار افتخار نمایش داده می‌شود. لازم نیست نام واقعی باشد.'),
    field('دربارهٔ من', bio),
    h('label', { class: 'check' }, pub, 'نمایش پروفایل من در تالار افتخار (بدون مبلغ و شمارهٔ تلفن)'),
    p.slug ? h('p', {}, h('a', { class: 'small', href: `#/donor/${p.slug}` }, 'مشاهدهٔ پروفایل عمومی من')) : null,
    h('div', { class: 'row-gap' }, save, logout)),
  emailCard(), themeCard());
  appCard().then((card) => card && body.append(card));
}

/** Links an email to the account (proven with a code), so the person can sign in by email too. */
function emailCard() {
  const current = state.user.email;
  const email = h('input', { class: 'input', type: 'email', dir: 'ltr', maxlength: 120, placeholder: 'name@example.com', value: current ?? '' });
  const code = h('input', { class: 'input otp', inputmode: 'numeric', dir: 'ltr', maxlength: 6, placeholder: '------' });
  const codeField = field('کد ارسال‌شده به ایمیل', code);
  codeField.hidden = true;
  const send = h('button', { class: 'btn' }, icon('upload'), current ? 'تغییر ایمیل' : 'ارسال کد تأیید');
  const confirmBtn = h('button', { class: 'btn btn-primary' }, icon('check'), 'تأیید');
  confirmBtn.hidden = true;
  send.onclick = busy(send, async () => {
    try {
      await api.post('/api/my/email', { email: email.value.trim() });
      codeField.hidden = false;
      confirmBtn.hidden = false;
      code.focus();
      toast('کد به ایمیل شما رفت؛ پوشهٔ Spam را هم ببینید', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  confirmBtn.onclick = busy(confirmBtn, async () => {
    try {
      const res = await api.post('/api/my/email/verify', { email: email.value.trim(), code: code.value });
      state.user.email = res.email;
      toast('ایمیل به حساب شما وصل شد', 'success');
      navigate(`/me?tab=settings&t=${Date.now()}`);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  return h('section', { class: 'card' }, h('h2', {}, icon('lock'), 'ایمیل و شمارهٔ حساب'),
    h('div', { class: 'info-row' }, h('span', { class: 'muted' }, 'موبایل'), h('strong', { dir: 'ltr' }, state.user.phone ?? '—')),
    h('div', { class: 'info-row' }, h('span', { class: 'muted' }, 'ایمیل'), h('strong', { dir: 'ltr' }, current ?? 'هنوز وصل نشده')),
    h('p', { class: 'muted small' }, 'با ایمیل تأییدشده می‌توانید با ایمیل هم وارد شوید و پیام‌های مهم را دریافت کنید.'),
    field('ایمیل', email), codeField, h('div', { class: 'row-gap' }, send, confirmBtn));
}

/** Day / night / follow-the-device choice. */
function themeCard() {
  const choices = { auto: ['خودکار', 'settings'], light: ['روز', 'sun'], dark: ['شب', 'moon'] };
  const group = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'ظاهر برنامه' });
  const draw = () => group.replaceChildren(...Object.entries(choices).map(([k, [label, ic]]) => {
    const active = window.mehrpolTheme.choice() === k;
    return h('button', { type: 'button', role: 'radio', 'aria-checked': String(active), class: active ? 'active' : '', onclick: () => {
      window.mehrpolTheme.set(k);
      draw();
    } }, icon(ic), ' ', label);
  }));
  draw();
  return h('section', { class: 'card' }, h('h2', {}, icon('sun'), 'ظاهر برنامه'),
    h('p', { class: 'muted small' }, '«خودکار» از تنظیم روز و شب گوشی یا کامپیوتر شما پیروی می‌کند.'), group);
}

/** Version info and update button, only inside the Android app. */
async function appCard() {
  const current = installedVersion();
  if (current === null) return null;
  const r = await latestRelease();
  const newer = r.available && r.versionCode > current;
  return h('section', { class: 'card' }, h('h2', {}, icon('android'), 'نسخهٔ برنامه'),
    h('p', { class: 'muted small' }, newer ? `نسخهٔ ${faVersion(r.version)} منتشر شده است.` : 'از آخرین نسخه استفاده می‌کنید.'),
    newer ? downloadButton(r) : null);
}

async function requestsTab(body) {
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
}

async function donationsTab(body) {
  const { items } = await api.get('/api/my/donations');
  if (!items.length) {
    body.append(emptyState('heart', 'هنوز کمکی ثبت نشده', 'اولین قبض را همین امروز پرداخت کنید و مدال «نخستین گام» را بگیرید.',
      h('a', { class: 'btn btn-primary', href: '#/cases' }, 'دیدن درخواست‌ها')));
    return;
  }
  body.append(h('div', { class: 'list' }, items.map((d) =>
    h('a', { class: 'card list-item', href: `#/receipt/${d.id}` },
      h('span', { class: 'cat-dot' }, icon('receipt')),
      h('div', { class: 'grow' }, h('strong', {}, d.case ? d.case.title : 'صندوق عمومی'), h('div', { class: 'muted small' }, faDate(d.createdAt))),
      h('div', { class: 'end' }, h('strong', {}, toman(d.amount)),
        d.status === 'succeeded' ? h('span', { class: 'pill pill-success' }, 'موفق') : h('span', { class: 'pill pill-danger' }, 'ناموفق'))))));
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
