import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, StatusBar, ActivityIndicator, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import QRCode from 'react-native-qrcode-svg';
import { T } from '../theme';
import { PAIRING_BYTES } from '../crypto/wordlist';
import { encodePairing, decodePairing } from '../crypto/pairingCode';

/**
 * Getting the pairing secret from one phone to the other.
 *
 * People ask for a phone number here, and it is worth being clear about why
 * there isn't one. Signing in with a number means a server holding both
 * numbers, an SMS service to verify them, and a directory tying the two
 * together — and that directory is precisely the record this app exists not to
 * create. It would reveal who talks to whom without reading a single message.
 *
 * A QR code gives the same "it just works" feeling with none of that. The
 * secret goes from screen to camera and touches nothing else: no server sees
 * it, and nothing about either person is written down anywhere.
 *
 * The words stay as a fallback, because a camera can be broken, a screen can be
 * cracked, and the two phones are not always in the same room.
 */

type Props = {
  /** The words this phone already holds, when it is the one showing the code. */
  phrase: string;
  onScanned: (words: string) => void;
  onBack: () => void;
};

export default function PairScreen({ phrase, onScanned, onBack }: Props) {
  const [mode, setMode] = useState<'show' | 'scan'>('show');
  const [permission, requestPermission] = useCameraPermissions();
  const [handled, setHandled] = useState(false);
  const [err, setErr] = useState('');

  const startScan = async () => {
    setErr('');
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        setErr('Camera access is needed to scan the other phone.');
        return;
      }
    }
    setHandled(false);
    setMode('scan');
  };

  const onBarcode = ({ data }: { data: string }) => {
    // The scanner fires continuously; one good read is all we want.
    if (handled) return;
    const words = decodePairing(String(data));
    if (!words) {
      setErr('That is not a pairing code from this app.');
      return;
    }
    setHandled(true);
    onScanned(words);
  };

  return (
    <SafeAreaView style={s.wrap}>
      <StatusBar barStyle="light-content" backgroundColor={T.vaultBg} />
      <View style={s.bar}>
        <TouchableOpacity onPress={mode === 'scan' ? () => setMode('show') : onBack} hitSlop={12}>
          <Text style={s.back}>{mode === 'scan' ? 'Cancel' : 'Back'}</Text>
        </TouchableOpacity>
      </View>

      {mode === 'show' ? (
        <ScrollView contentContainerStyle={s.body}>
          <Text style={s.h}>Pair the phones</Text>
          <Text style={s.sub}>
            Hold this up and scan it with the other phone. Nothing here goes over the internet —
            the code travels from this screen to that camera and nowhere else.
          </Text>

          <View style={s.qrCard}>
            {phrase ? (
              <QRCode
                value={encodePairing(phrase)}
                size={220}
                backgroundColor="#FFFFFF"
                color="#000000"
              />
            ) : (
              <ActivityIndicator color={T.vaultInk} />
            )}
          </View>

          <TouchableOpacity style={s.primary} onPress={startScan}>
            <Text style={s.primaryText}>Scan the other phone instead</Text>
          </TouchableOpacity>

          {!!err && <Text style={s.err}>{err}</Text>}

          <Text style={s.words}>{phrase}</Text>
          <Text style={s.note}>
            If a camera will not cooperate, these {PAIRING_BYTES} words are the same secret — type
            them into the other phone by hand.
          </Text>

          <Text style={s.why}>
            There is no sign-in with a phone number, and that is deliberate. It would mean a server
            holding both your numbers and a list tying you together — which is the record this app
            exists not to keep.
          </Text>
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={onBarcode}
          />
          <View style={s.scanOverlay} pointerEvents="none">
            <View style={s.reticle} />
          </View>
          <View style={s.scanFoot}>
            <Text style={s.scanText}>Point it at the code on the other phone</Text>
            {!!err && <Text style={s.err}>{err}</Text>}
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: T.vaultBg },
  bar: { paddingHorizontal: 16, paddingVertical: 14 },
  back: { color: T.vaultInkSoft, fontSize: 16 },
  body: { paddingHorizontal: 24, paddingBottom: 40, alignItems: 'center' },
  h: { fontSize: 26, fontWeight: '700', color: T.vaultInk, alignSelf: 'flex-start' },
  sub: {
    fontSize: 13.5, color: T.vaultInkSoft, marginTop: 8, marginBottom: 24,
    lineHeight: 20, alignSelf: 'flex-start',
  },
  qrCard: {
    backgroundColor: '#FFFFFF', padding: 18, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center', minHeight: 256, minWidth: 256,
  },
  primary: {
    backgroundColor: T.mine, borderRadius: 12, paddingVertical: 15,
    alignItems: 'center', alignSelf: 'stretch', marginTop: 24,
  },
  primaryText: { color: '#fff', fontSize: 15.5, fontWeight: '600' },
  words: {
    color: T.accent, fontSize: 16, fontWeight: '600', lineHeight: 24,
    textAlign: 'center', marginTop: 28, paddingHorizontal: 8,
  },
  note: {
    color: T.vaultInkSoft, fontSize: 12.5, lineHeight: 18, marginTop: 10, textAlign: 'center',
  },
  why: {
    color: T.vaultInkSoft, fontSize: 12, lineHeight: 18, marginTop: 28,
    borderTopWidth: 1, borderTopColor: T.vaultLine, paddingTop: 18,
  },
  err: { color: T.danger, fontSize: 13.5, marginTop: 14, textAlign: 'center' },

  scanOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  reticle: {
    width: 240, height: 240, borderWidth: 3, borderColor: T.accent, borderRadius: 20,
  },
  scanFoot: { padding: 24, backgroundColor: T.vaultBg },
  scanText: { color: T.vaultInk, fontSize: 15, textAlign: 'center' },
});
