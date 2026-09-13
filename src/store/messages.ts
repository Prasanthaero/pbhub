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
  | 'read'      // and they had the chat open, so they have seen it
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
  /** When this vanishes from both phones. See Expiring below. */
  expiresAt?: number;
  /**
   * A photo meant to be looked at once.
   *
   * On the receiving phone, opening it is the last time it exists: the bytes
   * are dropped when the viewer closes and the bubble becomes a note saying it
   * was opened. The sender keeps their own copy for the session, as they do
   * with everything else.
   */
  viewOnce?: boolean;
  /** Set once it has been looked at, on either phone. */
  viewed?: boolean;
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

/**
 * When a message should vanish from both phones.
 *
 * Carried on the message rather than worked out from a setting at display
 * time, because the two phones can have different settings and a message that
 * disappeared on one and not the other would be worse than no timer at all.
 * The sender's choice at the moment of sending travels with it, and both sides
 * honour the same instant.
 */
export type Expiring = {
  /** Absolute ms. Undefined means it stays until the app is closed. */
  expiresAt?: number;
};

/** The choices offered, in the order they appear in Settings. */
export const TTL_CHOICES: { label: string; ms: number }[] = [
  { label: 'Off', ms: 0 },
  { label: '1 hour', ms: 60 * 60 * 1000 },
  { label: '8 hours', ms: 8 * 60 * 60 * 1000 },
  { label: '1 day', ms: 24 * 60 * 60 * 1000 },
  { label: '7 days', ms: 7 * 24 * 60 * 60 * 1000 },
];

export const ttlLabel = (ms: number): string =>
  TTL_CHOICES.find((c) => c.ms === ms)?.label ?? 'Off';

/** Drop anything whose time is up. Returns the same array when nothing went,
 *  so callers can skip a re-render and a write to disk. */
export function dropExpired(msgs: Msg[], now = Date.now()): Msg[] {
  const live = msgs.filter((m) => !m.expiresAt || m.expiresAt > now);
  return live.length === msgs.length ? msgs : live;
}

/**
 * Put a message where it belongs, rather than on the end.
 *
 * The conversation used to be built in arrival order, which is the same thing
 * as sent order right up until it is not: a message re-sent after a
 * reconnection, or a backlog collected from the relay, arrives now but was
 * written hours ago. On the end, it sits under today's messages wearing
 * yesterday's timestamp.
 *
 * Sorting by when it was sent fixes that. The sort is stable, so two messages
 * sharing a millisecond keep the order they were added in.
 */
export function place(msgs: Msg[], next: Msg): Msg[] {
  // The common case by far: it really does belong on the end.
  if (!msgs.length || next.at >= msgs[msgs.length - 1].at) return [...msgs, next];
  return [...msgs, next].sort((a, b) => a.at - b.at);
}

/** The same, for a handful arriving together. */
export function placeAll(msgs: Msg[], next: Msg[]): Msg[] {
  return next.reduce(place, msgs);
}
