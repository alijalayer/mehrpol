// Points the Android app at a server: node scripts/android-config.js https://your-domain.ir
// An http:// address (e.g. your PC on Wi-Fi for a demo) also turns on cleartext traffic.
import { readFileSync, writeFileSync } from 'node:fs';

const url = process.argv[2];
let parsed;
try {
  parsed = new URL(url);
} catch {
  console.error('Usage: node scripts/android-config.js <https://server-address>');
  process.exit(1);
}
if (!['https:', 'http:'].includes(parsed.protocol)) {
  console.error('The address must start with https:// or http://');
  process.exit(1);
}
const file = 'capacitor.config.json';
const config = JSON.parse(readFileSync(file, 'utf8'));
config.server.url = parsed.origin;
config.server.cleartext = parsed.protocol === 'http:';
writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
console.log(`Android app now loads ${parsed.origin}${config.server.cleartext ? ' (cleartext http allowed)' : ''}`);
