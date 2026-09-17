/**
 * Which messages this phone has already accepted.
 *
 * The app has always dropped an id it had seen before, which is what stops a
 * message appearing twice when the relay re-delivers one whose acknowledgement
 * went missing. But that memory lived in RAM and was thrown away on every lock,
 * and that turned an ordinary duplicate check into a gap:
 *
 *   A sealed message is valid forever. It carries no counter, and its timestamp
 *   is inside the ciphertext where nothing can argue with it. Anyone who kept a
 *   copy of one — the relay is holding them by design, briefly — could hand it
 *   back after a restart, and the phone would have no way to know it had ever
 *   seen it. It would decrypt, it would verify, and it would appear as new.
 *
 * So the list is written down. It survives locking, force-stopping and rebooting
 * the phone, which is exactly the window the gap lived in.
 *
 * It is sealed with this device's store key, like everything else on disk. The
 * ids themselves say nothing — they are random strings — but a plaintext list of
 * them would say how many messages arrived and roughly when, which is more than
 * a notes app should be carrying around.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { seal, unseal } from '../crypto/vault';

const KEY = '@nt/marks';

/**
 * How many to remember.
 *
 * Enough that a replay has to be hopelessly stale to get through, small enough
 * that the list is a few tens of kilobytes and writing it is not something the
 * chat waits for. Oldest go first.
 */
const KEEP = 1000;

export async function loadSeen(key: Uint8Array): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const ids = JSON.parse(unseal(key, raw)) as unknown;
    if (!Array.isArray(ids)) return [];
    return ids.filter((x): x is string => typeof x === 'string').slice(-KEEP);
  } catch {
    // Unreadable means a different vault wrote it, or it was damaged. An empty
    // list costs one window of replay protection; refusing to unlock over it
    // would cost the conversation.
    await AsyncStorage.removeItem(KEY).catch(() => {});
    return [];
  }
}

export async function saveSeen(key: Uint8Array, ids: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, seal(key, JSON.stringify(ids.slice(-KEEP))));
  } catch {
    // A list that fails to save means the next restart forgets a few ids. Not
    // worth interrupting a message that has already arrived.
  }
}

export async function clearSeen(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {}
}

/**
 * The remembered ids, and a cheap way to keep them.
 *
 * An ordered list beside the set, because eviction needs to know which is
 * oldest and a Set does not promise to tell you. Writing is left to the caller
 * to schedule — this gets touched once per arriving message, and a write per
 * message would be a write per message.
 */
export class SeenIds {
  private set: Set<string>;
  private order: string[];

  constructor(initial: string[] = []) {
    this.order = initial.slice(-KEEP);
    this.set = new Set(this.order);
  }

  has(id: string): boolean {
    return this.set.has(id);
  }

  /** True if this id is new, and it is now remembered. False if it was a repeat. */
  add(id: string): boolean {
    if (this.set.has(id)) return false;
    this.set.add(id);
    this.order.push(id);
    if (this.order.length > KEEP) {
      const gone = this.order.splice(0, this.order.length - KEEP);
      gone.forEach((old) => this.set.delete(old));
    }
    return true;
  }

  get ids(): string[] {
    return this.order;
  }

  get size(): number {
    return this.set.size;
  }
}
