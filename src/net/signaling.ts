/**
 * Signaling client.
 *
 * The relay is a dumb pipe. It sees a room id (a hash of the shared passphrase)
 * and opaque ciphertext. It cannot read a single field of the SDP, cannot tell
 * who is talking, and holds nothing on disk. Once the two peers connect
 * directly, the relay is out of the loop entirely.
 */
import { seal, unseal } from '../crypto/vault';

export type Role = 'a' | 'b';

export type SignalingEvents = {
  onReady: (role: Role) => void;
  onPeerPresent: (present: boolean) => void;
  onSignal: (msg: any) => void;
  onStatus: (s: string) => void;
  onClosed: (reason: string) => void;
};

export class Signaling {
  private ws: WebSocket | null = null;
  private closedByUs = false;
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  private url: string;
  private roomId: string;
  private key: Uint8Array;
  private ev: SignalingEvents;

  constructor(url: string, roomId: string, key: Uint8Array, ev: SignalingEvents) {
    this.url = url;
    this.roomId = roomId;
    this.key = key;
    this.ev = ev;
  }

  connect() {
    this.closedByUs = false;
    this.ev.onStatus('Connecting…');

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (e: any) {
      this.scheduleRetry(`Bad relay address`);
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.retry = 0;
      ws.send(JSON.stringify({ t: 'join', room: this.roomId }));
    };

    ws.onmessage = (e) => {
      let msg: any;
      try {
        msg = JSON.parse(String(e.data));
      } catch {
        return;
      }
      switch (msg.t) {
        case 'joined':
          this.ev.onStatus(msg.peer ? 'Partner is here' : 'Waiting for partner…');
          this.ev.onReady(msg.role as Role);
          this.ev.onPeerPresent(!!msg.peer);
          break;
        case 'peer':
          this.ev.onStatus(msg.present ? 'Partner is here' : 'Waiting for partner…');
          this.ev.onPeerPresent(!!msg.present);
          break;
        case 'sig':
          try {
            this.ev.onSignal(JSON.parse(unseal(this.key, msg.d)));
          } catch {
            // Undecryptable: someone else's traffic, or tampering. Ignore it.
          }
          break;
        case 'full':
          this.closedByUs = true;
          this.ev.onClosed('Someone else is already using this passphrase.');
          ws.close();
          break;
      }
    };

    ws.onerror = () => {
      this.ev.onStatus('Relay unreachable');
    };

    ws.onclose = () => {
      this.ws = null;
      if (this.closedByUs) return;
      this.scheduleRetry('Relay disconnected');
    };
  }

  private scheduleRetry(reason: string) {
    this.ev.onStatus(reason);
    const delay = Math.min(1000 * 2 ** this.retry, 15000);
    this.retry++;
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  /** Everything outbound is sealed with the shared key first. */
  send(msg: any) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ t: 'sig', d: seal(this.key, JSON.stringify(msg)) }));
  }

  close() {
    this.closedByUs = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.ws?.close();
    this.ws = null;
  }
}
