/**
 * The pairing secret as numbers.
 *
 * It used to be shown as words. Words are easy to read out loud, but they are
 * also the one part of this app that looked like a password — and a phrase
 * sitting on a screen invites someone to wonder what it opens. Twenty digits
 * look like an order number, and a phone offers a number pad for them.
 *
 * The mapping is exact and reversible, which matters more than either: two
 * phones must derive the same room from this, and a format that quietly loses a
 * bit would pair them into different rooms. That failure looks like a working
 * setup right up until nothing ever arrives.
 *
 * Two bytes at a time, printed as five digits — 0..65535 always fits, and every
 * secret has exactly one spelling. A group above 65535 cannot have come from
 * this app, so a mistyped digit is usually caught here rather than an hour
 * later.
 */
import { PAIRING_BYTES, wordsToBytes } from './wordlist';
export { PAIRING_BYTES };

const GROUP_BYTES = 2;
const GROUP_DIGITS = 5;
const GROUPS = PAIRING_BYTES / GROUP_BYTES;

/** How many digits a whole secret is. */
export const PAIRING_DIGITS = GROUPS * GROUP_DIGITS;

if (!Number.isInteger(GROUPS)) {
  throw new Error('pairing secret must be an even number of bytes');
}

/** "38491 00027 65535 01204" — spaced for reading, not for parsing. */
export function bytesToDigits(bytes: Uint8Array): string {
  if (bytes.length !== PAIRING_BYTES) return '';
  const out: string[] = [];
  for (let i = 0; i < bytes.length; i += GROUP_BYTES) {
    const value = (bytes[i] << 8) | bytes[i + 1];
    out.push(String(value).padStart(GROUP_DIGITS, '0'));
  }
  return out.join(' ');
}

/**
 * Back to bytes, or null.
 *
 * Spaces, dashes and anything else a person might type between groups are
 * ignored; the digits are what count.
 */
export function digitsToBytes(text: string): Uint8Array | null {
  const digits = String(text ?? '').replace(/\D/g, '');
  if (digits.length !== PAIRING_DIGITS) return null;

  const out = new Uint8Array(PAIRING_BYTES);
  for (let g = 0; g < GROUPS; g++) {
    const value = Number(digits.slice(g * GROUP_DIGITS, (g + 1) * GROUP_DIGITS));
    if (!Number.isInteger(value) || value > 0xffff) return null;
    out[g * GROUP_BYTES] = value >> 8;
    out[g * GROUP_BYTES + 1] = value & 0xff;
  }
  return out;
}

/**
 * Whatever the other phone gave you.
 *
 * Numbers are what this app shows. Words are still read because an older build
 * showed those — but only at the current length; see `looksOutdated`.
 */
export function parsePairing(text: string): Uint8Array | null {
  return digitsToBytes(text) ?? wordsToBytes(text);
}

/**
 * A code from before the secret was made longer.
 *
 * Worth telling apart from a typo. Those codes are exactly half the length of a
 * current one, and accepting one would be worse than refusing it: this phone
 * would build a vault the other phone cannot meet, and the only symptom would
 * be "waiting for partner" forever. Refusing it with the real reason — the
 * other phone needs the new app — costs one sentence and saves an evening.
 */
export function looksOutdated(text: string): boolean {
  const digits = String(text ?? '').replace(/\D/g, '');
  if (digits.length === PAIRING_DIGITS / 2) return true;
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  return words.length === PAIRING_BYTES / 2 && /^[a-z\s]+$/i.test(String(text ?? '').trim());
}
