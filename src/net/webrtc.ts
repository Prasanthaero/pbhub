/**
 * WebRTC, if this build has it.
 *
 * `react-native-webrtc` is native code. It is in the real app, and it is not in
 * Expo Go — Expo Go carries a fixed set of libraries and cannot be extended, so
 * importing it there throws while the app is still starting and nothing renders
 * at all.
 *
 * Loading it through here instead means the app comes up either way. Where
 * WebRTC is present, nothing changes: the two phones talk directly and can
 * call each other. Where it is absent, `available` is false, no peer connection
 * is ever built, and everything falls back to the path that already exists for
 * a partner who is not in the app — sealed messages and photos through the
 * relay. Text and pictures still work. Voice and video do not, and the buttons
 * for them stay greyed out, because there is no connection to carry them.
 *
 * Types come from the package as normal: `import type` is erased before any of
 * this runs, so it costs nothing at runtime.
 */
import type {
  MediaStream as MediaStreamType,
  RTCPeerConnection as RTCPeerConnectionType,
} from 'react-native-webrtc';

export type MediaStream = MediaStreamType;
export type RTCPeerConnection = RTCPeerConnectionType;

type WebRTC = typeof import('react-native-webrtc');

let mod: WebRTC | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  mod = require('react-native-webrtc') as WebRTC;
} catch {
  mod = null;
}

/** False in Expo Go, true in any real build of this app. */
export const available = mod !== null;

/** Throws only if something reaches for WebRTC without checking `available`. */
function need(): WebRTC {
  if (!mod) throw new Error('WebRTC is not available in this build');
  return mod;
}

export const RTCPeerConnectionCtor = () => need().RTCPeerConnection;
export const RTCSessionDescriptionCtor = () => need().RTCSessionDescription;
export const RTCIceCandidateCtor = () => need().RTCIceCandidate;
export const MediaStreamCtor = () => need().MediaStream;
export const mediaDevices = () => need().mediaDevices;

/** The remote/local video surface, or null where there is no WebRTC to show. */
export const RTCView = mod?.RTCView ?? null;
