// Generates every PNG icon (web, iPhone, Android launcher and splash) from one vector logo.
// Run after changing the logo: npm run icons
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { ROOT } from '../server/src/config.js';

const BG = '#0f6e5c';
// The mark without a background, drawn in a 64×64 box.
const MARK = `<path d="M10 42c6-10 14-15 22-15s16 5 22 15" fill="none" stroke="#f6c46a" stroke-width="4" stroke-linecap="round"/><path d="M18 42v-6M26 42v-9M38 42v-9M46 42v-6" stroke="#f6c46a" stroke-width="3" stroke-linecap="round"/><path d="M32 25s-9-5-9-11a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 6-9 11-9 11z" fill="#fff"/>`;

/** Square icon: background (optional, optionally rounded) plus the mark scaled to `scale` of the canvas. */
function svg({ size, scale = 1, background = true, radius = 0 }) {
  const inner = size * scale;
  const offset = (size - inner) / 2;
  const bg = background ? `<rect width="${size}" height="${size}" rx="${radius}" fill="${BG}"/>` : '';
  // The mark sits slightly high in its 64-box; nudge it down so it looks centred.
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${bg}<g transform="translate(${offset} ${offset + inner * 0.06}) scale(${inner / 64})">${MARK}</g></svg>`);
}

// Written through Node's fs, which handles long Windows paths that sharp's own writer cannot.
const png = async (opts, file) => writeFileSync(file, await sharp(svg(opts)).png().toBuffer());

const web = join(ROOT, 'public', 'icons');
await Promise.all([
  png({ size: 192, radius: 40 }, join(web, 'icon-192.png')),
  png({ size: 512, radius: 108 }, join(web, 'icon-512.png')),
  png({ size: 512, scale: 0.72 }, join(web, 'maskable-512.png')),
  // iOS rounds the corners itself and shows transparency as black, so this one is full-bleed.
  png({ size: 180, scale: 0.9 }, join(web, 'apple-touch-icon.png')),
]);
console.log('web + iPhone icons written');

const res = join(ROOT, 'android', 'app', 'src', 'main', 'res');
if (existsSync(res)) {
  const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  const jobs = [];
  for (const [d, k] of Object.entries(densities)) {
    const dir = join(res, `mipmap-${d}`);
    jobs.push(png({ size: 48 * k, radius: 10 * k }, join(dir, 'ic_launcher.png')));
    jobs.push(png({ size: 48 * k, radius: 24 * k }, join(dir, 'ic_launcher_round.png')));
    // Adaptive icon foreground: 108dp canvas, content kept inside the 66dp safe zone.
    jobs.push(png({ size: 108 * k, scale: 0.6, background: false }, join(dir, 'ic_launcher_foreground.png')));
  }
  // Replace the template splash images in place, keeping each one's size.
  for (const dir of readdirSync(res).filter((n) => n.startsWith('drawable'))) {
    const file = join(res, dir, 'splash.png');
    if (!existsSync(file)) continue;
    jobs.push(sharp(readFileSync(file)).metadata().then(async ({ width, height }) => {
      const logo = Math.round(Math.min(width, height) * 0.28);
      const mark = await sharp(svg({ size: logo, radius: logo * 0.22 })).png().toBuffer();
      const out = await sharp({ create: { width, height, channels: 4, background: '#fbf6ee' } })
        .composite([{ input: mark, gravity: 'center' }]).png().toBuffer();
      writeFileSync(file, out);
    }));
  }
  await Promise.all(jobs);
  console.log('Android launcher + splash icons written');
}
