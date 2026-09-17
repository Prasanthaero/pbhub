/**
 * How many wrong PINs in a row, and how long the door stays shut afterwards.
 *
 * Three wrong guesses closes the vault and drops whoever is holding the phone
 * back into the notes. That alone would be theatre — they could walk straight
 * back in and guess three more times — so the count is written down, and the
 * fourth attempt has to wait. The wait grows each time it happens.
 *
 * Deliberately not encrypted with the vault key: it has to be readable before
 * anything is unlocked, which is the whole point of it. It holds no secrets —
 * three numbers, under a name that looks like the rest of the notes app's
 * storage — and the worst anyone can do by clearing it is get their tries back,
 * which is exactly what reinstalling the app would give them anyway.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@nt/spell';

/** Wrong guesses allowed before the door shuts. */
export const MAX_TRIES = 3;

/** The wait after the first lockout, the second, and every one after that. */
const COOLOFF = [20_000, 60_000, 5 * 60_000];

export type Guard = {
  /** Wrong guesses since the last time it opened. */
  strikes: number;
  /** How many times three-in-a-row has happened. Sets the length of the wait. */
  rounds: number;
  /** Nothing may be tried before this moment. */
  until: number;
};

const EMPTY: Guard = { strikes: 0, rounds: 0, until: 0 };

export async function readGuard(): Promise<Guard> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const g = JSON.parse(raw) as Partial<Guard>;
    return {
      strikes: Number(g.strikes) || 0,
      rounds: Number(g.rounds) || 0,
      until: Number(g.until) || 0,
    };
  } catch {
    return EMPTY;
  }
}

async function write(g: Guard): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(g));
  } catch {
    // A counter that fails to save costs three extra guesses, which is not
    // worth failing an unlock over.
  }
}

/**
 * Record a wrong guess.
 *
 * Returns the state afterwards; `until` being in the future means that guess
 * was the third and the door is now shut.
 */
export async function strike(): Promise<Guard> {
  const g = await readGuard();
  const strikes = g.strikes + 1;

  if (strikes < MAX_TRIES) {
    const next = { ...g, strikes };
    await write(next);
    return next;
  }

  const rounds = g.rounds + 1;
  const wait = COOLOFF[Math.min(rounds - 1, COOLOFF.length - 1)];
  const next: Guard = { strikes: 0, rounds, until: Date.now() + wait };
  await write(next);
  return next;
}

/** A correct PIN forgives everything, including the waiting. */
export async function clearGuard(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {}
}

/** Milliseconds still to wait, or 0. */
export function waitLeft(g: Guard): number {
  // A clock moved backwards would otherwise lock someone out for years.
  const left = g.until - Date.now();
  if (left <= 0) return 0;
  const longest = COOLOFF[COOLOFF.length - 1];
  return Math.min(left, longest);
}

/** "20 seconds", "4 minutes" — for telling someone how long PB is sulking. */
export function waitWords(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return s + (s === 1 ? ' second' : ' seconds');
  const m = Math.ceil(s / 60);
  return m + (m === 1 ? ' minute' : ' minutes');
}
