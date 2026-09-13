import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RTCView, type MediaStream } from 'react-native-webrtc';
import { T } from '../theme';

export type CallState = 'outgoing' | 'incoming' | 'active';

type Props = {
  kind: 'audio' | 'video';
  state: CallState;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  muted: boolean;
  cameraOff: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onHangup: () => void;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onSwitchCamera: () => void;
};

export default function Call({
  kind, state, localStream, remoteStream, muted, cameraOff,
  onAccept, onDecline, onHangup, onToggleMute, onToggleCamera, onSwitchCamera,
}: Props) {
  const video = kind === 'video';
  const label =
    state === 'incoming' ? `Incoming ${video ? 'video' : 'voice'} call`
    : state === 'outgoing' ? 'Calling…'
    : video ? '' : 'Connected';

  return (
    <SafeAreaView style={s.wrap}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      {video && remoteStream ? (
        <RTCView streamURL={remoteStream.toURL()} objectFit="cover" style={StyleSheet.absoluteFill} />
      ) : (
        <View style={[StyleSheet.absoluteFill, s.audioBg]}>
          <View style={s.orb} />
        </View>
      )}

      {video && localStream && !cameraOff && (
        <RTCView streamURL={localStream.toURL()} objectFit="cover" style={s.pip} mirror />
      )}

      <View style={s.top}>
        {!!label && <Text style={s.label}>{label}</Text>}
        {state === 'active' && !video && <Text style={s.sub}>end-to-end encrypted</Text>}
      </View>

      <View style={s.controls}>
        {state === 'incoming' ? (
          <>
            <TouchableOpacity style={[s.round, { backgroundColor: T.danger }]} onPress={onDecline}>
              <Text style={s.roundText}>Decline</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.round, { backgroundColor: T.ok }]} onPress={onAccept}>
              <Text style={s.roundText}>Accept</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity style={[s.round, s.neutral, muted && s.on]} onPress={onToggleMute}>
              <Text style={s.roundText}>{muted ? 'Unmute' : 'Mute'}</Text>
            </TouchableOpacity>

            {video && (
              <>
                <TouchableOpacity style={[s.round, s.neutral, cameraOff && s.on]} onPress={onToggleCamera}>
                  <Text style={s.roundText}>{cameraOff ? 'Cam on' : 'Cam off'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.round, s.neutral]} onPress={onSwitchCamera}>
                  <Text style={s.roundText}>Flip</Text>
                </TouchableOpacity>
              </>
            )}

            <TouchableOpacity style={[s.round, { backgroundColor: T.danger }]} onPress={onHangup}>
              <Text style={s.roundText}>End</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#000', justifyContent: 'space-between' },
  audioBg: { backgroundColor: '#0B0E12', alignItems: 'center', justifyContent: 'center' },
  orb: {
    width: 140, height: 140, borderRadius: 70,
    backgroundColor: '#1A2230', borderWidth: 1, borderColor: '#2A3444',
  },
  pip: {
    position: 'absolute', right: 16, top: 60, width: 104, height: 156,
    borderRadius: 12, backgroundColor: '#111', overflow: 'hidden',
  },
  top: { alignItems: 'center', paddingTop: 28 },
  label: { color: '#fff', fontSize: 19, fontWeight: '600' },
  sub: { color: 'rgba(255,255,255,0.55)', fontSize: 12, marginTop: 6 },
  controls: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    gap: 12, paddingBottom: 44, paddingHorizontal: 12, flexWrap: 'wrap',
  },
  round: { paddingHorizontal: 18, paddingVertical: 14, borderRadius: 30, minWidth: 78, alignItems: 'center' },
  neutral: { backgroundColor: 'rgba(255,255,255,0.14)' },
  on: { backgroundColor: 'rgba(255,255,255,0.34)' },
  roundText: { color: '#fff', fontWeight: '600', fontSize: 14 },
});
