// Publishes an Android build for in-app updates, same as the admin panel's «نسخهٔ اندروید» tab:
//   node server/scripts/publish-apk.js mehrpol-1.0.3.apk 1.0.3 3 "تغییرات این نسخه"
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { audit, getSetting, openDb, setSetting } from '../src/db.js';

const [file, version, code, notes = ''] = process.argv.slice(2);
const versionCode = Number(code);
if (!file || !/^\d+(\.\d+){0,3}$/.test(version ?? '') || !Number.isSafeInteger(versionCode) || versionCode < 1) {
  console.error('Usage: node server/scripts/publish-apk.js <file.apk> <version e.g. 1.0.3> <versionCode e.g. 3> [notes]');
  process.exit(1);
}
const bytes = readFileSync(file);
if (bytes.subarray(0, 4).toString('latin1') !== 'PK\x03\x04' || !bytes.includes('AndroidManifest.xml')) {
  console.error('Not an Android APK');
  process.exit(1);
}

const config = loadConfig();
const db = openDb(config.dbFile);
const previous = getSetting(db, 'app', null);
if (previous && previous.versionCode >= versionCode) {
  console.error(`Version code must be greater than the published one (${previous.versionCode})`);
  process.exit(1);
}
const id = randomUUID();
const stored = `${id}.apk`;
copyFileSync(file, join(config.publicDir, stored));
const size = statSync(join(config.publicDir, stored)).size;
db.prepare('INSERT INTO public_files (id, stored_name, mime, size, created_at) VALUES (?, ?, ?, ?, ?)')
  .run(id, stored, 'application/vnd.android.package-archive', size, Date.now());
setSetting(db, 'app', { version, versionCode, notes: notes.slice(0, 500), fileId: id, size, publishedAt: Date.now() });
if (previous?.fileId) {
  const old = db.prepare('SELECT stored_name FROM public_files WHERE id = ?').get(previous.fileId);
  if (old && existsSync(join(config.publicDir, old.stored_name))) rmSync(join(config.publicDir, old.stored_name));
  db.prepare('DELETE FROM public_files WHERE id = ?').run(previous.fileId);
}
audit(db, null, 'admin.app.published', null, { version, versionCode });
db.close();
console.log(`Published ${version} (${versionCode}), ${(size / 1048576).toFixed(1)} MB`);
