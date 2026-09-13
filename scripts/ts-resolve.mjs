/**
 * Node's ESM resolver demands file extensions; Metro (which actually builds the
 * app) does not. This hook lets the Node-based tests import the app's modules
 * exactly as the app writes them, without littering `.ts` into source imports.
 */
import { register } from 'node:module';

register(new URL('./ts-resolve-hook.mjs', import.meta.url));
