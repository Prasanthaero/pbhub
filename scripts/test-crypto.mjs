/**
 * Exercises the vault against the real module under Node's type stripping.
 * Run with: npm run test:crypto
 */
import assert from 'node:assert/strict';
import { createVault, openVault, seal, unseal } from '../src/crypto/vault.ts';
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

console.log(`\n${pass} checks passed`);
