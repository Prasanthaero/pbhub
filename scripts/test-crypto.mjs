/**
 * Exercises the vault against the real module under Node's type stripping.
 * Run with: npm run test:crypto
 */
import assert from 'node:assert/strict';
import { createVault, openVault, seal, unseal } from '../src/crypto/vault.ts';

let pass = 0;
const ok = (name) => { console.log('  ok  ' + name); pass++; };
const hex = (u8) => Buffer.from(u8).toString('hex');

const PHRASE = 'correct horse battery staple river';

console.log('pairing');
const t0 = Date.now();
const phoneA = createVault(PHRASE);
const kdfMs = Date.now() - t0;

// The one that matters: two phones that have never met, same phrase typed
// independently, must land in the same room with the same key.
const phoneB = createVault(PHRASE);
assert.equal(phoneB.keys.roomId, phoneA.keys.roomId);
assert.equal(hex(phoneB.keys.msgKey), hex(phoneA.keys.msgKey));
ok('two independent setups with the same phrase agree on room id and key');

assert.notEqual(phoneB.blob.nonce, phoneA.blob.nonce);
assert.notEqual(phoneB.blob.ct, phoneA.blob.ct);
ok('...while still writing different-looking bytes to each phone');

const other = createVault('a completely different secret phrase');
assert.notEqual(other.keys.roomId, phoneA.keys.roomId);
ok('a different phrase lands in a different room');

console.log('vault');
assert.equal(phoneA.blob.v, 1);
assert.match(phoneA.keys.roomId, /^[0-9a-f]{32}$/);
ok('room id is a 32-char hex string, as the relay requires');

const onDisk = JSON.stringify(phoneA.blob);
assert.ok(!/pbhub|vault|marker/i.test(onDisk), 'blob leaked a plaintext marker');
assert.ok(!onDisk.includes(PHRASE), 'blob leaked the passphrase');
assert.ok(!onDisk.includes('correct'), 'blob leaked part of the passphrase');
ok('stored blob contains no plaintext marker and no passphrase');

const reopened = openVault(phoneA.blob, PHRASE);
assert.ok(reopened, 'correct passphrase failed to open the vault');
assert.equal(reopened.roomId, phoneA.keys.roomId);
assert.equal(hex(reopened.msgKey), hex(phoneA.keys.msgKey));
ok('correct passphrase reopens to the same room id and key');

// A phone can open a blob its partner created, since pairing ignores the blob.
assert.ok(openVault(phoneB.blob, PHRASE), 'partner blob should also open');
ok('the blob is interchangeable — the phrase is the only secret');

for (const wrong of [
  'Correct horse battery staple river', // case
  'correct horse battery staple rive',  // one char short
  'correct  horse battery staple river',// double space
  '',
  'milk\neggs\nrice\nonions',           // an ordinary note
  'Groceries',
]) {
  assert.equal(openVault(phoneA.blob, wrong), null, `"${wrong}" should not open the vault`);
}
ok('wrong passphrases and ordinary note text return null');

assert.ok(openVault(phoneA.blob, '  ' + PHRASE + '  '), 'surrounding whitespace should be forgiven');
ok('leading/trailing whitespace is trimmed, so a stray space is not a lockout');

console.log('sealing');
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
ok('an eavesdropper with a different phrase cannot open the payload');

console.log(`\n${pass} checks passed  (key derivation: ${kdfMs}ms on this machine)`);
if (kdfMs > 6000) console.warn('WARNING: KDF is slow here; it will be slower on a phone.');
