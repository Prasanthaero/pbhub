/**
 * Vault crypto.
 *
 * Two secrets with two different jobs, which is the whole point of this file:
 *
 *   The PAIRING SECRET is 16 random bytes generated once and carried to the
 *   other phone by QR code. Four keys come out of it, one per job. It is never
 *   typed again after setup.
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
 * throughout, at roughly 0.044ms per round on the phone.
 *
 * It was 40,000 rounds — about 1.8 seconds in a release build, and 6.2 seconds
 * measured on a real phone under Expo Go, which is long enough that people
 * reasonably think the app has hung. Now 12,000: about half a second, and a
 * couple of seconds even in a development build.
 *
 * What that costs, honestly: almost nothing against the attack that matters.
 * This protects the stored blob against someone who already has the phone and
 * can get at its files. Against a six-digit PIN, the whole space is a million
 * guesses, which dedicated hardware chews through in seconds at either round
 * count — the rounds are a speed bump for a casual attempt, not a wall. What
 * actually buys security here is the length of the PIN. One more character is
 * worth more than tripling this number.
 */
const PBKDF2_ROUNDS = 12_000;

/** What vaults made before the count was written down used. */
const LEGACY_ROUNDS = 40_000;

/**
 * Vault formats.
 *
 * v2 — one 8-byte pairing secret, and one key derived from it doing every job:
 * messages, media, signalling, and everything this phone writes to its own
 * disk. Still opened, never created. See `deriveV2`.
 *
 * v3 — a 16-byte pairing secret, and a second random value that never leaves
 * this phone. Four keys come out of them, one per job. See `deriveV3`.
 */
export type VaultBlob = {
  v: 2 | 3;
  /** Random per device. The PIN never leaves this phone, so nothing forces
   *  two phones to agree on it. */
  salt: string;
  nonce: string;
  /**
   * Sealed under the PIN, indistinguishable from noise.
   *
   * v2: the pairing secret's raw bytes.
   * v3: JSON — the pairing secret and this device's store root.
   */
  ct: string;
  /** Rounds used to stretch the PIN. Absent on older vaults, which all used
   *  LEGACY_ROUNDS — recorded now so the number can change again without
   *  stranding anybody. */
  c?: number;
};

/**
 * Whether this vault can be re-sealed faster after a successful unlock.
 *
 * Only ever true for v3. A v2 vault is deliberately left alone: re-sealing it
 * would have to keep it v2 — its shared key is what the *other* phone is also
 * using, and what this phone's stored files are encrypted with — and a
 * re-seal path that must carefully preserve an old format is exactly the kind
 * of code that quietly gets it wrong one day. v2 vaults stay slow until the
 * pair is set up again, which is the thing that actually fixes them.
 */
export function needsRestretch(blob: VaultBlob): boolean {
  return blob.v === 3 && (blob.c ?? LEGACY_ROUNDS) !== PBKDF2_ROUNDS;
}

export type VaultKeys = {
  /** Rendezvous id handed to the relay. 128 bits of randomness. */
  roomId: string;
  /**
   * Content that goes to the other phone: chat envelopes, media, mailbox.
   *
   * Media is not given a key of its own. A separate key is worth having where
   * it draws a line between different parties or different threats, and media
   * here travels the same channel to the same person under the same session as
   * the text does. A fifth key would look like more security and add none.
   */
  msgKey: Uint8Array;
  /**
   * Signalling: SDP and ICE candidates, which pass through the relay.
   *
   * Separate from msgKey because this is the one kind of payload the relay is
   * *meant* to route while still being unable to read it. If a mistake is ever
   * made in the signalling path, it should not hand anyone the key to the
   * conversation.
   */
  sigKey: Uint8Array;
  /**
   * Everything this phone writes to its own disk: history, outbox, statuses,
   * status media, settings.
   *
   * On v3 this comes from a random value that exists only on this device, so
   * the other phone cannot decrypt this phone's files even though the two of
   * them share a conversation. It also means changing the pairing — setting the
   * two phones up again — does not make this phone's own stored history
   * unreadable, because the store root is carried across unchanged.
   */
  storeKey: Uint8Array;
  /** The pairing secret itself, kept in RAM while unlocked so Settings can
   *  show it again when the second phone is being set up. Wiped on lock. */
  pairing: Uint8Array;
  /** Which construction produced these keys. */
  era: 2 | 3;
  /** The per-device store root, so a re-pair can keep this phone's files. */
  storeRoot: Uint8Array;
};

export const toHex = bytesToHex;
export const fromHex = hexToBytes;

// Hermes does not reliably ship TextEncoder, so byte conversion comes from noble.
const utf8 = utf8ToBytes;

/** Deliberately slow. Only ever runs on an explicit submit, behind a spinner. */
function stretchPin(pin: string, salt: Uint8Array, rounds = PBKDF2_ROUNDS): Uint8Array {
  const t0 = Date.now();
  const out = pbkdf2(sha256, utf8(pin.normalize('NFKC').trim()), salt, {
    c: rounds,
    dkLen: 32,
  });
  // Duration only — never the PIN, never the key. Lets the round count be
  // checked against a real device instead of a desktop guess.
  console.log(`[kdf] ${rounds} rounds in ${Date.now() - t0}ms`);
  return out;
}

/**
 * The old construction: one key for everything.
 *
 * Kept exactly as it was, because two phones that have not been set up again
 * still have to agree, and because this phone's existing files are sealed with
 * the key it produces. Never used for a new vault.
 */
function deriveV2(secret: Uint8Array): VaultKeys {
  const one = hkdf(sha256, secret, undefined, utf8('pbhub/message'), 32);
  return {
    roomId: toHex(hkdf(sha256, secret, undefined, utf8('pbhub/room'), 16)),
    msgKey: one,
    sigKey: one,
    storeKey: one,
    pairing: secret,
    storeRoot: secret,
    era: 2,
  };
}

/**
 * One key per job.
 *
 * The labels are the domain separation: HKDF with different `info` gives keys
 * that cannot be derived from one another, so a key that leaks through one path
 * does not open the others. The version is in the label on purpose — a future
 * v4 must not be able to produce a v3 key by accident.
 */
function deriveV3(secret: Uint8Array, storeRoot: Uint8Array): VaultKeys {
  return {
    roomId: toHex(hkdf(sha256, secret, undefined, utf8('pbhub/room/v3'), 16)),
    msgKey: hkdf(sha256, secret, undefined, utf8('pbhub/message/v3'), 32),
    sigKey: hkdf(sha256, secret, undefined, utf8('pbhub/signal/v3'), 32),
    storeKey: hkdf(sha256, storeRoot, undefined, utf8('pbhub/store/v3'), 32),
    pairing: secret,
    storeRoot,
    era: 3,
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
  /**
   * The value this phone's own files are keyed to.
   *
   * Passed in when the two phones are being set up again on a phone that
   * already had a vault: carrying the old root across means a new pairing does
   * not make this phone's saved history unreadable. Fresh installs get a new
   * one, which is the common case.
   */
  storeRoot: Uint8Array = randomBytes(32),
  /** Only the tests pass this, to build a vault as an older version would. */
  rounds: number = PBKDF2_ROUNDS,
): { blob: VaultBlob; keys: VaultKeys } {
  const salt = randomBytes(16);
  const nonce = randomBytes(24);
  const body = JSON.stringify({ p: toHex(secret), s: toHex(storeRoot) });
  const ct = xchacha20poly1305(stretchPin(pin, salt, rounds), nonce).encrypt(utf8(body));
  return {
    blob: { v: 3, salt: toHex(salt), nonce: toHex(nonce), ct: toHex(ct), c: rounds },
    keys: deriveV3(secret, storeRoot),
  };
}

/**
 * Build a v2 vault, exactly as the old code did. Tests only.
 *
 * Here rather than in the test file because a test that constructs the old
 * format by hand stops testing the old format the moment this one changes.
 */
export function createLegacyVault(
  pin: string,
  secret: Uint8Array,
  rounds: number = LEGACY_ROUNDS,
): { blob: VaultBlob; keys: VaultKeys } {
  const salt = randomBytes(16);
  const nonce = randomBytes(24);
  const ct = xchacha20poly1305(stretchPin(pin, salt, rounds), nonce).encrypt(secret);
  return {
    blob: { v: 2, salt: toHex(salt), nonce: toHex(nonce), ct: toHex(ct), c: rounds },
    keys: deriveV2(secret),
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
    const key = stretchPin(candidate, fromHex(blob.salt), blob.c ?? LEGACY_ROUNDS);
    const opened = xchacha20poly1305(key, fromHex(blob.nonce)).decrypt(fromHex(blob.ct));

    // v2 sealed the secret's raw bytes; v3 seals a small JSON object. The
    // version decides, not the shape of what came out — guessing at the
    // contents is how a format migration turns into a silent wrong answer.
    if (blob.v === 2) return deriveV2(opened);

    const body = JSON.parse(bytesToUtf8(opened)) as { p?: string; s?: string };
    if (!body?.p || !body?.s) return null;
    return deriveV3(fromHex(body.p), fromHex(body.s));
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
