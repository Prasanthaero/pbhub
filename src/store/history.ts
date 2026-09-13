/**
 * Optional chat history.
 *
 * Off by default, and the app works exactly as before when it is off: messages
 * live in a JavaScript array and closing the app erases them from both phones.
 *
 * Turned on, the conversation is written to this phone encrypted under the
 * vault key, so it is there when you come back. That is a real change in what a
 * seized phone gives up, which is why it is a switch the two of you set
 * deliberately rather than a default someone discovers later.
 *
 * Media never goes in here. Photos, video and voice notes stay in memory
 * whatever this setting says — they are the bulky, incriminating part, and
 * keeping them would turn a notes app into an evidence locker.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { seal, unseal } from '../crypto/vault';
import type { Msg } from './messages';

const KEY = '@nt/log';

/** Keep the file bounded; a couple's chat is long and a phone is small. */
const MAX_MESSAGES = 2000;

export async function loadHistory(key: Uint8Array): Promise<Msg[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(unseal(key, raw)) as Msg[];
  } catch {
    return [];
  }
}

export async function saveHistory(key: Uint8Array, messages: Msg[]): Promise<void> {
  // System notices ("connected", "call ended") are noise once the moment has
  // passed, and media is deliberately never persisted.
  const keep = messages
    .filter((m) => m.kind !== 'system' && !m.media)
    .slice(-MAX_MESSAGES);

  if (!keep.length) {
    await AsyncStorage.removeItem(KEY);
    return;
  }
  await AsyncStorage.setItem(KEY, seal(key, JSON.stringify(keep)));
}

export async function clearHistory(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}
