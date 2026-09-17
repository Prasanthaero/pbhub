import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
  StatusBar, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { T } from '../theme';
import { inExpoGo } from '../env';
import { DEFAULT_RELAY } from '../store/vaultStore';
import {
  generatePairingSecret, bytesToWords, wordsToBytes,
} from '../crypto/wordlist';
import {
  bytesToDigits, parsePairing, looksOutdated, PAIRING_DIGITS,
} from '../crypto/pairingNumber';
import PairScreen from './PairScreen';
import PBBot, { type PBMood } from '../ui/PBBot';
import {
  readGuard, strike, clearGuard, waitLeft, waitWords, MAX_TRIES,
} from '../store/guard';

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
  /**
   * The secret, as words, which is what the QR code and this app have always
   * carried internally. Nobody sees it in this form any more — what is shown
   * and typed is the number below.
   */
  const [pairing, setPairing] = useState('');
  /** What is actually in the box, digits and all. */
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [generated, setGenerated] = useState(false);
  /** The QR sheet: showing this phone's code, or scanning the other's. */
  const [pairing_open, setPairingOpen] = useState(false);

  // ---- PB, who minds the door ---------------------------------------------
  const [mood, setMood] = useState<PBMood>('idle');
  const [say, setSay] = useState(mode === 'unlock' ? 'Type it in. I am watching the door.' : '');
  /** Makes him react a second time to the same kind of news. */
  const [beat, setBeat] = useState(0);
  /** Wrong guesses so far, as three dots under him. */
  const [used, setUsed] = useState(0);
  /** Milliseconds before anything may be tried again. */
  const [cool, setCool] = useState(0);
  const leaving = useRef(false);
  /** True while he is sleeping off a lockout, so waking him is noticeable. */
  const waking = useRef(false);

  /**
   * Watch the cool-off down to zero.
   *
   * Read from storage rather than counted here, so backgrounding the app or
   * killing it does not hand back the tries that were just spent.
   */
  useEffect(() => {
    if (mode !== 'unlock') return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      const g = await readGuard();
      if (!alive) return;
      const left = waitLeft(g);
      setUsed(left > 0 ? MAX_TRIES : g.strikes);
      setCool(left);
      if (left > 0) {
        setMood('sleepy');
        setSay('Too many wrong. Come back in ' + waitWords(left) + '.');
        timer = setTimeout(tick, 1000);
      } else if (waking.current) {
        // The wait just ran out while this screen was open: wake him up rather
        // than leave him asleep in front of a button that now works.
        waking.current = false;
        setMood('idle');
        setBeat((b) => b + 1);
        setSay('All right. Try again.');
      }
      waking.current = left > 0;
    };

    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [mode]);

  const makePairing = () => {
    setPairing(bytesToWords(generatePairingSecret()));
    setTyped('');
    setGenerated(true);
    setErr('');
  };

  /** The generated secret as the number the other phone has to be given. */
  const shownNumber = (() => {
    const bytes = wordsToBytes(pairing);
    return bytes ? bytesToDigits(bytes) : '';
  })();

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
      if (cool > 0 || leaving.current) return;

      setBusy(true);
      await new Promise((r) => setTimeout(r, 30));

      if (await onUnlock(pin)) {
        // Getting in forgives every wrong guess before it, including a wait
        // that is still running.
        await clearGuard();
        setUsed(0);
        setMood('love');
        setBeat((b) => b + 1);
        setSay('Welcome back.');
        return;
      }

      setBusy(false);
      setPin('');
      setBeat((b) => b + 1);

      const g = await strike();
      const left = waitLeft(g);

      if (left > 0) {
        // Third wrong one. Shut the door and put them back in the notes, where
        // there is nothing to suggest there was ever another way in.
        leaving.current = true;
        setUsed(MAX_TRIES);
        setCool(left);
        setMood('locked');
        setSay('Three wrong. I am closing it.');
        setTimeout(onCancel, 1700);
        return;
      }

      setUsed(g.strikes);
      setMood('sad');
      const remaining = MAX_TRIES - g.strikes;
      setSay(
        remaining === 1
          ? 'Not that one. One try left.'
          : 'That is not it. ' + remaining + ' tries left.',
      );
      return;
    }

    if (pin.trim().length < 4) return setErr('The PIN needs at least 4 characters.');
    // Anything goes, spaces included. There used to be a rule against them,
    // from when the way in was typing the PIN into a note — and the rule was
    // written /s/ rather than /\s/, so it was quietly rejecting every PIN with
    // the letter s in it. The note route is gone; so is the rule.
    if (pin.trim().length > 64) return setErr('That PIN is very long. Keep it under 64.');
    if (pin !== pin2) return setErr('The two PINs do not match.');

    const secret = wordsToBytes(pairing);
    if (!secret) {
      if (looksOutdated(typed)) {
        return setErr(
          'That code is from an older version of the app. Update the other phone, '
          + 'make a new code there, and use that one.',
        );
      }
      return setErr(
        typed.trim()
          ? 'That number is not right — check it against the other phone.'
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
          {/* PB does the talking here. An error line under the box would say
              the same thing twice, and say it less kindly. */}
          <View style={s.petWrap}>
            <PBBot mood={mood} beat={beat} size={116} say={say} />
          </View>

          <View style={s.dots}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={[s.tryDot, i < used && s.tryDotUsed]} />
            ))}
          </View>

          <TextInput
            style={[s.input, cool > 0 && s.inputMuted]}
            value={pin}
            onChangeText={(t) => {
              setPin(t);
              if (err) setErr('');
              if (mood === 'sad') { setMood('idle'); setSay('Go on.'); }
            }}
            editable={cool === 0 && !leaving.current}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            // Deliberately the ordinary keyboard. This used to be a number pad,
            // which locked out anyone whose PIN had a letter in it — setup
            // accepts any characters, so this must too. A keyboard that cannot
            // type the PIN the app itself allowed is not a small bug.
            placeholder={cool > 0 ? 'wait' : 'your PIN'}
            placeholderTextColor={T.vaultInkSoft}
            autoFocus={cool === 0}
            onSubmitEditing={go}
            returnKeyType="go"
          />
          {!!err && <Text style={s.err}>{err}</Text>}
          <TouchableOpacity
            style={[s.btn, (busy || cool > 0) && { opacity: 0.5 }]}
            onPress={go}
            disabled={busy || cool > 0 || leaving.current}
          >
            {busy
              ? <ActivityIndicator color="#fff" />
              : <Text style={s.btnText}>{cool > 0 ? waitWords(cool) : 'Open'}</Text>}
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
          // Show the scanned secret as its number, so both phones can be held
          // side by side and checked against each other.
          const bytes = wordsToBytes(words);
          setTyped(bytes ? bytesToDigits(bytes) : '');
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
          <View style={{ alignItems: 'center', marginBottom: 14 }}>
            <PBBot mood="happy" size={86} say="I am PB. I will look after this." />
          </View>

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
              {generated ? 'Give me another number' : 'Or use a number instead'}
            </Text>
          </TouchableOpacity>

          {generated && !!shownNumber && (
            <View style={s.suggestBox}>
              <Text style={s.suggestPhrase}>{shownNumber}</Text>
              <Text style={s.suggestNote}>Type this into the other phone.</Text>
            </View>
          )}

          <TextInput
            style={s.input}
            value={typed}
            onChangeText={(t) => {
              setTyped(t);
              setGenerated(false);
              // Kept as words behind the glass: that is what the QR code
              // carries, so both roads end at the same string.
              const bytes = parsePairing(t);
              setPairing(bytes ? bytesToWords(bytes) : '');
              if (err) setErr('');
            }}
            autoCapitalize="none"
            autoCorrect={false}
            // iOS's number pad has no return key and no way off it — with a
            // PIN field below this one, that is a dead end on a phone where the
            // keyboard covers what you would tap next. Its numbers-and-
            // punctuation keyboard is digits first and has a return key.
            keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'number-pad'}
            placeholder={`or type the ${PAIRING_DIGITS} numbers from the other phone`}
            placeholderTextColor={T.vaultInkSoft}
          />

          <Text style={s.step}>2 · Your PIN</Text>
          <Text style={s.sub}>
            This opens the chat on this phone. It never leaves it. Three wrong tries and PB
            shuts the door, and the next attempt has to wait.
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
            After this, hold down the + button on the notes list to get back here.
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
  petWrap: { alignItems: 'center', marginTop: 8, marginBottom: 18 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 9, marginBottom: 18 },
  tryDot: {
    width: 9, height: 9, borderRadius: 5,
    backgroundColor: T.vaultLine, borderWidth: 1, borderColor: T.vaultLine,
  },
  tryDotUsed: { backgroundColor: T.danger, borderColor: T.danger },
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
