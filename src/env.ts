/**
 * Which shell the app is running inside.
 *
 * Expo Go is somebody else's app with our JavaScript loaded into it. That makes
 * it a fine way to look at screens while editing code on a PC, and a poor way to
 * judge anything that lives below JavaScript — the activity, its window, and how
 * that window treats the keyboard and the navigation bar all belong to Expo Go,
 * not to us. In particular plugins/withKeyboardInsets.js is not there, so the
 * app has to do that work itself in JavaScript while it is a guest.
 *
 * Used only to decide who handles a layout inset. Nothing about privacy or
 * encryption branches on this.
 */
import Constants, { ExecutionEnvironment } from 'expo-constants';

export const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
