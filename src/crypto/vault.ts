/**
 * Vault crypto.
 *
 * Two secrets with two different jobs, which is the whole point of this file:
 *
 *   The PAIRING SECRET is 8 random bytes generated once and carried to the
 *   other phone by hand. It produces the room id and the message key. It is
 *   never typed again after setup.
 *
 *   The PIN is what you type into a note to get in. It protects the pairing
 *   secret where it sits on this phone, and nothing else.
 *
 * An earlier version made the typed phrase itself the room id and the message
 * key. That forced two awkward things: a constant KDF salt (two phones that
 * share only a phrase must derive the same room from it), and a long phrase
 * (a short one would put the room within reach of anyone willing to enumerate).
 *
 * Splitting the roles removes both problems:
 *
 *   - The room id is 128 bits of randomness. Nobody can reach it by guessing,
 *     so nobody can find the conversation on the relay, however short the PIN.
 *   - The PIN never leaves the device, so its salt is random per phone. The
 *     precomputation weakness the fixed salt created is gone.
 *   - A short PIN becomes a reasonable thing to want, because it now only
 *     stands between an attacker *holding your unlocked phone* and the stored
 *     key — not between the world and your conversation.
 *
 * What a short PIN still costs: someone who takes the phone, extracts the
 * stored blob and attacks it offline on real hardware will get a six-digit PIN
 * quickly. They would learn the pairing secret and could then join the room.
 * They would NOT recover any past conversation, because none is kept anywhere.
 * A longer PIN is strictly better; the app allows a short one because that is a
 * judgement for the people using it, not for this file.
 */
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { utf8ToBytes, bytesToUtf8, bytesToHex, hexToBytes } from '@noble/ciphers/utils.js';
import { randomBytes } from './random';

/**
 * Measured on the device, not guessed from a desktop benchmark.
 *
 * This runs in Hermes, which has no JIT. An early version used
 * PBKDF2-HMAC-SHA512 at 250,000 rounds: about half a second on a laptop and
 * over a MINUTE on the phone, because SHA-512 needs 64-bit arithmetic that
 * Hermes emulates with pairs of 32-bit operations. SHA-256 uses 32-bit words
 * throughout and measured 5.3s for 120,000 rounds on the same device, so
 * roughly 0.044ms per round. 40,000 rounds is about 1.8s: a real cost to
 * anyone guessing, short enough that unlocking does not feel broken.
 */
const PBKDF2_ROUNDS = 40_000;

export type VaultBlob = {
  v: 2;
  /** Random per device. The PIN never leaves this phone, so nothing forces
   *  two phones to agree on it. */
  salt: string;
  nonce: string;
  /** The pairing secret, sealed under the PIN. Indistinguishable from noise. */
  ct: string;
};

export type VaultKeys = {
  /** Rendezvous id handed to the relay. 128 bits of randomness. */
  roomId: string;
  /** Symmetric key for every byte that leaves the device. */
  msgKey: Uint8Array;
  /** The pairing secret itself, kept in RAM while unlocked so Settings can
   *  show it again when the second phone is being set up. Wiped on lock. */
  pairing: Uint8Array;
};

export const toHex = bytesToHex;
export const fromHex = hexToBytes;

// Hermes does not reliably ship TextEncoder, so byte conversion comes from noble.
const utf8 = utf8ToBytes;

/** Deliberately slow. Only ever runs on an explicit submit, behind a spinner. */
function stretchPin(pin: string, salt: Uint8Array): Uint8Array {
  const t0 = Date.now();
  const out = pbkdf2(sha256, utf8(pin.normalize('NFKC').trim()), salt, {
    c: PBKDF2_ROUNDS,
    dkLen: 32,
  });
  // Duration only — never the PIN, never the key. Lets the round count be
  // checked against a real device instead of a desktop guess.
  console.log(`[kdf] ${PBKDF2_ROUNDS} rounds in ${Date.now() - t0}ms`);
  return out;
}

/** Room id and message key, from the pairing secret both phones hold. */
function deriveShared(secret: Uint8Array): VaultKeys {
  return {
    roomId: toHex(hkdf(sha256, secret, undefined, utf8('pbhub/room'), 16)),
    msgKey: hkdf(sha256, secret, undefined, utf8('pbhub/message'), 32),
    pairing: secret,
  };
}

/**
 * Set up this phone.
 *
 * `secret` is the pairing secret: generated on the first phone, and typed in
 * from that phone on the second. Both phones must end up with the same bytes,
 * which is the one thing that cannot be shortcut.
 */
export function createVault(
  pin: string,
  secret: Uint8Array,
): { blob: VaultBlob; keys: VaultKeys } {
  const salt = randomBytes(16);
  const nonce = randomBytes(24);
  const ct = xchacha20poly1305(stretchPin(pin, salt), nonce).encrypt(secret);
  return {
    blob: { v: 2, salt: toHex(salt), nonce: toHex(nonce), ct: toHex(ct) },
    keys: deriveShared(secret),
  };
}

/**
 * Try a candidate PIN against the stored vault.
 *
 * The AEAD tag does double duty: if it verifies, the PIN was right AND we now
 * hold the pairing secret. If it does not, we learn nothing and neither does
 * anyone else — a wrong PIN is indistinguishable from an ordinary note.
 */
export function openVault(blob: VaultBlob, candidate: string): VaultKeys | null {
  try {
    const key = stretchPin(candidate, fromHex(blob.salt));
    const secret = xchacha20poly1305(key, fromHex(blob.nonce)).decrypt(fromHex(blob.ct));
    return deriveShared(secret);
  } catch {
    return null;
  }
}

/** Seal a payload for the wire. Nothing readable ever leaves the device. */
export function seal(key: Uint8Array, plaintext: string): string {
  const nonce = randomBytes(24);
  const ct = xchacha20poly1305(key, nonce).encrypt(utf8(plaintext));
  const joined = new Uint8Array(nonce.length + ct.length);
  joined.set(nonce);
  joined.set(ct, nonce.length);
  return toHex(joined);
}

/**
 * Seal raw bytes — for status media, which is far too big to go through the
 * key-value store as a hex string.
 *
 * Returns nonce||ciphertext as bytes, so the caller can base64 it into a file
 * without ever holding a doubled-up hex copy of a video in memory.
 */
export function sealBytes(key: Uint8Array, plain: Uint8Array): Uint8Array {
  const nonce = randomBytes(24);
  const ct = xchacha20poly1305(key, nonce).encrypt(plain);
  const out = new Uint8Array(nonce.length + ct.length);
  out.set(nonce);
  out.set(ct, nonce.length);
  return out;
}

/** Open bytes sealed by sealBytes. Throws if they were tampered with. */
export function unsealBytes(key: Uint8Array, packed: Uint8Array): Uint8Array {
  return xchacha20poly1305(key, packed.slice(0, 24)).decrypt(packed.slice(24));
}

/** Open a payload from the wire. Throws if it was tampered with. */
export function unseal(key: Uint8Array, packed: string): string {
  const raw = fromHex(packed);
  return bytesToUtf8(xchacha20poly1305(key, raw.slice(0, 24)).decrypt(raw.slice(24)));
}

/** Overwrite key material in place before dropping the reference. */
export function wipe(k?: Uint8Array | null) {
  if (k) k.fill(0);
}
