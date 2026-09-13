import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, View, StyleSheet, Alert, Platform, UIManager } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as ScreenCapture from 'expo-screen-capture';
import type { MediaStream } from 'react-native-webrtc';

import { T } from './src/theme';
import { openVault, createVault, wipe, type VaultKeys } from './src/crypto/vault';
import {
  readMarker, writeMarker, destroyVault, readSettings, writeSettings,
  defaultSettings, type VaultSettings,
} from './src/store/vaultStore';
import { loadNotes, saveNotes, newNote, type Note } from './src/store/notes';
import { mkMsg, type Msg } from './src/store/messages';
import { Signaling, type Role } from './src/net/signaling';
import { Peer, type CallKind } from './src/net/peer';

import NotesList from './src/screens/NotesList';
import NoteEditor from './src/screens/NoteEditor';
import VaultGate from './src/screens/VaultGate';
import Chat from './src/screens/Chat';
import CallScreen, { type CallState } from './src/screens/Call';
import VaultSettingsScreen from './src/screens/VaultSettings';

type Screen = 'list' | 'editor' | 'gate' | 'chat' | 'call' | 'settings';
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

  // ---- vault (all of this is RAM-only) -----------------------------------
  const keysRef = useRef<VaultKeys | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [settings, setSettings] = useState<VaultSettings>(defaultSettings());
  const [messages, setMessages] = useState<Msg[]>([]);
  const [status, setStatus] = useState('Offline');
  const [connected, setConnected] = useState(false);

  const sigRef = useRef<Signaling | null>(null);
  const peerRef = useRef<Peer | null>(null);
  const roleRef = useRef<Role>('a');

  const [call, setCall] = useState<CallInfo | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);

  useEffect(() => {
    loadNotes().then(setNotes);
    readMarker().then((m) => setHasVault(!!m));
  }, []);

  const pushSystem = useCallback((body: string) => {
    setMessages((m) => [...m, mkMsg('system', body)]);
  }, []);

  // ---- teardown ----------------------------------------------------------
  const lock = useCallback(() => {
    peerRef.current?.destroy();
    peerRef.current = null;
    sigRef.current?.close();
    sigRef.current = null;
    wipe(keysRef.current?.msgKey);
    keysRef.current = null;
    setMessages([]);
    setLocalStream(null);
    setRemoteStream(null);
    setCall(null);
    setConnected(false);
    setStatus('Offline');
    setUnlocked(false);
    setActive(null);
    setScreen('list');
  }, []);

  // Leaving the foreground closes everything, if asked to.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active' && unlocked && settings.panicOnBackground) lock();
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

  // ---- transport ---------------------------------------------------------
  const buildPeer = useCallback((keys: VaultKeys, cfg: VaultSettings, role: Role) => {
    const peer = new Peer(role, cfg.iceServers, keys.msgKey, (m) => sigRef.current?.send(m), {
      onChannelOpen: (open) => {
        setConnected(open);
        setStatus(open ? 'Connected, direct' : 'Waiting for partner…');
        if (open) pushSystem('Connected directly. Nothing is being stored.');
      },
      onMessage: (text, at) => setMessages((m) => [...m, mkMsg('in', text, at)]),
      onLocalStream: setLocalStream,
      onRemoteStream: setRemoteStream,
      onConnectionState: (cs) => {
        if (cs === 'failed') setStatus('Could not find a direct path');
        else if (cs === 'connected') setStatus('Connected, direct');
      },
      onCallSignal: (action, kind) => {
        if (action === 'ring') {
          setCall({ kind: kind ?? 'audio', state: 'incoming' });
          setScreen('call');
        } else if (action === 'accept') {
          // The caller only reaches for the camera once the other side says yes.
          setCall((c) => {
            if (!c) return c;
            peerRef.current?.openMedia(c.kind).catch(() => {});
            return { ...c, state: 'active' };
          });
        } else if (action === 'decline' || action === 'hangup') {
          peerRef.current?.closeMedia();
          setCall(null);
          setScreen('chat');
          pushSystem(action === 'decline' ? 'Call declined.' : 'Call ended.');
        }
      },
    });
    peerRef.current = peer;
    return peer;
  }, [pushSystem]);

  const connect = useCallback((keys: VaultKeys, cfg: VaultSettings) => {
    const sig = new Signaling(cfg.relayUrl, keys.roomId, keys.msgKey, {
      onReady: (role) => {
        roleRef.current = role;
        if (!peerRef.current) buildPeer(keys, cfg, role);
      },
      onPeerPresent: (present) => {
        if (present) {
          if (!peerRef.current) buildPeer(keys, cfg, roleRef.current);
          peerRef.current?.start();
        } else {
          setConnected(false);
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
      },
    });
    sigRef.current = sig;
    sig.connect();
  }, [buildPeer]);

  const enterVault = useCallback(async (keys: VaultKeys) => {
    keysRef.current = keys;
    const cfg = await readSettings(keys.msgKey);
    setSettings(cfg);
    setMessages([]);
    setUnlocked(true);
    setScreen('chat');
    connect(keys, cfg);
  }, [connect]);

  // ---- entrances ---------------------------------------------------------
  /** Called from the note editor with whatever the user typed. */
  const tryUnlock = useCallback(async (candidate: string): Promise<boolean> => {
    const marker = await readMarker();
    if (!marker) return false;
    const keys = openVault(marker, candidate);
    if (!keys) return false;
    await enterVault(keys);
    return true;
  }, [enterVault]);

  const setupVault = useCallback(async (passphrase: string) => {
    const { blob, keys } = createVault(passphrase);
    await writeMarker(blob);
    await writeSettings(keys.msgKey, defaultSettings());
    setHasVault(true);
    await enterVault(keys);
  }, [enterVault]);

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

  // ---- calls -------------------------------------------------------------
  const startCall = (kind: CallKind) => {
    if (!connected) return;
    setCall({ kind, state: 'outgoing' });
    setMuted(false);
    setCameraOff(false);
    peerRef.current?.signalCall('ring', kind);
    setScreen('call');
  };

  const declineCall = () => {
    peerRef.current?.signalCall('decline');
    peerRef.current?.closeMedia();
    setCall(null);
    setScreen('chat');
  };

  const acceptCall = async () => {
    if (!call) return;
    try {
      await peerRef.current?.openMedia(call.kind);
    } catch {
      Alert.alert('Permission needed', 'Allow microphone and camera access to take calls.');
      declineCall();
      return;
    }
    peerRef.current?.signalCall('accept', call.kind);
    setCall({ ...call, state: 'active' });
  };

  const hangUp = () => {
    peerRef.current?.signalCall('hangup');
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
          onSave={async (next) => {
            const keys = keysRef.current;
            setSettings(next);
            if (keys) await writeSettings(keys.msgKey, next);
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
            setHasVault(false);
            lock();
          }}
          onBack={() => setScreen('chat')}
        />
      );
    }

    if (screen === 'chat' && unlocked) {
      return (
        <Chat
          messages={messages}
          status={status}
          connected={connected}
          onSend={(text) => {
            if (peerRef.current?.sendMessage(text)) {
              setMessages((m) => [...m, mkMsg('out', text)]);
            }
          }}
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
      <View style={[styles.root, { backgroundColor: unlocked ? T.vaultBg : T.paper }]}>
        {body}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
