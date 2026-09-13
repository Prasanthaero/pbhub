/** Persistence for the vault marker and its settings.
 *
 *  On disk this is: one blob of random-looking bytes, and one more blob of
 *  random-looking bytes. Nothing names a chat app, a relay, or a person.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { seal, unseal, toHex, type VaultBlob } from '../crypto/vault';
import { randomBytes } from '../crypto/random';

const MARKER_KEY = '@nt/idx';
const SETTINGS_KEY = '@nt/cache';

/**
 * The relay this build was made for.
 *
 * There used to be no default, on the reasoning that a hardcoded address means
 * funnelling other people's rendezvous through a machine they do not control.
 * That reasoning does not apply to a build made for one couple who own the
 * relay: asking them to type `wss://` and a hostname they have to go and look
 * up was the single most awkward thing in setting the app up, and it is the
 * same answer every time.
 *
 * Still editable in Settings, so moving the relay does not mean a new build.
 * Anyone forking this should put their own `server/` deployment here —
 * render.yaml is in the repo.
 */
export const DEFAULT_RELAY = 'wss://pbhub-7vob.onrender.com';

/** Shown as placeholder text, so the expected shape is obvious. */
export const RELAY_EXAMPLE = 'wss://your-relay.onrender.com';

/**
 * How two phones find a path to each other for a call.
 *
 * STUN alone was the bug behind "video call does not connect properly". STUN
 * only tells a phone what its address looks like from outside; that is enough
 * when the two can reach each other directly. On mobile data they usually
 * cannot — carriers put thousands of customers behind one shared address, and
 * neither phone can open a path to the other. With nothing else on the list
 * there is no route at all, and the call rings until somebody gives up.
 *
 * TURN is the fallback: a server both phones can reach, which forwards the
 * stream between them. These are Open Relay, a free public TURN service,
 * offered on 443 as well as the usual ports because a network that blocks
 * anything unusual rarely blocks 443.
 *
 * What a TURN server sees: both phones' addresses, when the call happened and
 * how much it carried. What it cannot see is the call — WebRTC encrypts audio
 * and video end to end with DTLS-SRTP, so a relay in the middle forwards noise.
 * It is only used when no direct path exists; a call on the same wifi will not
 * touch it.
 */
export const DEFAULT_ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  {
    urls: [
      'turn:standard.relay.metered.ca:80',
      'turn:standard.relay.metered.ca:80?transport=tcp',
      'turn:standard.relay.metered.ca:443',
      'turns:standard.relay.metered.ca:443?transport=tcp',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

/** True for a stored list that predates TURN being on it. */
export const stunOnly = (list: any[]): boolean =>
  Array.isArray(list)
  && list.length > 0
  && list.every((e) => !JSON.stringify(e?.urls ?? '').includes('turn'));

export type VaultSettings = {
  relayUrl: string;
  iceServers: any[];
  /** Wipe the conversation the moment the app leaves the foreground. */
  panicOnBackground: boolean;
  /**
   * Block screenshots and hide the app in the recents switcher.
   *
   * Off by default now, because it was on and getting in the way: you cannot
   * screenshot a conversation, screen record it, or show it on anything that
   * mirrors the display, and that is a real cost for two people who wanted to
   * keep a picture of something said to them. Still one switch away in Settings
   * for anyone who would rather the app could not be captured at all.
   */
  blockScreenshots: boolean;
  /**
   * Keep the conversation on this phone between sessions.
   *
   * Off, the app behaves as it always has: the chat lives in memory and closing
   * it erases the conversation from both phones. On, the text is written here
   * encrypted so it is waiting when you come back — which is what most people
   * mean by a chat app, and a real change in what a seized phone gives up.
   *
   * Media is never kept either way.
   */
  keepHistory: boolean;
  /**
   * Whether a partner has ever actually connected on this pairing.
   *
   * The way pairing goes wrong is quiet: both people tap "make one up", each
   * ends up in their own room, and both sit at "waiting for partner" forever
   * with nothing on screen suggesting they are not even in the same place.
   * Until this has been true once, the app says so plainly.
   */
  pairedOnce: boolean;
  /**
   * Tell them when their messages have been seen.
   *
   * On by default because that is what people expect of a chat, but it is a
   * switch: a read receipt says when you picked up your phone, which is a
   * little more than "delivered" and not everyone wants to send it. Turning it
   * off stops sending them; it does not stop receiving theirs.
   */
  sendReadReceipts: boolean;
  /**
   * A dot in the status bar when a message arrives while you are elsewhere.
   *
   * No banner, no preview, no sound — see net/notify.ts. It also only works
   * while the app is still alive in the background, which means it cannot be
   * combined with locking on background: that closes the connection, so there
   * is nothing left to be notified about.
   */
  quietNotifications: boolean;
  /**
   * A random id for this install, sent to the relay with every join.
   *
   * Its only job is letting the relay recognise a phone reconnecting and drop
   * that phone's own previous socket. Without it, restarting the app races its
   * own ghost and the owner is refused with "someone else is already using this
   * passphrase" — where the someone else was them.
   *
   * It says nothing about the person or the device: random bytes, stored
   * encrypted, and only ever seen by a relay that already sees the room id.
   */
  deviceId: string;
  /**
   * How long a message lives before it disappears from both phones.
   *
   * Milliseconds; 0 means it stays for the session. The choice travels with
   * each message rather than being applied at display time, so the two phones
   * cannot disagree — see Expiring in store/messages.ts.
   */
  messageTtl: number;
};

export const defaultSettings = (relayUrl = DEFAULT_RELAY): VaultSettings => ({
  relayUrl,
  iceServers: DEFAULT_ICE,
  panicOnBackground: true,
  blockScreenshots: false,
  keepHistory: false,
  pairedOnce: false,
  sendReadReceipts: true,
  quietNotifications: false,
  messageTtl: 0,
  deviceId: toHex(randomBytes(16)),
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

/** Destroy the vault outright. Afterwards the app is only ever a notes app.
 *  Everything the vault ever wrote goes with it — settings, history, the
 *  outbox and the status — or the leftovers would say what the app really is. */
export async function destroyVault(): Promise<void> {
  await AsyncStorage.multiRemove([
    MARKER_KEY, SETTINGS_KEY, '@nt/log', '@nt/pending', '@nt/mood',
  ]);
}

export async function readSettings(key: Uint8Array): Promise<VaultSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings();
    const stored = { ...defaultSettings(), ...JSON.parse(unseal(key, raw)) };
    if (!stored.deviceId) stored.deviceId = toHex(randomBytes(16));
    // A vault set up before TURN was on the list has the old one written into
    // it, and would go on failing to connect calls forever. Nobody chose that
    // list — it was only ever the default — so replacing it takes nothing away.
    if (stunOnly(stored.iceServers)) stored.iceServers = DEFAULT_ICE;
    return stored;
  } catch {
    return defaultSettings();
  }
}

export async function writeSettings(key: Uint8Array, s: VaultSettings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, seal(key, JSON.stringify(s)));
}
