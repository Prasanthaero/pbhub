/**
 * Peer connection: direct device-to-device chat, voice and video.
 *
 * Chat rides a WebRTC data channel, calls ride the same connection's media
 * tracks. Both are DTLS-encrypted by WebRTC itself, and chat payloads are
 * additionally sealed with the passphrase-derived key, so a hostile relay or
 * TURN server still sees nothing but noise.
 *
 * Uses the "perfect negotiation" pattern so that adding camera/mic mid-session
 * cannot deadlock if both sides act at once.
 */
import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  mediaDevices,
  MediaStream,
} from 'react-native-webrtc';
import type { Role } from './signaling';
import { seal, unseal } from '../crypto/vault';

export type CallKind = 'audio' | 'video';

export type PeerEvents = {
  onChannelOpen: (open: boolean) => void;
  onMessage: (text: string, at: number) => void;
  onLocalStream: (s: MediaStream | null) => void;
  onRemoteStream: (s: MediaStream | null) => void;
  onConnectionState: (s: string) => void;
  onCallSignal: (kind: 'ring' | 'accept' | 'decline' | 'hangup', callKind?: CallKind) => void;
};

export class Peer {
  private pc: RTCPeerConnection;
  private dc: any = null;
  private makingOffer = false;
  private ignoreOffer = false;
  private polite: boolean;
  private localStream: MediaStream | null = null;
  private senders: any[] = [];

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

    // Role 'a' (first to arrive) yields in a collision; 'b' drives.
    this.polite = role === 'a';

    this.pc = new RTCPeerConnection({
      iceServers,
      // Trickle everything; we want the fastest possible direct path.
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

  /** The impolite side opens the channel; the other receives it. */
  start() {
    if (this.role === 'b') this.bindChannel(this.pc.createDataChannel('n', { ordered: true }));
  }

  private bindChannel(ch: any) {
    this.dc = ch;
    ch.addEventListener('open', () => this.ev.onChannelOpen(true));
    ch.addEventListener('close', () => this.ev.onChannelOpen(false));
    ch.addEventListener('message', (e: any) => {
      let payload: any;
      try {
        payload = JSON.parse(unseal(this.key, String(e.data)));
      } catch {
        return;
      }
      if (payload.k === 'msg') this.ev.onMessage(String(payload.body), Number(payload.at) || Date.now());
      else if (payload.k === 'call') this.ev.onCallSignal(payload.action, payload.callKind);
    });
  }

  private post(obj: any) {
    if (this.dc?.readyState !== 'open') return false;
    this.dc.send(seal(this.key, JSON.stringify(obj)));
    return true;
  }

  sendMessage(body: string): boolean {
    return this.post({ k: 'msg', body, at: Date.now() });
  }

  signalCall(action: 'ring' | 'accept' | 'decline' | 'hangup', callKind?: CallKind) {
    this.post({ k: 'call', action, callKind });
  }

  /** Inbound SDP/ICE from the relay. */
  async handleSignal(msg: any) {
    try {
      if (msg.kind === 'sdp') {
        const description = msg.description;
        const offerCollision =
          description.type === 'offer' &&
          (this.makingOffer || (this.pc as any).signalingState !== 'stable');

        this.ignoreOffer = !this.polite && offerCollision;
        if (this.ignoreOffer) return;

        await this.pc.setRemoteDescription(new RTCSessionDescription(description));
        if (description.type === 'offer') {
          await this.pc.setLocalDescription();
          this.sendSignal({ kind: 'sdp', description: this.pc.localDescription });
        }
      } else if (msg.kind === 'ice') {
        try {
          await this.pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
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
    const stream = (await mediaDevices.getUserMedia({
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

  /** Tear down media but keep the chat channel alive. */
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
    try {
      this.dc?.close();
    } catch {}
    try {
      this.pc.close();
    } catch {}
  }
}
