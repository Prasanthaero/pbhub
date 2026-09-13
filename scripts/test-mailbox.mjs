/**
 * Offline delivery: a message sent while the partner is away must reach them
 * when they open the app, and must not be readable by the relay holding it.
 *
 * Drives the real Signaling class against the real relay.
 * Run with: npm run test:mailbox
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createVault, seal, unseal } from '../src/crypto/vault.ts';
import { generatePairingSecret } from '../src/crypto/wordlist.ts';
import { Signaling } from '../src/net/signaling.ts';

const PORT = 8144;
const URL = `ws://127.0.0.1:${PORT}`;

let pass = 0;
const ok = (name) => { console.log('  ok  ' + name); pass++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await once(srv.stdout, 'data');

const live = [];
function client(tag, keys) {
  const log = { role: null, mail: [], done: [], held: [], full: [], acks: [], present: [] };
  const s = new Signaling(URL, keys.roomId, keys.msgKey, {
    onReady: (r) => { log.role = r; },
    onPeerPresent: (p) => log.present.push(p),
    onSignal: () => {},
    onStatus: () => {},
    onClosed: () => {},
    onMail: (id, wire, at) => log.mail.push({ id, wire, at }),
    onMailDone: (count) => log.done.push(count),
    onMailHeld: (id) => log.held.push(id),
    onMailFull: (id) => log.full.push(id),
    onAck: (id) => log.acks.push(id),
  });
  live.push(s);
  s.connect();
  return { s, log };
}

try {
  const { keys } = createVault('110490', generatePairingSecret());
  const body = 'are you up?';

  console.log('sending to someone who is not there');
  const a = client('A', keys);
  await wait(400);
  assert.deepEqual(a.log.present, [false]);
  ok('the sender can tell their partner is away');

  const wire = seal(keys.msgKey, JSON.stringify({ k: 'msg', id: 'm1', body, at: Date.now() }));
  a.s.mail('m1', wire);
  await wait(400);

  assert.deepEqual(a.log.held, ['m1']);
  ok('the relay says it is holding the message');

  console.log('\nthe partner opens the app');
  const b = client('B', keys);
  await wait(600);

  assert.equal(b.log.mail.length, 1);
  assert.equal(b.log.mail[0].id, 'm1');
  ok('the waiting message is handed over on connect');

  assert.deepEqual(b.log.done, [1]);
  ok('...followed by a marker saying the backlog is finished');

  const opened = JSON.parse(unseal(keys.msgKey, b.log.mail[0].wire));
  assert.equal(opened.body, body);
  ok('and it decrypts to exactly what was sent');

  console.log('\nwhat the relay could see');
  assert.ok(!wire.includes('are you'), 'the payload was not sealed');
  assert.ok(!wire.includes(body));
  assert.match(wire, /^[0-9a-f]+$/);
  ok('the relay held ciphertext, not a message');

  console.log('\nreceipts');
  b.s.ack('m1');
  await wait(400);
  assert.deepEqual(a.log.acks, ['m1']);
  ok('the receipt reaches the sender, so it can leave the outbox');

  console.log('\ndelivered once, not twice');
  b.s.close();
  await wait(400);
  const b2 = client('B2', keys);
  await wait(600);
  assert.equal(b2.log.mail.length, 0);
  ok('a collected message is gone from the relay, not re-delivered');

  console.log('\na photo sent to someone who is not there');
  // The point of this: media used to need both phones present at once, so a
  // picture sent to a partner who was not in the app could not be sent at all.
  b2.s.close();
  await wait(400);

  // Stands in for a shrunk camera photo — a few hundred KB that are not text.
  const photo = Buffer.alloc(300 * 1024);
  for (let i = 0; i < photo.length; i++) photo[i] = (i * 31) & 0xff;
  const photoB64 = photo.toString('base64');

  const photoWire = seal(keys.msgKey, JSON.stringify({
    k: 'media-whole', id: 'p1', kind: 'photo', mime: 'image/jpeg',
    bytes: photo.length, b64: photoB64, at: Date.now(),
  }));
  a.s.mail('p1', photoWire);
  await wait(1200);

  assert.ok(a.log.held.includes('p1'), 'the relay refused to hold the photo');
  ok('the relay holds a photo for an absent partner, as it does a message');

  assert.ok(!photoWire.includes(photoB64.slice(0, 40)), 'the photo went over in the clear');
  assert.match(photoWire, /^[0-9a-f]+$/);
  ok('...as ciphertext, not a picture');

  const b3 = client('B3', keys);
  await wait(1500);
  const arrived = b3.log.mail.find((m) => m.id === 'p1');
  assert.ok(arrived, 'the photo never arrived');
  const shown = JSON.parse(unseal(keys.msgKey, arrived.wire));
  assert.equal(shown.k, 'media-whole');
  assert.equal(shown.b64, photoB64);
  ok('and it arrives byte for byte when they open the app');

  // A partner whose socket has died but has not been noticed yet is deliberately
  // not tested here. The relay now refuses to hand mail to a socket that is not
  // OPEN, which closes a window of up to thirty seconds in which a message was
  // handed to nobody and the sender heard nothing back. Over loopback that
  // window barely exists — kill a client and the server sees the reset almost
  // at once — so any test written for it would pass because the socket had
  // already been removed, not because the new check did anything. A test that
  // cannot fail for the right reason is worse than none.

  console.log('\nthe mailbox is not free storage');
  b3.s.close();
  await wait(400);
  // 600 is above the 500-item cap.
  const filler = seal(keys.msgKey, JSON.stringify({ k: 'msg', id: 'x', body: 'x', at: 1 }));
  for (let i = 0; i < 600; i++) a.s.mail(`f${i}`, filler);
  await wait(1500);
  assert.ok(a.log.full.length > 0, 'the cap was never reported');
  ok('past the cap the sender is told, rather than silently dropped');

  console.log(`\n${pass} checks passed`);
} finally {
  live.forEach((s) => { try { s.close(); } catch {} });
  srv.kill();
}
