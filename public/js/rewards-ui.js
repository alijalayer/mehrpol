import { api, state } from './api.js';
import { fa, h, icon } from './ui.js';

/** A medal: coloured disc with ribbon and icon. Locked medals render greyed with their hint. */
export function medal(m, { size = 'md', showTitle = true } = {}) {
  return h('div', { class: `medal medal-${size} tier-${m.tier} ${m.earned === false ? 'locked' : 'earned'}`, title: m.earned === false ? m.hint : m.title },
    h('div', { class: 'medal-art', 'aria-hidden': 'true' },
      h('span', { class: 'ribbon ribbon-l' }), h('span', { class: 'ribbon ribbon-r' }),
      h('span', { class: 'medal-disc' }, icon(m.earned === false ? 'lock' : m.icon))),
    showTitle ? h('strong', {}, m.title) : null,
    showTitle && size !== 'sm' ? h('small', {}, m.earned === false ? m.hint : 'کسب شد') : null);
}

export function levelBadge(level) {
  if (!level) return h('span', { class: 'level-badge lvl-none' }, 'هنوز سطحی ندارد');
  return h('span', { class: `level-badge lvl-${level.color}` }, icon('star'), level.name);
}

/** Round avatar with the first letter of the name, ringed in the level colour. */
export function avatar(name, level, size = 'md') {
  const letter = (name || '').trim().charAt(0) || '؟';
  return h('span', { class: `avatar-ring avatar-${size} ring-${level?.color ?? 'none'}` }, h('span', { class: 'avatar-letter' }, letter));
}

export function levelProgress(level) {
  if (!level.next) return h('div', { class: 'level-progress' }, h('div', { class: 'muted small' }, 'بالاترین سطح مهرپل را دارید. سپاس!'));
  return h('div', { class: 'level-progress' },
    h('div', { class: 'row-between small' }, h('span', {}, `تا «${level.next.name}»`), h('strong', {}, `${fa(level.progress)}٪`)),
    h('div', { class: 'progress' }, h('div', { class: 'progress-bar', style: `width:${level.progress}%` })),
    h('div', { class: 'muted small' }, `${fa(level.next.minToman / 1_000_000)} میلیون تومان کمک یا کمک به ${fa(level.next.minCases)} درخواست`));
}

/**
 * Profile hover card on the header avatar. Opens on hover (mouse) and on tap/click
 * (touch, keyboard); data loads on first open.
 */
export function profileMenu(onLogout) {
  const panel = h('div', { class: 'hovercard', role: 'dialog', 'aria-label': 'پروفایل' }, h('div', { class: 'hovercard-loading' }, '…'));
  const trigger = h('button', { class: 'avatar-btn', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': 'پروفایل من' },
    avatar(state.user.displayName, null, 'sm'));
  const wrap = h('div', { class: 'hover-wrap' }, trigger, panel);
  let loaded = false;
  let closeTimer;

  const load = async () => {
    if (loaded) return;
    loaded = true;
    try {
      const p = await api.get('/api/my/profile');
      trigger.replaceChildren(avatar(p.displayName || state.user.displayName, p.level.current, 'sm'));
      const earned = p.medals.filter((m) => m.earned);
      const logout = h('button', { class: 'menu-link danger' }, icon('logout'), 'خروج');
      logout.onclick = onLogout;
      panel.replaceChildren(
        h('div', { class: 'hc-head' }, avatar(p.displayName, p.level.current, 'lg'),
          h('div', {}, h('strong', {}, p.displayName || 'کاربر مهرپل'), h('div', {}, levelBadge(p.level.current)))),
        h('div', { class: 'hc-stats' },
          h('div', {}, h('strong', {}, fa(p.stats.cases)), h('span', {}, 'خانواده')),
          h('div', {}, h('strong', {}, fa(earned.length)), h('span', {}, 'مدال')),
          h('div', {}, h('strong', {}, fa(p.stats.closed)), h('span', {}, 'گره‌گشایی'))),
        levelProgress(p.level),
        earned.length ? h('div', { class: 'hc-medals' }, earned.slice(0, 6).map((m) => medal(m, { size: 'sm', showTitle: false }))) : '',
        h('nav', { class: 'hc-links' },
          h('a', { class: 'menu-link', href: '#/me' }, icon('user'), 'پروفایل و دستاوردها'),
          h('a', { class: 'menu-link', href: '#/me?tab=donations' }, icon('receipt'), 'کمک‌های من'),
          h('a', { class: 'menu-link', href: '#/me?tab=requests' }, icon('file'), 'درخواست‌های من'),
          h('a', { class: 'menu-link', href: '#/circle' }, icon('users'), 'حلقهٔ مهر'),
          h('a', { class: 'menu-link', href: '#/gift' }, icon('gift'), 'کارت هدیهٔ مهر'),
          h('a', { class: 'menu-link', href: '#/honor' }, icon('trophy'), 'تالار افتخار'),
          state.user.role === 'admin' ? h('a', { class: 'menu-link', href: '#/admin' }, icon('shield'), 'پنل مدیریت') : null,
          logout));
    } catch {
      loaded = false;
    }
  };
  const open = () => {
    clearTimeout(closeTimer);
    wrap.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
    load();
  };
  const close = () => {
    wrap.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
  };
  const hoverable = matchMedia('(hover: hover)').matches;
  if (hoverable) {
    wrap.addEventListener('mouseenter', open);
    // A generous delay so a brief slip of the pointer off the card does not close it.
    wrap.addEventListener('mouseleave', () => (closeTimer = setTimeout(close, 450)));
  }
  trigger.addEventListener('click', () => (wrap.classList.contains('open') ? close() : open()));
  document.addEventListener('click', (e) => !wrap.contains(e.target) && close());
  document.addEventListener('keydown', (e) => e.key === 'Escape' && close());
  window.addEventListener('hashchange', close);
  return wrap;
}
