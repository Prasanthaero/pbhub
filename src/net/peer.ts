/**
 * Peer connection: direct device-to-device chat, media, voice and video.
 *
 * Text and media ride a WebRTC data channel; calls ride the same connection's
 * media tracks. Both are DTLS-encrypted by WebRTC itself, and every payload is
 * additionally sealed with the pairing-derived key, so a hostile relay or TURN
 * server still sees nothing but noise.
 *
 * Uses the "perfect negotiation" pattern so that adding camera/mic mid-session
 * cannot deadlock if both sides act at once. Who yields is decided by comparing
 * random tags rather than by join order — see `tag` below.
 */
// Through the shim rather than straight from the package, so a build without
// WebRTC in it still starts. See src/net/webrtc.ts.
import {
  RTCPeerConnectionCtor,
  RTCSessionDescriptionCtor,
  RTCIceCandidateCtor,
  mediaDevices,
  type MediaStream,
  type RTCPeerConnection,
} from './webrtc';
import type { Role } from './signaling';
import { seal, unseal, toHex } from '../crypto/vault';
import { randomBytes } from '../crypto/random';
import {
  BUFFER_HIGH, BUFFER_LOW, chunkBase64, MediaAssembler, type Envelope,
} from './transport';
import type { MediaKind } from '../store/messages';

export type CallKind = 'audio' | 'video';

export type PeerEvents = {
  onChannelOpen: (open: boolean) => void;
  onEnvelope: (e: Envelope) => void;
  /** A media transfer finished arriving. */
  onMedia: (
    id: string, kind: MediaKind, uri: string, mime: string, bytes: number,
    at: number, duration?: number,
  ) => void;
  /** Status media that was asked for, keyed by the status it belongs to. */
  onStatusMedia: (statusId: string, uri: string, mime: string) => void;
  onMediaProgress: (id: string, progress: number) => void;
  onLocalStream: (s: MediaStream | null) => void;
  onRemoteStream: (s: MediaStream | null) => void;
  onConnectionState: (s: string) => void;
};

export class Peer {
  private pc: RTCPeerConnection;
  private dc: any = null;
  private makingOffer = false;
  private ignoreOffer = false;
  private polite = true;
  private localStream: MediaStream | null = null;
  private senders: any[] = [];
  private incoming = new Map<string, MediaAssembler>();
  /** transfer id -> the status it is fetching, for transfers that are not
   *  destined for the conversation. */
  private statusTransfers = new Map<string, string>();

  /**
   * Who offers, and who yields in a collision.
   *
   * This used to come from the role the relay handed out, which it derived from
   * how many sockets were already in the room. That is wrong whenever the count
   * is stale: kill a phone without a clean close and its socket lingers, so both
   * peers can reconnect and be told the same thing. Two impolite peers ignore
   * each other's offers forever, and the symptom is a connection that reports
   * "partner is here" and then never opens.
   *
   * A random tag each, compared, cannot collide that way — it does not care who
   * arrived first, how many times either side reconnected, or what the relay
   * believes about the room.
   */
  private tag = toHex(randomBytes(16));
  private peerTag: string | null = null;
  private negotiating = false;

  private role: Role;
  private key: Uint8Array;
  private sendSignal: (m: any) => void;
  private ev: PeerEvents;

  constructor(
    role: Role,
    iceServers: any[],
    key: Uint8Array,
    sendSignal: (m: any) => void,
    ev: PeerEvents,
  ) {
    this.role = role;
    this.key = key;
    this.sendSignal = sendSignal;
    this.ev = ev;

    this.pc = new (RTCPeerConnectionCtor())({
      iceServers,
      // Gather a few candidates up front so the first offer already carries a
      // usable path, rather than waiting on a full trickle round trip.
      iceCandidatePoolSize: 4,
    });

    this.pc.addEventListener('icecandidate', (e: any) => {
      if (e.candidate) this.sendSignal({ kind: 'ice', candidate: e.candidate });
    });

    this.pc.addEventListener('connectionstatechange', () => {
      const s = (this.pc as any).connectionState;
      this.ev.onConnectionState(s);
      if (s === 'failed') this.pc.restartIce?.();
    });

    this.pc.addEventListener('track', (e: any) => {
      const [stream] = e.streams;
      this.ev.onRemoteStream(stream ?? null);
    });

    this.pc.addEventListener('datachannel', (e: any) => this.bindChannel(e.channel));

    this.pc.addEventListener('negotiationneeded', async () => {
      try {
        this.makingOffer = true;
        await this.pc.setLocalDescription();
        this.sendSignal({ kind: 'sdp', description: this.pc.localDescription });
      } catch {
        // Swallowed deliberately: a failed offer is retried by the next
        // negotiationneeded or by ICE restart.
      } finally {
        this.makingOffer = false;
      }
    });
  }

  /** Announce ourselves. Whoever has the higher tag will open the channel.
   *  Safe to call repeatedly — the relay re-announces presence on reconnect. */
  start() {
    this.sendSignal({ kind: 'hello', tag: this.tag });
  }

  /** Both tags known: settle who drives, and let that side open the channel. */
  private beginNegotiation() {
    if (!this.peerTag || this.negotiating || this.dc) return;
    this.negotiating = true;
    this.polite = this.tag < this.peerTag;
    if (!this.polite) {
      this.bindChannel(this.pc.createDataChannel('n', { ordered: true }));
    }
  }

  private bindChannel(ch: any) {
    this.dc = ch;
    ch.bufferedAmountLowThreshold = BUFFER_LOW;
    ch.addEventListener('open', () => this.ev.onChannelOpen(true));
    ch.addEventListener('close', () => this.ev.onChannelOpen(false));
    ch.addEventListener('message', (e: any) => {
      let payload: Envelope;
      try {
        payload = JSON.parse(unseal(this.key, String(e.data)));
      } catch {
        return;
      }
      this.handleEnvelope(payload);
    });
  }

  /** Media is reassembled here; everything else is handed straight up. */
  private handleEnvelope(p: Envelope) {
    switch (p.k) {
      case 'media-start': {
        this.incoming.set(
          p.id,
          new MediaAssembler(p.id, p.kind, p.mime, p.bytes, p.chunks, p.at, p.duration),
        );
        if (p.statusId) {
          // A status being fetched. Deliberately no progress event: this is not
          // a message, and a placeholder bubble must not appear in the chat.
          this.statusTransfers.set(p.id, p.statusId);
          return;
        }
        this.ev.onMediaProgress(p.id, 0);
        return;
      }
      case 'media-chunk': {
        const a = this.incoming.get(p.id);
        if (!a) return;
        const progress = a.add(p.seq, p.b64);
        if (!this.statusTransfers.has(p.id)) this.ev.onMediaProgress(p.id, progress);
        return;
      }
      case 'media-end': {
        const a = this.incoming.get(p.id);
        if (!a) return;
        this.incoming.delete(p.id);
        const statusId = this.statusTransfers.get(p.id);
        this.statusTransfers.delete(p.id);
        if (!a.complete) return; // A gap means the sender will resend it.
        if (statusId) {
          this.ev.onStatusMedia(statusId, a.toDataUri(), a.mime);
          return;
        }
        this.ev.onMedia(a.id, a.kind, a.toDataUri(), a.mime, a.bytes, a.at, a.duration);
        return;
      }
      case 'media-abort': {
        this.incoming.delete(p.id);
        this.statusTransfers.delete(p.id);
        return;
      }
      default:
        this.ev.onEnvelope(p);
    }
  }

  get isOpen(): boolean {
    return this.dc?.readyState === 'open';
  }

  /** Seal a payload for the wire. Used for both roads out of here. */
  wrap(e: Envelope): string {
    return seal(this.key, JSON.stringify(e));
  }

  /** Open a payload that came back the other way — including mail the relay
   *  held, which never touched the data channel. Null if it is not ours. */
  unwrap(wire: string): Envelope | null {
    try {
      return JSON.parse(unseal(this.key, wire)) as Envelope;
    } catch {
      return null;
    }
  }

  /** Send down the data channel. Returns false if it is not open. */
  sendWire(wire: string): boolean {
    if (!this.isOpen) return false;
    this.dc.send(wire);
    return true;
  }

  send(e: Envelope): boolean {
    return this.sendWire(this.wrap(e));
  }

  /** Wait for the send buffer to drain, so a big transfer cannot burst the
   *  channel. Resolves immediately when there is room. */
  private drain(): Promise<void> {
    if (!this.dc || this.dc.bufferedAmount < BUFFER_HIGH) return Promise.resolve();
    return new Promise((resolve) => {
      const onLow = () => {
        this.dc?.removeEventListener('bufferedamountlow', onLow);
        resolve();
      };
      this.dc.addEventListener('bufferedamountlow', onLow);
      // Belt and braces: some implementations are shy about firing the event.
      setTimeout(onLow, 3000);
    });
  }

  /**
   * Push a photo, video or voice note across.
   *
   * Only ever goes down the data channel — media through the relay's mailbox
   * would mean it sitting on a server, which is the one thing this app does not
   * do with pictures.
   */
  async sendMedia(
    id: string,
    kind: MediaKind,
    b64: string,
    mime: string,
    bytes: number,
    duration: number | undefined,
    onProgress: (p: number) => void,
    statusId?: string,
  ): Promise<boolean> {
    if (!this.isOpen) return false;

    const chunks = chunkBase64(b64);
    const at = Date.now();
    this.send({
      k: 'media-start', id, kind, mime, bytes, chunks: chunks.length, duration, at, statusId,
    });

    for (let i = 0; i < chunks.length; i++) {
      if (!this.isOpen) {
        this.send({ k: 'media-abort', id, reason: 'disconnected' });
        return false;
      }
      await this.drain();
      this.send({ k: 'media-chunk', id, seq: i, b64: chunks[i] });
      onProgress((i + 1) / chunks.length);
    }

    this.send({ k: 'media-end', id });
    return true;
  }

  /** Inbound SDP/ICE/hello from the relay. */
  async handleSignal(msg: any) {
    try {
      if (msg.kind === 'hello') {
        this.peerTag = String(msg.tag);
        // Answer so a peer that announced before we existed still learns our
        // tag; the guard in beginNegotiation keeps this from ping-ponging.
        this.sendSignal({ kind: 'hello', tag: this.tag });
        this.beginNegotiation();
        return;
      }

      if (msg.kind === 'sdp') {
        const description = msg.description;
        const offerCollision =
          description.type === 'offer' &&
          (this.makingOffer || (this.pc as any).signalingState !== 'stable');

        this.ignoreOffer = !this.polite && offerCollision;
        if (this.ignoreOffer) return;

        await this.pc.setRemoteDescription(new (RTCSessionDescriptionCtor())(description));
        if (description.type === 'offer') {
          await this.pc.setLocalDescription();
          this.sendSignal({ kind: 'sdp', description: this.pc.localDescription });
        }
      } else if (msg.kind === 'ice') {
        try {
          await this.pc.addIceCandidate(new (RTCIceCandidateCtor())(msg.candidate));
        } catch {
          if (!this.ignoreOffer) throw new Error('ice');
        }
      }
    } catch {
      // Malformed or out-of-order signal; negotiation will recover.
    }
  }

  /** Attach camera/mic. Triggers renegotiation automatically. */
  async openMedia(kind: CallKind): Promise<MediaStream | null> {
    if (this.localStream) return this.localStream;
    const stream = (await mediaDevices().getUserMedia({
      audio: true,
      video: kind === 'video' ? { facingMode: 'user', width: 1280, height: 720 } : false,
    })) as MediaStream;
    this.localStream = stream;
    this.senders = stream.getTracks().map((t: any) => this.pc.addTrack(t, stream));
    this.ev.onLocalStream(stream);
    return stream;
  }

  toggleMute(): boolean {
    const t = this.localStream?.getAudioTracks()[0];
    if (!t) return false;
    t.enabled = !t.enabled;
    return !t.enabled;
  }

  toggleCamera(): boolean {
    const t = this.localStream?.getVideoTracks()[0];
    if (!t) return false;
    t.enabled = !t.enabled;
    return !t.enabled;
  }

  switchCamera() {
    const t: any = this.localStream?.getVideoTracks()[0];
    t?._switchCamera?.();
  }

  /** Tear down call media but keep the chat channel alive. */
  closeMedia() {
    this.localStream?.getTracks().forEach((t: any) => t.stop());
    this.senders.forEach((s) => {
      try {
        this.pc.removeTrack(s);
      } catch {}
    });
    this.senders = [];
    this.localStream = null;
    this.ev.onLocalStream(null);
    this.ev.onRemoteStream(null);
  }

  destroy() {
    this.closeMedia();
    this.incoming.clear();
    this.statusTransfers.clear();
    try {
      this.dc?.close();
    } catch {}
    try {
      this.pc.close();
    } catch {}
  }
}
