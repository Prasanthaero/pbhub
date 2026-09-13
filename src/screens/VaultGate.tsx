import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { T } from '../theme';

type Props = {
  mode: 'setup' | 'unlock';
  onSetup: (passphrase: string) => Promise<void>;
  onUnlock: (passphrase: string) => Promise<boolean>;
  onCancel: () => void;
};

export default function VaultGate({ mode, onSetup, onUnlock, onCancel }: Props) {
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const weak = p1.trim().length < 10;

  const go = async () => {
    setErr('');
    if (mode === 'setup') {
      if (weak) return setErr('Use at least 10 characters. A short phrase of real words beats a short password.');
      if (p1 !== p2) return setErr('The two entries do not match.');
    }
    setBusy(true);
    await new Promise((r) => setTimeout(r, 30));
    try {
      if (mode === 'setup') await onSetup(p1);
      else if (!(await onUnlock(p1))) {
        setErr('No.');
        setBusy(false);
        return;
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

      <View style={s.body}>
        <Text style={s.h}>{mode === 'setup' ? 'Create the phrase' : 'Phrase'}</Text>
        <Text style={s.sub}>
          {mode === 'setup'
            ? 'You and one other person type the exact same phrase. That is the entire setup — there are no accounts, no numbers, no names. Nobody can recover it for you, including this app.'
            : ' '}
        </Text>

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
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: T.vaultBg },
  body: { paddingHorizontal: 24, paddingTop: 24 },
  h: { fontSize: 28, fontWeight: '700', color: T.vaultInk },
  sub: { fontSize: 14, color: T.vaultInkSoft, marginTop: 10, marginBottom: 24, lineHeight: 20 },
  input: {
    backgroundColor: T.vaultCard, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
    color: T.vaultInk, fontSize: 17, marginBottom: 12, borderWidth: 1, borderColor: T.vaultLine,
  },
  err: { color: T.danger, marginBottom: 12, fontSize: 14 },
  btn: {
    backgroundColor: T.mine, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 4,
  },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  note: { color: T.vaultInkSoft, fontSize: 13, marginTop: 20, lineHeight: 19 },
});
