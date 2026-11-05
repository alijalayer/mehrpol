import { api } from './api.js';
import { h, icon, toast } from './ui.js';

/** "1.0.5" with Persian digits; a version is text, not a number. */
export const faVersion = (v) => String(v).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

/** True inside the Android app (Capacitor), false in a normal browser. */
export const isNativeApp = () => !!window.Capacitor?.isNativePlatform?.();

/**
 * The installed app's version code. Builds since 1.0.3 add "MehrpolApp/<code>" to the user agent;
 * older builds have none and count as 0. Null in a browser.
 */
export function installedVersion() {
  const m = navigator.userAgent.match(/MehrpolApp\/(\d+)/);
  if (m) return Number(m[1]);
  return isNativeApp() ? 0 : null;
}

let latest;
export async function latestRelease() {
  latest ??= api.get('/api/app/latest').catch(() => ({ available: false }));
  return latest;
}

// Builds before 1.0.3 cannot download inside the app; a link to another site opens in the phone's browser.
const RELEASES_PAGE = 'https://github.com/alijalayer/mehrpol/releases/latest';

/** The download link. Inside the app, Android's download manager saves it and opens the installer. */
export function downloadButton(release, cls = 'btn btn-primary') {
  const old = installedVersion() === 0;
  return h('a', { class: cls, href: old ? RELEASES_PAGE : release.url, ...(old ? { target: '_blank', rel: 'noopener' } : { download: `mehrpol-${release.version}.apk` }) },
    icon('download'), `دریافت نسخهٔ ${faVersion(release.version)}`);
}

/** Banner shown inside the Android app when a newer version is published (dismissible per session). */
export async function updateNotice() {
  const current = installedVersion();
  if (current === null) return null;
  const r = await latestRelease();
  if (!r.available || r.versionCode <= current) return null;
  try {
    if (sessionStorage.getItem('mehrpol-update-dismissed') === String(r.versionCode)) return null;
  } catch {}
  const close = h('button', { class: 'btn btn-sm btn-ghost', 'aria-label': 'بستن' }, icon('x'));
  const bar = h('div', { class: 'update-bar', role: 'status' },
    icon('sparkle'),
    h('div', { class: 'grow' },
      h('strong', {}, `نسخهٔ جدید مهرپل (${faVersion(r.version)}) آماده است`),
      h('div', { class: 'muted small' }, current === 0
        ? 'این نسخه یک‌بار باید جداگانه نصب شود: پس از دانلود، اگر نصب انجام نشد، اپ فعلی را حذف و فایل دانلودشده را نصب کنید.'
        : r.notes || 'پس از دانلود، فایل را باز کنید تا روی نسخهٔ فعلی نصب شود؛ اطلاعات حسابتان حفظ می‌شود.')),
    downloadButton(r), close);
  close.onclick = () => {
    bar.remove();
    try {
      sessionStorage.setItem('mehrpol-update-dismissed', String(r.versionCode));
    } catch {}
  };
  bar.querySelector('a').addEventListener('click', () => toast('دانلود شروع شد؛ پس از پایان، فایل را باز و «نصب» را بزنید.'));
  return bar;
}
