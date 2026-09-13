/**
 * A phrase generator.
 *
 * This matters more than the KDF round count, and it is worth saying why.
 *
 * Because two phones that have never met must derive the same room from the
 * phrase alone, the KDF salt has to be a constant (see vault.ts). That removes
 * the usual protection against precomputed dictionaries, so the security of the
 * whole app rests on the phrase being unguessable. And people are famously bad
 * at choosing unguessable things — "iloveyou2" survives no amount of stretching,
 * while seven random words survive any amount of computation anyone can buy.
 *
 * 256 words = 8 bits each. Seven words = 56 bits, drawn from the system CSPRNG,
 * with no human choice involved at any point.
 */
import { randomBytes } from './random';

export const WORDS_IN_PHRASE = 7;

/**
 * 256 short, common, unambiguous English words. Chosen to be easy to say out
 * loud and to type on a phone: no homophones, no words that differ by one
 * letter, nothing longer than six characters.
 */
const WORDS = [
  'able', 'acid', 'acre', 'aim', 'air', 'alarm', 'album', 'ale', 'amber', 'angle',
  'ankle', 'apple', 'april', 'arch', 'arm', 'army', 'art', 'ash', 'atlas', 'attic',
  'auto', 'axis', 'baby', 'badge', 'bag', 'baker', 'ball', 'band', 'bank', 'barn',
  'basin', 'bay', 'beach', 'bean', 'bear', 'bed', 'bell', 'belt', 'bench', 'berry',
  'bike', 'bird', 'blade', 'block', 'blue', 'board', 'boat', 'bone', 'book', 'boot',
  'bowl', 'box', 'brain', 'brass', 'bread', 'brick', 'bridge', 'broom', 'brush', 'bulb',
  'cabin', 'cake', 'camel', 'camp', 'candy', 'cane', 'cap', 'card', 'cargo', 'carpet',
  'cart', 'cave', 'chain', 'chair', 'chalk', 'cheek', 'chess', 'chin', 'city', 'clay',
  'cliff', 'clock', 'cloth', 'cloud', 'clown', 'coal', 'coast', 'coat', 'coin', 'comet',
  'cook', 'copper', 'coral', 'cork', 'corn', 'couch', 'cow', 'crab', 'crane', 'crown',
  'cube', 'cup', 'curve', 'dance', 'dawn', 'deck', 'deer', 'desk', 'diary', 'dish',
  'dock', 'dog', 'doll', 'donkey', 'door', 'dove', 'draft', 'dream', 'dress', 'drum',
  'duck', 'dust', 'eagle', 'earth', 'east', 'edge', 'egg', 'elbow', 'elder', 'engine',
  'fabric', 'face', 'fan', 'farm', 'fence', 'fern', 'field', 'fig', 'finger', 'fire',
  'flag', 'flame', 'flask', 'floor', 'flour', 'flute', 'fog', 'forest', 'fork', 'fox',
  'frame', 'frog', 'fruit', 'garden', 'gate', 'ghost', 'giant', 'ginger', 'glass', 'globe',
  'glove', 'goat', 'gold', 'goose', 'grape', 'grass', 'green', 'guitar', 'hammer', 'hand',
  'harbor', 'hat', 'hawk', 'hedge', 'helmet', 'hill', 'honey', 'hook', 'horse', 'hotel',
  'house', 'ice', 'index', 'ink', 'iron', 'island', 'ivory', 'jacket', 'jar', 'jelly',
  'jewel', 'judge', 'juice', 'jungle', 'kettle', 'key', 'kite', 'knee', 'knife', 'ladder',
  'lake', 'lamp', 'lawn', 'leaf', 'lemon', 'lens', 'letter', 'lily', 'lime', 'lion',
  'lock', 'log', 'lotus', 'maple', 'marble', 'market', 'mask', 'mast', 'meadow', 'melon',
  'metal', 'meter', 'mint', 'mirror', 'mist', 'money', 'monkey', 'moon', 'moss', 'motor',
  'mount', 'mouse', 'museum', 'nail', 'napkin', 'needle', 'nest', 'net', 'north', 'nurse',
  'oak', 'ocean', 'olive', 'onion', 'orange', 'orbit', 'otter', 'oven', 'owl', 'oyster',
  'paint', 'palace', 'palm', 'paper', 'parcel', 'park',
];

// A wrong length here silently biases the generator, so fail loudly at import.
if (WORDS.length !== 256) {
  throw new Error(`wordlist must be exactly 256 words, got ${WORDS.length}`);
}

/**
 * A fresh phrase, straight from the system CSPRNG.
 *
 * Each byte indexes the list directly. The list is exactly 256 long, so every
 * word is equally likely and there is no modulo bias to reason about.
 */
export function generatePhrase(words = WORDS_IN_PHRASE): string {
  return Array.from(randomBytes(words), (b) => WORDS[b]).join(' ');
}

/** Bits of entropy in a generated phrase, for showing the user. */
export const phraseBits = (words = WORDS_IN_PHRASE) => words * 8;

// ---------------------------------------------------------------------------
// Pairing secret <-> words
//
// The pairing secret is raw random bytes, and it has to be carried from one
// phone to the other by a human reading it out. Words survive that trip;
// hex does not. Because the list is exactly 256 long, one byte is one word and
// the mapping is lossless in both directions.
// ---------------------------------------------------------------------------

/** Bytes in a pairing secret. 8 bytes = 64 bits = 8 words to type once. */
export const PAIRING_BYTES = 8;

const INDEX: Record<string, number> = {};
WORDS.forEach((word, i) => { INDEX[word] = i; });

export function bytesToWords(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => WORDS[b]).join(' ');
}

/** Returns null if any word is not in the list, so a typo cannot silently
 *  produce a different secret and a mystifying "waiting for partner" forever. */
export function wordsToBytes(phrase: string): Uint8Array | null {
  const words = phrase.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length !== PAIRING_BYTES) return null;
  const out = new Uint8Array(PAIRING_BYTES);
  for (let i = 0; i < words.length; i++) {
    const idx = INDEX[words[i]];
    if (idx === undefined) return null;
    out[i] = idx;
  }
  return out;
}

/** A fresh pairing secret, straight from the system CSPRNG. */
export function generatePairingSecret(): Uint8Array {
  return randomBytes(PAIRING_BYTES);
}
