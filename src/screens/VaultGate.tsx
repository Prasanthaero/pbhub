import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
  StatusBar, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { T } from '../theme';
import { RELAY_EXAMPLE } from '../store/vaultStore';
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
  const [relay, setRelay] = useState('');
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
        setErr('No.');
        setBusy(false);
      }
      return;
    }

    if (pin.trim().length < 4) return setErr('The PIN needs at least 4 characters.');
    if (pin !== pin2) return setErr('The two PINs do not match.');

    const secret = wordsToBytes(pairing);
    if (!secret) {
      return setErr(
        pairing.trim()
          ? `That is not a valid pairing phrase. It is ${PAIRING_BYTES} words from this app — check for a typo.`
          : 'Make a pairing phrase, or type in the one from the other phone.',
      );
    }
    if (!/^wss?:\/\/.+/i.test(relay.trim())) {
      return setErr('Enter the address of your relay, starting with wss://');
    }

    setBusy(true);
    await new Promise((r) => setTimeout(r, 30));
    try {
      await onSetup(pin, secret, relay);
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
            onChangeText={setPin}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="number-pad"
            placeholder="••••••"
            placeholderTextColor={T.vaultInkSoft}
            autoFocus
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

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          <Text style={s.h}>Set up</Text>

          <Text style={s.step}>1 · Pairing phrase</Text>
          <Text style={s.sub}>
            This is what connects the two phones, and you only ever do it once. It is not the
            thing you type to get in.
          </Text>

          <TouchableOpacity style={s.qrBtn} onPress={openPairing}>
            <Text style={s.qrBtnText}>Use a QR code</Text>
            <Text style={s.qrBtnSub}>
              Show one phone's code to the other. Seconds, and nothing typed.
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.suggestBtn} onPress={makePairing}>
            <Text style={s.suggestText}>
              {generated ? 'Give me another' : 'Or make up words instead'}
            </Text>
          </TouchableOpacity>

          {generated && !!pairing && (
            <View style={s.suggestBox}>
              <Text style={s.suggestPhrase}>{pairing}</Text>
              <Text style={s.suggestNote}>
                Write this down and type it into the other phone. Then you can forget it.
              </Text>
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

          <Text style={s.step}>3 · Relay address</Text>
          <Text style={s.sub}>
            Two phones that have never met need something to introduce them. The relay does only
            that: it sees a hash and ciphertext, keeps nothing, and drops out once you are
            connected. Run your own — <Text style={s.mono}>server/</Text> in the project. Both of
            you must use the same one.
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
