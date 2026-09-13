import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Switch, Alert, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { T } from '../theme';
import { DEFAULT_ICE, RELAY_EXAMPLE, type VaultSettings } from '../store/vaultStore';
import QRCode from 'react-native-qrcode-svg';
import { encodePairing } from '../crypto/pairingCode';

type Props = {
  settings: VaultSettings;
  roomId: string;
  pairingPhrase: string;
  onSave: (s: VaultSettings) => void;
  /** Re-seal the vault under a new PIN. Resolves false if it was refused. */
  onChangePin: (next: string) => Promise<boolean>;
  onDestroy: () => void;
  onBack: () => void;
};

export default function VaultSettingsScreen({
  settings, roomId, pairingPhrase, onSave, onChangePin, onDestroy, onBack,
}: Props) {
  const [showPairing, setShowPairing] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [newPin2, setNewPin2] = useState('');
  const [pinMsg, setPinMsg] = useState('');

  const [relayUrl, setRelayUrl] = useState(settings.relayUrl);
  const [ice, setIce] = useState(JSON.stringify(settings.iceServers, null, 2));
  const [panic, setPanic] = useState(settings.panicOnBackground);
  const [block, setBlock] = useState(settings.blockScreenshots);
  const [keep, setKeep] = useState(settings.keepHistory);
  const [receipts, setReceipts] = useState(settings.sendReadReceipts);
  const [advanced, setAdvanced] = useState(false);
  const [quiet, setQuiet] = useState(settings.quietNotifications);
  const [err, setErr] = useState('');

  const savePin = async () => {
    if (newPin.trim().length < 4) return setPinMsg('The PIN needs at least 4 characters.');
    if (newPin !== newPin2) return setPinMsg('The two entries do not match.');
    if (!(await onChangePin(newPin))) return setPinMsg('Could not change it.');
    setPinMsg('Changed. Use the new one from now on.');
    setNewPin('');
    setNewPin2('');
    setPinOpen(false);
  };

  const save = () => {
    let parsed: any[];
    try {
      parsed = JSON.parse(ice);
      if (!Array.isArray(parsed)) throw new Error();
    } catch {
      return setErr('ICE servers must be a JSON array.');
    }
    const url = relayUrl.trim();
    if (!/^wss?:\/\//i.test(url)) return setErr('Relay must start with wss:// or ws://');
    onSave({
      relayUrl: url,
      iceServers: parsed,
      panicOnBackground: panic,
      blockScreenshots: block,
      keepHistory: keep,
      sendReadReceipts: receipts,
      quietNotifications: quiet,
      // Neither of these is a user setting: one records that the two phones
      // have actually met, the other identifies this install to the relay.
      // Saving other settings must not quietly reset either.
      pairedOnce: settings.pairedOnce,
      deviceId: settings.deviceId,
    });
  };

  /**
   * The warning has to answer the question people actually have afterwards,
   * which is not "is this permanent" but "can I get back in".
   *
   * Destroying erases this phone's copy — the vault, the PIN, the statuses, the
   * chat. It does not destroy the conversation: the room comes from the pairing
   * words, so anyone holding those can set up again and land in the same place.
   * Saying so here is the difference between a reversible mistake and a lost
   * conversation.
   */
  const confirmDestroy = () =>
    Alert.alert(
      'Destroy the vault on this phone?',
      'This erases the PIN, the statuses and the chat. Afterwards this is only a notes app.\n\n'
      + 'You can come back by setting up again with the same pairing words — they are on the '
      + 'other phone, and wherever you wrote them down. Without them, nobody can get back in, '
      + 'including you.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Show me the words first', onPress: () => setShowPairing(true) },
        { text: 'Destroy', style: 'destructive', onPress: onDestroy },
      ],
    );

  return (
    <SafeAreaView style={s.wrap} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor={T.vaultBg} />
      <View style={s.bar}>
        <TouchableOpacity onPress={onBack} hitSlop={12}>
          <Text style={{ color: T.vaultInkSoft, fontSize: 16 }}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={save} hitSlop={12}>
          <Text style={{ color: T.vaultInk, fontSize: 16, fontWeight: '700' }}>Save</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        <Text style={s.section}>The conversation</Text>
        <View style={s.rowItem}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={s.rowTitle}>Keep chat on this phone</Text>
            <Text style={s.rowSub}>
              Off, the chat lives only while the app is open and closing it erases the conversation
              from both phones. On, the messages are written here encrypted so they are waiting
              next time — which is what most people expect, and more for anyone holding your phone
              to find. Photos and voice notes are never kept either way.
            </Text>
          </View>
          <Switch value={keep} onValueChange={setKeep} />
        </View>
        <Text style={s.help}>
          Messages sent while your partner is away wait on the relay as ciphertext it cannot read,
          and are handed over the moment they open the app. Photos, video and voice notes never
          wait anywhere — you both have to be here for those.
        </Text>

        <View style={s.rowItem}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={s.rowTitle}>Tell them when you have read it</Text>
            <Text style={s.rowSub}>
              Their two ticks turn green once their message is on your screen. A read receipt says
              when you picked up your phone, which is a little more than "delivered" — turn it off
              and you still see theirs, they just stop seeing yours.
            </Text>
          </View>
          <Switch value={receipts} onValueChange={setReceipts} />
        </View>

        <Text style={s.section}>Safety</Text>
        <View style={s.rowItem}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={s.rowTitle}>Lock when the app leaves the screen</Text>
            <Text style={s.rowSub}>Switching apps wipes the conversation and drops the keys.</Text>
          </View>
          <Switch value={panic} onValueChange={setPanic} />
        </View>
        <View style={s.rowItem}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={s.rowTitle}>A dot when a message arrives</Text>
            <Text style={s.rowSub}>
              A small dot in the status bar and nothing else — no banner, no name, no preview, no
              sound. Open the app to see what it was.
              {panic
                ? ' It cannot work while "lock when the app leaves the screen" is on, because that closes the connection.'
                : ' It only works while the app is still in the background; once Android closes it, nothing arrives.'}
            </Text>
          </View>
          <Switch value={quiet && !panic} onValueChange={setQuiet} disabled={panic} />
        </View>

        <View style={s.rowItem}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={s.rowTitle}>Block screenshots</Text>
            <Text style={s.rowSub}>Also hides the vault from the app switcher preview.</Text>
          </View>
          <Switch value={block} onValueChange={setBlock} />
        </View>

        <Text style={s.section}>Your PIN</Text>
        <Text style={s.help}>
          What you type into a new note to get in here. It only protects this phone, so changing it
          does not disturb the pairing, the conversation, or anything already saved — and the other
          phone's PIN is its own business.
        </Text>

        {pinOpen ? (
          <>
            <TextInput
              style={s.input}
              value={newPin}
              onChangeText={(t) => { setNewPin(t); setPinMsg(''); }}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="new PIN"
              placeholderTextColor={T.vaultInkSoft}
              autoFocus
            />
            <TextInput
              style={[s.input, { marginTop: 10 }]}
              value={newPin2}
              onChangeText={(t) => { setNewPin2(t); setPinMsg(''); }}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="type it again"
              placeholderTextColor={T.vaultInkSoft}
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <TouchableOpacity
                style={[s.reveal, { flex: 1 }]}
                onPress={() => { setPinOpen(false); setNewPin(''); setNewPin2(''); setPinMsg(''); }}
              >
                <Text style={s.revealText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.reveal, { flex: 1, backgroundColor: T.mine, borderColor: T.mine }]}
                onPress={savePin}
              >
                <Text style={[s.revealText, { color: '#fff' }]}>Change it</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <TouchableOpacity style={s.reveal} onPress={() => setPinOpen(true)}>
            <Text style={s.revealText}>Change the PIN</Text>
          </TouchableOpacity>
        )}
        {!!pinMsg && <Text style={s.pinMsg}>{pinMsg}</Text>}

        <Text style={s.section}>Pairing phrase</Text>
        <Text style={s.help}>
          What connects the two phones. You need it to set up the second phone — and again if
          either phone ever reinstalls the app, since that wipes everything on it. Anyone who
          reads this can join the conversation, so do not leave it on screen.
        </Text>
        {showPairing ? (
          <>
            {/* The QR is here for the case that actually happens: one phone
                reinstalls the app and has to be paired again from scratch. */}
            <View style={s.qrCard}>
              <QRCode
                value={encodePairing(pairingPhrase)}
                size={190}
                backgroundColor="#FFFFFF"
                color="#000000"
              />
            </View>
            <Text style={s.pairing}>{pairingPhrase}</Text>
            <TouchableOpacity onPress={() => setShowPairing(false)}>
              <Text style={s.link}>Hide</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity style={s.reveal} onPress={() => setShowPairing(true)}>
            <Text style={s.revealText}>Show the code and words</Text>
          </TouchableOpacity>
        )}

        <Text style={s.section}>This pairing</Text>
        <Text style={s.help}>
          Both phones must show the same short code below. If they differ, one of you typed the
          phrase differently.
        </Text>
        <Text style={s.fingerprint}>{roomId.slice(0, 8).toUpperCase().match(/.{1,4}/g)?.join(' ')}</Text>

        {!!err && <Text style={s.err}>{err}</Text>}

        <TouchableOpacity style={s.advancedToggle} onPress={() => setAdvanced(!advanced)}>
          <Text style={s.advancedText}>
            {advanced ? 'Hide the technical settings' : 'Technical settings'}
          </Text>
          <Text style={s.advancedChevron}>{advanced ? '▲' : '▼'}</Text>
        </TouchableOpacity>
        {advanced && (
          <>
            <Text style={s.help}>
              You set these up once and then forget them. Nothing here needs changing unless the
              two phones stop finding each other.
            </Text>
        <Text style={s.section}>Rendezvous</Text>
        <Text style={s.help}>
          The relay only introduces the two phones to each other. It receives a hash and a blob of
          ciphertext, keeps nothing, and drops out once the call is up. Point it at your own server
          if you would rather not trust ours.
        </Text>
        <TextInput
          style={s.input}
          value={relayUrl}
          onChangeText={setRelayUrl}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={RELAY_EXAMPLE}
          placeholderTextColor={T.vaultInkSoft}
        />

        <Text style={s.section}>ICE servers</Text>
        <Text style={s.help}>
          STUN lets the phones find a direct path. A public STUN server learns your IP address —
          self-host coturn if that matters to you. Add a TURN entry here if a strict mobile network
          blocks the direct path.
        </Text>
        <TextInput
          style={[s.input, { height: 130, fontFamily: 'monospace', fontSize: 12 }]}
          value={ice}
          onChangeText={setIce}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          textAlignVertical="top"
        />
        <TouchableOpacity onPress={() => setIce(JSON.stringify(DEFAULT_ICE, null, 2))}>
          <Text style={s.link}>Reset to default</Text>
        </TouchableOpacity>
          </>
        )}

        <TouchableOpacity style={s.destroy} onPress={confirmDestroy}>
          <Text style={s.destroyText}>Destroy vault on this phone</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: T.vaultBg },
  bar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: T.vaultLine,
  },
  section: { color: T.vaultInk, fontSize: 17, fontWeight: '700', marginTop: 26, marginBottom: 6 },
  help: { color: T.vaultInkSoft, fontSize: 13, lineHeight: 19, marginBottom: 12 },
  input: {
    backgroundColor: T.vaultCard, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    color: T.vaultInk, fontSize: 14, borderWidth: 1, borderColor: T.vaultLine,
  },
  link: { color: T.mine, fontSize: 13, marginTop: 8 },
  pinMsg: { color: T.accent, fontSize: 13, marginTop: 10 },
  advancedToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 34, paddingVertical: 14,
    borderTopWidth: 1, borderTopColor: T.vaultLine,
  },
  advancedText: { color: T.vaultInkSoft, fontSize: 14, fontWeight: '600' },
  advancedChevron: { color: T.vaultInkSoft, fontSize: 11 },
  rowItem: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: T.vaultLine,
  },
  rowTitle: { color: T.vaultInk, fontSize: 15 },
  rowSub: { color: T.vaultInkSoft, fontSize: 12, marginTop: 3, lineHeight: 17 },
  qrCard: {
    backgroundColor: '#FFFFFF', padding: 14, borderRadius: 14,
    alignSelf: 'center', marginBottom: 14,
  },
  pairing: {
    color: T.accent, fontSize: 18, fontWeight: '600', lineHeight: 26,
    backgroundColor: T.vaultCard, borderRadius: 10, padding: 14,
    borderWidth: 1, borderColor: T.accent,
  },
  reveal: {
    borderWidth: 1, borderColor: T.vaultLine, borderRadius: 10,
    paddingVertical: 12, alignItems: 'center',
  },
  revealText: { color: T.vaultInk, fontSize: 14, fontWeight: '600' },
  fingerprint: {
    color: T.accent, fontSize: 24, fontWeight: '700', letterSpacing: 3,
    fontFamily: 'monospace', marginTop: 4,
  },
  err: { color: T.danger, marginTop: 16, fontSize: 14 },
  destroy: {
    marginTop: 40, borderWidth: 1, borderColor: T.danger, borderRadius: 10,
    paddingVertical: 14, alignItems: 'center',
  },
  destroyText: { color: T.danger, fontSize: 15, fontWeight: '600' },
});
