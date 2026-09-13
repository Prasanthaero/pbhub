/**
 * Reliable delivery, without trusting the relay to remember anything.
 *
 * A message goes out three ways, in order of preference:
 *
 *   1. Straight down the WebRTC data channel, when the partner is here.
 *   2. Into the relay's mailbox, when they are not. The relay holds it in
 *      memory only, and drops it the moment it is collected.
 *   3. Back out again on the next connection, from this phone's own outbox,
 *      for anything that was never acknowledged.
 *
 * Step 3 is what makes step 2 safe to keep in memory. A relay restart — which
 * free hosting does constantly — costs a retry rather than a message.
 *
 * The outbox is encrypted with the vault key, so what sits on disk between
 * sends is ciphertext, and it is erased as soon as the receipt arrives.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { seal, unseal } from '../crypto/vault';

const KEY = '@nt/pending';

/** Give up on a message nobody ever collected, matching the relay's own TTL. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type Pending = {
  id: string;
  /** The sealed payload, exactly as it would go down the wire. */
  wire: string;
  at: number;
};

export async function loadOutbox(key: Uint8Array): Promise<Pending[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const items = JSON.parse(unseal(key, raw)) as Pending[];
    const now = Date.now();
    return items.filter((m) => now - m.at < MAX_AGE_MS);
  } catch {
    // Unreadable means a different vault or a corrupt write. Either way there
    // is nothing here we can send, and nothing worth keeping.
    return [];
  }
}

export async function saveOutbox(key: Uint8Array, items: Pending[]): Promise<void> {
  if (!items.length) {
    await AsyncStorage.removeItem(KEY);
    return;
  }
  await AsyncStorage.setItem(KEY, seal(key, JSON.stringify(items)));
}

/** Forget the outbox entirely — used when the vault is destroyed. */
export async function clearOutbox(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}
