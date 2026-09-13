/**
 * Base64, without depending on the environment to provide it.
 *
 * Hermes does not reliably ship `atob`/`btoa`, and `Buffer` is a Node idea that
 * only exists here if something drags in a polyfill. Both appear to work often
 * enough to pass a quick test and then fail on a device, so neither is used.
 *
 * These run on megabyte-sized media, so the loops are written to be dull and
 * allocation-light rather than clever.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const LOOKUP = (() => {
  const t = new Uint8Array(256).fill(255);
  for (let i = 0; i < ALPHABET.length; i++) t[ALPHABET.charCodeAt(i)] = i;
  return t;
})();

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  const n = bytes.length;
  let i = 0;

  // Build in chunks: string concatenation of a few million single characters
  // is the slow path in every engine.
  const CHUNK = 0x3000; // multiple of 3, so no padding lands mid-chunk
  while (i < n) {
    const end = Math.min(i + CHUNK, n);
    let part = '';
    let j = i;
    for (; j + 2 < end; j += 3) {
      const v = (bytes[j] << 16) | (bytes[j + 1] << 8) | bytes[j + 2];
      part += ALPHABET[(v >> 18) & 63] + ALPHABET[(v >> 12) & 63]
        + ALPHABET[(v >> 6) & 63] + ALPHABET[v & 63];
    }
    // Tail, only ever at the very end of the input.
    if (end === n && j < n) {
      const rem = n - j;
      if (rem === 1) {
        const v = bytes[j] << 16;
        part += ALPHABET[(v >> 18) & 63] + ALPHABET[(v >> 12) & 63] + '==';
      } else {
        const v = (bytes[j] << 16) | (bytes[j + 1] << 8);
        part += ALPHABET[(v >> 18) & 63] + ALPHABET[(v >> 12) & 63]
          + ALPHABET[(v >> 6) & 63] + '=';
      }
      j = n;
    }
    out += part;
    i = j;
  }
  return out;
}

export function base64ToBytes(b64: string): Uint8Array {
  // Tolerate whitespace and missing padding; both turn up in the wild.
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const n = clean.length;
  // `clean` has already had the '=' stripped, so the length follows from it
  // alone: four characters carry three bytes, and a short tail carries fewer.
  // Subtracting the padding on top of that counts it twice, which underflowed
  // to a negative length for a one-byte input.
  const out = new Uint8Array(Math.floor((n * 3) / 4));

  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < n; i++) {
    const v = LOOKUP[clean.charCodeAt(i)];
    if (v === 255) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      if (o < out.length) out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}

/** Bytes a base64 string actually encodes, without decoding it. */
export const decodedLength = (b64: string): number => {
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
};
