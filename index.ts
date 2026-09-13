// Must come first: installs a real CSPRNG behind globalThis.crypto before any
// module that derives a key gets a chance to run.
import 'react-native-get-random-values';

import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
