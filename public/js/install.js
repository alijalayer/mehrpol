import { h, icon } from './ui.js';

// "Add to home screen" helper. iPhone Safari has no install prompt, so it gets
// step-by-step instructions; Chrome/Android gets the browser's own prompt.

let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  document.dispatchEvent(new Event('mehrpol:installable'));
});

const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isNative = () => Boolean(window.Capacitor?.isNativePlatform?.());

const DISMISS_KEY = 'mehrpol.install.dismissed';
const dismissed = () => {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
};
const dismiss = (card) => {
  try {
    localStorage.setItem(DISMISS_KEY, '1');
  } catch {}
  card.remove();
};

/** Returns an install card for the home page, or null when installing makes no sense. */
export function installCard() {
  if (isStandalone() || isNative() || dismissed()) return null;
  const close = h('button', { class: 'icon-btn', 'aria-label': 'بستن' }, icon('x'));
  const card = h('div', { class: 'card install-card' });
  close.onclick = () => dismiss(card);

  if (isIos()) {
    card.append(close,
      h('img', { src: '/icons/apple-touch-icon.png', alt: '', width: 56, height: 56, class: 'install-icon' }),
      h('div', {},
        h('strong', {}, 'مهرپل را روی آیفون نصب کنید'),
        h('ol', { class: 'install-steps' },
          h('li', {}, 'در Safari، دکمهٔ ', h('b', {}, 'Share'), ' ', icon('share'), ' پایین صفحه را بزنید'),
          h('li', {}, 'گزینهٔ ', h('b', {}, 'Add to Home Screen'), ' را انتخاب کنید'),
          h('li', {}, 'روی ', h('b', {}, 'Add'), ' بزنید؛ آیکون مهرپل کنار برنامه‌های دیگر قرار می‌گیرد'))));
    return card;
  }

  const btn = h('button', { class: 'btn btn-primary btn-sm' }, icon('download'), 'نصب برنامه');
  btn.onclick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    card.remove();
  };
  card.append(close,
    h('img', { src: '/icons/icon-192.png', alt: '', width: 56, height: 56, class: 'install-icon' }),
    h('div', { class: 'grow' }, h('strong', {}, 'مهرپل را نصب کنید'), h('p', { class: 'muted small' }, 'دسترسی سریع از صفحهٔ اصلی گوشی، بدون نیاز به فروشگاه.')),
    btn);
  if (!deferredPrompt) {
    card.hidden = true;
    document.addEventListener('mehrpol:installable', () => (card.hidden = false), { once: true });
  }
  return card;
}
