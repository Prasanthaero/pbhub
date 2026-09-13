/** Persistence for the vault marker and its settings.
 *
 *  On disk this is: one blob of random-looking bytes, and one more blob of
 *  random-looking bytes. Nothing names a chat app, a relay, or a person.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { seal, unseal, type VaultBlob } from '../crypto/vault';

const MARKER_KEY = '@nt/idx';
const SETTINGS_KEY = '@nt/cache';

/**
 * There is no default relay on purpose.
 *
 * Shipping someone else's address here would mean every pair of users funnels
 * their rendezvous through a machine none of them control, and a hardcoded
 * URL that later goes dark would break the app silently. Deploy `server/`
 * somewhere (render.yaml is in the repo) and enter that address during setup.
 */
export const DEFAULT_RELAY = '';

/** Shown as placeholder text, so the expected shape is obvious. */
export const RELAY_EXAMPLE = 'wss://your-relay.onrender.com';

export const DEFAULT_ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export type VaultSettings = {
  relayUrl: string;
  iceServers: any[];
  /** Wipe the conversation the moment the app leaves the foreground. */
  panicOnBackground: boolean;
  /** Block screenshots and hide the app in the recents switcher. */
  blockScreenshots: boolean;
};

export const defaultSettings = (relayUrl = DEFAULT_RELAY): VaultSettings => ({
  relayUrl,
  iceServers: DEFAULT_ICE,
  panicOnBackground: true,
  blockScreenshots: true,
});

export async function readMarker(): Promise<VaultBlob | null> {
  try {
    const raw = await AsyncStorage.getItem(MARKER_KEY);
    return raw ? (JSON.parse(raw) as VaultBlob) : null;
  } catch {
    return null;
  }
}

export async function writeMarker(blob: VaultBlob): Promise<void> {
  await AsyncStorage.setItem(MARKER_KEY, JSON.stringify(blob));
}

/** Destroy the vault outright. Afterwards the app is only ever a notes app. */
export async function destroyVault(): Promise<void> {
  await AsyncStorage.multiRemove([MARKER_KEY, SETTINGS_KEY]);
}

export async function readSettings(key: Uint8Array): Promise<VaultSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings();
    return { ...defaultSettings(), ...JSON.parse(unseal(key, raw)) };
  } catch {
    return defaultSettings();
  }
}

export async function writeSettings(key: Uint8Array, s: VaultSettings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, seal(key, JSON.stringify(s)));
}
