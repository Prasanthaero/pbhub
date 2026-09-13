import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList, Image,
  KeyboardAvoidingView, Platform, StatusBar, ActivityIndicator, Modal, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAudioRecorder, useAudioPlayer, RecordingPresets, setAudioModeAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import { useVideoPlayer, VideoView } from 'expo-video';
import { T } from '../theme';
import type { Msg } from '../store/messages';
import { STATUS_MAX_CHARS, timeLeft, isLive, type Status } from '../store/status';

type Props = {
  messages: Msg[];
  status: string;
  connected: boolean;
  relayUp: boolean;
  keepHistory: boolean;
  myStatus: Status | null;
  theirStatus: Status | null;
  sending: { id: string; progress: number } | null;
  onSend: (text: string) => void;
  onSetStatus: (text: string) => void;
  onPickPhoto: (fromCamera: boolean) => void;
  onPickVideo: (fromCamera: boolean) => void;
  onSendRecording: (uri: string, seconds: number) => void;
  onCall: (kind: 'audio' | 'video') => void;
  onLock: () => void;
  onSettings: () => void;
};

const clock = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const mb = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

/** One glyph for where an outgoing message got to. */
const tick = (d: Msg['delivery']) => {
  switch (d) {
    case 'delivered': return '✓✓';
    case 'held': return '✓';
    case 'failed': return '!';
    default: return '·';
  }
};

function VideoBubble({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = false; });
  return <VideoView style={s.media} player={player} nativeControls contentFit="cover" />;
}

function AudioBubble({ uri, duration, mine }: { uri: string; duration?: number; mine: boolean }) {
  const player = useAudioPlayer(uri);
  const [playing, setPlaying] = useState(false);

  const toggle = () => {
    if (playing) {
      player.pause();
      setPlaying(false);
    } else {
      player.seekTo(0);
      player.play();
      setPlaying(true);
    }
  };

  return (
    <TouchableOpacity style={s.audioRow} onPress={toggle} activeOpacity={0.7}>
      <View style={[s.playBtn, { backgroundColor: mine ? 'rgba(255,255,255,0.25)' : T.vaultLine }]}>
        <Text style={s.playIcon}>{playing ? '❚❚' : '▶'}</Text>
      </View>
      <View style={s.waveform}>
        {Array.from({ length: 18 }, (_, i) => (
          <View
            key={i}
            style={[s.waveBar, { height: 5 + ((i * 7) % 17), opacity: playing ? 1 : 0.55 }]}
          />
        ))}
      </View>
      <Text style={s.audioTime}>{duration ? `${Math.round(duration)}s` : ''}</Text>
    </TouchableOpacity>
  );
}

export default function Chat({
  messages, status, connected, relayUp, keepHistory, myStatus, theirStatus, sending,
  onSend, onSetStatus, onPickPhoto, onPickVideo, onSendRecording,
  onCall, onLock, onSettings,
}: Props) {
  const [draft, setDraft] = useState('');
  const [attachOpen, setAttachOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [statusDraft, setStatusDraft] = useState('');
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [viewing, setViewing] = useState<Msg | null>(null);

  const listRef = useRef<FlatList<Msg>>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recStarted = useRef(0);

  // Tick the recording timer so it is obvious something is being captured.
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setRecSeconds((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  const send = () => {
    const t = draft.trim();
    if (!t) return;
    onSend(t);
    setDraft('');
  };

  const startRecording = async () => {
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Microphone needed', 'Allow microphone access to record a voice note.');
      return;
    }
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      recStarted.current = Date.now();
      setRecSeconds(0);
      setRecording(true);
    } catch {
      Alert.alert('Could not record', 'Something went wrong starting the recorder.');
    }
  };

  const stopRecording = async (keep: boolean) => {
    setRecording(false);
    try {
      await recorder.stop();
      const seconds = (Date.now() - recStarted.current) / 1000;
      const uri = recorder.uri;
      // Under a second is almost always a mis-tap, not a message.
      if (keep && uri && seconds >= 1) onSendRecording(uri, seconds);
    } catch {
      // Nothing usable; silently drop it rather than alarm anyone.
    }
  };

  const openStatus = () => {
    setStatusDraft(myStatus?.text ?? '');
    setStatusOpen(true);
  };

  const saveStatus = () => {
    onSetStatus(statusDraft);
    setStatusOpen(false);
  };

  const dot = connected ? T.ok : relayUp ? T.accent : T.vaultInkSoft;

  return (
    <SafeAreaView style={s.wrap} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor={T.vaultBg} />

      <View style={s.bar}>
        <TouchableOpacity onPress={onLock} hitSlop={12}>
          <Text style={s.lock}>Close</Text>
        </TouchableOpacity>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, justifyContent: 'center' }}>
          <View style={[s.dot, { backgroundColor: dot }]} />
          <Text style={s.status} numberOfLines={1}>{status}</Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 14 }}>
          <TouchableOpacity onPress={() => onCall('audio')} disabled={!connected} hitSlop={8}>
            <Text style={[s.icon, !connected && s.iconOff]}>Call</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onCall('video')} disabled={!connected} hitSlop={8}>
            <Text style={[s.icon, !connected && s.iconOff]}>Video</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onSettings} hitSlop={8}>
            <Text style={s.icon}>•••</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Status strip: theirs on the left, yours tappable on the right. */}
      <View style={s.statusBar}>
        <View style={{ flex: 1 }}>
          {isLive(theirStatus) ? (
            <>
              <Text style={s.theirStatus} numberOfLines={2}>{theirStatus.text}</Text>
              <Text style={s.statusMeta}>{timeLeft(theirStatus)}</Text>
            </>
          ) : (
            <Text style={s.noStatus}>No status from them</Text>
          )}
        </View>
        <TouchableOpacity style={s.statusBtn} onPress={openStatus}>
          <Text style={s.statusBtnText}>
            {isLive(myStatus) ? 'Your status' : 'Set status'}
          </Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={8}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 14, paddingBottom: 8 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          ListHeaderComponent={
            <Text style={s.preamble}>
              {keepHistory
                ? 'This chat is kept on your phone, encrypted. Photos and voice notes never are.'
                : 'Nothing here is saved. Close the app and this conversation is gone from both phones.'}
            </Text>
          }
          renderItem={({ item }) => {
            if (item.kind === 'system') return <Text style={s.system}>{item.body}</Text>;

            const mine = item.kind === 'out';
            const m = item.media;

            return (
              <View style={[s.row, { justifyContent: mine ? 'flex-end' : 'flex-start' }]}>
                <View style={[s.bubble, mine ? s.mine : s.theirs, m ? s.bubbleMedia : null]}>
                  {m?.kind === 'photo' && (
                    <TouchableOpacity onPress={() => setViewing(item)} activeOpacity={0.9}>
                      <Image source={{ uri: m.uri }} style={s.media} resizeMode="cover" />
                    </TouchableOpacity>
                  )}
                  {m?.kind === 'video' && <VideoBubble uri={m.uri} />}
                  {m?.kind === 'audio' && (
                    <AudioBubble uri={m.uri} duration={m.duration} mine={mine} />
                  )}

                  {!m && item.progress !== undefined && (
                    <View style={s.incomingMedia}>
                      <ActivityIndicator color="#fff" />
                      <Text style={s.progressText}>
                        {Math.round(item.progress * 100)}%
                      </Text>
                    </View>
                  )}

                  {!!item.body && <Text style={s.msg}>{item.body}</Text>}

                  <View style={s.meta}>
                    {!!m && <Text style={s.metaSize}>{mb(m.bytes)}</Text>}
                    <Text style={s.time}>{clock(item.at)}</Text>
                    {mine && <Text style={s.tick}>{tick(item.delivery)}</Text>}
                  </View>

                  {mine && item.progress !== undefined && (
                    <View style={s.progressTrack}>
                      <View style={[s.progressFill, { width: `${item.progress * 100}%` }]} />
                    </View>
                  )}
                </View>
              </View>
            );
          }}
        />

        {recording ? (
          <View style={s.recBar}>
            <View style={s.recDot} />
            <Text style={s.recText}>Recording  {recSeconds}s</Text>
            <TouchableOpacity onPress={() => stopRecording(false)} hitSlop={10}>
              <Text style={s.recCancel}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.recSend} onPress={() => stopRecording(true)}>
              <Text style={s.sendText}>Send</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={s.composer}>
            <TouchableOpacity style={s.attach} onPress={() => setAttachOpen(true)} hitSlop={8}>
              <Text style={s.attachIcon}>+</Text>
            </TouchableOpacity>

            <TextInput
              style={s.input}
              value={draft}
              onChangeText={setDraft}
              placeholder={connected ? 'Message' : relayUp ? 'They will get it when they open the app' : 'Offline'}
              placeholderTextColor={T.vaultInkSoft}
              multiline
              autoCorrect={false}
            />

            {draft.trim() ? (
              <TouchableOpacity style={s.send} onPress={send}>
                <Text style={s.sendText}>Send</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={s.send} onPress={startRecording}>
                <Text style={s.sendText}>Hold</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </KeyboardAvoidingView>

      {/* Attachment sheet */}
      <Modal visible={attachOpen} transparent animationType="slide" onRequestClose={() => setAttachOpen(false)}>
        <TouchableOpacity style={s.sheetBg} activeOpacity={1} onPress={() => setAttachOpen(false)}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>Send</Text>
            <Text style={s.sheetNote}>
              These go straight between the phones — you both need to be in the app. They are
              never saved, on either side.
            </Text>
            {([
              ['Photo from gallery', () => onPickPhoto(false)],
              ['Take a photo', () => onPickPhoto(true)],
              ['Video from gallery', () => onPickVideo(false)],
              ['Record a video', () => onPickVideo(true)],
            ] as const).map(([label, fn]) => (
              <TouchableOpacity
                key={label}
                style={s.sheetItem}
                onPress={() => { setAttachOpen(false); fn(); }}
              >
                <Text style={s.sheetItemText}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Status composer */}
      <Modal visible={statusOpen} transparent animationType="fade" onRequestClose={() => setStatusOpen(false)}>
        <View style={s.sheetBg}>
          <View style={s.statusCard}>
            <Text style={s.sheetTitle}>Your status</Text>
            <Text style={s.sheetNote}>
              Saved on this phone only, encrypted, and sent to your partner when you are both
              here. It disappears by itself after a day.
            </Text>
            <TextInput
              style={s.statusInput}
              value={statusDraft}
              onChangeText={(t) => setStatusDraft(t.slice(0, STATUS_MAX_CHARS))}
              placeholder="thinking of you"
              placeholderTextColor={T.vaultInkSoft}
              multiline
              autoFocus
            />
            <Text style={s.counter}>{statusDraft.length}/{STATUS_MAX_CHARS}</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                style={[s.statusAction, { borderColor: T.vaultLine }]}
                onPress={() => { setStatusDraft(''); onSetStatus(''); setStatusOpen(false); }}
              >
                <Text style={{ color: T.vaultInkSoft, fontWeight: '600' }}>Clear</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.statusAction, { backgroundColor: T.mine, borderColor: T.mine }]}
                onPress={saveStatus}
              >
                <Text style={{ color: '#fff', fontWeight: '600' }}>Save</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={() => setStatusOpen(false)} style={{ marginTop: 14 }}>
              <Text style={{ color: T.vaultInkSoft, textAlign: 'center' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Full-screen photo */}
      <Modal visible={!!viewing} transparent animationType="fade" onRequestClose={() => setViewing(null)}>
        <TouchableOpacity style={s.viewer} activeOpacity={1} onPress={() => setViewing(null)}>
          {viewing?.media && (
            <Image source={{ uri: viewing.media.uri }} style={s.viewerImage} resizeMode="contain" />
          )}
          <Text style={s.viewerHint}>Tap to close</Text>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: T.vaultBg },
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: T.vaultLine,
  },
  lock: { color: T.vaultInkSoft, fontSize: 15 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  status: { color: T.vaultInkSoft, fontSize: 12 },
  icon: { color: T.vaultInk, fontSize: 14, fontWeight: '600' },
  iconOff: { color: T.vaultInkSoft, opacity: 0.5 },

  statusBar: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: T.vaultLine,
    backgroundColor: T.vaultCard,
  },
  theirStatus: { color: T.vaultInk, fontSize: 14, lineHeight: 19 },
  statusMeta: { color: T.vaultInkSoft, fontSize: 11, marginTop: 2 },
  noStatus: { color: T.vaultInkSoft, fontSize: 13, fontStyle: 'italic' },
  statusBtn: {
    borderWidth: 1, borderColor: T.accent, borderRadius: 16,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  statusBtnText: { color: T.accent, fontSize: 12.5, fontWeight: '600' },

  preamble: {
    color: T.vaultInkSoft, fontSize: 12, textAlign: 'center',
    marginBottom: 18, marginTop: 6, paddingHorizontal: 20, lineHeight: 18,
  },
  system: { color: T.vaultInkSoft, fontSize: 12, textAlign: 'center', marginVertical: 8 },
  row: { flexDirection: 'row', marginBottom: 8 },
  bubble: { maxWidth: '78%', borderRadius: 16, paddingHorizontal: 13, paddingVertical: 9 },
  bubbleMedia: { paddingHorizontal: 5, paddingVertical: 5 },
  mine: { backgroundColor: T.mine, borderBottomRightRadius: 5 },
  theirs: { backgroundColor: T.theirs, borderBottomLeftRadius: 5 },
  msg: { color: '#fff', fontSize: 15.5, lineHeight: 21 },

  media: { width: 220, height: 220, borderRadius: 12, backgroundColor: '#000' },
  incomingMedia: {
    width: 220, height: 140, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  progressText: { color: '#fff', fontSize: 12 },
  progressTrack: {
    height: 3, backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 2, marginTop: 6,
    marginHorizontal: 8, overflow: 'hidden',
  },
  progressFill: { height: 3, backgroundColor: '#fff' },

  audioRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8, paddingVertical: 6, minWidth: 200 },
  playBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  playIcon: { color: '#fff', fontSize: 13 },
  waveform: { flexDirection: 'row', alignItems: 'center', gap: 3, flex: 1 },
  waveBar: { width: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.85)' },
  audioTime: { color: 'rgba(255,255,255,0.75)', fontSize: 11 },

  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6, marginTop: 4, paddingHorizontal: 8 },
  metaSize: { color: 'rgba(255,255,255,0.5)', fontSize: 10 },
  time: { color: 'rgba(255,255,255,0.55)', fontSize: 10 },
  tick: { color: 'rgba(255,255,255,0.75)', fontSize: 10 },

  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 10, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: T.vaultLine,
  },
  attach: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: T.vaultCard,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: T.vaultLine,
  },
  attachIcon: { color: T.vaultInk, fontSize: 22, lineHeight: 25 },
  input: {
    flex: 1, maxHeight: 120, backgroundColor: T.vaultCard, borderRadius: 20,
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10,
    color: T.vaultInk, fontSize: 15.5, borderWidth: 1, borderColor: T.vaultLine,
  },
  send: { backgroundColor: T.mine, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 11 },
  sendText: { color: '#fff', fontWeight: '600', fontSize: 14 },

  recBar: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    borderTopWidth: 1, borderTopColor: T.vaultLine, backgroundColor: T.vaultCard,
  },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: T.danger },
  recText: { color: T.vaultInk, fontSize: 15, flex: 1 },
  recCancel: { color: T.vaultInkSoft, fontSize: 14 },
  recSend: { backgroundColor: T.mine, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10 },

  sheetBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: T.vaultCard, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 22, paddingBottom: 40, borderTopWidth: 1, borderColor: T.vaultLine,
  },
  sheetTitle: { color: T.vaultInk, fontSize: 19, fontWeight: '700' },
  sheetNote: { color: T.vaultInkSoft, fontSize: 12.5, lineHeight: 18, marginTop: 8, marginBottom: 16 },
  sheetItem: { paddingVertical: 15, borderTopWidth: 1, borderTopColor: T.vaultLine },
  sheetItemText: { color: T.vaultInk, fontSize: 16 },

  statusCard: {
    backgroundColor: T.vaultCard, margin: 20, borderRadius: 18, padding: 22,
    borderWidth: 1, borderColor: T.vaultLine, marginBottom: 'auto', marginTop: 'auto',
  },
  statusInput: {
    backgroundColor: T.vaultBg, borderRadius: 12, padding: 14, minHeight: 90,
    color: T.vaultInk, fontSize: 16, borderWidth: 1, borderColor: T.vaultLine,
    textAlignVertical: 'top',
  },
  counter: { color: T.vaultInkSoft, fontSize: 11, textAlign: 'right', marginTop: 6, marginBottom: 14 },
  statusAction: {
    flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center',
  },

  viewer: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  viewerImage: { width: '100%', height: '85%' },
  viewerHint: { color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 12 },
});
