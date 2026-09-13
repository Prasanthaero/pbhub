import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, View, StyleSheet, Alert, Platform, UIManager } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as ScreenCapture from 'expo-screen-capture';
import type { MediaStream } from 'react-native-webrtc';

import { T } from './src/theme';
import { openVault, createVault, wipe, type VaultKeys } from './src/crypto/vault';
import { bytesToWords } from './src/crypto/wordlist';
import {
  readMarker, writeMarker, destroyVault, readSettings, writeSettings,
  defaultSettings, type VaultSettings,
} from './src/store/vaultStore';
import { loadNotes, saveNotes, newNote, type Note } from './src/store/notes';
import { mkMsg, newId, type Msg, type MediaKind } from './src/store/messages';
import { loadHistory, saveHistory, clearHistory } from './src/store/history';
import { loadOutbox, saveOutbox, clearOutbox, type Pending } from './src/store/outbox';
import {
  loadStatus, saveStatus, clearStatus, isLive, type Status, type StatusImage,
} from './src/store/status';
import { Signaling, type Role } from './src/net/signaling';
import { Peer, type CallKind } from './src/net/peer';
import type { Envelope } from './src/net/transport';
import { pickPhoto, pickVideo, readRecording, TooLarge } from './src/media/pick';
import {
  readSharedFile, toStatusImage, kindForMime, type SharedItem,
} from './src/media/shared';
import { useShareIntent } from 'expo-share-intent';
import * as ImagePicker from 'expo-image-picker';

import NotesList from './src/screens/NotesList';
import NoteEditor from './src/screens/NoteEditor';
import VaultGate from './src/screens/VaultGate';
import Chat from './src/screens/Chat';
import CallScreen, { type CallState } from './src/screens/Call';
import VaultSettingsScreen from './src/screens/VaultSettings';
import SharedSheet from './src/screens/SharedSheet';

type Screen = 'list' | 'editor' | 'gate' | 'chat' | 'call' | 'settings' | 'shared';
type CallInfo = { kind: CallKind; state: CallState };

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export default function App() {
  // ---- cover story -------------------------------------------------------
  const [notes, setNotes] = useState<Note[]>([]);
  const [active, setActive] = useState<Note | null>(null);
  const [activeIsNew, setActiveIsNew] = useState(false);
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
  const [relayUp, setRelayUp] = useState(false);

  const [myStatus, setMyStatus] = useState<Status | null>(null);
  const myStatusRef = useRef<Status | null>(null);
  myStatusRef.current = myStatus;
  const [theirStatus, setTheirStatus] = useState<Status | null>(null);

  const sigRef = useRef<Signaling | null>(null);
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
  const [sharedBusy, setSharedBusy] = useState(false);

  useEffect(() => {
    loadNotes().then(setNotes);
    readMarker().then((m) => setHasVault(!!m));
  }, []);

  const pushSystem = useCallback((body: string) => {
    setMessages((m) => [...m, mkMsg('system', body)]);
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

  // ---- teardown ----------------------------------------------------------
  const lock = useCallback(() => {
    peerRef.current?.destroy();
    peerRef.current = null;
    sigRef.current?.close();
    sigRef.current = null;
    wipe(keysRef.current?.msgKey);
    wipe(keysRef.current?.pairing);
    keysRef.current = null;
    outboxRef.current = [];
    seenRef.current = new Set();
    setMessages([]);
    setLocalStream(null);
    setRemoteStream(null);
    setCall(null);
    setConnected(false);
    setRelayUp(false);
    setSending(null);
    setShared(null);
    setSharedBusy(false);
    setMyStatus(null);
    setTheirStatus(null);
    setStatus('Offline');
    setUnlocked(false);
    setActive(null);
    setScreen('list');
  }, [setCall]);

  // Leaving the foreground closes everything, if asked to.
  //
  // Deliberately 'background' and not "anything but active": Android reports
  // 'inactive' while a permission dialog is on screen, and locking the vault the
  // instant someone taps Allow on the microphone prompt would make calls
  // impossible to answer.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background' && unlocked && settings.panicOnBackground) lock();
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
          const next = [...m, { id: e.id, kind: 'in' as const, body: e.body, at: e.at || at }];
          persistHistory(next);
          return next;
        });
        // Receipt travels whichever road is open.
        if (!peerRef.current?.send({ k: 'ack', id: e.id })) sigRef.current?.ack(e.id);
        return;
      }
      case 'ack': {
        outboxRef.current = outboxRef.current.filter((p) => p.id !== e.id);
        persistOutbox();
        markDelivered(e.id, 'delivered');
        return;
      }
      case 'status':
        setTheirStatus({
          text: e.text, at: e.at, expiresAt: e.expiresAt, image: e.image, source: e.source,
        });
        return;
      case 'status-clear':
        setTheirStatus(null);
        return;
      case 'call': {
        if (e.action === 'ring') {
          setCall({ kind: e.callKind ?? 'audio', state: 'incoming' });
          setScreen('call');
        } else if (e.action === 'accept') {
          const c = callRef.current;
          if (c) {
            setCall({ ...c, state: 'active' });
            peerRef.current?.openMedia(c.kind).catch(() => {});
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
    if (!peer) return;

    const id = newId();
    const at = Date.now();
    // Sealed once; both roads carry the identical bytes.
    const wire = peer.wrap({ k: 'msg', id, body, at });

    setMessages((m) => {
      const next: Msg[] = [...m, { id, kind: 'out', body, at, delivery: 'sending' }];
      persistHistory(next);
      return next;
    });

    outboxRef.current = [...outboxRef.current, { id, wire, at }];
    persistOutbox();

    // Direct if we can, mailbox if we cannot, and the outbox covers neither.
    if (!peer.sendWire(wire)) sig?.mail(id, wire);
  }, [persistHistory, persistOutbox]);

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
    const peer = new Peer(role, cfg.iceServers, keys.msgKey, (m) => sigRef.current?.send(m), {
      onChannelOpen: (open) => {
        setConnected(open);
        setStatus(open ? 'Connected, direct' : 'Waiting for partner…');
        if (!open) return;
        pushSystem('Connected directly.');
        flushOutbox();
        const mine = myStatusRef.current;
        if (isLive(mine)) {
          peer.send({
            k: 'status', text: mine.text, at: mine.at, expiresAt: mine.expiresAt,
            image: mine.image, source: mine.source,
          });
        }
      },
      onEnvelope: (e) => applyEnvelope(e),
      onMedia: (id, kind, uri, mime, bytes, at, duration) => {
        if (seenRef.current.has(id)) return;
        seenRef.current.add(id);
        setMessages((m) => [
          ...m.filter((x) => x.id !== id),
          { id, kind: 'in', body: '', at, media: { kind, uri, mime, bytes, duration } },
        ]);
      },
      onMediaProgress: (id, progress) => {
        setMessages((m) =>
          m.some((x) => x.id === id)
            ? m.map((x) => (x.id === id ? { ...x, progress } : x))
            : [...m, { id, kind: 'in' as const, body: '', at: Date.now(), progress }],
        );
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
        if (present) {
          if (!peerRef.current) buildPeer(keys, cfg, roleRef.current);
          peerRef.current?.start();
        } else {
          setConnected(false);
          setTheirStatus(null);
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
        setRelayUp(false);
      },
      onMail: (id, wire, at) => {
        // Still sealed at this point; only we hold the key.
        const peer = peerRef.current;
        if (!peer) return;
        const e = peer.unwrap(wire);
        if (e) applyEnvelope(e, at);
      },
      onMailDone: (count) => {
        if (count > 0) {
          pushSystem(`${count} message${count === 1 ? '' : 's'} arrived while you were away.`);
        }
      },
      onMailHeld: (id) => markDelivered(id, 'held'),
      onMailFull: (id) => markDelivered(id, 'failed'),
      onAck: (id) => {
        outboxRef.current = outboxRef.current.filter((p) => p.id !== id);
        persistOutbox();
        markDelivered(id, 'delivered');
      },
    });
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
      loadStatus(keys.msgKey),
    ]);

    history.forEach((m) => seenRef.current.add(m.id));
    outboxRef.current = outbox;
    setMessages(history);
    setMyStatus(mine);
    myStatusRef.current = mine;

    setUnlocked(true);
    setScreen('chat');
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
  /** Push already-read bytes across, showing progress as it goes. */
  const shipMediaBytes = useCallback(async (
    kind: MediaKind,
    b64: string,
    mime: string,
    bytes: number,
    duration?: number,
  ) => {
    const peer = peerRef.current;
    if (!peer?.isOpen) return false;

    const id = newId();
    const at = Date.now();
    setMessages((m) => [
      ...m,
      {
        id, kind: 'out', body: '', at, delivery: 'sending', progress: 0,
        media: { kind, uri: `data:${mime};base64,${b64}`, mime, bytes, duration },
      },
    ]);
    setSending({ id, progress: 0 });

    const ok = await peer.sendMedia(id, kind, b64, mime, bytes, duration, (p) => {
      setSending({ id, progress: p });
      setMessages((m) => m.map((x) => (x.id === id ? { ...x, progress: p } : x)));
    });

    setSending(null);
    setMessages((m) =>
      m.map((x) =>
        x.id === id ? { ...x, progress: undefined, delivery: ok ? 'delivered' : 'failed' } : x,
      ),
    );
    return ok;
  }, []);

  const shipMedia = useCallback(async (
    kind: MediaKind,
    get: () => Promise<{ b64: string; mime: string; bytes: number; duration?: number } | null>,
  ) => {
    if (!peerRef.current?.isOpen) {
      Alert.alert(
        'Not connected',
        'Photos, video and voice notes go straight between the phones, so you both need to be in the app. Text can wait for them; pictures cannot.',
      );
      return;
    }

    let picked;
    try {
      picked = await get();
    } catch (err) {
      Alert.alert(
        err instanceof TooLarge ? 'Too big' : 'Could not read that',
        err instanceof TooLarge
          ? 'That file is too large to send. Try a shorter video.'
          : 'Something went wrong getting that file.',
      );
      return;
    }
    if (!picked) return;

    await shipMediaBytes(kind, picked.b64, picked.mime, picked.bytes, picked.duration);
  }, [shipMediaBytes]);

  // ---- status ------------------------------------------------------------
  const updateStatus = useCallback(async (
    text: string,
    image?: StatusImage,
    source?: string,
  ) => {
    const keys = keysRef.current;
    if (!keys) return;
    const s = await saveStatus(keys.msgKey, text, image, source);
    setMyStatus(s);
    myStatusRef.current = s;
    peerRef.current?.send(
      s
        ? {
            k: 'status', text: s.text, at: s.at, expiresAt: s.expiresAt,
            image: s.image, source: s.source,
          }
        : { k: 'status-clear' },
    );
  }, []);

  // ---- shared from another app -------------------------------------------
  /**
   * Whatever Instagram, Facebook, the gallery or a browser just handed us.
   *
   * The bytes are read immediately rather than on the user's next tap: the
   * content:// URI in a share is borrowed, and the permission behind it is
   * routinely gone by the time someone has unlocked and made up their mind.
   */
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent({
    resetOnBackground: false,
  });

  useEffect(() => {
    if (!hasShareIntent || !shareIntent) return;

    const take = async () => {
      const file = shareIntent.files?.[0];
      const caption = shareIntent.text ?? shareIntent.webUrl ?? undefined;

      if (!file) {
        if (!caption) return resetShareIntent();
        setShared({ kind: 'text', text: caption });
      } else {
        const mime = file.mimeType || 'image/jpeg';
        setShared({
          kind: kindForMime(mime),
          text: caption,
          uri: file.path,
          mime,
          bytes: file.size ?? undefined,
          duration: file.duration ?? undefined,
        });
      }
      resetShareIntent();
      // Locked? Leave them at the notes list; the sheet is shown once they are
      // in. Nothing about the share is visible until then.
      setScreen((s) => (keysRef.current ? 'shared' : s));
    };

    take();
  }, [hasShareIntent, shareIntent, resetShareIntent]);

  // A share that arrived while locked surfaces the moment the vault opens.
  useEffect(() => {
    if (unlocked && shared && screen === 'chat') setScreen('shared');
  }, [unlocked, shared, screen]);

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
      Alert.alert('Could not send that', 'The file may be too large, or the app that shared it has already taken it back.');
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
      // Video makes a poor status and a worse thing to store; keep the words.
      const image = item.kind === 'photo' && item.uri ? await toStatusImage(item.uri) : undefined;
      await updateStatus(item.text ?? '', image, item.kind === 'text' ? undefined : 'shared');
    } catch {
      Alert.alert('Could not use that', 'The app that shared it may have already taken it back.');
    }
    setSharedBusy(false);
    setShared(null);
    setScreen('chat');
  }, [shared, updateStatus]);

  const pickStatusPhoto = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return;
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
        exif: false, // no location, no camera serial
      });
      if (res.canceled || !res.assets?.length) return;
      const image = await toStatusImage(res.assets[0].uri);
      await updateStatus(myStatusRef.current?.text ?? '', image);
    } catch {
      Alert.alert('Could not use that', 'Something went wrong reading the picture.');
    }
  }, [updateStatus]);

  // ---- calls -------------------------------------------------------------
  const startCall = (kind: CallKind) => {
    if (!connected) return;
    setCall({ kind, state: 'outgoing' });
    setMuted(false);
    setCameraOff(false);
    peerRef.current?.send({ k: 'call', action: 'ring', callKind: kind });
    setScreen('call');
  };

  const declineCall = () => {
    peerRef.current?.send({ k: 'call', action: 'decline' });
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
    peerRef.current?.send({ k: 'call', action: 'accept', callKind: c.kind });
    setCall({ ...c, state: 'active' });
  };

  const hangUp = () => {
    peerRef.current?.send({ k: 'call', action: 'hangup' });
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
          onSave={async (next) => {
            const keys = keysRef.current;
            const wasKeeping = settingsRef.current.keepHistory;
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
          onDestroy={async () => {
            await destroyVault();
            await clearHistory();
            await clearOutbox();
            await clearStatus();
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
          messages={messages}
          status={status}
          connected={connected}
          relayUp={relayUp}
          keepHistory={settings.keepHistory}
          myStatus={myStatus}
          theirStatus={theirStatus}
          sending={sending}
          onSend={sendText}
          onSetStatus={updateStatus}
          onPickStatusPhoto={pickStatusPhoto}
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
          isNew={activeIsNew}
          tryUnlock={tryUnlock}
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
        onOpen={(n) => {
          setActive(n);
          setActiveIsNew(false);
          setScreen('editor');
        }}
        onNew={() => {
          setActive(newNote());
          setActiveIsNew(true);
          setScreen('editor');
        }}
        onSecretGesture={() => setScreen('gate')}
      />
    );
  })();

  return (
    <SafeAreaProvider>
      <View style={[styles.root, { backgroundColor: unlocked ? T.vaultBg : T.paper }]}>
        {body}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
