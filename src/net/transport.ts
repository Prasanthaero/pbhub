/**
 * Everything that travels between the two phones, and how it gets there.
 *
 * Two roads, one format. A payload is sealed once, then either goes down the
 * WebRTC data channel (direct, when the partner is here) or into the relay's
 * mailbox (when they are not). The relay cannot tell the two apart and cannot
 * read either — it is the same ciphertext in both cases.
 *
 * Media is chunked. A data channel will not carry an arbitrarily large message:
 * implementations disagree on the ceiling, and exceeding it closes the channel
 * outright rather than failing politely. 16KB chunks are below every limit
 * worth caring about, and let progress be shown while a photo arrives.
 */
import type { MediaKind } from '../store/messages';

/** Comfortably under the smallest data-channel message limit in the wild. */
export const CHUNK_BYTES = 16 * 1024;

/**
 * Pause sending when this much is already queued in the channel, and resume
 * when it drains. Without backpressure a large video fills the send buffer,
 * and the channel is torn down mid-transfer.
 */
export const BUFFER_HIGH = 512 * 1024;
export const BUFFER_LOW = 128 * 1024;

/** Refuse anything that would take absurdly long over a phone connection. */
export const MAX_MEDIA_BYTES = 24 * 1024 * 1024;

export type Envelope =
  | { k: 'msg'; id: string; body: string; at: number }
  | { k: 'ack'; id: string }
  | { k: 'call'; action: 'ring' | 'accept' | 'decline' | 'hangup'; callKind?: 'audio' | 'video' }
  | { k: 'status'; text: string; at: number; expiresAt: number }
  | { k: 'status-clear' }
  | {
      k: 'media-start';
      id: string;
      kind: MediaKind;
      mime: string;
      bytes: number;
      chunks: number;
      duration?: number;
      at: number;
    }
  | { k: 'media-chunk'; id: string; seq: number; b64: string }
  | { k: 'media-end'; id: string }
  | { k: 'media-abort'; id: string; reason: string };

/** Reassembles a media transfer as its chunks arrive. */
export class MediaAssembler {
  private parts: (string | undefined)[];
  private received = 0;

  constructor(
    readonly id: string,
    readonly kind: MediaKind,
    readonly mime: string,
    readonly bytes: number,
    readonly chunks: number,
    readonly at: number,
    readonly duration?: number,
  ) {
    this.parts = new Array(chunks);
  }

  /** Returns progress 0..1. Ignores duplicates, which a resend can produce. */
  add(seq: number, b64: string): number {
    if (seq < 0 || seq >= this.chunks || this.parts[seq] !== undefined) {
      return this.progress;
    }
    this.parts[seq] = b64;
    this.received++;
    return this.progress;
  }

  get progress(): number {
    return this.chunks === 0 ? 1 : this.received / this.chunks;
  }

  get complete(): boolean {
    return this.received === this.chunks;
  }

  /** A data: URI, held in memory only. */
  toDataUri(): string {
    return `data:${this.mime};base64,${this.parts.join('')}`;
  }
}

/** Split a base64 string into chunk-sized pieces.
 *
 *  Base64 is cut on 4-character boundaries so each chunk decodes on its own if
 *  we ever want it to, and so the join at the far end is a plain concatenation.
 */
export function chunkBase64(b64: string): string[] {
  const per = Math.floor(CHUNK_BYTES / 3) * 4; // bytes -> base64 characters
  const out: string[] = [];
  for (let i = 0; i < b64.length; i += per) out.push(b64.slice(i, i + per));
  return out;
}
