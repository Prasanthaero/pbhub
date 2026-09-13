/**
 * pbhub relay.
 *
 * This is deliberately the least interesting program in the repository. It
 * introduces two phones to each other and then gets out of the way.
 *
 * What it sees:   a room id (a hash of a passphrase it does not have), and
 *                 opaque ciphertext it cannot read.
 * What it keeps:  nothing. No disk, no log of message contents, no history.
 *                 Rooms live in a Map and vanish when the second socket closes.
 * What it can do: deny service. It cannot read, replay usefully, or
 *                 impersonate — the payloads are authenticated with a key
 *                 derived from the passphrase.
 */
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const MAX_ROOM = 2;
const MAX_FRAME = 256 * 1024;
const IDLE_MS = 10 * 60 * 1000;

/** roomId -> Set<ws> */
const rooms = new Map();

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

const peersOf = (ws) => {
  const set = rooms.get(ws.roomId);
  if (!set) return [];
  return [...set].filter((c) => c !== ws);
};

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.roomId = null;
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

      const set = rooms.get(id) || new Set();
      if (set.size >= MAX_ROOM) {
        send(ws, { t: 'full' });
        return ws.close();
      }

      ws.roomId = id;
      ws.role = set.size === 0 ? 'a' : 'b';
      set.add(ws);
      rooms.set(id, set);

      send(ws, { t: 'joined', role: ws.role, peer: set.size === 2 });
      peersOf(ws).forEach((p) => send(p, { t: 'peer', present: true }));
      return;
    }

    if (msg.t === 'sig') {
      if (!ws.roomId || typeof msg.d !== 'string') return;
      // Forwarded verbatim. The server has no key and no opinion.
      peersOf(ws).forEach((p) => send(p, { t: 'sig', d: msg.d }));
    }
  });

  ws.on('close', () => {
    const set = rooms.get(ws.roomId);
    if (!set) return;
    set.delete(ws);
    set.forEach((p) => send(p, { t: 'peer', present: false }));
    if (set.size === 0) rooms.delete(ws.roomId);
  });

  ws.on('error', () => ws.terminate());
});

// Drop dead sockets and anything that has gone quiet for ten minutes, so a
// stale room can never pin a passphrase hash in memory indefinitely.
const sweep = setInterval(() => {
  const now = Date.now();
  wss.clients.forEach((ws) => {
    if (!ws.isAlive || now - ws.lastSeen > IDLE_MS) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30_000);

wss.on('close', () => clearInterval(sweep));

server.listen(PORT, () => {
  console.log(`relay listening on :${PORT}`);
});
