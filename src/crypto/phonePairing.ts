/**
 * Pairing two phones from their two phone numbers.
 *
 * The app is for one couple and nobody else, so the pair of numbers is fixed
 * for the life of the install. Both phones type the same two numbers, in either
 * order, and arrive at the same pairing secret — no phrase to copy, no QR to
 * scan, no relay address to find.
 *
 * Nothing is sent anywhere to do this. There is no SMS, no verification code,
 * no account, and no server that learns a number: the numbers never leave the
 * phone, they are only stirred into a key derivation on each device
 * independently. That matters, because an SMS service would know both numbers
 * and that they were verified minutes apart, which is the one fact this app
 * exists to keep to itself.
 *
 * WHAT THIS COSTS, because it is a real reduction and should not be buried.
 * The old pairing secret was eight random bytes — unguessable, and known only
 * to two phones that had met. This one is derived from two phone numbers and
 * the constant below. Phone numbers are not secret and a number is short enough
 * to search exhaustively. So the secrecy now rests on SALT, which is compiled
 * into the app: anyone holding the APK *and* knowing both numbers can derive
 * the same room and read the conversation. That is an acceptable trade only
 * because this APK is handed to two people and published nowhere. If it is ever
 * put online, the QR pairing on the setup screen is still there and still the
 * stronger of the two.
 */
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/ciphers/utils.js';
import { PAIRING_BYTES } from './wordlist';

/**
 * Build-time constant, the same in both copies of the app because it is the
 * same APK. Not a secret from anyone who has the file — see above.
 */
const SALT = utf8ToBytes('pbhub/one-couple/2026');

/**
 * Reduce whatever was typed to the part both phones will agree on.
 *
 * The same phone can be written +91 98765 43210, 098765-43210 or 9876543210,
 * and one person will write their partner's number with a country code while
 * the other does not. Keeping only the last ten digits makes all of those the
 * same string, which is what matters here: two phones that disagree by one
 * character land in different rooms and wait for each other forever.
 *
 * The cost is that two numbers differing only above the tenth digit would
 * collide. For two people pairing their own phones, that cannot happen.
 */
export function normalisePhone(raw: string): string | null {
  const digits = (raw ?? '').replace(/[^0-9]/g, '');
  if (digits.length < 7) return null;
  return digits.slice(-10);
}

/**
 * The same secret on both phones, whichever way round the numbers are typed.
 *
 * Sorted before hashing, so "mine then theirs" on one phone and "mine then
 * theirs" on the other — which are opposite orders — still agree.
 */
export function pairingFromNumbers(mine: string, theirs: string): Uint8Array | null {
  const a = normalisePhone(mine);
  const b = normalisePhone(theirs);
  if (!a || !b) return null;
  // Both phones the same number is a typo, and would pair a phone with itself.
  if (a === b) return null;

  const joined = [a, b].sort().join('+');
  return hkdf(sha256, utf8ToBytes(joined), SALT, utf8ToBytes('pbhub/pair'), PAIRING_BYTES);
}
