/**
 * Encrypted storage for status pictures and clips.
 *
 * Status media is the one thing in this app that has to survive closing it, and
 * a video is far too big for the key-value store the rest of the vault uses. So
 * each item gets its own file under the app's private directory, encrypted with
 * the vault key, named by a random id that says nothing about what it holds.
 *
 * A phone taken apart finds a handful of files of random bytes with meaningless
 * names. Without the PIN they are noise, and the app itself cannot tell you
 * which was a photo and which was a video without opening them.
 *
 * Everything here is deliberately explicit about deletion: media outlives its
 * status record by exactly as long as it takes to notice, and an orphan is a
 * file nothing will ever clean up.
 */
import * as Legacy from 'expo-file-system/legacy';
import { sealBytes, unsealBytes, toHex } from '../crypto/vault';
import { randomBytes } from '../crypto/random';
import { bytesToBase64, base64ToBytes } from '../crypto/base64';

/** Its own folder, so a sweep can enumerate exactly what belongs to status. */
const DIR = `${Legacy.documentDirectory}nt/`;

const path = (id: string) => `${DIR}${id}`;

async function ensureDir() {
  const info = await Legacy.getInfoAsync(DIR);
  if (!info.exists) await Legacy.makeDirectoryAsync(DIR, { intermediates: true });
}

/** Write media to its own encrypted file. Returns the id to store with the item. */
export async function writeStatusMedia(key: Uint8Array, b64: string): Promise<string> {
  await ensureDir();
  const id = toHex(randomBytes(16));
  const sealed = sealBytes(key, base64ToBytes(b64));
  await Legacy.writeAsStringAsync(path(id), bytesToBase64(sealed), { encoding: 'base64' });
  return id;
}

/** Read one back. Null if it is missing or not ours — either way, unusable. */
export async function readStatusMedia(key: Uint8Array, id: string): Promise<string | null> {
  try {
    const stored = await Legacy.readAsStringAsync(path(id), { encoding: 'base64' });
    return bytesToBase64(unsealBytes(key, base64ToBytes(stored)));
  } catch {
    return null;
  }
}

export async function deleteStatusMedia(id: string): Promise<void> {
  try {
    await Legacy.deleteAsync(path(id), { idempotent: true });
  } catch {
    // A file we cannot delete is one the OS will take with the app; not worth
    // failing an expiry sweep over.
  }
}

/**
 * Delete every stored file that no live status still points at.
 *
 * Called after expiry and after a delete, because the alternative is a folder
 * that only ever grows and that nothing else will ever tidy.
 */
export async function pruneStatusMedia(keepIds: string[]): Promise<void> {
  try {
    const info = await Legacy.getInfoAsync(DIR);
    if (!info.exists) return;
    const keep = new Set(keepIds);
    const files = await Legacy.readDirectoryAsync(DIR);
    await Promise.all(files.filter((f) => !keep.has(f)).map((f) => deleteStatusMedia(f)));
  } catch {}
}

/** Remove the folder outright, when the vault is destroyed. */
export async function wipeStatusMedia(): Promise<void> {
  try {
    await Legacy.deleteAsync(DIR, { idempotent: true });
  } catch {}
}
