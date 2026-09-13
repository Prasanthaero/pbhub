import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
  StatusBar, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { T } from '../theme';
import { RELAY_EXAMPLE } from '../store/vaultStore';

type Props = {
  mode: 'setup' | 'unlock';
  onSetup: (passphrase: string, relayUrl: string) => Promise<void>;
  onUnlock: (passphrase: string) => Promise<boolean>;
  onCancel: () => void;
};

export default function VaultGate({ mode, onSetup, onUnlock, onCancel }: Props) {
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [relay, setRelay] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const go = async () => {
    setErr('');
    if (mode === 'setup') {
      if (p1.trim().length < 10) {
        return setErr('Use at least 10 characters. A few ordinary words beats a short password.');
      }
      if (p1 !== p2) return setErr('The two entries do not match.');
      if (!/^wss?:\/\/.+/i.test(relay.trim())) {
        return setErr('Enter the address of your relay, starting with wss://');
      }
    }
    setBusy(true);
    await new Promise((r) => setTimeout(r, 30));
    try {
      if (mode === 'setup') await onSetup(p1, relay);
      else if (!(await onUnlock(p1))) {
        setErr('No.');
        setBusy(false);
      }
    } catch {
      setErr('Something went wrong.');
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={s.wrap}>
      <StatusBar barStyle="light-content" backgroundColor={T.vaultBg} />
      <TouchableOpacity onPress={onCancel} hitSlop={12} style={{ padding: 16 }}>
        <Text style={{ color: T.vaultInkSoft, fontSize: 16 }}>Back</Text>
      </TouchableOpacity>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          <Text style={s.h}>{mode === 'setup' ? 'Create the phrase' : 'Phrase'}</Text>

          {mode === 'setup' && (
            <Text style={s.sub}>
              You and one other person type the exact same phrase. That is the whole setup — no
              accounts, no numbers, no names. Nobody can recover it for you, including this app.
            </Text>
          )}

          <TextInput
            style={s.input}
            value={p1}
            onChangeText={setP1}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="passphrase"
            placeholderTextColor={T.vaultInkSoft}
            autoFocus
          />

          {mode === 'setup' && (
            <>
              <TextInput
                style={s.input}
                value={p2}
                onChangeText={setP2}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="type it again"
                placeholderTextColor={T.vaultInkSoft}
              />

              <Text style={s.label}>Relay address</Text>
              <Text style={s.sub}>
                Two phones that have never met need something to introduce them. The relay does
                only that: it sees a hash and ciphertext, keeps nothing, and drops out once you are
                connected. Run your own — <Text style={s.mono}>server/</Text> in the project — and
                put its address here. Both of you must use the same one.
              </Text>
              <TextInput
                style={s.input}
                value={relay}
                onChangeText={setRelay}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder={RELAY_EXAMPLE}
                placeholderTextColor={T.vaultInkSoft}
              />
            </>
          )}

          {!!err && <Text style={s.err}>{err}</Text>}

          <TouchableOpacity style={[s.btn, busy && { opacity: 0.6 }]} onPress={go} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" />
              : <Text style={s.btnText}>{mode === 'setup' ? 'Create' : 'Open'}</Text>}
          </TouchableOpacity>

          {mode === 'setup' && (
            <Text style={s.note}>
              Once this exists, you get back in by opening a new note and typing the phrase into it.
            </Text>
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: T.vaultBg },
  body: { paddingHorizontal: 24, paddingTop: 16 },
  h: { fontSize: 28, fontWeight: '700', color: T.vaultInk, marginBottom: 10 },
  label: { fontSize: 15, fontWeight: '600', color: T.vaultInk, marginTop: 22 },
  sub: { fontSize: 13.5, color: T.vaultInkSoft, marginTop: 8, marginBottom: 18, lineHeight: 20 },
  mono: { fontFamily: 'monospace', color: T.vaultInk },
  input: {
    backgroundColor: T.vaultCard, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
    color: T.vaultInk, fontSize: 16, marginBottom: 12, borderWidth: 1, borderColor: T.vaultLine,
  },
  err: { color: T.danger, marginBottom: 12, fontSize: 14, lineHeight: 20 },
  btn: {
    backgroundColor: T.mine, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 8,
  },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  note: { color: T.vaultInkSoft, fontSize: 13, marginTop: 20, lineHeight: 19 },
});
