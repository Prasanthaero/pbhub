/**
 * Getting a photo, video or voice note into memory as base64.
 *
 * Everything here returns bytes, never a file path that outlives the send. The
 * picker hands us a copy in the app's cache; we read it, transmit it, and delete
 * it. What ends up in the conversation is a data: URI held in RAM, which is why
 * closing the app takes the pictures with it.
 */
import * as ImagePicker from 'expo-image-picker';
import * as Legacy from 'expo-file-system/legacy';
import { toStatusImage } from './shared';
import { MAX_MEDIA_BYTES } from '../net/transport';
import type { MediaKind } from '../store/messages';

export type Picked = {
  kind: MediaKind;
  b64: string;
  mime: string;
  bytes: number;
  duration?: number;
};

export class TooLarge extends Error {
  constructor(readonly bytes: number) {
    super('too large');
  }
}

const mimeFor = (kind: MediaKind, uri: string): string => {
  const ext = uri.split('.').pop()?.toLowerCase() ?? '';
  if (kind === 'photo') return ext === 'png' ? 'image/png' : 'image/jpeg';
  if (kind === 'video') return ext === 'webm' ? 'video/webm' : 'video/mp4';
  return ext === 'wav' ? 'audio/wav' : 'audio/m4a';
};

/** base64 inflates by 4/3; this is the real size of the bytes it encodes. */
const decodedBytes = (b64: string) => Math.floor((b64.length * 3) / 4);

async function readAsBase64(uri: string): Promise<string> {
  return Legacy.readAsStringAsync(uri, { encoding: 'base64' });
}

/** Delete the picker's temporary copy — it is in the app's cache, not the
 *  gallery, and leaving it there would outlive the conversation. */
async function discard(uri: string) {
  try {
    await Legacy.deleteAsync(uri, { idempotent: true });
  } catch {
    // Best effort. A file we cannot delete is one the OS will clear with the
    // cache; it is not worth failing a send over.
  }
}

async function finish(
  kind: MediaKind,
  uri: string,
  b64: string | null | undefined,
  duration?: number,
): Promise<Picked> {
  const data = b64 ?? (await readAsBase64(uri));
  const bytes = decodedBytes(data);
  await discard(uri);
  if (bytes > MAX_MEDIA_BYTES) throw new TooLarge(bytes);
  return { kind, b64: data, mime: mimeFor(kind, uri), bytes, duration };
}

export async function pickPhoto(fromCamera: boolean): Promise<Picked | null> {
  const perm = fromCamera
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;

  const opts: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    // Asking the picker for base64 saves a round trip through the filesystem.
    base64: true,
    quality: 0.7,
    exif: false, // location and camera serial have no business in this app
  };

  const res = fromCamera
    ? await ImagePicker.launchCameraAsync(opts)
    : await ImagePicker.launchImageLibraryAsync(opts);

  if (res.canceled || !res.assets?.length) return null;
  const a = res.assets[0];

  /**
   * Shrink it before it goes anywhere.
   *
   * A phone camera photo is several megabytes of detail no phone screen can
   * show. Full size made every send slow, and made a photo too large to wait in
   * the relay's mailbox for a partner who is not in the app — which is the
   * whole point of being able to send one at all. 1080px looks the same in a
   * chat bubble and is a fraction of the size.
   */
  const small = await toStatusImage(a.uri);
  await discard(a.uri);
  return {
    kind: 'photo',
    b64: small.uri.split(',')[1],
    mime: small.mime,
    bytes: small.bytes,
  };
}

export async function pickVideo(fromCamera: boolean): Promise<Picked | null> {
  const perm = fromCamera
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;

  const opts: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['videos'],
    quality: 0.5,
    // A minute of phone video is already tens of megabytes; the cap exists so a
    // send cannot run for ten minutes and then fail.
    videoMaxDuration: 60,
  };

  const res = fromCamera
    ? await ImagePicker.launchCameraAsync(opts)
    : await ImagePicker.launchImageLibraryAsync(opts);

  if (res.canceled || !res.assets?.length) return null;
  const a = res.assets[0];
  return finish('video', a.uri, null, a.duration ? a.duration / 1000 : undefined);
}

/** Turn a finished recording into a sendable payload. */
export async function readRecording(uri: string, seconds: number): Promise<Picked> {
  return finish('audio', uri, null, seconds);
}
