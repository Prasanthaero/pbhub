/**
 * What goes inside the pairing QR code.
 *
 * Kept apart from the screen that draws it so it can be tested without a
 * camera: a decode that quietly goes wrong means two phones that will never
 * pair, and the symptom — "waiting for partner" forever — says nothing about
 * the cause.
 *
 * The prefix is short and unbranded on purpose. A code photographed over a
 * shoulder, or left in a gallery, should not announce which app it belongs to.
 */
import { PAIRING_BYTES } from './wordlist';

const PREFIX = 'nt1:';

export const encodePairing = (words: string): string =>
  PREFIX + words.trim().replace(/\s+/g, '-');

/**
 * Returns null for anything that is not one of our codes.
 *
 * Deliberately strict about the word count: a partial read that produced a
 * shorter secret would pair the phones to different rooms, which looks exactly
 * like a working setup right up until nothing arrives.
 */
export const decodePairing = (scanned: string): string | null => {
  const text = String(scanned ?? '').trim();
  if (!text.startsWith(PREFIX)) return null;
  const words = text.slice(PREFIX.length).split('-').filter(Boolean);
  if (words.length !== PAIRING_BYTES) return null;
  return words.join(' ').toLowerCase();
};
