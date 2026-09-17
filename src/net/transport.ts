/**
 * Moving what envelope.ts describes.
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
import { CHUNK_BYTES } from './envelope';

export {
  PROTOCOL_VERSION, CHUNK_BYTES, MAX_MEDIA_BYTES, MAX_OFFLINE_MEDIA_BYTES,
  packEnvelope, parseEnvelope,
} from './envelope';
export type { Envelope } from './envelope';

/**
 * Pause sending when this much is already queued in the channel, and resume
 * when it drains. Without backpressure a large video fills the send buffer,
 * and the channel is torn down mid-transfer.
 */
export const BUFFER_HIGH = 512 * 1024;
export const BUFFER_LOW = 128 * 1024;

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
    /** Absolute ms when both phones drop it. */
    readonly exp?: number,
    /** A photo the receiver may look at exactly once. */
    readonly once?: boolean,
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
