import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
  StatusBar, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { T } from '../theme';
import { inExpoGo } from '../env';
import { DEFAULT_RELAY } from '../store/vaultStore';
import {
  generatePairingSecret, bytesToWords, wordsToBytes, PAIRING_BYTES,
} from '../crypto/wordlist';
import PairScreen from './PairScreen';

type Props = {
  mode: 'setup' | 'unlock';
  onSetup: (pin: string, secret: Uint8Array, relayUrl: string) => Promise<void>;
  onUnlock: (pin: string) => Promise<boolean>;
  onCancel: () => void;
};

/** Prefilled so the common case is one tap. Editable — it is only a default. */
const DEFAULT_PIN = '110490';

export default function VaultGate({ mode, onSetup, onUnlock, onCancel }: Props) {
  const [pin, setPin] = useState(mode === 'setup' ? DEFAULT_PIN : '');
  const [pin2, setPin2] = useState(mode === 'setup' ? DEFAULT_PIN : '');
  const [pairing, setPairing] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [generated, setGenerated] = useState(false);
  /** The QR sheet: showing this phone's code, or scanning the other's. */
  const [pairing_open, setPairingOpen] = useState(false);

  const makePairing = () => {
    setPairing(bytesToWords(generatePairingSecret()));
    setGenerated(true);
    setErr('');
  };

  /** Open the QR screen, making a secret first if this phone has none yet. */
  const openPairing = () => {
    if (!wordsToBytes(pairing)) {
      setPairing(bytesToWords(generatePairingSecret()));
      setGenerated(true);
    }
    setErr('');
    setPairingOpen(true);
  };

  const go = async () => {
    setErr('');

    if (mode === 'unlock') {
      setBusy(true);
      await new Promise((r) => setTimeout(r, 30));
      if (!(await onUnlock(pin))) {
        setErr('That is not the PIN for this phone.');
        setBusy(false);
      }
      return;
    }

    if (pin.trim().length < 4) return setErr('The PIN needs at least 4 characters.');
    // No spaces. The way in is typing the PIN as one word in a note, and that
    // route deliberately ignores anything with a space in it so that writing an
    // ordinary note does not pause for two seconds. Accepting a PIN here that
    // the note route could never carry would lock someone out of their own
    // vault, and they would have no way to work out why.
    if (/s/.test(pin.trim())) {
      return setErr('No spaces in the PIN — you type it as one word into a note.');
    }
    if (pin.trim().length > 64) return setErr('That PIN is too long to type into a note.');
    if (pin !== pin2) return setErr('The two PINs do not match.');

    const secret = wordsToBytes(pairing);
    if (!secret) {
      return setErr(
        pairing.trim()
          ? 'That code is not right — check it against the other phone.'
          : 'Make a code on one phone and scan it with the other.',
      );
    }

    setBusy(true);
    await new Promise((r) => setTimeout(r, 30));
    try {
      await onSetup(pin, secret, DEFAULT_RELAY);
    } catch {
      setErr('Something went wrong.');
      setBusy(false);
    }
  };

  // ---- unlock: just the PIN ------------------------------------------------
  if (mode === 'unlock') {
    return (
      <SafeAreaView style={s.wrap}>
        <StatusBar barStyle="light-content" backgroundColor={T.vaultBg} />
        <TouchableOpacity onPress={onCancel} hitSlop={12} style={{ padding: 16 }}>
          <Text style={{ color: T.vaultInkSoft, fontSize: 16 }}>Back</Text>
        </TouchableOpacity>
        <View style={s.body}>
          <Text style={s.h}>PIN</Text>
          <TextInput
            style={s.input}
            value={pin}
            onChangeText={(t) => { setPin(t); if (err) setErr(''); }}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            // Deliberately the ordinary keyboard. This used to be a number pad,
            // which locked out anyone whose PIN had a letter in it — setup
            // accepts any characters, so this must too. A keyboard that cannot
            // type the PIN the app itself allowed is not a small bug.
            placeholder="your PIN"
            placeholderTextColor={T.vaultInkSoft}
            autoFocus
            onSubmitEditing={go}
            returnKeyType="go"
          />
          {!!err && <Text style={s.err}>{err}</Text>}
          <TouchableOpacity style={[s.btn, busy && { opacity: 0.6 }]} onPress={go} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Open</Text>}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (pairing_open) {
    return (
      <PairScreen
        phrase={pairing}
        onScanned={(words) => {
          setPairing(words);
          setGenerated(false); // scanned, not generated here
          setPairingOpen(false);
        }}
        onBack={() => setPairingOpen(false)}
      />
    );
  }

  // ---- setup ---------------------------------------------------------------
  return (
    <SafeAreaView style={s.wrap}>
      <StatusBar barStyle="light-content" backgroundColor={T.vaultBg} />
      <TouchableOpacity onPress={onCancel} hitSlop={12} style={{ padding: 16 }}>
        <Text style={{ color: T.vaultInkSoft, fontSize: 16 }}>Back</Text>
      </TouchableOpacity>

      {/* Same reasoning as NoteEditor: a real Android build needs nothing here. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        enabled={Platform.OS === 'ios' || inExpoGo}
      >
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          <Text style={s.h}>Set up</Text>

          <Text style={s.step}>1 · Connect the two phones</Text>
          <Text style={s.sub}>
            One phone makes a code, the other scans it. Once, and never again.
          </Text>

          <TouchableOpacity style={s.qrBtn} onPress={openPairing}>
            <Text style={s.qrBtnText}>Make or scan a QR code</Text>
            <Text style={s.qrBtnSub}>Seconds, and nothing typed.</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.suggestBtn} onPress={makePairing}>
            <Text style={s.suggestText}>
              {generated ? 'Give me another code' : 'Or use words instead of a code'}
            </Text>
          </TouchableOpacity>

          {generated && !!pairing && (
            <View style={s.suggestBox}>
              <Text style={s.suggestPhrase}>{pairing}</Text>
              <Text style={s.suggestNote}>Type these into the other phone.</Text>
            </View>
          )}

          <TextInput
            style={[s.input, generated && s.inputMuted]}
            value={pairing}
            onChangeText={(t) => { setPairing(t); setGenerated(false); }}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            placeholder={`or type the ${PAIRING_BYTES} words from the other phone`}
            placeholderTextColor={T.vaultInkSoft}
          />

          <Text style={s.step}>2 · Your PIN</Text>
          <Text style={s.sub}>
            This is what you type into a new note to open the chat. It stays on this phone and
            never goes anywhere, so it can be short. A longer one is harder for anyone holding
            your phone to guess.
          </Text>

          <TextInput
            style={s.input}
            value={pin}
            onChangeText={setPin}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="PIN"
            placeholderTextColor={T.vaultInkSoft}
          />
          <TextInput
            style={s.input}
            value={pin2}
            onChangeText={setPin2}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="type it again"
            placeholderTextColor={T.vaultInkSoft}
          />

          {!!err && <Text style={s.err}>{err}</Text>}

          <TouchableOpacity style={[s.btn, busy && { opacity: 0.6 }]} onPress={go} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Create</Text>}
          </TouchableOpacity>

          <Text style={s.note}>
            After this, you get in by opening a new note and typing your PIN into it.
          </Text>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: T.vaultBg },
  body: { paddingHorizontal: 24, paddingTop: 16 },
  h: { fontSize: 28, fontWeight: '700', color: T.vaultInk, marginBottom: 4 },
  step: { fontSize: 16, fontWeight: '700', color: T.accent, marginTop: 26 },
  sub: { fontSize: 13.5, color: T.vaultInkSoft, marginTop: 8, marginBottom: 14, lineHeight: 20 },
  mono: { fontFamily: 'monospace', color: T.vaultInk },
  input: {
    backgroundColor: T.vaultCard, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
    color: T.vaultInk, fontSize: 16, marginBottom: 12, borderWidth: 1, borderColor: T.vaultLine,
  },
  inputMuted: { opacity: 0.45 },
  err: { color: T.danger, marginBottom: 12, fontSize: 14, lineHeight: 20 },
  btn: {
    backgroundColor: T.mine, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 10,
  },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  note: { color: T.vaultInkSoft, fontSize: 13, marginTop: 20, lineHeight: 19 },
  hint: { color: T.vaultInkSoft, fontSize: 12.5, marginTop: -2, marginBottom: 4, lineHeight: 18 },
  swap: { color: T.accent, fontSize: 14, fontWeight: '600', lineHeight: 20 },
  qrBtn: {
    backgroundColor: T.mine, borderRadius: 12, paddingVertical: 15, paddingHorizontal: 16,
    marginBottom: 10,
  },
  qrBtnText: { color: '#fff', fontSize: 15.5, fontWeight: '600' },
  qrBtnSub: { color: 'rgba(255,255,255,0.75)', fontSize: 12, marginTop: 4 },
  suggestBtn: {
    borderWidth: 1, borderColor: T.vaultLine, borderRadius: 12,
    paddingVertical: 13, alignItems: 'center', marginBottom: 12,
  },
  suggestText: { color: T.accent, fontSize: 15, fontWeight: '600' },
  suggestBox: {
    backgroundColor: T.vaultCard, borderRadius: 12, padding: 16, marginBottom: 14,
    borderWidth: 1, borderColor: T.accent,
  },
  suggestPhrase: {
    color: T.vaultInk, fontSize: 19, fontWeight: '600', lineHeight: 27, letterSpacing: 0.3,
  },
  suggestNote: { color: T.vaultInkSoft, fontSize: 12.5, marginTop: 10, lineHeight: 18 },
});
