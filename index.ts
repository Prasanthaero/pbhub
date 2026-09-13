// Must come first: installs a real CSPRNG behind globalThis.crypto before any
// module that derives a key gets a chance to run.
//
// The polyfill is native code, so it is in the real app and may not be in a
// stripped-down host like Expo Go. expo-crypto is, and its getRandomValues is
// the same platform RNG by a different door. Never fall back to Math.random:
// this is what the pairing secret is made of, and a guessable pairing secret is
// no secret at all — better to refuse to start.
try {
  require('react-native-get-random-values');
} catch {
  const { getRandomValues } = require('expo-crypto');
  const g = globalThis as any;
  if (!g.crypto) g.crypto = {};
  g.crypto.getRandomValues = getRandomValues;
}

import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
