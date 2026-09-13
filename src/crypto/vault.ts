/**
 * Vault crypto.
 *
 * Design goals:
 *  - The passphrase is NEVER stored, not even as a hash.
 *  - The only thing written to disk is a "marker": a small blob of ciphertext
 *    that is indistinguishable from random bytes. If it decrypts, the
 *    passphrase was right. If it doesn't, we learn nothing and neither does
 *    anyone who seizes the phone.
 *  - Both partners type the SAME phrase on two phones that have never met, and
 *    must land in the same place. That forces the shared material to be a pure
 *    function of the phrase alone.
 *
 * On the fixed salt
 * ----------------
 * Because the two devices share nothing but the phrase, the KDF salt has to be
 * a constant. A per-device random salt would give the partners different room
 * ids and they would never find each other.
 *
 * The cost is real and worth stating plainly: a constant salt means an attacker
 * could precompute a dictionary once and try it against every user of this app,
 * rather than paying the cost per target. The defence is entirely in the
 * passphrase, which is why setup refuses anything under 10 characters and asks
 * for a phrase of real words. A five-word phrase is far beyond any practical
 * precomputation; "iloveyou2" is not, salt or no salt.
 */
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha512, sha256 } from '@noble/hashes/sha2.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { utf8ToBytes, bytesToUtf8, bytesToHex, hexToBytes } from '@noble/ciphers/utils.js';
import { randomBytes } from './random';

const PBKDF2_ROUNDS = 250_000;
const MARKER_PLAINTEXT = 'pbhub.vault.v1';

/** Constant by necessity — see the note above. */
const PAIRING_SALT = utf8ToBytes('pbhub/pairing/v1');

export type VaultBlob = {
  v: 1;
  /** Fresh per device, so two phones holding the same phrase still store
   *  different-looking bytes. Plays no part in pairing. */
  nonce: string;
  ct: string;
};

export type VaultKeys = {
  /** Rendezvous id handed to the relay. A hash — reveals nothing. */
  roomId: string;
  /** Symmetric key for every byte that leaves the device. */
  msgKey: Uint8Array;
};

export const toHex = bytesToHex;
export const fromHex = hexToBytes;

// Hermes does not reliably ship TextEncoder, so byte conversion comes from noble.
const utf8 = utf8ToBytes;
const fromUtf8 = bytesToUtf8;

/** Slow, deliberately. Only ever runs on an explicit submit, behind a spinner. */
function stretch(passphrase: string): Uint8Array {
  return pbkdf2(sha512, utf8(passphrase.normalize('NFKC').trim()), PAIRING_SALT, {
    c: PBKDF2_ROUNDS,
    dkLen: 32,
  });
}

function subkey(master: Uint8Array, label: string, len = 32): Uint8Array {
  return hkdf(sha256, master, undefined, utf8(label), len);
}

function derive(master: Uint8Array): VaultKeys {
  return {
    roomId: toHex(subkey(master, 'pbhub/room', 16)),
    msgKey: subkey(master, 'pbhub/message', 32),
  };
}

function sealMarker(master: Uint8Array): VaultBlob {
  const markerKey = subkey(master, 'pbhub/marker', 32);
  const nonce = randomBytes(24);
  const ct = xchacha20poly1305(markerKey, nonce).encrypt(utf8(MARKER_PLAINTEXT));
  return { v: 1, nonce: toHex(nonce), ct: toHex(ct) };
}

/** Create a brand new vault from a passphrase. Returns the blob to persist. */
export function createVault(passphrase: string): { blob: VaultBlob; keys: VaultKeys } {
  const master = stretch(passphrase);
  return { blob: sealMarker(master), keys: derive(master) };
}

/**
 * Try a candidate passphrase against a stored vault.
 * Returns null on failure — with no way to tell "wrong password" apart from
 * "this was just an ordinary note".
 */
export function openVault(blob: VaultBlob, candidate: string): VaultKeys | null {
  try {
    const master = stretch(candidate);
    const markerKey = subkey(master, 'pbhub/marker', 32);
    const pt = xchacha20poly1305(markerKey, fromHex(blob.nonce)).decrypt(fromHex(blob.ct));
    if (fromUtf8(pt) !== MARKER_PLAINTEXT) return null;
    return derive(master);
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

/** Open a payload from the wire. Throws if it was tampered with. */
export function unseal(key: Uint8Array, packed: string): string {
  const raw = fromHex(packed);
  return fromUtf8(xchacha20poly1305(key, raw.slice(0, 24)).decrypt(raw.slice(24)));
}

/** Overwrite key material in place before dropping the reference. */
export function wipe(k?: Uint8Array | null) {
  if (k) k.fill(0);
}
