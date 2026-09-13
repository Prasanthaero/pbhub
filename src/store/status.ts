/**
 * Status: a line, or a picture, that stands for a day.
 *
 * Your own status is the one thing here that deliberately survives closing the
 * app, because a status that vanishes when you put your phone down is not a
 * status. It is written to *your* phone, encrypted under the vault key, and
 * pushed to your partner the next time you are both connected.
 *
 * The relay never holds it. Your partner's status is kept in memory only, so it
 * is present while you are talking and gone afterwards — they decide how long
 * their own words live, not you.
 *
 * On the picture
 * --------------
 * A status photo is the one exception to "media is never written to disk", and
 * it is worth being plain about that. Everything else — the photos and voice
 * notes in the chat — lives in memory and dies with the app. A status photo is
 * stored, encrypted, for up to a day, because that is what a status is.
 *
 * It is downscaled hard before it is stored (see media/status-image.ts), both
 * so it fits and so what sits on the phone is a small, low-detail copy rather
 * than the original.
 *
 * Expiry is enforced on read as well as write, so a clock change or a missed
 * sweep cannot resurrect something that should have gone.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { seal, unseal } from '../crypto/vault';

const KEY = '@nt/mood';

export const STATUS_TTL_MS = 24 * 60 * 60 * 1000;
export const STATUS_MAX_CHARS = 140;

export type StatusImage = {
  /** A data: URI. Downscaled before it ever gets here. */
  uri: string;
  mime: string;
  bytes: number;
};

export type Status = {
  text: string;
  image?: StatusImage;
  at: number;
  expiresAt: number;
  /** Where it came from, when it was shared in from another app. */
  source?: string;
};

export const isLive = (s: Status | null | undefined): s is Status =>
  !!s && (!!s.text.trim() || !!s.image) && Date.now() < s.expiresAt;

export async function loadStatus(key: Uint8Array): Promise<Status | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(unseal(key, raw)) as Status;
    if (!isLive(s)) {
      // Expired: clear it rather than leaving it to be found later.
      await AsyncStorage.removeItem(KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export async function saveStatus(
  key: Uint8Array,
  text: string,
  image?: StatusImage,
  source?: string,
): Promise<Status | null> {
  const trimmed = text.trim().slice(0, STATUS_MAX_CHARS);
  if (!trimmed && !image) {
    await AsyncStorage.removeItem(KEY);
    return null;
  }
  const at = Date.now();
  const s: Status = { text: trimmed, image, at, expiresAt: at + STATUS_TTL_MS, source };
  await AsyncStorage.setItem(KEY, seal(key, JSON.stringify(s)));
  return s;
}

export async function clearStatus(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}

/** How long is left, in words, for showing under the status. */
export function timeLeft(s: Status): string {
  const ms = s.expiresAt - Date.now();
  if (ms <= 0) return 'expired';
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${hours}h left`;
  const mins = Math.max(1, Math.floor(ms / 60_000));
  return `${mins}m left`;
}
