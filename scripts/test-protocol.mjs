/**
 * The three things Phase 2 added, and the one it fixed.
 *
 *   - one key per job, so a key that leaks through one path does not open the others
 *   - a version on every payload, so an unknown one is refused rather than guessed at
 *   - a shape check after decryption, because decryption proves the sender, not the message
 *   - a replay window that survives the app dying
 *
 * Run with: npm run test:protocol
 */
import assert from 'node:assert/strict';
import {
  createVault, createLegacyVault, openVault, seal, unseal,
} from '../src/crypto/vault.ts';
import { generatePairingSecret, PAIRING_BYTES } from '../src/crypto/wordlist.ts';
import { packEnvelope, parseEnvelope, PROTOCOL_VERSION } from '../src/net/envelope.ts';
import { SeenIds, loadSeen, saveSeen, clearSeen } from '../src/store/seen.ts';

let pass = 0;
const ok = (name) => { console.log('  ok  ' + name); pass++; };
const hex = (u8) => Buffer.from(u8).toString('hex');
const PIN = '110490';

// ---------------------------------------------------------------------------
console.log('');
console.log('the pairing secret');

const secret = generatePairingSecret();
assert.equal(PAIRING_BYTES, 16);
assert.equal(secret.length, 16);
ok('is 16 bytes — 128 bits, up from 64');

// Two secrets from the generator must not share a byte pattern; a generator
// that had quietly become deterministic would pass every other test in here.
const many = new Set();
for (let i = 0; i < 200; i++) many.add(hex(generatePairingSecret()));
assert.equal(many.size, 200);
ok('and every one of two hundred is different');

// ---------------------------------------------------------------------------
console.log('');
console.log('one key per job');

const a = createVault(PIN, secret);
const b = createVault('another-pin-entirely', secret);

assert.equal(a.blob.v, 3);
assert.equal(a.keys.era, 3);
ok('a new vault is version 3');

const keys = [a.keys.msgKey, a.keys.sigKey, a.keys.storeKey];
const seen = new Set(keys.map(hex));
assert.equal(seen.size, 3, 'two of the three keys are the same key');
ok('message, signalling and storage keys are three different keys');

// The one that matters most: a payload sealed for one job must not open under
// another job's key. This is what domain separation buys.
const wire = seal(a.keys.msgKey, 'meet me at 8');
assert.throws(() => unseal(a.keys.sigKey, wire));
assert.throws(() => unseal(a.keys.storeKey, wire));
ok('a message does not open under the signalling or storage key');

assert.equal(b.keys.roomId, a.keys.roomId);
assert.equal(hex(b.keys.msgKey), hex(a.keys.msgKey));
assert.equal(hex(b.keys.sigKey), hex(a.keys.sigKey));
ok('both phones still agree on everything shared');

assert.notEqual(hex(b.keys.storeKey), hex(a.keys.storeKey));
ok("...but not on each other's storage key — this phone's files are its own");

// ---------------------------------------------------------------------------
console.log('');
console.log('setting the two phones up again');

// The point of the store root: a new pairing must not make this phone's saved
// history unreadable, because none of it was ever the partner's business.
const fresh = generatePairingSecret();
const rePaired = createVault(PIN, fresh, a.keys.storeRoot);
assert.notEqual(rePaired.keys.roomId, a.keys.roomId);
assert.notEqual(hex(rePaired.keys.msgKey), hex(a.keys.msgKey));
assert.equal(hex(rePaired.keys.storeKey), hex(a.keys.storeKey));
ok('a new pairing means a new room and new shared keys, and the same store key');

const stored = seal(a.keys.storeKey, 'the kept conversation');
assert.equal(unseal(rePaired.keys.storeKey, stored), 'the kept conversation');
ok('so what this phone had written down before still opens afterwards');

// ---------------------------------------------------------------------------
console.log('');
console.log('the old format');

const old = createLegacyVault(PIN, generatePairingSecret().slice(0, 8));
assert.equal(old.blob.v, 2);
const opened = openVault(old.blob, PIN);
assert.ok(opened, 'a v2 vault must still open');
assert.equal(opened.era, 2);
assert.equal(opened.roomId, old.keys.roomId);
ok('a vault from before this change still opens, on the same room');

assert.equal(hex(opened.msgKey), hex(opened.storeKey));
ok('...with the one key it has always had, so its stored files still open');

assert.notEqual(
  createVault(PIN, opened.pairing).keys.roomId,
  opened.roomId,
  'v3 must not derive the old room from the old secret',
);
ok('and v3 never lands in a v2 room by accident — the labels carry the version');

// ---------------------------------------------------------------------------
console.log('');
console.log('what arrives from the other phone');

const good = { k: 'msg', id: 'x1', body: 'hello', at: Date.now() };
assert.deepEqual(parseEnvelope(packEnvelope(good)), good);
ok('a well-formed envelope survives packing and parsing');

assert.equal(parseEnvelope(JSON.stringify({ v: PROTOCOL_VERSION + 1, e: good })), null);
assert.equal(parseEnvelope(JSON.stringify({ v: 1, e: good })), null);
assert.equal(parseEnvelope(JSON.stringify({ e: good })), null);
ok('a version this build does not speak is refused, not guessed at');

assert.equal(parseEnvelope(JSON.stringify(good)), null);
ok('and so is a bare envelope with no version at all');

for (const bad of [
  '', 'null', '[]', '"hello"', '{', 'undefined',
  JSON.stringify({ v: PROTOCOL_VERSION }),
  JSON.stringify({ v: PROTOCOL_VERSION, e: null }),
  JSON.stringify({ v: PROTOCOL_VERSION, e: {} }),
  JSON.stringify({ v: PROTOCOL_VERSION, e: { k: 'nonsense' } }),
  JSON.stringify({ v: PROTOCOL_VERSION, e: { k: 'msg' } }),
  JSON.stringify({ v: PROTOCOL_VERSION, e: { k: 'msg', id: 1, body: 'x', at: 1 } }),
  JSON.stringify({ v: PROTOCOL_VERSION, e: { k: 'msg', id: 'x', body: null, at: 1 } }),
  JSON.stringify({ v: PROTOCOL_VERSION, e: { k: 'read', ids: 'not-a-list' } }),
  JSON.stringify({ v: PROTOCOL_VERSION, e: { k: 'read', ids: [1, 2] } }),
  JSON.stringify({ v: PROTOCOL_VERSION, e: { k: 'call', action: 'explode' } }),
  JSON.stringify({ v: PROTOCOL_VERSION, e: { k: 'media-chunk', id: 'x', seq: -1, b64: 'a' } }),
]) {
  assert.equal(parseEnvelope(bad), null, 'should be refused: ' + bad.slice(0, 60));
}
ok('junk, wrong types and unknown kinds are all refused');

// A chunk count large enough to allocate an enormous array is the one piece of
// remote data that can hurt this phone without any key being broken.
assert.equal(
  parseEnvelope(JSON.stringify({
    v: PROTOCOL_VERSION,
    e: { k: 'media-start', id: 'x', kind: 'photo', mime: 'image/jpeg',
         bytes: 10, chunks: 50_000_000, at: 1 },
  })),
  null,
);
ok('and a media header that would make this phone allocate a huge array is refused');

// ---------------------------------------------------------------------------
console.log('');
console.log('a message cannot be played back');

const ids = new SeenIds();
assert.equal(ids.add('m1'), true);
assert.equal(ids.add('m1'), false);
assert.equal(ids.add('m2'), true);
ok('the same id is accepted once and refused after that');

// The window has to forget eventually, but only the oldest.
const many2 = new SeenIds();
for (let i = 0; i < 1200; i++) many2.add('id-' + i);
assert.equal(many2.has('id-1199'), true);
assert.equal(many2.has('id-900'), true);
assert.equal(many2.has('id-0'), false, 'the oldest should have been dropped');
assert.ok(many2.size <= 1000);
ok('it remembers the last thousand and drops the oldest, not the newest');

// The actual fix. Before this, the window lived in RAM and died with the app,
// so a captured message handed back after a restart looked new.
await clearSeen();
const storeKey = a.keys.storeKey;
const before = new SeenIds(await loadSeen(storeKey));
before.add('replayed-message');
await saveSeen(storeKey, before.ids);

const afterRestart = new SeenIds(await loadSeen(storeKey));
assert.equal(afterRestart.has('replayed-message'), true);
assert.equal(afterRestart.add('replayed-message'), false);
ok('an id accepted before a restart is still refused after one');

// And it is not lying around in the clear for anyone reading the phone's files.
const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
const raw = await AsyncStorage.getItem('@nt/marks');
assert.ok(raw && !raw.includes('replayed-message'), 'the list is stored in plaintext');
ok('and the list itself is sealed, not a plain record of what arrived and when');

// A list written by a different vault must not stop this one unlocking.
await AsyncStorage.setItem('@nt/marks', seal(rePaired.keys.msgKey, JSON.stringify(['x'])));
assert.deepEqual(await loadSeen(storeKey), []);
ok('one it cannot read is discarded rather than thrown');

console.log('\n  ' + pass + ' protocol checks passed\n');
