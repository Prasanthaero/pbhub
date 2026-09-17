/**
 * pbhub relay.
 *
 * This is deliberately the least interesting program in the repository. It
 * introduces two phones to each other, holds mail for whichever one is away,
 * and otherwise gets out of the way.
 *
 * What it sees:   a room id (a hash it cannot reverse without the pairing
 *                 secret, which it does not have), and ciphertext.
 * What it keeps:  undelivered mail, in memory, until it is collected — then it
 *                 is dropped immediately. Nothing is ever written to disk, so a
 *                 restart loses the queue rather than leaking it. Senders keep
 *                 their own outbox and re-send anything unacknowledged, so that
 *                 loss costs a retry rather than a message.
 * What it can do: deny service, and see that two devices talk and roughly how
 *                 much. It cannot read a single byte of any of it.
 */
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const MAX_ROOM = 2;
/**
 * Big enough for one sealed photo or short clip.
 *
 * Media used to require both phones present, so nothing large ever passed
 * through here. Now that a photo can wait for someone, a single frame has to be
 * able to carry one — still ciphertext, still dropped the moment it is
 * collected, still never written to disk.
 */
const MAX_FRAME = 12 * 1024 * 1024;
const IDLE_MS = 10 * 60 * 1000;

/** Caps per mailbox, so a room cannot be used as free storage. */
const MAX_MAIL_ITEMS = 500;
const MAX_MAIL_BYTES = 32 * 1024 * 1024;
const MAIL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** roomId -> { clients: Set<ws>, mail: { a: [], b: [] }, bytes: {a, b} } */
const rooms = new Map();

const emptyRoom = () => ({ clients: new Set(), mail: { a: [], b: [] }, bytes: { a: 0, b: 0 } });

const server = http.createServer((req, res) => {
  // A single unremarkable health endpoint. Nothing else is served.
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('ok');
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server, maxPayload: MAX_FRAME });

const send = (ws, obj) => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
};

const otherRole = (role) => (role === 'a' ? 'b' : 'a');

const peersOf = (ws) => {
  const room = rooms.get(ws.roomId);
  if (!room) return [];
  return [...room.clients].filter((c) => c !== ws);
};

/**
 * Throw out sockets nobody is on, and say so.
 *
 * A phone that is force-stopped or loses signal does not always send a close
 * frame, so its socket sits in the room looking present until a ping fails —
 * up to thirty seconds later. For that whole window the other person is told
 * their partner is online when they are not, and the chat says "online" over an
 * empty room. Checking whenever anything happens in the room makes the answer
 * honest within a moment instead.
 *
 * Returns whether anything was removed.
 */
function reap(room) {
  const dead = [...room.clients].filter((c) => c.readyState !== c.OPEN);
  if (!dead.length) return false;
  dead.forEach((c) => {
    room.clients.delete(c);
    try {
      c.terminate();
    } catch {}
  });
  room.clients.forEach((p) => send(p, { t: 'peer', present: false }));
  return true;
}

/** Hand over everything waiting for this peer, oldest first. */
function deliverMail(ws) {
  const room = rooms.get(ws.roomId);
  if (!room) return;
  const queue = room.mail[ws.role];
  if (!queue.length) return;

  const now = Date.now();
  const live = queue.filter((m) => now - m.at < MAIL_TTL_MS);
  room.mail[ws.role] = [];
  room.bytes[ws.role] = 0;

  for (const m of live) send(ws, { t: 'mail', id: m.id, d: m.d, at: m.at });
  // Tell the peer where the backlog ends, so it can stop showing "catching up".
  send(ws, { t: 'mail-done', count: live.length });
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.roomId = null;
  ws.role = null;
  /** Stable per-install id, so a reconnect can replace its own dead socket. */
  ws.device = null;
  /**
   * Listening, but locked.
   *
   * A phone whose vault has closed still wants to know that something arrived —
   * that is the whole point of the dot in the status bar. It has no key any
   * more, so it must not be handed the mail: the relay drops a message the
   * moment it is delivered, and delivering to somebody who cannot read it, and
   * is not storing it, would lose it. A peeking client is told that something
   * is waiting and nothing else, and the mail stays here until they unlock and
   * ask for it.
   *
   * It is also not 'present' for the other side. They are not in the app, and
   * saying they were would put online on their partner's screen over a locked
   * phone, and send messages down a channel nobody is listening to.
   */
  ws.peek = false;
  ws.lastSeen = Date.now();

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
    ws.lastSeen = Date.now();

    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.t === 'join') {
      if (ws.roomId) return;
      const id = String(msg.room || '');
      // Room ids are hex hashes of a fixed width. Anything else is not ours.
      if (!/^[0-9a-f]{32}$/.test(id)) return ws.close();

      const room = rooms.get(id) || emptyRoom();
      const device = typeof msg.device === 'string' ? msg.device.slice(0, 64) : null;

      // Drop anything in the room that has already failed a ping. Without this
      // a phone that was killed (battery, force-stop, crashed emulator) holds
      // its slot until the next sweep, and its owner cannot get back in.
      [...room.clients].forEach((c) => {
        if (c.readyState !== c.OPEN) {
          room.clients.delete(c);
          try {
            c.terminate();
          } catch {}
        }
      });

      // A phone reconnecting displaces its own previous socket.
      //
      // Without this, restarting the app races its own ghost: the old
      // connection is still OPEN as far as the server knows — TCP has not
      // noticed the app is gone and the next ping is up to 30 seconds away — so
      // the room looks full and the returning owner is turned away with
      // "someone else is already using this passphrase". Which was true, and
      // the someone else was them.
      if (device) {
        [...room.clients].forEach((c) => {
          if (c.device === device) {
            room.clients.delete(c);
            try {
              c.terminate();
            } catch {}
          }
        });
      }

      if (room.clients.size >= MAX_ROOM) {
        send(ws, { t: 'full' });
        return ws.close();
      }

      ws.roomId = id;
      ws.device = device;
      // Take whichever slot is actually free, rather than inferring it from the
      // count, which is stale whenever a socket died without closing.
      ws.role = [...room.clients].some((c) => c.role === 'a') ? 'b' : 'a';
      room.clients.add(ws);
      rooms.set(id, room);

      ws.peek = msg.peek === true;

      const others = [...room.clients].filter((c) => c !== ws && !c.peek);
      send(ws, { t: 'joined', role: ws.role, peer: others.length > 0 });

      if (ws.peek) {
        // Locked and listening. Say whether anything is already waiting, and
        // leave it where it is.
        if (room.mail[ws.role].length) send(ws, { t: 'waiting' });
        return;
      }

      peersOf(ws).forEach((p) => send(p, { t: 'peer', present: true }));

      // Anything that arrived while this peer was away.
      deliverMail(ws);
      return;
    }

    if (!ws.roomId) return;

    if (msg.t === 'sig') {
      if (typeof msg.d !== 'string') return;
      // Forwarded verbatim. The server has no key and no opinion.
      peersOf(ws).forEach((p) => send(p, { t: 'sig', d: msg.d }));
      return;
    }

    if (msg.t === 'mail') {
      if (typeof msg.d !== 'string' || typeof msg.id !== 'string') return;
      const room = rooms.get(ws.roomId);
      if (!room) return;

      // Anything of theirs that has quietly died goes now, so the mail below
      // is decided on who is really there and the other phone is told at once.
      reap(room);

      const target = otherRole(ws.role);
      // Open, not merely present. A socket whose owner has gone is still in the
      // room until the next sweep notices — up to thirty seconds — and handing
      // a message to it looked like delivery and was not. The sender got no
      // acknowledgement of any kind and its message sat at one dot until
      // something else happened to flush the outbox. Held is the honest answer
      // for a partner whose connection is already dead.
      const live = [...room.clients].find(
        (c) => c.role === target && c.readyState === c.OPEN && !c.peek,
      );

      // Partner is here: hand it over and let them acknowledge directly.
      if (live) {
        send(live, { t: 'mail', id: msg.id, d: msg.d, at: Date.now() });
        return;
      }

      // Partner is away: hold it. Caps keep a room from becoming free storage.
      const queue = room.mail[target];
      if (queue.length >= MAX_MAIL_ITEMS || room.bytes[target] + msg.d.length > MAX_MAIL_BYTES) {
        send(ws, { t: 'mail-full', id: msg.id });
        return;
      }
      queue.push({ id: msg.id, d: msg.d, at: Date.now() });
      room.bytes[target] += msg.d.length;
      send(ws, { t: 'mail-held', id: msg.id });

      // Their phone may be locked but listening. It cannot read this and is not
      // being given it — it is only being told that something came, so it can
      // put a dot in the status bar.
      const peeking = [...room.clients].find(
        (c) => c.role === target && c.readyState === c.OPEN && c.peek,
      );
      if (peeking) send(peeking, { t: 'waiting' });
      return;
    }

    /**
     * Something only worth saying right now: forwarded if they are here, and
     * dropped if they are not.
     *
     * "Typing" held in a mailbox for two days and delivered on Tuesday is
     * nonsense, and it would fill the queue that real messages need. This is
     * the one thing in the protocol that is allowed to be lost.
     */
    if (msg.t === 'live') {
      if (typeof msg.d !== 'string') return;
      const room = rooms.get(ws.roomId);
      if (!room) return;
      reap(room);
      const target = otherRole(ws.role);
      const there = [...room.clients].find(
        (c) => c.role === target && c.readyState === c.OPEN && !c.peek,
      );
      if (there) send(there, { t: 'live', d: msg.d });
      return;
    }

    /** Unlocked: stop peeking, join properly, and take the post. */
    if (msg.t === 'collect') {
      if (!ws.peek) return;
      ws.peek = false;
      peersOf(ws).forEach((p) => send(p, { t: 'peer', present: true }));
      const room = rooms.get(ws.roomId);
      if (room) {
        const others = [...room.clients].filter((c) => c !== ws && !c.peek);
        send(ws, { t: 'joined', role: ws.role, peer: others.length > 0 });
      }
      deliverMail(ws);
      return;
    }

    if (msg.t === 'ack') {
      // Receipts travel peer to peer; the relay only forwards them.
      if (typeof msg.id !== 'string') return;
      peersOf(ws).forEach((p) => send(p, { t: 'ack', id: msg.id }));
    }
  });

  ws.on('close', () => {
    const room = rooms.get(ws.roomId);
    if (!room) return;
    room.clients.delete(ws);
    room.clients.forEach((p) => send(p, { t: 'peer', present: false }));
    // Keep the room alive while mail is waiting; drop it when there is nothing
    // left to hold.
    if (room.clients.size === 0 && !room.mail.a.length && !room.mail.b.length) {
      rooms.delete(ws.roomId);
    }
  });

  ws.on('error', () => ws.terminate());
});

// Drop dead sockets, anything gone quiet for ten minutes, and mail nobody came
// back for — so a stale room can never pin a room id in memory indefinitely.
const sweep = setInterval(() => {
  const now = Date.now();

  wss.clients.forEach((ws) => {
    if (!ws.isAlive || now - ws.lastSeen > IDLE_MS) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });

  rooms.forEach((room) => reap(room));

  rooms.forEach((room, id) => {
    for (const role of ['a', 'b']) {
      const before = room.mail[role].length;
      room.mail[role] = room.mail[role].filter((m) => now - m.at < MAIL_TTL_MS);
      if (room.mail[role].length !== before) {
        room.bytes[role] = room.mail[role].reduce((n, m) => n + m.d.length, 0);
      }
    }
    if (room.clients.size === 0 && !room.mail.a.length && !room.mail.b.length) {
      rooms.delete(id);
    }
  });
}, 30_000);

wss.on('close', () => clearInterval(sweep));

/**
 * Keep the host from putting this to sleep.
 *
 * Free hosting stops an instance that has had no inbound request for about
 * fifteen minutes, and starting it again takes the better part of a minute —
 * which is exactly what "connecting takes too long" was. A request to our own
 * public address every ten minutes counts as traffic and keeps it up.
 *
 * It costs the whole of the free tier's monthly allowance, since the instance
 * then never stops. That is the trade: one always-awake relay, or a minute of
 * waiting whenever you have both been quiet for a quarter of an hour.
 *
 * Silent about failures on purpose. If the ping cannot go out, the relay is
 * still a relay; there is nothing for it to do about it and nothing worth
 * filling the log with.
 */
const SELF = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL;
if (SELF) {
  const https = require('https');
  const http2 = require('http');
  setInterval(() => {
    const get = SELF.startsWith('https') ? https.get : http2.get;
    try {
      const req = get(`${SELF}/health`, (res) => res.resume());
      req.on('error', () => {});
      req.setTimeout(20_000, () => req.destroy());
    } catch {}
  }, 10 * 60 * 1000);
  console.log(`staying awake via ${SELF}/health`);
}

server.listen(PORT, () => {
  console.log(`relay listening on :${PORT}`);
});
