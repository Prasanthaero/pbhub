/**
 * Drives the app's real Signaling class against the real relay over a real
 * socket. Node 24 ships a global WebSocket, so the class under test is the
 * exact code the phone runs.
 *
 * Run with: npm run test:signaling
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createVault, seal, unseal } from '../src/crypto/vault.ts';
import { generatePairingSecret } from '../src/crypto/wordlist.ts';
import { Signaling } from '../src/net/signaling.ts';
import { createRequire } from 'node:module';

// Node's built-in WebSocket gives no way to drop a connection without a close
// frame, which is exactly what a dying phone does. The ws client does.
const WsClient = createRequire(import.meta.url)('../server/node_modules/ws');

const PORT = 8123;
const URL = `ws://127.0.0.1:${PORT}`;

let pass = 0;
const ok = (name) => { console.log('  ok  ' + name); pass++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await once(srv.stdout, 'data');

const seen = [];
/** Build a Signaling exactly as App.tsx does, recording what it reports. */
function client(tag, keys, onSignal = () => {}) {
  const log = { role: null, present: [], status: [], closed: null, signals: [] };
  const s = new Signaling(URL, keys.roomId, keys.msgKey, {
    onReady: (r) => { log.role = r; },
    onPeerPresent: (p) => log.present.push(p),
    onSignal: (m) => { log.signals.push(m); onSignal(m); },
    onStatus: (x) => log.status.push(x),
    onClosed: (r) => { log.closed = r; },
  });
  seen.push({ tag, s, log });
  s.connect();
  return { s, log };
}

try {
  const { keys } = createVault('110490', generatePairingSecret());

  console.log('handshake');
  const a = client('A', keys);
  await wait(400);
  assert.equal(a.log.role, 'a');
  assert.deepEqual(a.log.present, [false]);
  ok('first client is told it is role "a" and that nobody else is here');

  const b = client('B', keys);
  await wait(400);
  assert.equal(b.log.role, 'b');
  assert.deepEqual(b.log.present, [true]);
  assert.deepEqual(a.log.present, [false, true]);
  ok('second client is role "b"; the first is told its partner arrived');

  console.log('relaying');
  b.s.send({ kind: 'sdp', description: { type: 'offer', sdp: 'v=0 SECRET-SDP' } });
  await wait(300);
  assert.equal(a.log.signals.length, 1);
  assert.equal(a.log.signals[0].description.sdp, 'v=0 SECRET-SDP');
  ok('an SDP offer arrives at the partner intact');

  a.s.send({ kind: 'ice', candidate: { candidate: 'candidate:1 1 udp' } });
  await wait(300);
  assert.equal(b.log.signals[0].candidate.candidate, 'candidate:1 1 udp');
  ok('ICE candidates flow the other way');

  console.log('what the relay can see');
  // Tap the wire directly and confirm the server never sees plaintext.
  const raw = [];
  const spy = new WebSocket(URL);
  await once(spy, 'open');
  spy.addEventListener('message', (e) => raw.push(String(e.data)));
  spy.send(JSON.stringify({ t: 'join', room: keys.roomId }));
  await wait(300);
  assert.ok(raw.some((m) => JSON.parse(m).t === 'full'), 'third party should be refused');
  ok('a third device cannot join an occupied room');
  spy.close();

  // Rebuild what the server actually forwarded, from its own point of view.
  const wire = seal(keys.msgKey, JSON.stringify({ kind: 'sdp', description: { sdp: 'v=0 SECRET-SDP' } }));
  assert.ok(!wire.includes('SECRET'), 'signaling payload was not sealed');
  assert.match(wire, /^[0-9a-f]+$/);
  assert.equal(JSON.parse(unseal(keys.msgKey, wire)).description.sdp, 'v=0 SECRET-SDP');
  ok('signaling payloads on the wire are ciphertext the relay cannot read');

  console.log('stale sockets');
  // Clear the room first; the checks above left both slots occupied.
  a.s.close();
  b.s.close();
  await wait(400);

  // The deadlock this guards against: a phone is killed without closing its
  // socket, both peers reconnect, and the relay hands out the same role twice.
  // Two peers that agree on who is impolite ignore each other's offers forever
  // and the connection reports "partner is here" and then never opens.
  const ghost = new WsClient(URL);
  await once(ghost, 'open');
  ghost.send(JSON.stringify({ t: 'join', room: keys.roomId }));
  await wait(300);

  // Kill it the way a dying phone does: no close frame, just gone.
  ghost._socket.destroy();
  await wait(300);

  const roles = [];
  const c1 = client('R1', keys); await wait(400);
  roles.push(c1.log.role);
  const c2 = client('R2', keys); await wait(400);
  roles.push(c2.log.role);

  assert.ok(roles[0], 'first reconnecting client got no role');
  assert.ok(roles[1], 'second reconnecting client got no role — evicted ghost still holds a slot');
  assert.notEqual(roles[0], roles[1]);
  ok('after a socket dies without closing, two reconnecting peers get distinct roles');

  c1.s.close(); c2.s.close();
  await wait(300);

  console.log('reconnecting over your own ghost');
  // The reported bug: restart the app and you are refused entry to your own
  // room, because the relay still believes your previous socket is live. TCP
  // has not noticed, and the next ping is up to 30 seconds away.
  // (the previous section left the room empty)

  const DEVICE = 'test-device-aaaa';
  const first = new WsClient(URL);
  await once(first, 'open');
  first.send(JSON.stringify({ t: 'join', room: keys.roomId, device: DEVICE }));
  await wait(300);

  const partner = new WsClient(URL);
  await once(partner, 'open');
  partner.send(JSON.stringify({ t: 'join', room: keys.roomId, device: 'the-other-phone' }));
  await wait(300);
  // Room is now full, and the first socket is about to die uncleanly.
  first._socket.destroy();

  // Immediately back, before any sweep could have noticed.
  const again = new WsClient(URL);
  await once(again, 'open');
  again.send(JSON.stringify({ t: 'join', room: keys.roomId, device: DEVICE }));

  const reply = await new Promise((resolve) => {
    again.on('message', (m) => resolve(JSON.parse(m)));
    setTimeout(() => resolve({ t: 'timeout' }), 4000);
  });

  assert.notEqual(reply.t, 'full', 'the phone was refused entry to its own room');
  assert.equal(reply.t, 'joined');
  ok('a phone returning immediately displaces its own dead socket, rather than being refused');

  assert.equal(partner.readyState, partner.OPEN);
  ok("...and the partner's connection is left alone");

  again.close();
  partner.close();
  await wait(300);

  console.log('departure');
  const d1 = client('D1', keys); await wait(400);
  const d2 = client('D2', keys); await wait(400);
  d2.s.close();
  await wait(400);
  assert.equal(d1.log.present.at(-1), false);
  ok('the remaining client is told its partner left');

  // And the room should now accept a fresh second device.
  const c = client('C', keys);
  await wait(400);
  assert.ok(c.log.role && c.log.role !== d1.log.role);
  ok('the freed slot is reusable, so a dropped partner can come back');

  console.log(`\n${pass} checks passed`);
} finally {
  seen.forEach(({ s }) => { try { s.close(); } catch {} });
  srv.kill();
}
