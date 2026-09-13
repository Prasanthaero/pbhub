/**
 * Content arriving from another app.
 *
 * Instagram, Facebook, the gallery, a browser — anything with a share button
 * can hand this app a picture, a clip or a line of text. What arrives is a URI
 * pointing at someone else's file, so the first thing we do is read the bytes
 * and stop depending on it: the source app may revoke the permission the
 * moment its share sheet closes.
 *
 * Two destinations, with different rules:
 *
 *   Sent to your partner — read into memory, transmitted, forgotten. Same as
 *   anything else in the chat, and never written down.
 *
 *   Set as your status — downscaled hard first, because this is the one piece
 *   of media the app stores. A status photo sits encrypted on your phone for up
 *   to a day, and a shrunken copy is both what fits and what you would rather
 *   be holding if the phone is ever taken.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as Legacy from 'expo-file-system/legacy';
import { MAX_MEDIA_BYTES } from '../net/transport';
import type { MediaKind } from '../store/messages';
import type { StatusImage } from '../store/status';

/** Small enough to store comfortably and to send in a blink. */
const STATUS_MAX_EDGE = 1080;
const STATUS_QUALITY = 0.6;

export type SharedItem = {
  kind: MediaKind | 'text';
  /** Present for text shares; also carries the caption of a media share. */
  text?: string;
  uri?: string;
  mime?: string;
  bytes?: number;
  duration?: number;
};

const decodedBytes = (b64: string) => Math.floor((b64.length * 3) / 4);

export const kindForMime = (mime: string): MediaKind =>
  mime.startsWith('video') ? 'video' : mime.startsWith('audio') ? 'audio' : 'photo';

/**
 * Read a shared file into memory as base64.
 *
 * Deliberately eager: the content:// URI a share hands over is borrowed, and
 * acting on it later — after the user has unlocked, chosen a destination and
 * thought about it — is exactly when it has stopped working.
 */
export async function readSharedFile(
  uri: string,
  mime: string,
): Promise<{ b64: string; bytes: number }> {
  const b64 = await Legacy.readAsStringAsync(uri, { encoding: 'base64' });
  const bytes = decodedBytes(b64);
  if (bytes > MAX_MEDIA_BYTES) {
    throw new Error('too large');
  }
  return { b64, bytes };
}

/**
 * Shrink a picture down to something worth storing for a day.
 *
 * A phone camera photo is several megabytes; a status does not need that, the
 * encrypted store would groan under it, and a full-resolution copy on disk is
 * more than anyone asked for. This produces a few hundred kilobytes.
 */
export async function toStatusImage(uri: string): Promise<StatusImage> {
  const ctx = ImageManipulator.manipulate(uri);
  ctx.resize({ width: STATUS_MAX_EDGE });
  const image = await ctx.renderAsync();
  const out = await image.saveAsync({
    compress: STATUS_QUALITY,
    format: SaveFormat.JPEG,
    base64: true,
  });

  const b64 = out.base64 ?? (await Legacy.readAsStringAsync(out.uri, { encoding: 'base64' }));

  // The manipulator writes its result to the cache; we have the bytes now.
  try {
    await Legacy.deleteAsync(out.uri, { idempotent: true });
  } catch {}

  return {
    uri: `data:image/jpeg;base64,${b64}`,
    mime: 'image/jpeg',
    bytes: decodedBytes(b64),
  };
}
