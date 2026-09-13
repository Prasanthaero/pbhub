/**
 * Status: several of them, each standing for a day.
 *
 * Your own statuses are the one thing here that deliberately survive closing
 * the app, because a status that vanishes when you put your phone down is not a
 * status. The list is written to *your* phone encrypted under the vault key,
 * and any media alongside it goes into its own encrypted file (statusMedia.ts).
 *
 * The relay never holds any of it. Your partner's statuses are kept in memory
 * only, so they are there while you are talking and gone afterwards — they
 * decide how long their own words live, not you.
 *
 * On media
 * --------
 * Status media is the one exception to "media is never written to disk", and it
 * is worth being plain about that. The photos and voice notes in the chat live
 * in memory and die with the app. A status photo or clip is stored, encrypted,
 * for up to a day, because that is what a status is.
 *
 * Photos are downscaled hard before they are stored. Video is capped at
 * STATUS_VIDEO_SECONDS, because a status is not a film and because every second
 * is a second of encrypted video sitting on a phone.
 *
 * Expiry is enforced on read as well as write, so a clock change or a missed
 * sweep cannot resurrect something that should have gone.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { seal, unseal } from '../crypto/vault';
import { pruneStatusMedia } from './statusMedia';

const KEY = '@nt/mood';

export const STATUS_TTL_MS = 24 * 60 * 60 * 1000;
export const STATUS_MAX_CHARS = 280;
/** Enough for a day of them; past this the oldest falls off. */
export const STATUS_MAX_ITEMS = 20;
export const STATUS_VIDEO_SECONDS = 30;

export type StatusKind = 'text' | 'photo' | 'video';

export type StatusItem = {
  id: string;
  kind: StatusKind;
  /** The words: the whole status for text, a caption otherwise. */
  text: string;
  at: number;
  expiresAt: number;

  // ---- media, absent for a text status ----
  /** Points at an encrypted file on this phone (statusMedia.ts). Ours only. */
  mediaId?: string;
  /** A data: URI held in memory. How a partner's status arrives, and how ours
   *  is carried once it has been read back for viewing. */
  uri?: string;
  mime?: string;
  bytes?: number;
  duration?: number;
  /** Set when it came in from another app's share sheet. */
  source?: string;
};

export const isLiveItem = (s: StatusItem): boolean => Date.now() < s.expiresAt;

/** Newest first, which is how a list of statuses wants to be read. */
const order = (items: StatusItem[]) => [...items].sort((a, b) => b.at - a.at);

export async function loadStatuses(key: Uint8Array): Promise<StatusItem[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const all = JSON.parse(unseal(key, raw)) as StatusItem[];
    const live = all.filter(isLiveItem);

    // Anything expired goes now, along with the files it was holding open.
    if (live.length !== all.length) {
      await writeStatuses(key, live);
    }
    return order(live);
  } catch {
    return [];
  }
}

export async function writeStatuses(key: Uint8Array, items: StatusItem[]): Promise<StatusItem[]> {
  const live = order(items.filter(isLiveItem)).slice(0, STATUS_MAX_ITEMS);

  if (!live.length) {
    await AsyncStorage.removeItem(KEY);
  } else {
    // The data: URI is a view-time convenience; storing it would duplicate the
    // whole picture into the key-value store, which is what the files avoid.
    const lean = live.map(({ uri, ...rest }) => rest);
    await AsyncStorage.setItem(KEY, seal(key, JSON.stringify(lean)));
  }

  await pruneStatusMedia(live.map((s) => s.mediaId).filter(Boolean) as string[]);
  return live;
}

export async function clearStatuses(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
  await pruneStatusMedia([]);
}

/** What goes over the wire: everything except the bytes. */
export type StatusSummary = Omit<StatusItem, 'mediaId' | 'uri'>;

export const toSummary = (s: StatusItem): StatusSummary => {
  const { mediaId, uri, ...rest } = s;
  return rest;
};

/** How long is left, in words, for showing under a status. */
export function timeLeft(s: { expiresAt: number }): string {
  const ms = s.expiresAt - Date.now();
  if (ms <= 0) return 'expired';
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${hours}h left`;
  const mins = Math.max(1, Math.floor(ms / 60_000));
  return `${mins}m left`;
}
