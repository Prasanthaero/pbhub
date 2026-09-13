/**
 * CSPRNG bytes.
 *
 * On device this is backed by the platform RNG via the
 * `react-native-get-random-values` polyfill, which the app entry point installs
 * before anything else loads. Keeping the import out of this module lets the
 * crypto be exercised under plain Node.
 */
export function randomBytes(n: number): Uint8Array {
  const c = globalThis.crypto;
  if (!c?.getRandomValues) {
    throw new Error('No secure random source available');
  }
  const b = new Uint8Array(n);
  c.getRandomValues(b);
  return b;
}
