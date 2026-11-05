// More ways to give (and how Mehrpol pays its way): the optional tip, gift and memorial cards,
// the monthly circle, sponsored campaigns and partnership plans for companies and charities.
import { api, state } from '../api.js';
import { navigate } from '../app.js';
import { CATEGORY_ICONS, busy, confirmBox, emptyState, fa, faDate, field, h, icon, moneyInput, progress, toAscii, toast, toman } from '../ui.js';

let configPromise;
export const revenueConfig = () => (configPromise ??= api.get('/api/revenue/config'));

const paymentNote = () => h('p', { class: 'muted small center' }, icon('lock'), state.meta.paymentProvider === 'mock' ? 'درگاه آزمایشی — پولی جابه‌جا نمی‌شود' : 'انتقال به درگاه امن شاپرک');
/** Real mode before a bank gateway is connected: giving is explained, not taken. */
export const paymentsSoon = () => h('div', { class: 'alert alert-info' }, icon('clock'),
  h('span', {}, h('strong', {}, 'پرداخت آنلاین به‌زودی فعال می‌شود. '), 'درگاه بانکی در حال راه‌اندازی است؛ تا آن زمان می‌توانید درخواست‌ها را ببینید و برای خودتان یادداشت کنید.'));
const payable = (form) => (state.meta.paymentsOpen ? form : paymentsSoon());

const requireLogin = (back) => {
  if (state.user) return false;
  navigate(`/login?next=${encodeURIComponent(back)}`);
  return true;
};

/**
 * The optional "support Mehrpol" choice under a donation. It never reduces what the family gets:
 * the tip is added on top. Returns { el, percent() } and keeps the total line up to date.
 */
export function tipPicker(amountInput, cfg) {
  let percent = cfg.tipDefault;
  const total = h('div', { class: 'tip-total' });
  const chips = h('div', { class: 'amount-chips', role: 'radiogroup', 'aria-label': 'حمایت از مهرپل' });
  const draw = () => {
    chips.replaceChildren(...cfg.tipOptions.map((p) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(p === percent), class: `chip ${p === percent ? 'active' : ''}`,
      onclick: () => { percent = p; draw(); },
    }, p ? `${fa(p)}٪` : 'نه، ممنون')));
    const amount = Number(amountInput.raw() || 0);
    const tip = Math.round((amount * percent) / 100);
    total.replaceChildren(amount
      ? h('span', {}, 'کمک شما ', h('strong', {}, `${fa(amount)} تومان`), tip ? [' + حمایت از مهرپل ', h('strong', {}, `${fa(tip)} تومان`)] : '', ' = پرداخت ', h('strong', {}, `${fa(amount + tip)} تومان`))
      : '');
  };
  amountInput.addEventListener('input', draw);
  draw();
  const el = h('div', { class: 'tip-box' },
    h('div', { class: 'row-between' }, h('span', { class: 'label' }, icon('sparkle'), ' حمایت از مهرپل (اختیاری)'), h('span', { class: 'muted small' }, 'جدا از کمک شما')),
    h('p', { class: 'muted small' }, 'کمک شما کامل به خانواده می‌رسد. اگر خواستید، کمی هم برای سرور، پیامک و پشتیبانی مهرپل بگذارید.'),
    chips, total);
  return { el, percent: () => percent, redraw: draw };
}

/* ---------- Gift and memorial cards ---------- */

const GIFT_KINDS = {
  gift: { label: 'هدیه', icon: 'gift', to: 'هدیه برای', toHint: 'مثلاً: مادرم، دوستم سارا', line: (g) => `${g.fromName} به نام «${g.toName}» چراغ خانهٔ خانواده‌ای را روشن نگه داشت.` },
  memory: { label: 'به یاد', icon: 'heart', to: 'به یاد', toHint: 'نام عزیز درگذشته', line: (g) => `به یاد «${g.toName}»، ${g.fromName} قبض خانواده‌ای نیازمند را پرداخت کرد. یادش گرامی.` },
  nazr: { label: 'نذر', icon: 'sparkle', to: 'به نیت', toHint: 'مثلاً: سلامتی پدرم، قبولی فرزندم', line: (g) => `${g.fromName} نذرش را به نیت «${g.toName}» با پرداخت قبض یک خانواده ادا کرد.` },
};
const THEMES = { dawn: 'طلوع', garden: 'باغ', night: 'شب پرستاره', rose: 'گل سرخ' };

export async function giftView(page) {
  const cfg = await revenueConfig();
  let kind = 'gift';
  let theme = 'dawn';
  const fromName = h('input', { class: 'input', maxlength: 60, placeholder: 'نامی که روی کارت می‌آید', value: state.user?.displayName ?? '' });
  const toName = h('input', { class: 'input', maxlength: 60 });
  const message = h('textarea', { class: 'input', rows: 2, maxlength: 300, placeholder: 'چند کلمه از دل (اختیاری)' });
  const amount = moneyInput({ placeholder: 'حداقل ۵۰ هزار تومان' });
  const preview = h('div', {});
  const kinds = h('div', { class: 'segmented scroll' });
  const themes = h('div', { class: 'theme-swatches' });
  const toField = h('div', {});

  const draw = () => {
    kinds.replaceChildren(...Object.entries(GIFT_KINDS).map(([k, v]) => h('button', { type: 'button', class: kind === k ? 'active' : '', onclick: () => { kind = k; draw(); } }, icon(v.icon), ' ', v.label)));
    themes.replaceChildren(...Object.entries(THEMES).map(([k, label]) => h('button', { type: 'button', class: `swatch gift-${k} ${theme === k ? 'active' : ''}`, title: label, 'aria-label': label, onclick: () => { theme = k; draw(); } })));
    toField.replaceChildren(field(GIFT_KINDS[kind].to, toName, GIFT_KINDS[kind].toHint));
    preview.replaceChildren(giftCard({ kind, theme, fromName: fromName.value || 'نام شما', toName: toName.value || '…', message: message.value, helped: 1 }, true));
  };
  for (const el of [fromName, toName, message]) el.addEventListener('input', draw);

  const submit = h('button', { class: 'btn btn-primary btn-lg btn-block' }, icon('gift'), 'پرداخت و ساخت کارت');
  submit.onclick = busy(submit, async () => {
    if (requireLogin('/gift')) return;
    try {
      const res = await api.post('/api/gifts', { kind, theme, fromName: fromName.value, toName: toName.value, message: message.value, amountToman: toAscii(amount.raw()) });
      location.href = res.redirectUrl;
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  draw();
  page.append(
    h('div', { class: 'page-head center' }, h('span', { class: 'eyebrow' }, icon('gift'), 'کارت هدیهٔ مهر'),
      h('h1', {}, 'به‌جای هدیه، چراغ خانه‌ای را روشن کنید'),
      h('p', { class: 'muted' }, 'برای تولد، نوروز، به یاد عزیزی که رفته یا ادای نذر. مبلغ کارت کامل صرف قبض خانواده‌های نیازمند می‌شود و کارتی زیبا برای اشتراک‌گذاری می‌گیرید.')),
    h('div', { class: 'gift-layout' },
      h('section', { class: 'card' },
        h('h2', {}, icon('sparkle'), 'نوع کارت'), kinds,
        toField, field('از طرف', fromName), field('پیام', message),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'طرح کارت'), themes),
        field('مبلغ کمک (تومان)', amount, `هزینهٔ صدور کارت: ${fa(cfg.giftFee)} تومان، جدا از مبلغ کمک`),
        payable(h('div', {}, submit, paymentNote()))),
      h('div', { class: 'gift-preview' }, h('div', { class: 'muted small center' }, 'پیش‌نمایش'), preview)));
}

function giftCard(g, isPreview = false) {
  const k = GIFT_KINDS[g.kind];
  return h('article', { class: `gift-card gift-${g.theme} ${isPreview ? '' : 'reveal-pop'}` },
    h('div', { class: 'gift-top' }, h('img', { src: '/icons/logo.svg', alt: '', width: 30, height: 30 }), h('span', {}, 'مهرپل'), h('span', { class: 'gift-kind' }, icon(k.icon), k.label)),
    h('div', { class: 'gift-to' }, k.to, h('strong', {}, g.toName)),
    h('p', { class: 'gift-line' }, k.line(g)),
    g.message ? h('blockquote', {}, g.message) : null,
    h('div', { class: 'gift-foot' }, h('span', {}, icon('house'), ` ${fa(g.helped)} خانواده`), h('span', {}, 'mehrpol')));
}

export async function cardView(page, code) {
  const g = await api.get(`/api/gifts/${code}`);
  const url = `${location.origin}/#/card/${g.code}`;
  const share = h('button', { class: 'btn btn-primary' }, icon('share'), 'ارسال برای دیگران');
  share.onclick = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'کارت هدیهٔ مهر', text: GIFT_KINDS[g.kind].line(g), url });
      else {
        await navigator.clipboard.writeText(url);
        toast('لینک کارت کپی شد', 'success');
      }
    } catch {}
  };
  page.append(h('div', { class: 'card-page' }, giftCard(g),
    h('div', { class: 'row-gap center-row' }, share, h('a', { class: 'btn btn-ghost', href: '#/gift' }, icon('gift'), 'ساخت کارت دیگر')),
    h('p', { class: 'muted small center' }, `صادرشده در ${faDate(g.createdAt)} · کد کارت `, h('span', { class: 'mono', dir: 'ltr' }, g.code))));
}

/* ---------- The monthly circle ---------- */

export async function circleView(page) {
  const [cfg, mine] = await Promise.all([revenueConfig(), state.user ? api.get('/api/my/circle') : { member: null }]);
  const { categories, provinces } = state.meta;
  const m = mine.member;
  const amount = moneyInput({ placeholder: `حداقل ${fa(cfg.circleMin)} تومان`, value: m ? fa(Math.round(m.monthlyAmount / 10)) : '' });
  const presets = [cfg.circleMin, 200_000, 500_000, 1_000_000].filter((v, i, a) => v >= cfg.circleMin && a.indexOf(v) === i);
  const chips = h('div', { class: 'amount-chips' }, presets.map((v) => h('button', { type: 'button', class: 'chip', onclick: () => { amount.value = fa(v); amount.dispatchEvent(new Event('input')); } }, `${fa(v / 1000)} هزار`)));
  const category = h('select', { class: 'input' }, h('option', { value: '' }, 'هر نوع بدهی'), Object.entries(categories).map(([k, c]) => h('option', { value: k, selected: m?.category === k }, c.label)));
  const province = h('select', { class: 'input' }, h('option', { value: '' }, 'همهٔ استان‌ها'), provinces.map((p) => h('option', { value: p, selected: m?.province === p }, p)));
  const submit = h('button', { class: 'btn btn-primary btn-lg btn-block' }, icon('heart'), m?.active ? 'تمدید یک ماه دیگر' : 'عضویت در حلقهٔ مهر');
  submit.onclick = busy(submit, async () => {
    if (requireLogin('/circle')) return;
    try {
      const res = await api.post('/api/circle/pay', { amountToman: toAscii(amount.raw()), category: category.value, province: province.value });
      location.href = res.redirectUrl;
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  const perks = [
    ['heart', 'کمک خودکار ماهانه', 'هر ماه کمک شما بی‌دردسر به پرونده‌های نزدیک به تکمیلِ موردعلاقه‌تان می‌رسد.'],
    ['activity', 'گزارش اثر', 'می‌بینید این ماه چراغ چند خانه با شما روشن ماند.'],
    ['bolt', 'خبر پرونده‌های فوری', 'قطع گاز در زمستان یا برق در تابستان؟ زودتر از همه خبردار می‌شوید.'],
    ['badge', 'نشان «عضو حلقهٔ مهر»', 'روی پروفایل و گواهی قدردانی شما.'],
  ];
  let status = '';
  if (m) {
    const cancel = h('button', { class: 'btn btn-sm btn-danger-ghost' }, 'لغو عضویت');
    cancel.onclick = busy(cancel, async () => {
      if (!(await confirmBox('عضویت حلقهٔ مهر لغو شود؟ تا پایان دورهٔ پرداخت‌شده فعال می‌ماند.', { ok: 'بله، لغو شود', danger: true }))) return;
      await api.post('/api/circle/cancel');
      toast('عضویت لغو شد');
      navigate('/circle?u=' + Date.now());
    });
    status = h('section', { class: `card circle-status ${m.active ? 'on' : ''}` },
      h('div', { class: 'row-between' }, h('h2', {}, icon('badge'), m.active ? 'شما عضو حلقهٔ مهر هستید' : 'عضویت شما فعال نیست'),
        m.active ? h('span', { class: 'pill pill-success' }, `تا ${faDate(m.paidUntil)}`) : h('span', { class: 'pill pill-muted' }, 'غیرفعال')),
      h('div', { class: 'kpis' },
        h('div', { class: 'kpi' }, h('span', {}, icon('house'), 'این ماه'), h('strong', { 'data-count': mine.thisMonth.cases }, fa(mine.thisMonth.cases)), h('small', {}, 'خانواده')),
        h('div', { class: 'kpi' }, h('span', {}, icon('heart'), 'از ابتدا'), h('strong', { 'data-count': mine.allTime.cases }, fa(mine.allTime.cases)), h('small', {}, 'خانواده')),
        h('div', { class: 'kpi' }, h('span', {}, icon('gift'), 'کمک ماهانه'), h('strong', {}, toman(m.monthlyAmount)), h('small', {}, 'کامل برای خانواده‌ها'))),
      m.status === 'active' ? cancel : null);
  }

  page.append(
    h('section', { class: 'circle-hero reveal' },
      h('span', { class: 'eyebrow' }, icon('users'), 'حلقهٔ مهر'),
      h('h1', {}, 'هر ماه، چراغ چند خانه را روشن نگه دارید'),
      h('p', { class: 'lead' }, 'یک مبلغ ماهانه انتخاب کنید؛ مهرپل آن را به پرونده‌هایی که به تکمیل نزدیک‌اند می‌رساند و گزارش اثرش را به شما نشان می‌دهد.')),
    status,
    h('div', { class: 'circle-layout' },
      h('section', { class: 'card' }, h('h2', {}, icon('sparkle'), 'مزایای عضویت'),
        h('ul', { class: 'perk-list' }, perks.map(([ic, t, d]) => h('li', { class: 'perk unlocked reveal' }, h('span', { class: 'perk-icon' }, icon(ic)), h('div', {}, h('strong', {}, t), h('p', { class: 'muted small' }, d)))))),
      h('section', { class: 'card' }, h('h2', {}, icon('heart'), m?.active ? 'تمدید عضویت' : 'عضویت'),
        h('label', { class: 'label' }, 'کمک ماهانهٔ شما'), chips, amount,
        h('div', { class: 'two-col' }, field('برای چه نوع بدهی‌ای؟', category), field('در کدام استان؟', province)),
        h('div', { class: 'alert alert-info' }, icon('sparkle'), `حق عضویت ماهانه ${fa(cfg.circleFee)} تومان است و جدا از کمک شما حساب می‌شود؛ تمام کمک ماهانه به خانواده‌ها می‌رسد.`),
        payable(h('div', {}, submit, paymentNote())))));
}

/* ---------- Campaigns ---------- */

function campaignCard(c) {
  return h('a', { class: 'card campaign-card tilt reveal', href: `#/campaign/${c.slug}` },
    h('div', { class: 'sponsor-row' }, c.sponsorLogo ? h('img', { src: c.sponsorLogo, alt: c.sponsor, class: 'sponsor-logo' }) : h('span', { class: 'sponsor-mark' }, c.sponsor.charAt(0)),
      h('div', {}, h('small', { class: 'muted' }, 'با حمایت'), h('strong', {}, c.sponsor))),
    h('h3', {}, c.title),
    c.matchPercent ? h('span', { class: 'pill pill-warn match-pill' }, icon('sparkle'), c.matchPercent === 100 ? 'هر تومان شما دو برابر می‌شود' : `${fa(c.matchPercent)}٪ کمک شما را حامی اضافه می‌کند`) : null,
    progress(c.total, c.goal),
    h('div', { class: 'case-amounts' }, h('span', {}, h('strong', {}, toman(c.total)), ' جمع شده'), h('span', { class: 'muted' }, `هدف ${toman(c.goal)}`)));
}

export async function campaignsView(page) {
  const { items } = await api.get('/api/campaigns');
  page.append(h('div', { class: 'page-head' }, h('span', { class: 'eyebrow' }, icon('trophy'), 'کمپین‌ها'), h('h1', {}, 'کمپین‌های مهر'),
    h('p', { class: 'muted' }, 'شرکت‌ها و مجموعه‌های خیر کنار مردم می‌ایستند؛ در خیلی از کمپین‌ها حامی هم به اندازهٔ کمک شما اضافه می‌کند.')));
  if (!items.length) {
    page.append(emptyState('trophy', 'فعلاً کمپین فعالی نیست', 'شرکت شما می‌تواند اولین کمپین را راه بیندازد.', h('a', { class: 'btn btn-primary', href: '#/business' }, 'همکاری سازمان‌ها')));
    return;
  }
  page.append(h('div', { class: 'grid' }, items.map(campaignCard)));
}

export async function campaignView(page, slug) {
  const [c, cfg] = await Promise.all([api.get(`/api/campaigns/${slug}`), revenueConfig()]);
  const { categories } = state.meta;
  const amount = moneyInput({ placeholder: 'مبلغ به تومان' });
  const chips = h('div', { class: 'amount-chips' }, [50_000, 100_000, 200_000, 500_000].map((v) => h('button', { type: 'button', class: 'chip', onclick: () => { amount.value = fa(v); amount.dispatchEvent(new Event('input')); } }, `${fa(v / 1000)} هزار`)));
  const tip = tipPicker(amount, cfg);
  const submit = h('button', { class: 'btn btn-primary btn-block' }, icon('heart'), 'کمک به این کمپین');
  submit.onclick = busy(submit, async () => {
    if (requireLogin(`/campaign/${slug}`)) return;
    try {
      const res = await api.post('/api/donations', { campaign: slug, amountToman: toAscii(amount.raw()), tipPercent: tip.percent() });
      location.href = res.redirectUrl;
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  const open = c.active && (!c.endsAt || c.endsAt > Date.now());
  page.append(
    h('a', { class: 'back', href: '#/campaigns' }, icon('back'), 'کمپین‌ها'),
    h('div', { class: 'case-layout' },
      h('article', { class: 'card campaign-hero' },
        h('div', { class: 'sponsor-row' }, c.sponsorLogo ? h('img', { src: c.sponsorLogo, alt: c.sponsor, class: 'sponsor-logo' }) : h('span', { class: 'sponsor-mark' }, c.sponsor.charAt(0)),
          h('div', {}, h('small', { class: 'muted' }, 'با حمایت'), c.sponsorLink ? h('a', { href: c.sponsorLink, target: '_blank', rel: 'noopener noreferrer' }, h('strong', {}, c.sponsor)) : h('strong', {}, c.sponsor))),
        h('h1', {}, c.title),
        h('p', { class: 'story' }, c.description),
        h('div', { class: 'row-gap' },
          c.category ? h('span', { class: `cat-chip cat-${c.category}` }, icon(CATEGORY_ICONS[c.category]), categories[c.category].label) : null,
          c.province ? h('span', { class: 'pill pill-muted' }, icon('map'), c.province) : null,
          c.endsAt ? h('span', { class: 'pill pill-muted' }, icon('clock'), `تا ${faDate(c.endsAt)}`) : null)),
      h('aside', { class: 'card donate-box' },
        h('div', { class: 'big-amount' }, h('strong', {}, toman(c.total)), h('span', { class: 'muted' }, ` از ${toman(c.goal)}`)),
        progress(c.total, c.goal),
        h('div', { class: 'muted small' }, `${fa(c.donors)} نفر کمک کرده‌اند`),
        c.matchPercent ? h('div', { class: 'alert alert-success' }, icon('sparkle'), `${c.sponsor} تا سقف ${toman(c.matchCap)}، ${fa(c.matchPercent)}٪ کمک‌ها را اضافه می‌کند. تاکنون: ${toman(c.matched)}`) : null,
        open ? payable(h('div', { class: 'donate-form' }, h('label', { class: 'label' }, 'چقدر کمک می‌کنید؟'), chips, amount, tip.el, submit, paymentNote()))
          : h('div', { class: 'alert alert-info' }, 'این کمپین به پایان رسیده است. سپاس از همهٔ همراهان.'))));
}

/* ---------- Companies and charities ---------- */

export async function businessView(page) {
  const cfg = await revenueConfig();
  let type = 'company';
  let plan = '';
  const org = h('input', { class: 'input', maxlength: 100 });
  const contact = h('input', { class: 'input', maxlength: 80, autocomplete: 'name' });
  const phone = h('input', { class: 'input', dir: 'ltr', inputmode: 'tel', maxlength: 20, autocomplete: 'tel' });
  const email = h('input', { class: 'input', dir: 'ltr', type: 'email', maxlength: 120, autocomplete: 'email' });
  const message = h('textarea', { class: 'input', rows: 3, maxlength: 1000, placeholder: 'هر توضیحی که به ما کمک کند (اختیاری)' });
  const send = h('button', { class: 'btn btn-primary btn-lg btn-block' }, icon('check'), 'درخواست همکاری');
  const typeSwitch = h('div', { class: 'segmented' });
  const drawType = () => typeSwitch.replaceChildren(...[['company', 'شرکت یا سازمان'], ['charity', 'مؤسسهٔ خیریه']].map(([k, label]) =>
    h('button', { type: 'button', class: type === k ? 'active' : '', onclick: () => { type = k; drawType(); } }, label)));
  drawType();
  send.onclick = busy(send, async () => {
    try {
      await api.post('/api/leads', { type, org: org.value, contact: contact.value, phone: toAscii(phone.value), email: email.value, plan, message: message.value });
      form.replaceChildren(h('div', { class: 'done-box' }, icon('check', 'done-icon'), h('h2', {}, 'درخواست شما رسید'), h('p', { class: 'muted' }, 'تیم مهرپل به‌زودی با شما تماس می‌گیرد. سپاس از همراهی‌تان.')));
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  const form = h('section', { class: 'card', id: 'lead-form' }, h('h2', {}, icon('users'), 'شروع همکاری'), typeSwitch,
    h('div', { class: 'two-col' }, field('نام مجموعه', org), field('نام شما', contact), field('شمارهٔ تماس', phone), field('ایمیل', email)),
    field('پیام', message), send);
  const choose = (kind, id) => {
    type = kind;
    plan = id;
    drawType();
    form.scrollIntoView({ behavior: 'smooth' });
  };
  const planCards = (plans, kind) => h('div', { class: 'plans' }, plans.map((p) => h('article', { class: `card plan tilt reveal ${p.featured ? 'featured' : ''}` },
    p.featured ? h('span', { class: 'plan-badge' }, 'پیشنهاد ما') : null,
    h('h3', {}, p.name), h('div', { class: 'plan-price' }, p.price),
    h('ul', { class: 'checks' }, p.features.map((f) => h('li', {}, icon('check'), f))),
    h('button', { class: `btn ${p.featured ? 'btn-primary' : ''} btn-block`, onclick: () => choose(kind, p.id) }, 'انتخاب این طرح'))));

  page.append(
    h('section', { class: 'circle-hero reveal' },
      h('span', { class: 'eyebrow' }, icon('house'), 'همکاری سازمان‌ها'),
      h('h1', {}, 'مسئولیت اجتماعی، شفاف و قابل اندازه‌گیری'),
      h('p', { class: 'lead' }, 'کمپین با نام شرکت شما، گزارش دقیق اثر برای روابط عمومی و مجمع، و برای خیریه‌ها: همین سامانه با نام و لوگوی خودتان.')),
    h('section', { class: 'section' }, h('h2', {}, icon('trophy'), 'برای شرکت‌ها و بانک‌ها'),
      h('p', { class: 'muted' }, 'کارکنان کمک می‌کنند، شرکت هم‌اندازه اضافه می‌کند و همه‌چیز با کد پیگیری بانک در دفتر عمومی ثبت می‌شود.'),
      planCards(cfg.csrPlans, 'company')),
    h('section', { class: 'section' }, h('h2', {}, icon('heart'), 'برای مؤسسه‌های خیریه'),
      h('p', { class: 'muted' }, 'بررسی هویت، رمزنگاری مدارک، پرداخت مستقیم قبض و دفتر شفافیت؛ آماده، با نام خیریهٔ شما.'),
      planCards(cfg.charityPlans, 'charity')),
    form);
}
