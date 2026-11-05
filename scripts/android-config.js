// Points the Android app at a server and stamps its version:
//   node scripts/android-config.js https://your-domain.ir [versionCode]
// An http:// address (e.g. a test server) also turns on cleartext traffic. The version code is
// added to the WebView user agent (MehrpolApp/<code>) so the site can offer in-app updates.
import { readFileSync, writeFileSync } from 'node:fs';

const [url, code = '1'] = process.argv.slice(2);
let parsed;
try {
  parsed = new URL(url);
} catch {
  console.error('Usage: node scripts/android-config.js <https://server-address> [versionCode]');
  process.exit(1);
}
if (!['https:', 'http:'].includes(parsed.protocol)) {
  console.error('The address must start with https:// or http://');
  process.exit(1);
}
if (!/^\d+$/.test(code)) {
  console.error('versionCode must be a whole number');
  process.exit(1);
}
const file = 'capacitor.config.json';
const config = JSON.parse(readFileSync(file, 'utf8'));
config.server.url = parsed.origin;
config.server.cleartext = parsed.protocol === 'http:';
config.android = { ...config.android, appendUserAgent: `MehrpolApp/${code}` };
writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
console.log(`Android app now loads ${parsed.origin}${config.server.cleartext ? ' (cleartext http allowed)' : ''}, version code ${code}`);
