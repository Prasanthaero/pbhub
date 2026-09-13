/**
 * The conversation.
 *
 * By default this array is the whole database: no file, no cache, and locking
 * the vault drops it. Turn on "keep chat history" in Settings and the text is
 * additionally written to this phone, encrypted (see history.ts).
 *
 * Media is the exception and always has been: photos, video and voice notes
 * live here in memory and nowhere else, whatever the history setting says.
 */
export type MediaKind = 'photo' | 'video' | 'audio';

export type Media = {
  kind: MediaKind;
  /** A data: URI held in memory. Never written to disk, never in history. */
  uri: string;
  mime: string;
  bytes: number;
  /** Seconds, for video and voice notes. */
  duration?: number;
};

/** Where a message has got to. Only ever meaningful for our own messages. */
export type Delivery =
  | 'sending'   // handed to the transport, no word back yet
  | 'held'      // the relay is holding it until they open the app
  | 'delivered' // their phone acknowledged it
  | 'failed';   // the relay's mailbox is full, or it expired unread

export type Msg = {
  id: string;
  kind: 'in' | 'out' | 'system';
  body: string;
  at: number;
  media?: Media;
  delivery?: Delivery;
  /** Progress 0..1 while a photo or video is still arriving. */
  progress?: number;
};

let seq = 0;

/** Ids must be unique across both phones, since they are used for receipts. */
export const newId = (): string =>
  `${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const mkMsg = (
  kind: Msg['kind'],
  body: string,
  at = Date.now(),
  extra: Partial<Msg> = {},
): Msg => ({
  id: newId(),
  kind,
  body,
  at,
  ...extra,
});
