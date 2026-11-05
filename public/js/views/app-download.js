import { faDate, h, icon } from '../ui.js';
import { downloadButton, faVersion, installedVersion, latestRelease } from '../update.js';

/** The Android app's download page, plus how to add the web app on an iPhone. */
export async function appDownloadView(page) {
  const r = await latestRelease();
  const inApp = installedVersion() !== null;
  page.append(
    h('section', { class: 'circle-hero reveal' },
      h('img', { src: '/icons/icon-192.png', alt: '', width: 88, height: 88, class: 'app-icon' }),
      h('h1', {}, 'اپ مهرپل'),
      h('p', { class: 'lead' }, 'همهٔ امکانات مهرپل روی گوشی، با به‌روزرسانی از داخل خود برنامه.')),
    h('div', { class: 'circle-layout' },
      h('section', { class: 'card' },
        h('h2', {}, icon('android'), 'اندروید'),
        r.available
          ? [h('p', { class: 'muted small' }, `نسخهٔ ${faVersion(r.version)} · ${(r.size / 1048576).toLocaleString('fa-IR', { maximumFractionDigits: 1 })} مگابایت · ${faDate(r.publishedAt)}`),
            r.notes ? h('p', {}, r.notes) : null,
            downloadButton(r, 'btn btn-primary btn-lg btn-block'),
            h('ol', { class: 'install-steps' },
              h('li', {}, 'دکمهٔ بالا را بزنید؛ دانلود در نوار اعلان‌ها دیده می‌شود.'),
              h('li', {}, 'فایل دانلودشده را باز کنید و «نصب» را بزنید.'),
              h('li', {}, 'اگر گوشی پرسید، اجازهٔ «نصب از این منبع» را بدهید.'),
              h('li', {}, 'اگر نسخهٔ قدیمی (۱.۰.۲ یا قبل‌تر) را دارید، اول آن را حذف کنید.'))]
          : h('p', { class: 'muted' }, 'نسخهٔ اندروید به‌زودی منتشر می‌شود.'),
        inApp ? h('p', { class: 'muted small' }, 'شما همین حالا داخل اپ هستید؛ نسخه‌های بعدی خودشان خبر می‌دهند.') : null),
      h('section', { class: 'card' },
        h('h2', {}, icon('mobile'), 'آیفون'),
        h('p', { class: 'muted small' }, 'مهرپل روی آیفون مثل یک اپ روی صفحهٔ اصلی می‌نشیند، بدون اپ‌استور:'),
        h('ol', { class: 'install-steps' },
          h('li', {}, 'همین صفحه را در Safari باز کنید.'),
          h('li', {}, 'دکمهٔ «اشتراک‌گذاری» پایین صفحه را بزنید.'),
          h('li', {}, '«Add to Home Screen» را انتخاب کنید.')))));
}
