/**
 * Exercises the vault against the real module under Node's type stripping.
 * Run with: npm run test:crypto
 */
import assert from 'node:assert/strict';
import {
  createVault, openVault, seal, unseal, needsRestretch,
} from '../src/crypto/vault.ts';
import {
  generatePairingSecret, bytesToWords, wordsToBytes, PAIRING_BYTES,
} from '../src/crypto/wordlist.ts';

let pass = 0;
const ok = (name) => { console.log('  ok  ' + name); pass++; };
const hex = (u8) => Buffer.from(u8).toString('hex');

const PIN = '110490';

console.log('pairing secret');
const secret = generatePairingSecret();
assert.equal(secret.length, PAIRING_BYTES);
ok(`a pairing secret is ${PAIRING_BYTES} random bytes`);

const words = bytesToWords(secret);
assert.equal(words.split(' ').length, PAIRING_BYTES);
assert.equal(hex(wordsToBytes(words)), hex(secret));
ok('it survives the trip through words and back unchanged');

assert.equal(hex(wordsToBytes(words.toUpperCase())), hex(secret));
assert.equal(hex(wordsToBytes(`  ${words.replace(/ /g, '   ')}  `)), hex(secret));
ok('case and sloppy spacing are forgiven when typing it into the second phone');

assert.equal(wordsToBytes(words + ' extra'), null);
assert.equal(wordsToBytes(words.split(' ').slice(1).join(' ')), null);
assert.equal(wordsToBytes(words.replace(/^\S+/, 'zzzz')), null);
ok('a typo or wrong length is rejected rather than silently becoming another secret');

console.log('\ntwo phones, one secret');
// Phone A sets up; phone B types the same words in. Different PINs on purpose.
const phoneA = createVault(PIN, secret);
const phoneB = createVault('a-much-longer-pin', wordsToBytes(words));

assert.equal(phoneB.keys.roomId, phoneA.keys.roomId);
assert.equal(hex(phoneB.keys.msgKey), hex(phoneA.keys.msgKey));
ok('both phones land in the same room with the same key');

assert.notEqual(phoneB.blob.salt, phoneA.blob.salt);
assert.notEqual(phoneB.blob.ct, phoneA.blob.ct);
ok('...while storing different bytes, under their own PINs and salts');

const other = createVault(PIN, generatePairingSecret());
assert.notEqual(other.keys.roomId, phoneA.keys.roomId);
ok('a different pairing secret is a different room, even with the same PIN');

console.log('\nthe room is not guessable');
assert.match(phoneA.keys.roomId, /^[0-9a-f]{32}$/);
// The whole point of the redesign: the PIN must not reach the room id.
const samePinDifferentSecret = createVault(PIN, generatePairingSecret());
assert.notEqual(samePinDifferentSecret.keys.roomId, phoneA.keys.roomId);
ok('the room id comes from the secret, never from the PIN — so digits cannot be scanned for');

console.log('\nunlocking');
const reopened = openVault(phoneA.blob, PIN);
assert.ok(reopened, 'correct PIN failed to open the vault');
assert.equal(reopened.roomId, phoneA.keys.roomId);
assert.equal(hex(reopened.pairing), hex(secret));
ok('the right PIN returns the room, the key, and the pairing secret');

for (const wrong of ['110491', '11049', '1104900', '', 'milk eggs rice', 'Groceries']) {
  assert.equal(openVault(phoneA.blob, wrong), null, `"${wrong}" should not open the vault`);
}
ok('wrong PINs and ordinary note text return null');

assert.ok(openVault(phoneA.blob, `  ${PIN}  `), 'surrounding whitespace should be forgiven');
ok('stray whitespace is trimmed, so a fat-fingered space is not a lockout');

assert.equal(openVault(phoneB.blob, PIN), null);
ok("one phone's PIN does not open the other phone's vault");

console.log('\nwhat is on disk');
const onDisk = JSON.stringify(phoneA.blob);
assert.ok(!onDisk.includes(PIN), 'blob leaked the PIN');
assert.ok(!/pbhub|vault|pair/i.test(onDisk), 'blob leaked a recognisable marker');
for (const w of words.split(' ')) {
  assert.ok(!onDisk.includes(w), `blob leaked the pairing word "${w}"`);
}
assert.ok(!onDisk.includes(hex(secret)), 'blob leaked the pairing secret');
ok('the stored blob reveals neither the PIN, the words, nor the secret');

console.log('\nsealing');
const payload = JSON.stringify({ k: 'msg', body: 'meet me at 8', at: 1 });
const sealed = seal(phoneA.keys.msgKey, payload);
assert.ok(!sealed.includes('meet'), 'sealed payload leaked plaintext');
assert.match(sealed, /^[0-9a-f]+$/);
assert.equal(unseal(phoneB.keys.msgKey, sealed), payload);
ok('a message sealed on one phone opens on the other');

assert.notEqual(seal(phoneA.keys.msgKey, payload), seal(phoneA.keys.msgKey, payload));
ok('nonce is fresh per message (identical plaintext -> different ciphertext)');

const tampered = sealed.slice(0, -2) + (sealed.endsWith('00') ? '11' : '00');
assert.throws(() => unseal(phoneA.keys.msgKey, tampered));
ok('tampering is rejected by the AEAD tag');

assert.throws(() => unseal(other.keys.msgKey, sealed));
ok('an eavesdropper in a different room cannot open the payload');

// ---------------------------------------------------------------------------
// Base64 — written by hand because Hermes ships neither atob/btoa nor Buffer
// reliably, and it now carries megabyte-sized status media.
// ---------------------------------------------------------------------------
const { bytesToBase64, base64ToBytes, decodedLength } = await import('../src/crypto/base64.ts');
const { sealBytes, unsealBytes } = await import('../src/crypto/vault.ts');

console.log('');
console.log('base64');
for (const n of [0, 1, 2, 3, 4, 5, 6, 7, 100, 255, 1024]) {
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i++) bytes[i] = (i * 37 + 11) & 0xff;
  const b64 = bytesToBase64(bytes);
  assert.equal(b64, Buffer.from(bytes).toString('base64'), `length ${n} encodes wrong`);
  assert.equal(hex(base64ToBytes(b64)), hex(bytes), `length ${n} round-trips wrong`);
  assert.equal(decodedLength(b64), n, `length ${n} reports the wrong size`);
}
ok('matches a known-good encoder at every padding case, and round-trips');

// Every byte value, since a video is not ASCII.
const allBytes = new Uint8Array(256);
for (let i = 0; i < 256; i++) allBytes[i] = i;
assert.equal(hex(base64ToBytes(bytesToBase64(allBytes))), hex(allBytes));
ok('survives all 256 byte values');

// Larger than one turn of the encoder's inner loop.
const big = new Uint8Array(300_000);
for (let i = 0; i < big.length; i++) big[i] = (i * 101) & 0xff;
const bigB64 = bytesToBase64(big);
assert.equal(bigB64, Buffer.from(big).toString('base64'));
assert.equal(hex(base64ToBytes(bigB64)), hex(big));
ok('handles a payload larger than its own chunk size');

console.log('');
console.log('sealing status media');
const sealedMedia = sealBytes(phoneA.keys.msgKey, big);
assert.notEqual(hex(sealedMedia.slice(24)), hex(big));
assert.equal(hex(unsealBytes(phoneA.keys.msgKey, sealedMedia)), hex(big));
ok('status media seals and opens byte-for-byte');

assert.throws(() => unsealBytes(other.keys.msgKey, sealedMedia));
ok('and cannot be opened by another vault');

console.log(``);
// ---------------------------------------------------------------------------
// QR pairing payload. A bad decode here means two phones that cannot pair, so
// it is worth pinning down rather than discovering with a camera in hand.
// ---------------------------------------------------------------------------
const { encodePairing, decodePairing } = await import('../src/crypto/pairingCode.ts');

console.log('');
console.log('QR pairing');
const qr = encodePairing(words);
assert.equal(decodePairing(qr), words);
ok('a pairing phrase survives the trip through a QR code');

assert.ok(!/pbhub|notes|chat/i.test(qr), 'the QR payload names the app');
ok('the payload does not announce which app the code belongs to');

for (const junk of ['', 'hello', 'nt1:', 'nt1:only-three-words', qr + '-extra', qr.slice(4)]) {
  assert.equal(decodePairing(junk), null, `"${junk.slice(0, 20)}" should be rejected`);
}
ok('anything that is not one of our codes is refused, not half-read');

assert.equal(hex(wordsToBytes(decodePairing(qr))), hex(secret));
ok('and the bytes that come back out are the same secret');

// ---------------------------------------------------------------------------
// Changing how hard the PIN is to stretch must not strand anybody. A vault made
// before the round count was written down has to keep opening, and be quietly
// upgraded on the way past.
// ---------------------------------------------------------------------------
console.log('');
console.log('changing the round count');

const made = createVault(PIN, secret);
assert.equal(typeof made.blob.c, 'number');
assert.equal(needsRestretch(made.blob), false);
ok('a vault records the round count it was sealed with');

// What an older install has on disk: the same blob with nothing to say about
// rounds, which means the 40,000 that used to be hardcoded.
const legacy = { ...made.blob };
delete legacy.c;
assert.equal(needsRestretch(legacy), true);
ok('one without it is recognised as needing re-sealing');

// It was actually sealed at the current count, so reading it as a legacy blob
// must fail rather than quietly return the wrong bytes.
assert.equal(openVault(legacy, PIN), null);
ok('and is read at the old count, not the new one');

const older = createVault(PIN, secret, 40_000);
delete older.blob.c;
const fromOld = openVault(older.blob, PIN);
assert.ok(fromOld, 'a vault from before the change no longer opens');
assert.equal(hex(fromOld.pairing), hex(secret));
assert.equal(fromOld.roomId, made.keys.roomId);
ok("a vault from before the change still opens, on the same room");

// The upgrade the app performs after a successful unlock.
const upgraded = createVault(PIN, fromOld.pairing);
assert.equal(needsRestretch(upgraded.blob), false);
const after = openVault(upgraded.blob, PIN);
assert.equal(hex(after.pairing), hex(secret));
assert.equal(after.roomId, made.keys.roomId);
ok('re-sealing keeps the same secret, room and message key — no re-pairing');

assert.equal(openVault(upgraded.blob, 'wrong'), null);
ok('and the new blob still refuses the wrong PIN');

console.log(``);
console.log(`${pass} checks passed`);
