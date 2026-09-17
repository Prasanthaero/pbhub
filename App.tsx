import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, View, StyleSheet, Alert, Platform, UIManager } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as ScreenCapture from 'expo-screen-capture';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import type { MediaStream } from 'react-native-webrtc';

import { T } from './src/theme';
import {
  openVault, createVault, wipe, needsRestretch, seal, unseal, type VaultKeys,
} from './src/crypto/vault';
import { bytesToWords } from './src/crypto/wordlist';
import {
  readMarker, writeMarker, destroyVault, readSettings, writeSettings,
  defaultSettings, type VaultSettings,
} from './src/store/vaultStore';
import { loadNotes, saveNotes, newNote, type Note } from './src/store/notes';
import {
  mkMsg, newId, dropExpired, place, type Msg, type MediaKind,
} from './src/store/messages';
import { loadHistory, saveHistory, clearHistory } from './src/store/history';
import { loadOutbox, saveOutbox, clearOutbox, type Pending } from './src/store/outbox';
import {
  loadStatuses, writeStatuses, clearStatuses, toSummary, isLiveItem,
  STATUS_TTL_MS, STATUS_VIDEO_SECONDS, type StatusItem,
} from './src/store/status';
import {
  writeStatusMedia, readStatusMedia, wipeStatusMedia,
} from './src/store/statusMedia';
import { Signaling, type Role } from './src/net/signaling';
import { Peer, type CallKind } from './src/net/peer';
import { available as webrtcAvailable } from './src/net/webrtc';
import { MAX_OFFLINE_MEDIA_BYTES, type Envelope } from './src/net/transport';
import { prepareNotifications, showDot, clearDot } from './src/net/notify';
import { pickPhoto, pickVideo, readRecording, TooLarge } from './src/media/pick';
import {
  readSharedFile, toStatusImage, kindForMime, type SharedItem,
} from './src/media/shared';
import * as ImagePicker from 'expo-image-picker';
import { useShareIntent } from './src/media/shareIntent';

import NotesList from './src/screens/NotesList';
import NoteEditor from './src/screens/NoteEditor';
import VaultGate from './src/screens/VaultGate';
import Chat from './src/screens/Chat';
import CallScreen, { type CallState } from './src/screens/Call';
import VaultSettingsScreen from './src/screens/VaultSettings';
import SharedSheet from './src/screens/SharedSheet';

/**
 * How long after a picker hands back before the lock is armed again.
 *
 * The picker resolves while its activity is still finishing, so the app is not
 * on screen yet and a background event can still be in flight behind it.
 */
const SETTLE_MS = 1500;

/**
 * And the longest this app will stay unlocked off screen, whatever it thinks
 * it is waiting for.
 *
 * Every excuse for not locking — a camera, a permission dialog, a share sheet —
 * is over in a second or two. Anything still "waiting" after this is a bug in
 * our own bookkeeping, and the right answer to a bug in the thing guarding the
 * vault is to lock the vault. Fail safe, never fail open.
 */
const AWAY_LIMIT_MS = 20_000;

type Screen = 'list' | 'editor' | 'gate' | 'chat' | 'call' | 'settings' | 'shared';
type CallInfo = { kind: CallKind; state: CallState };

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export default function App() {
  // ---- cover story -------------------------------------------------------
  const [notes, setNotes] = useState<Note[]>([]);
  const [active, setActive] = useState<Note | null>(null);
  const [screen, setScreen] = useState<Screen>('list');
  const [hasVault, setHasVault] = useState(false);

  // ---- vault -------------------------------------------------------------
  const keysRef = useRef<VaultKeys | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [settings, setSettings] = useState<VaultSettings>(defaultSettings());
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const [messages, setMessages] = useState<Msg[]>([]);
  const messagesRef = useRef<Msg[]>([]);
  messagesRef.current = messages;

  const [status, setStatus] = useState('Offline');
  const [connected, setConnected] = useState(false);
  /**
   * Whether the relay says the other phone is in the app.
   *
   * Deliberately separate from `connected`, which means a direct WebRTC channel
   * is open. The two are not the same thing, and treating them as one was a
   * bug: the channel closes and reopens on its own — a renegotiation, an ICE
   * hiccup, the end of a call — and the chat announced "they are away" every
   * time, with both people sitting in the app looking at each other. Presence
   * comes from the relay, which knows, and does not flicker.
   */
  const [peerPresent, setPeerPresent] = useState(false);
  /**
   * When they were last in the app, as far as this phone saw.
   *
   * Noted locally the moment the relay says they have gone. Nothing extra is
   * sent or stored anywhere to produce it — the relay already tells both phones
   * when the other arrives and leaves, and this is only that, remembered. It
   * lasts as long as the app is open; after that there is nothing to show and
   * the chat says only that they are away.
   */
  const [lastSeen, setLastSeen] = useState<number | null>(null);
  /**
   * They are writing something.
   *
   * Cleared by a timer as well as by the message that says they stopped, so a
   * partner who starts typing and then loses signal does not leave the word
   * hanging there for the rest of the evening.
   */
  const [theirTyping, setTheirTyping] = useState(false);
  const typingClear = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [relayUp, setRelayUp] = useState(false);

  const [myStatuses, setMyStatuses] = useState<StatusItem[]>([]);
  const myStatusesRef = useRef<StatusItem[]>([]);
  myStatusesRef.current = myStatuses;
  /** Theirs, in memory only — they decide how long their own words live. */
  const [theirStatuses, setTheirStatuses] = useState<StatusItem[]>([]);

  const sigRef = useRef<Signaling | null>(null);
  /**
   * The locked listener.
   *
   * Holds the room id and no key at all. It cannot read a word of what arrives
   * and is never handed it — the relay keeps the mail until the vault is open
   * and asks. All it can do is put a dot in the status bar, which is exactly
   * what the dot was always meant to be.
   *
   * This is what lets "lock when the app leaves the screen" and the dot both be
   * on at once. They used to be mutually exclusive: locking closed the socket,
   * so nothing arrived to notify about, and the switch sat greyed out.
   */
  const peekRef = useRef<Signaling | null>(null);
  const peerRef = useRef<Peer | null>(null);
  const roleRef = useRef<Role>('a');
  const outboxRef = useRef<Pending[]>([]);
  /** Ids already shown, so a message that arrived twice appears once. */
  const seenRef = useRef<Set<string>>(new Set());

  const [call, setCallState] = useState<CallInfo | null>(null);
  const callRef = useRef<CallInfo | null>(null);
  const setCall = useCallback((c: CallInfo | null) => {
    callRef.current = c;
    setCallState(c);
  }, []);

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [sending, setSending] = useState<{ id: string; progress: number } | null>(null);

  /** Something handed to us by another app's share sheet, waiting for a home. */
  const [shared, setShared] = useState<SharedItem | null>(null);
  /** Readable from enterVault, which runs before the next render. */
  const sharedRef = useRef<SharedItem | null>(null);
  sharedRef.current = shared;
  const [sharedBusy, setSharedBusy] = useState(false);

  useEffect(() => {
    loadNotes().then(setNotes);
    readMarker().then((m) => setHasVault(!!m));
  }, []);

  /**
   * Something shared into the app from Instagram, the gallery, a browser.
   *
   * The screen for this and the code that sends it were both written; nothing
   * ever connected Android's share sheet to them, so the app appeared in the
   * share menu and then did nothing with what it was handed.
   *
   * The bytes are read immediately, before anything is asked of the user: the
   * content:// URI a share hands over is borrowed, and the app that lent it can
   * take it back the moment its sheet closes — which is exactly while someone
   * is unlocking and deciding what to do with it.
   */
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent({
    // Keep it across the trip to the lock screen and back.
    resetOnBackground: false,
  });

  useEffect(() => {
    if (!hasShareIntent) return;

    (async () => {
      try {
        const file = shareIntent.files?.[0];
        if (file?.path) {
          const mime = file.mimeType || 'image/jpeg';
          const kind = kindForMime(mime);
          const { bytes } = await readSharedFile(file.path, mime);
          setShared({
            kind,
            uri: file.path,
            mime,
            bytes,
            text: shareIntent.text ?? undefined,
            duration: file.duration ? file.duration / 1000 : undefined,
          });
        } else {
          const text = shareIntent.text || shareIntent.webUrl;
          if (!text) return;
          setShared({ kind: 'text', text });
        }
        // Unlocked already: straight to the sheet. Locked: the PIN first, and
        // the share is still here on the other side of it.
        setScreen(keysRef.current ? 'shared' : 'gate');
      } catch {
        Alert.alert(
          'Could not use that',
          'The app that shared it may have already taken it back.',
        );
      } finally {
        resetShareIntent();
      }
    })();
  }, [hasShareIntent, shareIntent, resetShareIntent]);

  /**
   * Seal and open envelopes without needing a peer connection.
   *
   * The Peer object has wrap/unwrap on it, which was fine while a peer always
   * existed. It does not in a build without WebRTC — Expo Go — where there is
   * never anything but the relay's mailbox, and the whole conversation goes
   * through it. Routing the crypto through the vault key instead of through
   * the peer means the mail path stands on its own.
   */
  const wrap = useCallback((e: Envelope): string | null => {
    const keys = keysRef.current;
    return keys ? seal(keys.msgKey, JSON.stringify(e)) : null;
  }, []);

  const unwrap = useCallback((wire: string): Envelope | null => {
    const keys = keysRef.current;
    if (!keys) return null;
    try {
      return JSON.parse(unseal(keys.msgKey, wire)) as Envelope;
    } catch {
      return null;
    }
  }, []);

  /**
   * Hold the screen on while a call is up.
   *
   * Android dims and then sleeps a screen nobody has touched, and a video call
   * is exactly that — you are looking at it, not tapping it. Letting it sleep
   * used to end the call outright; that is separately fixed in the lock, but
   * the screen going dark in the middle of a video call is wrong on its own.
   *
   * Released the moment the call ends, so the phone goes back to its normal
   * habits rather than sitting awake for the rest of the day.
   */
  useEffect(() => {
    if (!call) return;
    let dropped = false;
    activateKeepAwakeAsync('call').catch(() => {});
    return () => {
      if (dropped) return;
      dropped = true;
      try {
        deactivateKeepAwake('call');
      } catch {
        // Nothing to do about a wake lock that will not release; Android drops
        // it with the process anyway.
      }
    };
  }, [call]);

  const pushSystem = useCallback((body: string) => {
    setMessages((m) => place(m, mkMsg('system', body)));
  }, []);

  // ---- persistence -------------------------------------------------------
  /** Write the conversation out, but only if the two of them asked for that. */
  const persistHistory = useCallback((msgs: Msg[]) => {
    const keys = keysRef.current;
    if (!keys || !settingsRef.current.keepHistory) return;
    saveHistory(keys.msgKey, msgs).catch(() => {});
  }, []);

  const persistOutbox = useCallback(() => {
    const keys = keysRef.current;
    if (!keys) return;
    saveOutbox(keys.msgKey, outboxRef.current).catch(() => {});
  }, []);

  /**
   * Sweep away anything whose time is up.
   *
   * Every thirty seconds rather than a timer per message: a conversation can
   * hold hundreds, and a scheduled callback for each is a lot of bookkeeping to
   * be exactly on time about something the user cannot see to the second. The
   * cost is that a message can linger up to half a minute past its moment.
   *
   * Runs while unlocked only. Locked, there is nothing on screen, and anything
   * written down is re-filtered when it is loaded back.
   */
  useEffect(() => {
    if (!unlocked) return;
    const sweep = setInterval(() => {
      setMessages((m) => {
        const live = dropExpired(m);
        if (live !== m) persistHistory(live);
        return live;
      });
    }, 30_000);
    return () => clearInterval(sweep);
  }, [unlocked, persistHistory]);

  // ---- teardown ----------------------------------------------------------
  /**
   * Start listening for the dot, holding nothing that could read a message.
   *
   * The room id is a hash. It says which conversation, never what was said, and
   * it is the one thing that has to survive the lock for a notification to be
   * possible at all without a push service.
   */
  const startPeek = useCallback((roomId: string, cfg: VaultSettings) => {
    peekRef.current?.close();
    peekRef.current = null;
    if (!cfg.quietNotifications || !cfg.relayUrl) return;

    const deaf = new Signaling(cfg.relayUrl, roomId, new Uint8Array(32), {
      onReady: () => {},
      onPeerPresent: () => {},
      onSignal: () => {},
      onStatus: () => {},
      onClosed: () => {},
      // Never sent to a listener; the relay holds the mail until it is asked.
      onMail: () => {},
      onMailDone: () => {},
      onMailHeld: () => {},
      onMailFull: () => {},
      onAck: () => {},
      onLive: () => {},
      onWaiting: () => { showDot(); },
    }, cfg.deviceId, true);
    peekRef.current = deaf;
    deaf.connect();
  }, []);

  const lock = useCallback(() => {
    const roomId = keysRef.current?.roomId ?? null;
    const cfg = settingsRef.current;
    peerRef.current?.destroy();
    peerRef.current = null;
    sigRef.current?.close();
    sigRef.current = null;
    wipe(keysRef.current?.msgKey);
    wipe(keysRef.current?.pairing);
    keysRef.current = null;
    outboxRef.current = [];
    seenRef.current = new Set();
    reportedSeen.current = new Set();
    setMessages([]);
    setLocalStream(null);
    setRemoteStream(null);
    setCall(null);
    setConnected(false);
    setPeerPresent(false);
    setLastSeen(null);
    setRelayUp(false);
    setSending(null);
    setShared(null);
    setSharedBusy(false);
    setMyStatuses([]);
    setTheirStatuses([]);
    setStatus('Offline');
    clearDot();
    setUnlocked(false);
    setActive(null);
    setScreen('list');

    // Closed, but not deaf — if the dot is wanted, keep a keyless ear on the
    // room. clearDot above wipes any dot from before; this is for what comes
    // next.
    if (roomId) startPeek(roomId, cfg);
  }, [setCall, startPeek]);

  /**
   * Close the vault if the phone is left sitting on it.
   *
   * The panic lock only fires when the app leaves the screen, which does
   * nothing about the commonest way the wrong person sees a conversation: the
   * phone put down, still open, and picked up by somebody else. A photo you
   * meant to delete and forgot stays on screen for as long as the phone is
   * awake. This closes it after a few quiet minutes.
   *
   * Reset by any touch anywhere (see the responder on the root view below), and
   * never while a call is up — watching someone talk is not being idle.
   */
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nudgeIdle = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = null;
    const after = settingsRef.current.idleLockMs;
    if (!unlocked || !after) return;
    idleTimer.current = setTimeout(() => {
      idleTimer.current = null;
      if (!callRef.current) lock();
    }, after);
    // settings.idleLockMs is read through the ref, but it belongs in the
    // dependencies: changing the setting has to rebuild this and re-arm the
    // effect below, or the old interval keeps running until the next unlock.
  }, [unlocked, lock, settings.idleLockMs]);

  // Start it on unlock, stop it on lock.
  useEffect(() => {
    nudgeIdle();
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = null;
    };
  }, [nudgeIdle]);

  // Leaving the foreground closes everything, if asked to.
  //
  // Deliberately 'background' and not "anything but active": Android reports
  // 'inactive' while a permission dialog is on screen, and locking the vault the
  // instant someone taps Allow on the microphone prompt would make calls
  // impossible to answer.
  const foreground = useRef(true);
  /**
   * How many things we deliberately left the app for are still outstanding.
   *
   * A count rather than a flag, because two can overlap — a permission dialog
   * in front of a camera — and the inner one finishing must not disarm the
   * guard while the outer one is still on screen.
   */
  const awayOnPurpose = useRef(0);
  /** Armed when we go off screen without locking; fires if we never come back. */
  const deadMansTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const leaveOnPurpose = useCallback(() => {
    awayOnPurpose.current += 1;
  }, []);

  /**
   * Come back — but not the instant the promise says so.
   *
   * A picker resolves while its activity is still finishing, so this app is not
   * on screen yet and a background event can still be in flight behind it.
   * Dropping the guard at that moment was the race behind "when I add a photo
   * it comes out": the photo arrived, the guard lifted, the queued background
   * event landed, and the vault locked and threw you back to the notes.
   *
   * A second and a half covers the transition. Being wrong in this direction
   * means walking away during that window does not lock; being wrong the other
   * way means losing the vault mid-action, every single time.
   */
  const returnedOnPurpose = useCallback(() => {
    // Its own timer, not a shared one. A single shared timer was a hole: two
    // overlapping departures both scheduled a decrement, the second cancelled
    // the first, and the count never came back to zero — so the vault stopped
    // locking for the rest of the session. Reported as the app being stuck
    // open, still in the chat after the screen had been off and on again.
    setTimeout(() => {
      awayOnPurpose.current = Math.max(0, awayOnPurpose.current - 1);
    }, SETTLE_MS);
  }, []);

  /** Armed by the attach sheet, read when the picked photo comes back. A ref
   *  and not state because the picker takes the app out of the foreground and
   *  back, and this has to survive that without causing a re-render. */
  const onceRef = useRef(false);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      foreground.current = s === 'active';
      if (s === 'active') {
        clearDot();
        if (deadMansTimer.current) {
          clearTimeout(deadMansTimer.current);
          deadMansTimer.current = null;
        }
        return;
      }
      if (s !== 'background' || !unlocked || !settings.panicOnBackground) return;

      // A call in progress is not walking away.
      //
      // Reported as the call cutting out and dumping you back on the notes
      // page. The screen going dark during a call — a timeout, the proximity
      // sensor when the phone is at your ear — backgrounds the activity exactly
      // like pressing home does, and locking tore down the peer connection
      // mid-sentence. No calling app hangs up because the screen went off.
      if (callRef.current) return;

      // The gallery and the camera are separate activities, so choosing a photo
      // backgrounds this app exactly like walking away does. Locking there
      // closed the vault mid-action and threw the user back to the notes list —
      // reported as "if I add any media it comes out", and it was.
      //
      // Anything the user deliberately left for, and will be returned from, sets
      // this first. Everything else — the home button, the recents switcher, a
      // call arriving — still locks.
      if (awayOnPurpose.current > 0) {
        // Waiting on a camera or a picker — but only for as long as one of
        // those could plausibly take. If we are still off screen after that,
        // something has gone wrong in our own bookkeeping, and an unlocked
        // vault on a phone somebody else is holding is the worst way to find
        // out. Lock it and let them type the PIN again.
        if (deadMansTimer.current) clearTimeout(deadMansTimer.current);
        deadMansTimer.current = setTimeout(() => {
          deadMansTimer.current = null;
          if (!foreground.current && !callRef.current) lock();
        }, AWAY_LIMIT_MS);
        return;
      }
      lock();
    });
    return () => sub.remove();
  }, [unlocked, settings.panicOnBackground, lock]);

  // Screenshot blocking follows the vault, not the app.
  useEffect(() => {
    if (unlocked && settings.blockScreenshots) {
      ScreenCapture.preventScreenCaptureAsync().catch(() => {});
      return () => {
        ScreenCapture.allowScreenCaptureAsync().catch(() => {});
      };
    }
  }, [unlocked, settings.blockScreenshots]);

  // ---- receiving ---------------------------------------------------------
  const markDelivered = useCallback((id: string, delivery: Msg['delivery']) => {
    setMessages((m) => m.map((x) => (x.id === id ? { ...x, delivery } : x)));
  }, []);

  /** The one place an inbound envelope becomes something on screen. */
  const applyEnvelope = useCallback((e: Envelope, at = Date.now()) => {
    switch (e.k) {
      case 'msg': {
        if (seenRef.current.has(e.id)) return; // arrived twice; show it once
        seenRef.current.add(e.id);
        setMessages((m) => {
          const next = place(m, {
            id: e.id, kind: 'in' as const, body: e.body, at: e.at || at, expiresAt: e.exp,
          });
          persistHistory(next);
          return next;
        });
        if (!foreground.current && settingsRef.current.quietNotifications) showDot();
        // Receipt travels whichever road is open.
        if (!peerRef.current?.send({ k: 'ack', id: e.id })) sigRef.current?.ack(e.id);
        return;
      }
      case 'typing': {
        setTheirTyping(e.on);
        if (typingClear.current) clearTimeout(typingClear.current);
        // Six seconds is longer than the sender's own repeat, so a steady
        // typist never flickers, and short enough that a dropped connection
        // does not leave them typing forever.
        if (e.on) typingClear.current = setTimeout(() => setTheirTyping(false), 6000);
        return;
      }
      case 'ack': {
        outboxRef.current = outboxRef.current.filter((p) => p.id !== e.id);
        persistOutbox();
        // Never walk a message backwards: an ack arriving after a read receipt
        // must not turn "seen" back into "delivered".
        setMessages((m) => m.map((x) => (
          x.id === e.id && x.delivery !== 'read' ? { ...x, delivery: 'delivered' } : x
        )));
        return;
      }
      case 'read': {
        const seen = new Set(e.ids);
        setMessages((m) => m.map((x) => (seen.has(x.id) ? { ...x, delivery: 'read' } : x)));
        return;
      }
      case 'media-whole': {
        if (seenRef.current.has(e.id)) return;
        seenRef.current.add(e.id);
        setMessages((m) => place(m, {
          id: e.id,
          kind: 'in',
          body: '',
          at: e.at || at,
          expiresAt: e.exp,
          viewOnce: e.once,
          media: {
            kind: e.kind,
            uri: `data:${e.mime};base64,${e.b64}`,
            mime: e.mime,
            bytes: e.bytes,
            duration: e.duration,
          },
        }));
        if (!peerRef.current?.send({ k: 'ack', id: e.id })) sigRef.current?.ack(e.id);
        if (!foreground.current && settingsRef.current.quietNotifications) showDot();
        return;
      }
      case 'status-list':
        // Metadata only; the bytes are fetched when a viewer opens one.
        setTheirStatuses(e.items.filter(isLiveItem).map((s) => ({ ...s })));
        return;
      case 'status-want': {
        const mine = myStatusesRef.current.find((s) => s.id === e.id);
        if (!mine?.mediaId) return;
        sendStatusMediaRef.current?.(mine);
        return;
      }
      case 'status-clear':
        setTheirStatuses([]);
        return;
      case 'delete': {
        const gone = new Set(e.ids);
        setMessages((m) => {
          // Only what they sent us. The rule is that a message can be taken
          // back by whoever wrote it, and enforcing it here as well as at the
          // sending end means a bug or a tampered client on their side cannot
          // reach across and delete our own words out of our own chat.
          const next = m.filter((x) => !(gone.has(x.id) && x.kind === 'in'));
          persistHistory(next);
          return next;
        });
        return;
      }
      case 'call': {
        if (e.action === 'ring') {
          setCall({ kind: e.callKind ?? 'audio', state: 'incoming' });
          setScreen('call');
        } else if (e.action === 'accept') {
          const c = callRef.current;
          if (c) {
            setCall({ ...c, state: 'active' });
            // Already open if we placed the call; this covers the case where it
            // is not, and says so rather than showing a call with nothing in it.
            peerRef.current?.openMedia(c.kind).catch(() => {
              Alert.alert(
                'Could not start the call',
                'This phone would not hand over its microphone or camera.',
              );
              peerRef.current?.send({ k: 'call', action: 'hangup' });
              peerRef.current?.closeMedia();
              setCall(null);
              setScreen('chat');
            });
          }
        } else {
          peerRef.current?.closeMedia();
          setCall(null);
          setScreen('chat');
          pushSystem(e.action === 'decline' ? 'Call declined.' : 'Call ended.');
        }
        return;
      }
      default:
        return;
    }
  }, [markDelivered, persistHistory, persistOutbox, pushSystem, setCall]);

  // ---- sending -----------------------------------------------------------
  /**
   * Send text. Straight down the channel when the partner is here, into the
   * relay's mailbox when they are not, and kept in our own outbox either way
   * until their phone confirms it.
   */
  const sendText = useCallback((body: string) => {
    const peer = peerRef.current;
    const sig = sigRef.current;

    const id = newId();
    const at = Date.now();
    const ttl = settingsRef.current.messageTtl;
    const expiresAt = ttl > 0 ? at + ttl : undefined;
    // Sealed once; both roads carry the identical bytes. The expiry travels
    // with the message so both phones drop it at the same instant, whatever
    // the other one has its own timer set to.
    const wire = wrap({ k: 'msg', id, body, at, exp: expiresAt });
    if (!wire) return;

    setMessages((m) => {
      const next: Msg[] = place(m, { id, kind: 'out', body, at, delivery: 'sending', expiresAt });
      persistHistory(next);
      return next;
    });

    outboxRef.current = [...outboxRef.current, { id, wire, at }];
    persistOutbox();

    // Direct if we can, mailbox if we cannot, and the outbox covers neither.
    if (!peer?.sendWire(wire)) sig?.mail(id, wire);
  }, [persistHistory, persistOutbox, wrap]);

  /** Re-post anything the partner never acknowledged. */
  const flushOutbox = useCallback(() => {
    const sig = sigRef.current;
    const peer = peerRef.current;
    for (const p of outboxRef.current) {
      if (peer?.sendWire(p.wire)) continue;
      sig?.mail(p.id, p.wire);
    }
  }, []);

  // ---- transport ---------------------------------------------------------
  const buildPeer = useCallback((keys: VaultKeys, cfg: VaultSettings, role: Role) => {
    // No WebRTC in this build (Expo Go): never attempt a direct connection.
    // Everything then takes the path already built for a partner who is not in
    // the app — sealed through the relay. Text and photos still arrive; calls
    // are not offered, because there is nothing to carry them.
    if (!webrtcAvailable) return;

    const peer = new Peer(role, cfg.iceServers, keys.msgKey, (m) => sigRef.current?.send(m), {
      onChannelOpen: (open) => {
        setConnected(open);
        setStatus(open ? 'Connected, direct' : 'Waiting for partner…');
        if (!open) return;
        pushSystem('Connected directly.');

        // First time the two phones have ever met on this pairing. Remember it,
        // so the "not paired yet" warning stops for good.
        if (!settingsRef.current.pairedOnce) {
          const confirmed = { ...settingsRef.current, pairedOnce: true };
          settingsRef.current = confirmed;
          setSettings(confirmed);
          if (keysRef.current) writeSettings(keysRef.current.msgKey, confirmed).catch(() => {});
        }

        flushOutbox();
        const mine = myStatusesRef.current.filter(isLiveItem);
        peer.send({ k: 'status-list', items: mine.map(toSummary) });
      },
      onEnvelope: (e) => applyEnvelope(e),
      onMedia: (id, kind, uri, mime, bytes, at, duration, exp, once) => {
        if (seenRef.current.has(id)) return;
        seenRef.current.add(id);
        setMessages((m) => place(m.filter((x) => x.id !== id), {
          id, kind: 'in', body: '', at, expiresAt: exp, viewOnce: once,
          media: { kind, uri, mime, bytes, duration },
        }));
      },
      onMediaProgress: (id, progress) => {
        setMessages((m) =>
          m.some((x) => x.id === id)
            ? m.map((x) => (x.id === id ? { ...x, progress } : x))
            : place(m, { id, kind: 'in' as const, body: '', at: Date.now(), progress }),
        );
      },
      onStatusMedia: (statusId, uri) => {
        setTheirStatuses((list) => list.map((s) => (s.id === statusId ? { ...s, uri } : s)));
      },
      onLocalStream: setLocalStream,
      onRemoteStream: setRemoteStream,
      onConnectionState: (cs) => {
        if (cs === 'failed') setStatus('Could not find a direct path');
        else if (cs === 'connected') setStatus('Connected, direct');
      },
    });
    peerRef.current = peer;
    return peer;
  }, [applyEnvelope, flushOutbox, pushSystem]);

  const connect = useCallback((keys: VaultKeys, cfg: VaultSettings) => {
    peekRef.current?.close();
    peekRef.current = null;
    const sig = new Signaling(cfg.relayUrl, keys.roomId, keys.msgKey, {
      onReady: (role) => {
        roleRef.current = role;
        setRelayUp(true);
        if (!peerRef.current) buildPeer(keys, cfg, role);
        // Unacknowledged mail goes back out as soon as there is a relay,
        // whether or not the partner is here to take it directly.
        flushOutbox();
      },
      onPeerPresent: (present) => {
        setPeerPresent(present);
        if (!present) setLastSeen(Date.now());
        if (present) {
          if (!peerRef.current) buildPeer(keys, cfg, roleRef.current);
          peerRef.current?.start();
          // They have just walked in. Anything of ours still unacknowledged goes
          // out again now rather than waiting for a direct channel to open —
          // there may never be one, and the relay will carry it either way.
          flushOutbox();
        } else {
          setConnected(false);
          setTheirStatuses([]);
          peerRef.current?.destroy();
          peerRef.current = null;
          setRemoteStream(null);
          setCall(null);
          buildPeer(keys, cfg, roleRef.current);
        }
      },
      onSignal: (m) => peerRef.current?.handleSignal(m),
      onStatus: setStatus,
      onClosed: (reason) => {
        setStatus(reason);
        setConnected(false);
        setPeerPresent(false);
        setRelayUp(false);
      },
      onMail: (id, wire, at) => {
        // Still sealed at this point; only we hold the key.
        const e = unwrap(wire);
        if (e) applyEnvelope(e, at);
      },
      onMailDone: (count) => {
        if (count > 0) {
          pushSystem(`${count} message${count === 1 ? '' : 's'} arrived while you were away.`);
        }
      },
      onLive: (wire) => {
        const e = unwrap(wire);
        if (e) applyEnvelope(e);
      },
      // Only a locked listener is ever told this; the open vault collects its
      // mail properly and has no use for it.
      onWaiting: () => {},
      onMailHeld: (id) => markDelivered(id, 'held'),
      onMailFull: (id) => markDelivered(id, 'failed'),
      onAck: (id) => {
        outboxRef.current = outboxRef.current.filter((p) => p.id !== id);
        persistOutbox();
        markDelivered(id, 'delivered');
      },
    }, cfg.deviceId);
    sigRef.current = sig;
    sig.connect();
  }, [applyEnvelope, buildPeer, flushOutbox, markDelivered, persistOutbox, pushSystem, setCall]);

  const enterVault = useCallback(async (keys: VaultKeys) => {
    keysRef.current = keys;
    const cfg = await readSettings(keys.msgKey);
    setSettings(cfg);
    settingsRef.current = cfg;

    const [history, outbox, mine] = await Promise.all([
      cfg.keepHistory ? loadHistory(keys.msgKey) : Promise.resolve([] as Msg[]),
      loadOutbox(keys.msgKey),
      loadStatuses(keys.msgKey),
    ]);

    const live = dropExpired(history);
    live.forEach((m) => seenRef.current.add(m.id));
    outboxRef.current = outbox;
    setMessages(live);
    setMyStatuses(mine);
    myStatusesRef.current = mine;

    if (cfg.quietNotifications) prepareNotifications();

    setUnlocked(true);
    // Unlocked because something was shared in and the app was locked: go to
    // what to do with it, not past it into the conversation.
    setScreen(sharedRef.current ? 'shared' : 'chat');
    connect(keys, cfg);
  }, [connect]);

  // ---- entrances ---------------------------------------------------------
  /** Called from the note editor with whatever the user typed — a PIN, or an
   *  ordinary note that is about to be saved as one. */
  const tryUnlock = useCallback(async (candidate: string): Promise<boolean> => {
    const marker = await readMarker();
    if (!marker) return false;
    const keys = openVault(marker, candidate);
    if (!keys) return false;

    // Sealed under a round count we no longer use, so unlocking it was slower
    // than it needs to be. Re-seal it with the current one while the PIN and the
    // pairing secret are both in hand: same secret, same room, same message key,
    // so nothing needs re-pairing and nothing already encrypted becomes
    // unreadable. Not awaited — the vault is open either way, and a write that
    // fails only means the next unlock is slow again.
    if (needsRestretch(marker)) {
      const { blob } = createVault(candidate, keys.pairing);
      writeMarker(blob).catch(() => {});
    }

    await enterVault(keys);
    return true;
  }, [enterVault]);

  const setupVault = useCallback(
    async (pin: string, secret: Uint8Array, relayUrl: string) => {
      const { blob, keys } = createVault(pin, secret);
      await writeMarker(blob);
      await writeSettings(keys.msgKey, defaultSettings(relayUrl.trim()));
      setHasVault(true);
      await enterVault(keys);
    },
    [enterVault],
  );

  // ---- notes -------------------------------------------------------------
  const persist = async (next: Note[]) => {
    setNotes(next);
    await saveNotes(next);
  };

  const onSaveNote = (n: Note) => {
    const others = notes.filter((x) => x.id !== n.id);
    persist([n, ...others].sort((a, b) => b.updatedAt - a.updatedAt));
    setActive(null);
    setScreen('list');
  };

  const onDeleteNote = (n: Note) => {
    persist(notes.filter((x) => x.id !== n.id));
    setActive(null);
    setScreen('list');
  };

  // ---- media -------------------------------------------------------------
  /**
   * Media only ever goes down the direct channel.
   *
   * Text can wait in the relay's mailbox because it is small and the relay
   * cannot read it. A photo is neither of those things by the same margin, and
   * queueing pictures on someone else's server is exactly what this app exists
   * to avoid — so if the partner is not here, we say so rather than storing it.
   */
  /**
   * Send a photo, clip or voice note.
   *
   * Partner here: chunked down the data channel, with progress, as before.
   * Partner away: sealed whole and left in the relay's mailbox, exactly like a
   * text message, so it is waiting when they open the app. The relay cannot
   * read it either way — it is the same ciphertext, and it is dropped the
   * moment it is collected.
   *
   * The offline road has a smaller size limit, because the file has to sit in
   * this phone's outbox and the relay's memory until then rather than streaming
   * past in seconds.
   */
  const shipMediaBytes = useCallback(async (
    kind: MediaKind,
    b64: string,
    mime: string,
    bytes: number,
    duration?: number,
  ) => {
    const peer = peerRef.current;
    const sig = sigRef.current;
    const id = newId();
    const at = Date.now();
    const uri = `data:${mime};base64,${b64}`;

    const ttl = settingsRef.current.messageTtl;
    const expiresAt = ttl > 0 ? at + ttl : undefined;
    // One look only is for photographs. A video already has a player with a
    // scrub bar in it, and a voice note has nothing to look at.
    const once = onceRef.current && kind === 'photo';

    const showIt = (delivery: Msg['delivery'], progress?: number) =>
      setMessages((m) => {
        const existing = m.some((x) => x.id === id);
        const row: Msg = {
          id, kind: 'out', body: '', at, delivery, progress, expiresAt, viewOnce: once,
          media: { kind, uri, mime, bytes, duration },
        };
        return existing ? m.map((x) => (x.id === id ? row : x)) : place(m, row);
      });

    // --- they are here: stream it ---
    if (peer?.isOpen) {
      showIt('sending', 0);
      setSending({ id, progress: 0 });
      const ok = await peer.sendMedia(id, kind, b64, mime, bytes, duration, (p) => {
        setSending({ id, progress: p });
        setMessages((m) => m.map((x) => (x.id === id ? { ...x, progress: p } : x)));
      }, undefined, expiresAt, once);
      setSending(null);
      showIt(ok ? 'delivered' : 'failed');
      return ok;
    }

    // --- they are away: leave it for them ---
    if (bytes > MAX_OFFLINE_MEDIA_BYTES) {
      Alert.alert(
        'Too big to leave waiting',
        'This is large enough that it needs you both in the app at once. A shorter clip will wait for them.',
      );
      return false;
    }
    showIt('sending');
    const wire = wrap({
      k: 'media-whole', id, kind, mime, bytes, duration, b64, at, exp: expiresAt, once,
    });
    if (!wire) return false;
    outboxRef.current = [...outboxRef.current, { id, wire, at }];
    persistOutbox();
    if (!sig?.mail(id, wire)) markDelivered(id, 'sending');
    return true;
  }, [markDelivered, persistOutbox, wrap]);

  const shipMedia = useCallback(async (
    kind: MediaKind,
    get: () => Promise<{ b64: string; mime: string; bytes: number; duration?: number } | null>,
  ) => {
    let picked;
    try {
      leaveOnPurpose();
      picked = await get();
    } catch (err) {
      Alert.alert(
        err instanceof TooLarge ? 'Too big' : 'Could not read that',
        err instanceof TooLarge
          ? 'That file is too large to send. Try a shorter video.'
          : 'Something went wrong getting that file.',
      );
      return;
    } finally {
      returnedOnPurpose();
    }
    if (!picked) return;

    await shipMediaBytes(kind, picked.b64, picked.mime, picked.bytes, picked.duration);
  }, [shipMediaBytes]);

  // ---- status ------------------------------------------------------------
  /** Push the current list (metadata only) whenever it changes. */
  const publishStatuses = useCallback((items: StatusItem[]) => {
    peerRef.current?.send({ k: 'status-list', items: items.filter(isLiveItem).map(toSummary) });
  }, []);

  const commitStatuses = useCallback(async (items: StatusItem[]) => {
    const keys = keysRef.current;
    if (!keys) return;
    const live = await writeStatuses(keys.msgKey, items);
    setMyStatuses(live);
    myStatusesRef.current = live;
    publishStatuses(live);
  }, [publishStatuses]);

  /**
   * Add one. Media is written to its own encrypted file; only the reference
   * goes in the list, so the key-value store never holds a video.
   */
  const addStatus = useCallback(async (
    kind: StatusItem['kind'],
    text: string,
    media?: { b64: string; mime: string; bytes: number; duration?: number },
    source?: string,
  ) => {
    const keys = keysRef.current;
    if (!keys) return;

    const at = Date.now();
    const item: StatusItem = {
      id: newId(),
      kind,
      text: text.trim(),
      at,
      expiresAt: at + STATUS_TTL_MS,
      source,
    };

    if (media) {
      item.mediaId = await writeStatusMedia(keys.msgKey, media.b64);
      item.mime = media.mime;
      item.bytes = media.bytes;
      item.duration = media.duration;
      item.uri = `data:${media.mime};base64,${media.b64}`;
    }

    await commitStatuses([item, ...myStatusesRef.current]);
  }, [commitStatuses]);

  const removeStatus = useCallback(async (id: string) => {
    await commitStatuses(myStatusesRef.current.filter((s) => s.id !== id));
  }, [commitStatuses]);

  /** Read one of ours back off disk, for viewing it again later. */
  const loadMyStatusMedia = useCallback(async (id: string) => {
    const keys = keysRef.current;
    const item = myStatusesRef.current.find((s) => s.id === id);
    if (!keys || !item?.mediaId || item.uri) return;
    const b64 = await readStatusMedia(keys.msgKey, item.mediaId);
    if (!b64) return;
    const uri = `data:${item.mime ?? 'image/jpeg'};base64,${b64}`;
    setMyStatuses((list) => list.map((s) => (s.id === id ? { ...s, uri } : s)));
    myStatusesRef.current = myStatusesRef.current.map((s) => (s.id === id ? { ...s, uri } : s));
  }, []);

  /** Ask for theirs when a viewer actually opens it. */
  const wantStatusMedia = useCallback((id: string) => {
    const item = theirStatuses.find((s) => s.id === id);
    if (!item || item.uri || item.kind === 'text') return;
    peerRef.current?.send({ k: 'status-want', id });
  }, [theirStatuses]);

  /** Answer a request for one of ours. */
  const sendStatusMedia = useCallback(async (item: StatusItem) => {
    const keys = keysRef.current;
    const peer = peerRef.current;
    if (!keys || !peer?.isOpen || !item.mediaId) return;
    const b64 = item.uri?.split(',')[1] ?? (await readStatusMedia(keys.msgKey, item.mediaId));
    if (!b64) return;
    await peer.sendMedia(
      newId(),
      item.kind === 'video' ? 'video' : 'photo',
      b64,
      item.mime ?? 'image/jpeg',
      item.bytes ?? 0,
      item.duration,
      () => {},
      item.id,
    );
  }, []);

  // Held in a ref so applyEnvelope can reach it without a circular dependency.
  const sendStatusMediaRef = useRef<((item: StatusItem) => void) | null>(null);
  sendStatusMediaRef.current = sendStatusMedia;

  const pickStatusMedia = useCallback(async (kind: 'photo' | 'video') => {
    try {
      leaveOnPurpose();
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return;
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: kind === 'video' ? ['videos'] : ['images'],
        quality: kind === 'video' ? 0.5 : 1,
        // A status is not a film, and every second is a second of encrypted
        // video sitting on the phone.
        videoMaxDuration: STATUS_VIDEO_SECONDS,
        exif: false, // no location, no camera serial
      });
      if (res.canceled || !res.assets?.length) return;
      const asset = res.assets[0];

      if (kind === 'photo') {
        const image = await toStatusImage(asset.uri);
        await addStatus('photo', '', {
          b64: image.uri.split(',')[1],
          mime: image.mime,
          bytes: image.bytes,
        });
        return;
      }

      const mime = asset.mimeType ?? 'video/mp4';
      const { b64, bytes } = await readSharedFile(asset.uri, mime);
      await addStatus('video', '', {
        b64, mime, bytes,
        duration: asset.duration ? asset.duration / 1000 : undefined,
      });
    } catch {
      Alert.alert('Could not use that', 'Something went wrong reading the file.');
    } finally {
      returnedOnPurpose();
    }
  }, [addStatus]);

  const sendShared = useCallback(async () => {
    const item = shared;
    if (!item) return;
    setSharedBusy(true);
    try {
      if (item.kind === 'text') {
        sendText(item.text ?? '');
      } else if (item.uri && item.mime) {
        const { b64, bytes } = await readSharedFile(item.uri, item.mime);
        await shipMediaBytes(item.kind, b64, item.mime, bytes, item.duration);
        // A caption travels as its own message, so it survives even if the
        // picture does not.
        if (item.text) sendText(item.text);
      }
    } catch {
      Alert.alert(
        'Could not send that',
        'The file may be too large, or the app that shared it has already taken it back.',
      );
    }
    setSharedBusy(false);
    setShared(null);
    setScreen('chat');
  }, [shared, sendText, shipMediaBytes]);

  const shareToStatus = useCallback(async () => {
    const item = shared;
    if (!item) return;
    setSharedBusy(true);
    try {
      if (item.kind === 'photo' && item.uri) {
        const image = await toStatusImage(item.uri);
        await addStatus('photo', item.text ?? '', {
          b64: image.uri.split(',')[1], mime: image.mime, bytes: image.bytes,
        }, 'shared');
      } else if (item.kind === 'video' && item.uri && item.mime) {
        const { b64, bytes } = await readSharedFile(item.uri, item.mime);
        await addStatus('video', item.text ?? '', {
          b64, mime: item.mime, bytes, duration: item.duration,
        }, 'shared');
      } else {
        await addStatus('text', item.text ?? '');
      }
    } catch {
      Alert.alert('Could not use that', 'The app that shared it may have already taken it back.');
    }
    setSharedBusy(false);
    setShared(null);
    setScreen('chat');
  }, [shared, addStatus]);

  /**
   * Change the PIN without touching anything else.
   *
   * The PIN only ever protected the pairing secret where it sits on this phone,
   * so changing it is re-sealing that same secret under a new one: new salt,
   * new nonce, same room, same message key. Nothing needs re-pairing and
   * nothing already encrypted becomes unreadable — the history, outbox and
   * statuses are all under the message key, which does not move.
   *
   * Being inside the vault is the authorisation. Asking for the old PIN again
   * would protect against someone holding your unlocked phone, who can already
   * read everything in it.
   */
  const changePin = useCallback(async (next: string): Promise<boolean> => {
    const keys = keysRef.current;
    if (!keys || next.trim().length < 4) return false;
    const { blob } = createVault(next, keys.pairing);
    await writeMarker(blob);
    return true;
  }, []);

  /**
   * Tell them we have their messages on screen.
   *
   * "Seen" here means exactly what it says: the chat was open and the message
   * was in it. There is no background delivery in this app, so there is no way
   * to be told something arrived without also being present to read it — which
   * makes this a more honest signal than it is in most chat apps.
   */
  const reportedSeen = useRef<Set<string>>(new Set());

  /**
   * Spend the single look.
   *
   * The bytes go, not just the ability to open them again: a photo left in
   * memory with a flag saying not to draw it is still a photo on the phone.
   * The row stays so the conversation still reads sensibly, saying only that
   * something was opened.
   */
  const burnViewOnce = useCallback((id: string) => {
    setMessages((m) => {
      const next = m.map((x) =>
        x.id === id ? { ...x, viewed: true, media: undefined } : x,
      );
      persistHistory(next);
      return next;
    });
  }, [persistHistory]);

  /**
   * Tell them we are writing, at most every few seconds.
   *
   * Sent down the direct channel when there is one and through the relay's
   * live path when there is not — which drops it if they are not there, since
   * a stale typing delivered tomorrow is worse than none.
   *
   * Repeated rather than sent once, because the far end forgets after six
   * seconds. That is what makes a lost stopped harmless.
   */
  const lastTypingSent = useRef(0);

  const sendTyping = useCallback((on: boolean) => {
    const now = Date.now();
    if (on && now - lastTypingSent.current < 3000) return;
    lastTypingSent.current = on ? now : 0;
    if (peerRef.current?.send({ k: 'typing', on })) return;
    const wire = wrap({ k: 'typing', on });
    if (wire) sigRef.current?.live(wire);
  }, [wrap]);

  const markSeen = useCallback((ids: string[]) => {
    if (!settingsRef.current.sendReadReceipts) return;
    const fresh = ids.filter((id) => !reportedSeen.current.has(id));
    if (!fresh.length) return;
    fresh.forEach((id) => reportedSeen.current.add(id));

    // Both roads, like everything else. This used to go only over the direct
    // WebRTC channel, so whenever there was not one — which is most of the time
    // on mobile data, and always in a build without WebRTC — the receipt simply
    // never left, and the sender's ticks never went green however carefully
    // their message had been read.
    if (peerRef.current?.send({ k: 'read', ids: fresh })) return;
    const wire = wrap({ k: 'read', ids: fresh });
    // Held for them if they have gone by now, which is the right answer: they
    // find out their message was read the next time they open the app.
    if (wire) sigRef.current?.mail(`read-${fresh[0]}`, wire);
  }, [wrap]);

  // ---- deleting ----------------------------------------------------------
  /**
   * Remove messages from this phone, and optionally from theirs.
   *
   * "For both" is a request, not a guarantee, and the UI says so: it only lands
   * if their app is running to receive it. Nothing here can reach a phone that
   * is switched off, and pretending otherwise would be the kind of promise this
   * app should not make.
   */
  /**
   * Taking a message back.
   *
   * Only off your own phone, unless you wrote it. Reaching into someone else's
   * phone to remove something they received is not deletion, it is editing
   * their memory of a conversation — so 'forBoth' carries only the ids of
   * messages this phone sent, whatever was selected. The rest go from here and
   * stay with them, which is the honest outcome.
   */
  const deleteMessages = useCallback((ids: string[], forBoth: boolean) => {
    const gone = new Set(ids);
    const mine = messagesRef.current
      .filter((m) => gone.has(m.id) && m.kind === 'out')
      .map((m) => m.id);

    setMessages((m) => {
      const next = m.filter((x) => !gone.has(x.id));
      persistHistory(next);
      return next;
    });
    // Stop re-sending anything that is being taken back.
    outboxRef.current = outboxRef.current.filter((p) => !gone.has(p.id));
    persistOutbox();

    if (!forBoth || !mine.length) return;
    // Both roads, as with everything else — and held for them if they have
    // gone, so a message taken back does not reappear when they next open it.
    if (peerRef.current?.send({ k: 'delete', ids: mine })) return;
    const wire = wrap({ k: 'delete', ids: mine });
    if (wire) sigRef.current?.mail(`del-${mine[0]}`, wire);
  }, [persistHistory, persistOutbox, wrap]);

  const clearChat = useCallback((forBoth: boolean) => {
    const ids = messagesRef.current.filter((m) => m.kind !== 'system').map((m) => m.id);
    deleteMessages(ids, forBoth);
  }, [deleteMessages]);

  // ---- calls -------------------------------------------------------------
  /**
   * Ask for the camera and microphone before ringing, not after.
   *
   * This used to ring first and open the camera only once the other side
   * accepted — and the failure was swallowed, so on a phone that had never
   * granted camera access the caller sat on an 'active' call screen with no
   * video and nothing said. Asking first also means the tracks exist before the
   * offer goes out, so there is one negotiation instead of two.
   */
  /** Ring, accept, decline, hang up — down the channel if there is one, and
   *  through the relay's live path if there is not. Calls used to need the
   *  direct channel to already be open, which meant the buttons sat greyed out
   *  while both people were plainly in the app. */
  const sendCall = useCallback((
    action: 'ring' | 'accept' | 'decline' | 'hangup',
    callKind?: CallKind,
  ) => {
    if (peerRef.current?.send({ k: 'call', action, callKind })) return;
    const wire = wrap({ k: 'call', action, callKind });
    if (wire) sigRef.current?.live(wire);
  }, [wrap]);

  const startCall = async (kind: CallKind) => {
    if (!peerPresent) return;
    try {
      // The permission dialog takes the app off screen; that must not lock it.
      leaveOnPurpose();
      await peerRef.current?.openMedia(kind);
    } catch {
      Alert.alert(
        'Permission needed',
        kind === 'video'
          ? 'Allow the camera and microphone to make a video call.'
          : 'Allow the microphone to make a call.',
      );
      return;
    } finally {
      // Without this the guard was raised and never lowered, and the lock
      // stopped working for the rest of the session after one call.
      returnedOnPurpose();
    }
    setCall({ kind, state: 'outgoing' });
    setMuted(false);
    setCameraOff(false);
    sendCall('ring', kind);
    setScreen('call');
  };

  const declineCall = () => {
    sendCall('decline');
    peerRef.current?.closeMedia();
    setCall(null);
    setScreen('chat');
  };

  const acceptCall = async () => {
    const c = callRef.current;
    if (!c) return;
    try {
      await peerRef.current?.openMedia(c.kind);
    } catch {
      Alert.alert('Permission needed', 'Allow microphone and camera access to take calls.');
      declineCall();
      return;
    }
    sendCall('accept', c.kind);
    setCall({ ...c, state: 'active' });
  };

  const hangUp = () => {
    sendCall('hangup');
    peerRef.current?.closeMedia();
    setCall(null);
    setScreen('chat');
    pushSystem('Call ended.');
  };

  // ---- render ------------------------------------------------------------
  const body = (() => {
    if (screen === 'gate') {
      return (
        <VaultGate
          mode={hasVault ? 'unlock' : 'setup'}
          onSetup={setupVault}
          onUnlock={tryUnlock}
          onCancel={() => setScreen('list')}
        />
      );
    }

    if (screen === 'call' && call) {
      return (
        <CallScreen
          kind={call.kind}
          state={call.state}
          localStream={localStream}
          remoteStream={remoteStream}
          muted={muted}
          cameraOff={cameraOff}
          onAccept={acceptCall}
          onDecline={declineCall}
          onHangup={hangUp}
          onToggleMute={() => setMuted(!!peerRef.current?.toggleMute())}
          onToggleCamera={() => setCameraOff(!!peerRef.current?.toggleCamera())}
          onSwitchCamera={() => peerRef.current?.switchCamera()}
        />
      );
    }

    if (screen === 'settings' && keysRef.current) {
      return (
        <VaultSettingsScreen
          settings={settings}
          roomId={keysRef.current.roomId}
          pairingPhrase={bytesToWords(keysRef.current.pairing)}
          onSave={async (incoming) => {
            let next = incoming;
            const keys = keysRef.current;
            // Read what it was BEFORE overwriting it. This used to assign first
            // and then compare the new settings against themselves, so the test
            // was always false and Android was never asked for permission to
            // post a notification — the switch went on and the dot never came,
            // with the system quietly recording the app as importance=NONE.
            const before = settingsRef.current;
            const wasKeeping = before.keepHistory;

            if (next.quietNotifications && !before.quietNotifications) {
              const allowed = await prepareNotifications();
              if (!allowed) {
                next = { ...next, quietNotifications: false };
                Alert.alert(
                  'Android said no',
                  'The dot needs permission to post a notification. Allow notifications for '
                  + 'Notes in Android settings, then turn this back on.',
                );
              }
            }

            setSettings(next);
            settingsRef.current = next;
            if (keys) await writeSettings(keys.msgKey, next);

            // Turning history off takes the existing log with it — otherwise
            // the switch says one thing and the disk says another.
            if (wasKeeping && !next.keepHistory) await clearHistory();
            if (!wasKeeping && next.keepHistory && keys) {
              await saveHistory(keys.msgKey, messagesRef.current);
            }

            // Reconnect so a changed relay or ICE list takes effect now.
            peerRef.current?.destroy();
            peerRef.current = null;
            sigRef.current?.close();
            sigRef.current = null;
            setConnected(false);
            if (keys) connect(keys, next);
            setScreen('chat');
          }}
          onChangePin={changePin}
          onDestroy={async () => {
            await destroyVault();
            await clearHistory();
            await clearOutbox();
            await clearStatuses();
            await wipeStatusMedia();
            setHasVault(false);
            lock();
          }}
          onBack={() => setScreen('chat')}
        />
      );
    }

    if (screen === 'shared' && unlocked && shared) {
      return (
        <SharedSheet
          item={shared}
          connected={connected}
          busy={sharedBusy}
          onSend={sendShared}
          onSetStatus={shareToStatus}
          onDiscard={() => { setShared(null); setScreen('chat'); }}
        />
      );
    }

    if (screen === 'chat' && unlocked) {
      return (
        <Chat
          onSetOnce={(on) => { onceRef.current = on; }}
          onBurn={burnViewOnce}
          messages={messages}
          status={status}
          connected={connected}
          peerPresent={peerPresent}
          lastSeen={lastSeen}
          theirTyping={theirTyping}
          onTyping={sendTyping}
          relayUp={relayUp}
          keepHistory={settings.keepHistory}
          pairedOnce={settings.pairedOnce}
          myStatuses={myStatuses}
          theirStatuses={theirStatuses}
          sending={sending}
          onSend={sendText}
          onAddTextStatus={(text) => addStatus('text', text)}
          onAddStatusMedia={pickStatusMedia}
          onRemoveStatus={removeStatus}
          onWantStatusMedia={wantStatusMedia}
          onLoadMyStatusMedia={loadMyStatusMedia}
          onMarkSeen={markSeen}
          onDeleteMessages={deleteMessages}
          onClearChat={clearChat}
          onPickPhoto={(camera) => shipMedia('photo', () => pickPhoto(camera))}
          onPickVideo={(camera) => shipMedia('video', () => pickVideo(camera))}
          onSendRecording={(uri, seconds) => shipMedia('audio', () => readRecording(uri, seconds))}
          onCall={startCall}
          onLock={lock}
          onSettings={() => setScreen('settings')}
        />
      );
    }

    if (screen === 'editor' && active) {
      return (
        <NoteEditor
          note={active}
          onSave={onSaveNote}
          onDelete={onDeleteNote}
          onCancel={() => {
            setActive(null);
            setScreen('list');
          }}
        />
      );
    }

    return (
      <NotesList
        notes={notes}
        showSetupHint={!hasVault}
        onOpen={(n) => {
          setActive(n);
          setScreen('editor');
        }}
        onNew={() => {
          setActive(newNote());
          setScreen('editor');
        }}
        onSecretGesture={() => setScreen('gate')}
      />
    );
  })();

  return (
    <SafeAreaProvider>
      {/* Every touch anywhere restarts the idle clock. Capture, and returning
          false, so this sees the touch without taking it from whatever was
          actually being pressed. */}
      <View
        style={[styles.root, { backgroundColor: unlocked ? T.vaultBg : T.paper }]}
        onStartShouldSetResponderCapture={() => {
          if (unlocked) nudgeIdle();
          return false;
        }}
      >
        {body}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
