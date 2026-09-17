import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList, Image, ScrollView,
  StatusBar, ActivityIndicator, Modal, Alert, Platform, Dimensions, useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardInset } from './useKeyboardInset';
import { inExpoGo } from '../env';
import {
  useAudioRecorder, useAudioPlayer, RecordingPresets,
  setAudioModeAsync, requestRecordingPermissionsAsync,
} from 'expo-audio';
import { useVideoPlayer, VideoView } from 'expo-video';
import { T } from '../theme';
import type { Msg } from '../store/messages';
import PBBot, { PB_LINES, type PBMood } from '../ui/PBBot';
import {
  STATUS_MAX_CHARS, STATUS_VIDEO_SECONDS, timeLeft, isLiveItem, type StatusItem,
} from '../store/status';

type Props = {
  messages: Msg[];
  status: string;
  connected: boolean;
  /** The relay says the other phone is in the app. */
  peerPresent: boolean;
  /** When they were last in it, if this session saw them go. */
  lastSeen: number | null;
  /** They are writing something right now. */
  theirTyping: boolean;
  /** Tell them we are, or have stopped. Throttled on the other side. */
  onTyping: (on: boolean) => void;
  relayUp: boolean;
  keepHistory: boolean;
  /** False until a partner has actually connected at least once. */
  pairedOnce: boolean;
  myStatuses: StatusItem[];
  theirStatuses: StatusItem[];
  sending: { id: string; progress: number } | null;
  onSend: (text: string) => void;
  onAddTextStatus: (text: string) => void;
  onAddStatusMedia: (kind: 'photo' | 'video') => void;
  onRemoveStatus: (id: string) => void;
  /** Ask the partner for the bytes of one of theirs, when it is opened. */
  onWantStatusMedia: (id: string) => void;
  /** Read one of ours back off disk, for looking at it again. */
  onLoadMyStatusMedia: (id: string) => void;
  /** Report which of their messages are on screen. */
  onMarkSeen: (ids: string[]) => void;
  onDeleteMessages: (ids: string[], forBoth: boolean) => void;
  onClearChat: (forBoth: boolean) => void;
  onPickPhoto: (fromCamera: boolean) => void;
  /** Arm or disarm one-look-only before a photo is picked. */
  onSetOnce: (on: boolean) => void;
  /** A one-look photo has been opened; drop its bytes on this phone. */
  onBurn: (id: string) => void;
  onPickVideo: (fromCamera: boolean) => void;
  onSendRecording: (uri: string, seconds: number) => void;
  onCall: (kind: 'audio' | 'video') => void;
  onLock: () => void;
  onSettings: () => void;
};

/**
 * The gap left under the message box.
 *
 * Enough that it is clearly sitting above the keyboard and the navigation
 * buttons rather than touching them — flush against the keys reads as a box
 * about to be swallowed by them. Applied everywhere, so the real app and Expo
 * Go agree; what differs between them is only who works out where the keyboard
 * and the navigation bar are.
 */
const BREATHING_ROOM = 40;

/**
 * "last seen 12:30 AM", with the day added once it is no longer today.
 *
 * Built only from what this phone watched happen. The relay already tells each
 * side when the other arrives and leaves — this is that, remembered. Nothing
 * extra is sent to produce it and nothing is written down, so it lasts as long
 * as the app is open and no longer.
 */
const seenAt = (ts: number): string => {
  const then = new Date(ts);
  const today = new Date().toDateString() === then.toDateString();
  const time = then.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (today) return time;
  const day = then.toLocaleDateString([], { day: 'numeric', month: 'short' });
  return `${day}, ${time}`;
};

const clock = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const size = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

/** One glyph for where an outgoing message got to. */
const tick = (d: Msg['delivery']) => {
  switch (d) {
    // Two ticks mean read, and nothing else. Delivered and waiting-on-the-relay
    // are both one tick: from the sender's side they are the same fact — it has
    // left, and nobody has looked at it yet.
    case 'read': return '✓✓';
    case 'delivered':
    case 'held': return '✓';
    case 'failed': return '!';
    default: return '·';
  }
};

/** Read is the same two ticks, in green. Colour carries the difference so the
 *  glyph does not have to grow a third form nobody would recognise. */
const tickColour = (d: Msg['delivery']) =>
  d === 'read' ? T.ok : d === 'failed' ? T.danger : 'rgba(255,255,255,0.75)';

function VideoBubble({ uri, style }: { uri: string; style?: any }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = false; });
  return <VideoView style={style ?? s.media} player={player} nativeControls contentFit="contain" />;
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

/** A single circle in the status row. */
function StatusBubble({
  item, label, onPress,
}: { item?: StatusItem; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={s.ringWrap} onPress={onPress} activeOpacity={0.8}>
      <View style={[s.ring, item ? s.ringLive : s.ringEmpty]}>
        {item?.uri && item.kind === 'photo' ? (
          <Image source={{ uri: item.uri }} style={s.ringImage} />
        ) : (
          <Text style={s.ringGlyph}>
            {!item ? '+' : item.kind === 'video' ? '▶' : item.kind === 'photo' ? '◈' : 'Aa'}
          </Text>
        )}
      </View>
      <Text style={s.ringLabel} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function Chat({
  messages, status, connected, peerPresent, lastSeen, theirTyping, onTyping,
  relayUp, keepHistory, pairedOnce,
  myStatuses, theirStatuses, sending,
  onSend, onAddTextStatus, onAddStatusMedia, onRemoveStatus, onWantStatusMedia,
  onLoadMyStatusMedia, onMarkSeen, onDeleteMessages, onClearChat,
  onPickPhoto, onPickVideo, onSendRecording, onCall, onLock, onSettings,
  onSetOnce, onBurn,
}: Props) {
  const [draft, setDraft] = useState('');
  const [attachOpen, setAttachOpen] = useState(false);
  const [addStatusOpen, setAddStatusOpen] = useState(false);
  const [statusDraft, setStatusDraft] = useState('');
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [viewing, setViewing] = useState<Msg | null>(null);
  /** Armed in the attach sheet: the next photo is one look only. */
  const [once, setOnce] = useState(false);

  /** Which list is open in the story viewer, and where we are in it. */
  const [story, setStory] = useState<{ mine: boolean; index: number } | null>(null);

  /** Messages picked out for deletion. Empty means normal mode. */
  const [selected, setSelected] = useState<Set<string>>(new Set());

  /** Hide the status row while the keyboard is up, so the chat keeps the room. */
  const [typing, setTyping] = useState(false);

  /** PB, once the door is behind us. Poke him while you wait for a reply. */
  const [pbMood, setPbMood] = useState<PBMood>('idle');
  const [pbSay, setPbSay] = useState('');
  const [pbBeat, setPbBeat] = useState(0);
  const [pbGone, setPbGone] = useState(false);
  const pbTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pbLast = useRef(-1);

  /** How far the message box has to rise to clear the keyboard. */
  const { inset, onLayout } = useKeyboardInset();

  /**
   * And how far to clear the navigation bar underneath it.
   *
   * A real build has nothing to do here — the activity already sits above the
   * navigation bar. As a guest in Expo Go the app draws to the very bottom of
   * the screen, which put the message box and Send button half behind the
   * navigation buttons.
   *
   * Three readings, largest wins, because no single one of them can be trusted
   * in that position: the safe-area inset, which is right when the provider has
   * measured and zero when it has not; the gap between the screen and the
   * window, which is right when the window is not drawing edge to edge; and a
   * floor, because every Android phone has a bar or a gesture strip down there
   * and none of them is thinner than this. Then a little more on top, so the
   * Send button is clearly above the buttons rather than touching them.
   *
   * The keyboard, when it is up, covers that bar anyway — so it is whichever of
   * the two is taller, never both.
   */
  const safeBottom = useSafeAreaInsets().bottom;
  const win = useWindowDimensions();
  const systemBars = Math.max(
    0,
    Dimensions.get('screen').height - win.height - (StatusBar.currentHeight ?? 0),
  );
  const navBar = Math.max(safeBottom, systemBars, Platform.OS === 'android' ? 28 : 0);
  const bottomPad = (inExpoGo ? Math.max(inset, navBar) : inset) + BREATHING_ROOM;

  const listRef = useRef<FlatList<Msg>>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recStarted = useRef(0);

  // When the keyboard opens, the last message should still be the one you are
  // looking at — not scrolled off behind it.
  useEffect(() => {
    if (inset > 0) {
      const t = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);
      return () => clearTimeout(t);
    }
  }, [inset]);

  const mine = myStatuses.filter(isLiveItem);
  const theirs = theirStatuses.filter(isLiveItem);
  const storyList = story ? (story.mine ? mine : theirs) : [];
  const storyItem = story ? storyList[story.index] : undefined;

  // Tick the recording timer so it is obvious something is being captured.
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setRecSeconds((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  // Fetch the bytes only when a status is actually opened — several clips would
  // be a long silent transfer on connect, most of which is never looked at.
  useEffect(() => {
    if (!storyItem || storyItem.uri || storyItem.kind === 'text') return;
    if (story?.mine) onLoadMyStatusMedia(storyItem.id);
    else onWantStatusMedia(storyItem.id);
  }, [storyItem, story?.mine, onLoadMyStatusMedia, onWantStatusMedia]);

  // Their messages are on screen the moment this list renders them — there is
  // no background delivery here, so being sent one and reading it are the same
  // moment. Reported once per id; the parent keeps the record.
  useEffect(() => {
    const ids = messages.filter((x) => x.kind === 'in').map((x) => x.id);
    if (ids.length) onMarkSeen(ids);
  }, [messages, onMarkSeen]);

  const send = () => {
    const t = draft.trim();
    if (!t) return;
    onSend(t);
    setDraft('');
    // The message itself says everything the typing signal was saying.
    onTyping(false);
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

  // ---- selecting and deleting ---------------------------------------------
  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /**
   * Deleting on both phones is a request, not a guarantee, and the wording says
   * so. It only lands if their app is open to receive it — nothing here can
   * reach a phone that is switched off, and implying otherwise would be the
   * kind of promise this app should not make.
   */
  /**
   * Taking something back, and how far back it can go.
   *
   * You can always empty your own phone. Reaching into theirs is only offered
   * for messages you wrote: removing something they received from their phone
   * is not deleting your message, it is editing their side of a conversation.
   * So the second button appears only when every chosen message is one of ours,
   * and the wording says what will actually happen.
   */
  const deletePrompt = (
    title: string,
    run: (forBoth: boolean) => void,
    canReachTheirs: boolean,
  ) => {
    Alert.alert(
      title,
      canReachTheirs
        ? 'Taking it off their phone too needs their app to be open, or it happens when they next open it.'
        : 'This can only empty your own phone. Messages they sent stay on theirs — only they can take those back.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Just here', onPress: () => run(false) },
        ...(canReachTheirs
          ? [{ text: 'Both phones', style: 'destructive' as const, onPress: () => run(true) }]
          : []),
      ],
    );
  };

  const confirmDelete = () => {
    const ids = [...selected];
    // Only our own can be taken off their phone as well.
    const allMine = messages.filter((m) => selected.has(m.id)).every((m) => m.kind === 'out');
    deletePrompt(`Delete ${ids.length} message${ids.length === 1 ? '' : 's'}?`, (forBoth) => {
      onDeleteMessages(ids, forBoth);
      setSelected(new Set());
    }, allMine);
  };

  const confirmClear = () =>
    deletePrompt(
      'Clear the whole conversation?',
      (forBoth) => onClearChat(forBoth),
      // Clearing always empties this phone. "Both phones" is still offered,
      // and reaches only as far as the messages we sent.
      messages.some((m) => m.kind === 'out'),
    );

  const selecting = selected.size > 0;

  /** A poke: he says one thing, throws a few hearts, and settles down again. */
  const pokePB = () => {
    let i = Math.floor(Math.random() * PB_LINES.length);
    if (i === pbLast.current) i = (i + 1) % PB_LINES.length;
    pbLast.current = i;
    setPbSay(PB_LINES[i]);
    setPbMood(Math.random() < 0.4 ? 'happy' : 'love');
    setPbBeat((b) => b + 1);
    if (pbTimer.current) clearTimeout(pbTimer.current);
    pbTimer.current = setTimeout(() => { setPbSay(''); setPbMood('idle'); }, 2600);
  };

  /** Held down by mistake is the usual reason, so this asks first. */
  const hidePB = () => {
    Alert.alert(
      'Send PB away?',
      'He comes back the next time you open the chat.',
      [
        { text: 'Keep him' },
        {
          text: 'Hide',
          style: 'destructive',
          onPress: () => { setPbSay(''); setPbGone(true); },
        },
      ],
    );
  };

  // He notices when the other one starts writing, which is usually a second or
  // two before anything appears.
  useEffect(() => {
    if (!theirTyping || pbGone) return;
    setPbMood('happy');
    setPbSay('they are writing');
    setPbBeat((b) => b + 1);
    if (pbTimer.current) clearTimeout(pbTimer.current);
    pbTimer.current = setTimeout(() => { setPbSay(''); setPbMood('idle'); }, 2600);
  }, [theirTyping, pbGone]);

  useEffect(() => () => { if (pbTimer.current) clearTimeout(pbTimer.current); }, []);
  /**
   * What the line at the top says, and what colour the dot is.
   *
   * The words follow the relay: it knows whether the other phone is in the app,
   * and that does not flicker. The colour follows the direct connection, which
   * does — green when the two phones are talking to each other, amber while
   * everything is going by way of the relay. Both are true at once and neither
   * is alarming, so only the dot moves.
   *
   * This used to key the words off the direct connection, so every time the
   * channel blinked the chat announced that the other person had left.
   */
  const heading = theirTyping && peerPresent
    ? 'typing…'
    : peerPresent
    ? 'online'
    : lastSeen
      ? `last seen ${seenAt(lastSeen)}`
      : relayUp
        ? 'They are away — messages will wait'
        : status;
  const dot = connected ? T.ok : peerPresent || relayUp ? T.accent : T.vaultInkSoft;

  return (
    <SafeAreaView style={s.wrap} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor={T.vaultBg} />

      {selecting ? (
        <View style={s.bar}>
          <TouchableOpacity onPress={() => setSelected(new Set())} hitSlop={12}>
            <Text style={s.lock}>Cancel</Text>
          </TouchableOpacity>
          <Text style={s.selCount}>{selected.size} selected</Text>
          <TouchableOpacity onPress={confirmDelete} hitSlop={12}>
            <Text style={[s.icon, { color: T.danger }]}>Delete</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={s.bar}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <TouchableOpacity onPress={onLock} hitSlop={12}>
              <Text style={s.lock}>Close</Text>
            </TouchableOpacity>
            {/* Emptying the chat is the thing people reach for most once it has
                got long, so it sits in the open next to Close rather than
                folded away behind a menu. */}
            <TouchableOpacity onPress={confirmClear} hitSlop={12}>
              <Text style={s.bin}>🗑</Text>
            </TouchableOpacity>
          </View>

          <View style={s.statusCenter}>
            <View style={[s.dot, { backgroundColor: dot }]} />
            <Text style={s.status} numberOfLines={1}>
              {heading}
            </Text>
          </View>

          <View style={{ flexDirection: 'row', gap: 14 }}>
            {/* Offered whenever they are in the app. The direct connection forms
                on demand; waiting for it to exist first left both buttons grey
                while the two of them were plainly looking at each other. */}
            <TouchableOpacity onPress={() => onCall('audio')} disabled={!peerPresent} hitSlop={8}>
              <Text style={[s.icon, !peerPresent && s.iconOff]}>Call</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onCall('video')} disabled={!peerPresent} hitSlop={8}>
              <Text style={[s.icon, !peerPresent && s.iconOff]}>Video</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onSettings} hitSlop={8}>
              <Text style={s.icon}>•••</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Status row: yours first, then theirs, newest to oldest.
          Hidden while typing — on a small screen it and the keyboard together
          leave almost nothing for the conversation. */}
      {!typing && (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.statusRow}
        contentContainerStyle={{ paddingHorizontal: 12, alignItems: 'center' }}
      >
        <StatusBubble
          item={mine[0]}
          label={mine.length ? `You · ${mine.length}` : 'Add'}
          onPress={() => (mine.length ? setStory({ mine: true, index: 0 }) : setAddStatusOpen(true))}
        />
        {mine.length > 0 && (
          <TouchableOpacity style={s.addSmall} onPress={() => setAddStatusOpen(true)}>
            <Text style={s.addSmallText}>+</Text>
          </TouchableOpacity>
        )}
        <View style={s.rowDivider} />
        {theirs.length ? (
          theirs.map((item, i) => (
            <StatusBubble
              key={item.id}
              item={item}
              label={timeLeft(item)}
              onPress={() => setStory({ mine: false, index: i })}
            />
          ))
        ) : (
          <Text style={s.noStatus}>No status from them</Text>
        )}
      </ScrollView>
      )}

      {!pairedOnce && !typing && (
        <View style={s.notPaired}>
          <Text style={s.notPairedTitle}>Not paired yet</Text>
          <Text style={s.notPairedBody}>
            Both phones need the same two numbers — or the same QR code, if you paired that way.
            The short code under ••• must match on both.
          </Text>
        </View>
      )}

      {/* The message box rides above the keyboard, and clear of the navigation
          bar. See useKeyboardInset — the lift is measured rather than assumed,
          because newer Androids no longer resize the window and the box would
          otherwise sit underneath the keys. */}
      <View style={{ flex: 1, paddingBottom: bottomPad }} onLayout={onLayout}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 14, paddingBottom: 8 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          ListHeaderComponent={
            <Text style={s.preamble}>
              {keepHistory ? 'Kept on this phone, encrypted.' : 'Nothing here is saved.'}
            </Text>
          }
          renderItem={({ item }) => {
            if (item.kind === 'system') return <Text style={s.system}>{item.body}</Text>;

            const isMine = item.kind === 'out';
            const m = item.media;
            /**
             * One look only is a rule about what *they* get, not about what we
             * keep. Hiding our own photo from us was wrong: it is on this phone
             * because we took it, and blanking it protects nobody. Reported as
             * the photo disappearing from the sender's phone too.
             */
            const oneLook = item.viewOnce && !isMine;
            const picked = selected.has(item.id);

            return (
              <TouchableOpacity
                activeOpacity={selecting ? 0.7 : 1}
                onLongPress={() => toggleSelect(item.id)}
                onPress={() => {
                  if (selecting) return toggleSelect(item.id);
                  if (m?.kind === 'photo') setViewing(item);
                }}
                // Spent, and there is nothing left to open.
                disabled={oneLook && item.viewed}
                style={[
                  s.row,
                  { justifyContent: isMine ? 'flex-end' : 'flex-start' },
                  picked && s.rowPicked,
                ]}
              >
                <View style={[s.bubble, isMine ? s.mine : s.theirs, m ? s.bubbleMedia : null]}>
                  {oneLook && item.viewed && (
                    <Text style={s.burnt}>Opened · the photo is gone</Text>
                  )}
                  {oneLook && !item.viewed && !!m && (
                    <Text style={s.burnt}>Photo · tap to open, once</Text>
                  )}
                  {m?.kind === 'photo' && !oneLook && (
                    <Image source={{ uri: m.uri }} style={s.media} resizeMode="cover" />
                  )}
                  {/* Our own one-look photo stays ours: it is on this phone
                      because we put it there, and hiding it from the person who
                      took it protects nobody. The note says what they will get. */}
                  {item.viewOnce && isMine && (
                    <Text style={s.onceNote}>One look only, for them</Text>
                  )}
                  {m?.kind === 'video' && <VideoBubble uri={m.uri} />}
                  {m?.kind === 'audio' && (
                    <AudioBubble uri={m.uri} duration={m.duration} mine={isMine} />
                  )}

                  {!m && item.progress !== undefined && (
                    <View style={s.incomingMedia}>
                      <ActivityIndicator color="#fff" />
                      <Text style={s.progressText}>{Math.round(item.progress * 100)}%</Text>
                    </View>
                  )}

                  {!!item.body && <Text style={s.msg}>{item.body}</Text>}

                  <View style={s.meta}>
                    {!!m && <Text style={s.metaSize}>{size(m.bytes)}</Text>}
                    <Text style={s.time}>{clock(item.at)}</Text>
                    {isMine && (
                      <Text style={[s.tick, { color: tickColour(item.delivery) }]}>
                        {tick(item.delivery)}
                      </Text>
                    )}
                  </View>

                  {isMine && item.progress !== undefined && (
                    <View style={s.progressTrack}>
                      <View style={[s.progressFill, { width: `${item.progress * 100}%` }]} />
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            );
          }}
        />

        {/* PB, off duty. He sits out of the way of the last message and is
            gone while the keyboard is up, where there is no room for him. */}
        {!pbGone && !typing && !selecting && (
          <View style={s.pet} pointerEvents="box-none">
            <PBBot
              mood={pbMood}
              beat={pbBeat}
              size={54}
              say={pbSay}
              onPress={pokePB}
              onLongPress={hidePB}
              // Both he and his bubble hang off the right edge. Centred, which
              // is what the door screen wants, he would hop sideways every time
              // a bubble appeared and take the eye with him.
              style={{ alignItems: 'flex-end' }}
            />
          </View>
        )}

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
              onChangeText={(t) => {
                setDraft(t);
                // Keystrokes, not focus: opening the keyboard and thinking
                // better of it should not announce anything.
                onTyping(t.length > 0);
              }}
              onFocus={() => setTyping(true)}
              onBlur={() => { setTyping(false); onTyping(false); }}
              placeholder={
                connected || relayUp ? 'Message' : 'No connection yet'
              }
              placeholderTextColor={T.vaultInkSoft}
              multiline
              autoCorrect={false}
            />

            <TouchableOpacity style={s.send} onPress={draft.trim() ? send : startRecording}>
              <Text style={s.sendText}>{draft.trim() ? 'Send' : 'Hold'}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* ---- story viewer ---- */}
      <Modal
        visible={!!storyItem}
        transparent
        animationType="fade"
        onRequestClose={() => setStory(null)}
      >
        <View style={s.viewer}>
          {/* One segment per status, so the position in the list is obvious. */}
          <View style={s.segments}>
            {storyList.map((it, i) => (
              <View key={it.id} style={[s.segment, i === story?.index ? s.segmentOn : null]} />
            ))}
          </View>

          <TouchableOpacity
            style={s.viewerBody}
            activeOpacity={1}
            onPress={() => {
              if (!story) return;
              const next = story.index + 1;
              if (next < storyList.length) setStory({ ...story, index: next });
              else setStory(null);
            }}
          >
            {storyItem?.kind === 'video' && storyItem.uri && (
              <VideoBubble uri={storyItem.uri} style={s.viewerMedia} />
            )}
            {storyItem?.kind === 'photo' && storyItem.uri && (
              <Image source={{ uri: storyItem.uri }} style={s.viewerMedia} resizeMode="contain" />
            )}
            {storyItem && storyItem.kind !== 'text' && !storyItem.uri && (
              <View style={s.viewerLoading}>
                <ActivityIndicator color="#fff" />
                <Text style={s.viewerHint}>Fetching…</Text>
              </View>
            )}
            {!!storyItem?.text && (
              <Text style={storyItem.kind === 'text' ? s.statusOnly : s.statusCaption} selectable>
                {storyItem.text}
              </Text>
            )}
          </TouchableOpacity>

          <View style={s.viewerBar}>
            <Text style={s.viewerHint}>
              {storyItem ? timeLeft(storyItem) : ''} · tap for next
            </Text>
            <View style={{ flexDirection: 'row', gap: 18 }}>
              {story?.mine && storyItem && (
                <TouchableOpacity
                  onPress={() => {
                    onRemoveStatus(storyItem.id);
                    setStory(null);
                  }}
                >
                  <Text style={{ color: T.danger, fontWeight: '600' }}>Delete</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => setStory(null)}>
                <Text style={{ color: '#fff', fontWeight: '600' }}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ---- add a status ---- */}
      <Modal
        visible={addStatusOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setAddStatusOpen(false)}
      >
        <View style={s.sheetBg}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>New status</Text>
            <Text style={s.sheetNote}>
              Kept on this phone, encrypted, and shown to your partner for a day before it deletes
              itself. A status picture or clip is stored, unlike anything else here.
            </Text>

            <TextInput
              style={s.statusInput}
              value={statusDraft}
              onChangeText={(t) => setStatusDraft(t.slice(0, STATUS_MAX_CHARS))}
              placeholder="say something"
              placeholderTextColor={T.vaultInkSoft}
              multiline
            />
            <Text style={s.counter}>{statusDraft.length}/{STATUS_MAX_CHARS}</Text>

            <TouchableOpacity
              style={[s.statusAction, { backgroundColor: T.mine, borderColor: T.mine }]}
              onPress={() => {
                if (statusDraft.trim()) onAddTextStatus(statusDraft);
                setStatusDraft('');
                setAddStatusOpen(false);
              }}
            >
              <Text style={{ color: '#fff', fontWeight: '600' }}>Post these words</Text>
            </TouchableOpacity>

            {([
              ['Post a picture', 'photo'],
              [`Post a clip (up to ${STATUS_VIDEO_SECONDS}s)`, 'video'],
            ] as const).map(([label, kind]) => (
              <TouchableOpacity
                key={kind}
                style={s.sheetItem}
                onPress={() => { setAddStatusOpen(false); onAddStatusMedia(kind); }}
              >
                <Text style={s.sheetItemText}>{label}</Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity onPress={() => setAddStatusOpen(false)} style={{ marginTop: 12 }}>
              <Text style={{ color: T.vaultInkSoft, textAlign: 'center' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ---- attachment sheet ---- */}
      <Modal
        visible={attachOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setAttachOpen(false)}
      >
        <TouchableOpacity style={s.sheetBg} activeOpacity={1} onPress={() => setAttachOpen(false)}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>Send</Text>
            <Text style={s.sheetNote}>
              {connected
                ? 'Sent straight between the phones and never saved, on either side.'
                : 'They are not in the app, so this waits for them — sealed, on the relay that cannot read it, and deleted the moment they collect it. Long videos need you both here.'}
            </Text>
            <TouchableOpacity
              style={[s.onceRow, once && s.onceRowOn]}
              onPress={() => { setOnce(!once); onSetOnce(!once); }}
              activeOpacity={0.8}
            >
              <View style={[s.onceBox, once && s.onceBoxOn]}>
                {once && <Text style={s.onceTick}>✓</Text>}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.onceTitle}>One look only</Text>
                <Text style={s.onceSub}>
                  They can open the photo once. After that it is gone from their phone.
                </Text>
              </View>
            </TouchableOpacity>

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

      {/* ---- full-screen photo from the chat ---- */}
      <Modal
        visible={!!viewing}
        transparent
        animationType="fade"
        onRequestClose={() => setViewing(null)}
      >
        <TouchableOpacity
          style={s.viewer}
          activeOpacity={1}
          onPress={() => {
            const shown = viewing;
            setViewing(null);
            if (shown?.viewOnce && shown.kind === 'in' && !shown.viewed) onBurn(shown.id);
          }}
        >
          <View style={s.viewerBody}>
            {viewing?.media && (
              <Image
                source={{ uri: viewing.media.uri }}
                style={s.viewerMedia}
                resizeMode="contain"
              />
            )}
            <Text style={s.viewerHint}>Tap to close</Text>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  onceRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12,
    borderWidth: 1, borderColor: T.vaultLine, marginBottom: 10,
  },
  onceRowOn: { borderColor: T.mine, backgroundColor: 'rgba(42,91,215,0.12)' },
  onceBox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 1.5, borderColor: T.vaultInkSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  onceBoxOn: { backgroundColor: T.mine, borderColor: T.mine },
  onceTick: { color: '#fff', fontSize: 14, fontWeight: '700' },
  onceTitle: { color: T.vaultInk, fontSize: 15, fontWeight: '600' },
  onceSub: { color: T.vaultInkSoft, fontSize: 12, marginTop: 2, lineHeight: 17 },
  onceNote: {
    color: 'rgba(255,255,255,0.75)', fontSize: 11.5,
    paddingHorizontal: 14, paddingTop: 6,
  },
  burnt: {
    color: T.vaultInkSoft, fontSize: 13.5, fontStyle: 'italic',
    paddingHorizontal: 14, paddingVertical: 12,
  },
  wrap: { flex: 1, backgroundColor: T.vaultBg },
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: T.vaultLine,
  },
  bin: { fontSize: 17, color: T.vaultInkSoft },
  lock: { color: T.vaultInkSoft, fontSize: 15 },
  selCount: { color: T.vaultInk, fontSize: 15, fontWeight: '600' },
  statusCenter: {
    flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, justifyContent: 'center',
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  status: { color: T.vaultInkSoft, fontSize: 12 },
  icon: { color: T.vaultInk, fontSize: 14, fontWeight: '600' },
  iconOff: { color: T.vaultInkSoft, opacity: 0.5 },

  statusRow: {
    maxHeight: 104, backgroundColor: T.vaultCard,
    borderBottomWidth: 1, borderBottomColor: T.vaultLine,
  },
  ringWrap: { alignItems: 'center', width: 74, paddingVertical: 12 },
  ring: {
    width: 54, height: 54, borderRadius: 27, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  ringLive: { borderColor: T.accent, backgroundColor: T.vaultBg },
  ringEmpty: { borderColor: T.vaultLine, backgroundColor: T.vaultBg, borderStyle: 'dashed' },
  ringImage: { width: '100%', height: '100%' },
  ringGlyph: { color: T.vaultInkSoft, fontSize: 18 },
  ringLabel: { color: T.vaultInkSoft, fontSize: 10.5, marginTop: 6 },
  addSmall: {
    width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: T.accent,
    alignItems: 'center', justifyContent: 'center', marginBottom: 22,
  },
  addSmallText: { color: T.accent, fontSize: 15, lineHeight: 17 },
  rowDivider: { width: 1, height: 44, backgroundColor: T.vaultLine, marginHorizontal: 10 },
  noStatus: { color: T.vaultInkSoft, fontSize: 13, fontStyle: 'italic', paddingHorizontal: 8 },

  notPaired: {
    backgroundColor: 'rgba(201,162,39,0.12)', borderBottomWidth: 1, borderBottomColor: T.accent,
    paddingHorizontal: 16, paddingVertical: 12,
  },
  notPairedTitle: { color: T.accent, fontSize: 14, fontWeight: '700' },
  notPairedBody: { color: T.vaultInkSoft, fontSize: 12.5, lineHeight: 18, marginTop: 5 },
  preamble: {
    color: T.vaultInkSoft, fontSize: 12, textAlign: 'center',
    marginBottom: 18, marginTop: 6, paddingHorizontal: 20, lineHeight: 18,
  },
  system: { color: T.vaultInkSoft, fontSize: 12, textAlign: 'center', marginVertical: 8 },
  row: { flexDirection: 'row', marginBottom: 8, borderRadius: 12 },
  rowPicked: { backgroundColor: 'rgba(42,91,215,0.22)' },
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

  audioRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 8, paddingVertical: 6, minWidth: 200,
  },
  playBtn: {
    width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
  },
  playIcon: { color: '#fff', fontSize: 13 },
  waveform: { flexDirection: 'row', alignItems: 'center', gap: 3, flex: 1 },
  waveBar: { width: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.85)' },
  audioTime: { color: 'rgba(255,255,255,0.75)', fontSize: 11 },

  meta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end',
    gap: 6, marginTop: 4, paddingHorizontal: 8,
  },
  metaSize: { color: 'rgba(255,255,255,0.5)', fontSize: 10 },
  time: { color: 'rgba(255,255,255,0.55)', fontSize: 10 },
  tick: { color: 'rgba(255,255,255,0.75)', fontSize: 10 },

  // Above the message box, hard against the right edge, where he covers the
  // corner of a bubble at worst and never the text.
  pet: { position: 'absolute', right: 8, bottom: 120, alignItems: 'flex-end' },

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
  sheetNote: {
    color: T.vaultInkSoft, fontSize: 12.5, lineHeight: 18, marginTop: 8, marginBottom: 16,
  },
  sheetItem: { paddingVertical: 15, borderTopWidth: 1, borderTopColor: T.vaultLine },
  sheetItemText: { color: T.vaultInk, fontSize: 16 },

  statusInput: {
    backgroundColor: T.vaultBg, borderRadius: 12, padding: 14, minHeight: 80,
    color: T.vaultInk, fontSize: 16, borderWidth: 1, borderColor: T.vaultLine,
    textAlignVertical: 'top',
  },
  counter: {
    color: T.vaultInkSoft, fontSize: 11, textAlign: 'right', marginTop: 6, marginBottom: 12,
  },
  statusAction: { borderWidth: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },

  viewer: { flex: 1, backgroundColor: '#000' },
  viewerBody: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  viewerMedia: { width: '100%', height: '80%' },
  viewerLoading: { alignItems: 'center', gap: 12 },
  viewerBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 20,
  },
  viewerHint: { color: 'rgba(255,255,255,0.55)', fontSize: 12 },
  segments: { flexDirection: 'row', gap: 4, paddingHorizontal: 12, paddingTop: 14 },
  segment: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)' },
  segmentOn: { backgroundColor: '#fff' },
  statusCaption: {
    color: '#fff', fontSize: 16, textAlign: 'center', paddingHorizontal: 28, marginTop: 16,
  },
  /** No picture: the words are the whole thing, so give them the room. */
  statusOnly: {
    color: '#fff', fontSize: 24, lineHeight: 34, textAlign: 'center', paddingHorizontal: 32,
  },
});
