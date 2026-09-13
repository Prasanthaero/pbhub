/**
 * react-native-webrtc ships `lib/typescript/RTCPeerConnection.d.ts`, which does
 * `import { EventTarget } from './vendor/event-target-shim'` — but the vendor
 * folder is not included in the published types. The base class therefore fails
 * to resolve and every `addEventListener` call looks like an error, even though
 * the method exists at runtime.
 *
 * The source tree does contain the declarations, so copy them into place.
 * Runs on postinstall so it survives `npm install`.
 */
const fs = require('fs');
const path = require('path');

const pkg = path.join(__dirname, '..', 'node_modules', 'react-native-webrtc');
const from = path.join(pkg, 'src', 'vendor', 'event-target-shim');
const to = path.join(pkg, 'lib', 'typescript', 'vendor', 'event-target-shim');

if (!fs.existsSync(pkg)) process.exit(0);
if (fs.existsSync(path.join(to, 'index.d.ts'))) process.exit(0);
if (!fs.existsSync(path.join(from, 'index.d.ts'))) {
  console.warn('[fix-webrtc-types] upstream shim types not found; skipping');
  process.exit(0);
}

fs.mkdirSync(to, { recursive: true });
for (const f of fs.readdirSync(from)) {
  if (f.endsWith('.d.ts')) fs.copyFileSync(path.join(from, f), path.join(to, f));
}
console.log('[fix-webrtc-types] restored event-target-shim declarations');
