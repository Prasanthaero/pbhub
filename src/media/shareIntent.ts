/**
 * The Android share sheet, if this build has it.
 *
 * `expo-share-intent` is native code and is not in Expo Go, where importing it
 * throws while the app is still starting. Loaded through a guard, the app comes
 * up either way — in a real build another app's Share button can hand a picture
 * or a link straight into the chat, and in Expo Go that simply never happens.
 *
 * The fallback is a hook-shaped function returning a constant. It calls no
 * hooks of its own, so swapping one for the other cannot break the rules about
 * calling hooks unconditionally.
 */
import type { ShareIntent } from 'expo-share-intent';

type Result = {
  hasShareIntent: boolean;
  shareIntent: ShareIntent;
  resetShareIntent: (clearNativeModule?: boolean) => void;
};

type Options = { resetOnBackground?: boolean };

const NOTHING: ShareIntent = { files: null, type: null, webUrl: null, text: null, meta: null };

let real: ((o?: Options) => Result) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  real = require('expo-share-intent').useShareIntent as (o?: Options) => Result;
} catch {
  real = null;
}

export const shareIntentAvailable = real !== null;

export const useShareIntent: (o?: Options) => Result =
  real ?? (() => ({ hasShareIntent: false, shareIntent: NOTHING, resetShareIntent: () => {} }));
