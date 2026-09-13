import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Switch, Alert, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { T } from '../theme';
import { DEFAULT_ICE, RELAY_EXAMPLE, type VaultSettings } from '../store/vaultStore';

type Props = {
  settings: VaultSettings;
  roomId: string;
  onSave: (s: VaultSettings) => void;
  onDestroy: () => void;
  onBack: () => void;
};

export default function VaultSettingsScreen({ settings, roomId, onSave, onDestroy, onBack }: Props) {
  const [relayUrl, setRelayUrl] = useState(settings.relayUrl);
  const [ice, setIce] = useState(JSON.stringify(settings.iceServers, null, 2));
  const [panic, setPanic] = useState(settings.panicOnBackground);
  const [block, setBlock] = useState(settings.blockScreenshots);
  const [err, setErr] = useState('');

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
    onSave({ relayUrl: url, iceServers: parsed, panicOnBackground: panic, blockScreenshots: block });
  };

  const confirmDestroy = () =>
    Alert.alert(
      'Destroy',
      'This erases the vault from this phone. Afterwards this is only a notes app, and the phrase opens nothing. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
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
            <Text style={s.rowTitle}>Block screenshots</Text>
            <Text style={s.rowSub}>Also hides the vault from the app switcher preview.</Text>
          </View>
          <Switch value={block} onValueChange={setBlock} />
        </View>

        <Text style={s.section}>This pairing</Text>
        <Text style={s.help}>
          Both phones must show the same short code below. If they differ, one of you typed the
          phrase differently.
        </Text>
        <Text style={s.fingerprint}>{roomId.slice(0, 8).toUpperCase().match(/.{1,4}/g)?.join(' ')}</Text>

        {!!err && <Text style={s.err}>{err}</Text>}

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
  rowItem: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: T.vaultLine,
  },
  rowTitle: { color: T.vaultInk, fontSize: 15 },
  rowSub: { color: T.vaultInkSoft, fontSize: 12, marginTop: 3, lineHeight: 17 },
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
