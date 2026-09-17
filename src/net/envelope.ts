/**
 * The wire format: what one phone says to the other, and what counts as a
 * sensible thing to have been said.
 *
 * Split from transport.ts so it can be exercised by the Node tests, which run
 * TypeScript in strip-only mode and cannot load a file with constructor
 * parameter properties in it. That is a mundane reason for a split, and it
 * happens to be the right one anyway: this file is a format, and transport.ts
 * is the machinery for moving things in that format.
 */
import type { MediaKind } from '../store/messages';
import type { StatusSummary } from '../store/status';

/**
 * What version of this format the phone speaks.
 *
 * Every sealed payload carries it, and a payload that carries anything else is
 * dropped rather than interpreted. The alternative — reading an unknown shape
 * as though it were this one — is how a future change turns into a wrong
 * message rather than a refused one.
 *
 * Version 3 is the first one to say so out loud. Earlier builds sealed a bare
 * envelope with no version at all; they cannot appear here, because they also
 * derived their keys differently and nothing they send will decrypt.
 */
export const PROTOCOL_VERSION = 3;

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

/**
 * The most that can be left waiting for an absent partner.
 *
 * Smaller than the live limit on purpose: this has to sit encrypted in the
 * sender's outbox and in the relay's memory until it is collected, rather than
 * streaming past in a few seconds. Photos are shrunk well under this; a long
 * video is not, and is told to wait for both phones.
 */
export const MAX_OFFLINE_MEDIA_BYTES = 4 * 1024 * 1024;

export type Envelope =
  | {
      k: 'msg';
      id: string;
      body: string;
      at: number;
      /** Absolute ms when both phones drop it. */
      exp?: number;
    }
  | { k: 'ack'; id: string }
  /** Someone is writing. Never held for later — see Signaling.live. */
  | { k: 'typing'; on: boolean }
  /** "I have these on screen." Sent only when the chat is actually open, and
   *  only if read receipts are switched on. */
  | { k: 'read'; ids: string[] }
  | { k: 'call'; action: 'ring' | 'accept' | 'decline' | 'hangup'; callKind?: 'audio' | 'video' }
  /**
   * The list of statuses, without any of the bytes.
   *
   * Media is fetched on demand rather than pushed: several clips would be a
   * long, silent transfer on connect, most of which the viewer never opens.
   */
  | { k: 'status-list'; items: StatusSummary[] }
  /** "Send me the media for this one" — sent when a viewer actually opens it. */
  | { k: 'status-want'; id: string }
  | { k: 'status-clear' }
  /** Take these back off the other phone as well as this one. */
  | { k: 'delete'; ids: string[] }
  | {
      k: 'media-start';
      id: string;
      kind: MediaKind;
      mime: string;
      bytes: number;
      chunks: number;
      duration?: number;
      at: number;
      /** Present when this transfer is a status being fetched, not a message.
       *  Without it the picture would land in the conversation. */
      statusId?: string;
      /** Both phones drop it at this instant. */
      exp?: number;
      /** A photo the other side may look at exactly once. */
      once?: boolean;
    }
  | { k: 'media-chunk'; id: string; seq: number; b64: string }
  | { k: 'media-end'; id: string }
  | { k: 'media-abort'; id: string; reason: string }
  /**
   * A whole file in one envelope, for when the partner is not here.
   *
   * The chunked path above exists because a data channel will not carry a large
   * message. The relay's mailbox will, so mail takes the simple road: seal it
   * once, hand it over, and let it wait. Capped, because it has to sit in the
   * sender's outbox and in the relay's memory until it is collected.
   */
  | {
      k: 'media-whole';
      id: string;
      kind: MediaKind;
      mime: string;
      bytes: number;
      duration?: number;
      b64: string;
      at: number;
      /** Both phones drop it at this instant. */
      exp?: number;
      /** A photo the other side may look at exactly once. */
      once?: boolean;
    };

// ---------------------------------------------------------------------------
// Packing and checking
//
// Decryption proves a payload came from someone holding the key. It proves
// nothing about its shape. TypeScript proves nothing either — `as Envelope` is
// a promise to the compiler, not a check at runtime, and the compiler is not
// the one reading the network.
//
// So everything that arrives goes through parseEnvelope, and anything that is
// not exactly one of the shapes below is dropped. The partner is the only one
// who can produce a valid payload here, so this is not defending against a
// stranger; it is defending against a partner running a different version, a
// truncated write, or a bug — the ordinary ways a program is handed something
// it did not expect.
// ---------------------------------------------------------------------------

const str = (x: unknown): x is string => typeof x === 'string';
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const strs = (x: unknown): x is string[] => Array.isArray(x) && x.every(str);

/** The required fields of each kind. Optional ones are checked only if present. */
function shapeOk(e: any): boolean {
  switch (e.k) {
    case 'msg': return str(e.id) && str(e.body) && num(e.at);
    case 'ack': return str(e.id);
    case 'typing': return typeof e.on === 'boolean';
    case 'read': return strs(e.ids);
    case 'delete': return strs(e.ids);
    case 'call':
      return ['ring', 'accept', 'decline', 'hangup'].includes(e.action)
        && (e.callKind === undefined || e.callKind === 'audio' || e.callKind === 'video');
    case 'status-list': return Array.isArray(e.items);
    case 'status-want': return str(e.id);
    case 'status-clear': return true;
    case 'media-start':
      return str(e.id) && str(e.kind) && str(e.mime)
        && num(e.bytes) && num(e.chunks) && e.chunks >= 0 && num(e.at)
        // A chunk count that does not match the byte count is either a bug or
        // an attempt to make the receiver allocate an enormous sparse array.
        && e.bytes <= MAX_MEDIA_BYTES
        && e.chunks <= Math.ceil(MAX_MEDIA_BYTES / CHUNK_BYTES) + 1;
    case 'media-chunk': return str(e.id) && num(e.seq) && e.seq >= 0 && str(e.b64);
    case 'media-end': return str(e.id);
    case 'media-abort': return str(e.id) && str(e.reason);
    case 'media-whole':
      return str(e.id) && str(e.kind) && str(e.mime) && num(e.bytes) && str(e.b64) && num(e.at)
        && e.bytes <= MAX_MEDIA_BYTES;
    default: return false;
  }
}

/** Seal-ready JSON: the version, and the envelope. */
export function packEnvelope(e: Envelope): string {
  return JSON.stringify({ v: PROTOCOL_VERSION, e });
}

/**
 * The reverse, with every reason to say no.
 *
 * Null for: not JSON, no version, a version this build does not speak, no
 * envelope, an unknown kind, or a kind whose fields are not what that kind
 * requires.
 */
export function parseEnvelope(json: string): Envelope | null {
  let outer: any;
  try {
    outer = JSON.parse(json);
  } catch {
    return null;
  }
  if (!outer || typeof outer !== 'object') return null;
  if (outer.v !== PROTOCOL_VERSION) return null;

  const e = outer.e;
  if (!e || typeof e !== 'object' || typeof e.k !== 'string') return null;
  return shapeOk(e) ? (e as Envelope) : null;
}

