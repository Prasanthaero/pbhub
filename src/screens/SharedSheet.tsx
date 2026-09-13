import React from 'react';
import {
  View, Text, Image, TouchableOpacity, StyleSheet, ActivityIndicator, StatusBar, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { T } from '../theme';
import type { SharedItem } from '../media/shared';

type Props = {
  item: SharedItem;
  /** False while the partner is away — media cannot be sent then. */
  connected: boolean;
  busy: boolean;
  onSend: () => void;
  onSetStatus: () => void;
  onDiscard: () => void;
};

const size = (bytes?: number) =>
  !bytes ? '' : bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;

/**
 * Where should this go?
 *
 * Shown after unlocking, when something arrived from another app's share
 * sheet. Both destinations are spelled out with what they cost, because they
 * differ in the one way that matters here: sending keeps nothing, and setting
 * a status writes a picture to this phone for a day.
 */
export default function SharedSheet({
  item, connected, busy, onSend, onSetStatus, onDiscard,
}: Props) {
  const isText = item.kind === 'text';
  const canSend = connected || isText;

  return (
    <SafeAreaView style={s.wrap}>
      <StatusBar barStyle="light-content" backgroundColor={T.vaultBg} />
      <ScrollView contentContainerStyle={s.body}>
        <Text style={s.h}>Shared with you</Text>
        <Text style={s.sub}>
          Something came in from another app. Nothing has been saved yet.
        </Text>

        <View style={s.preview}>
          {item.kind === 'photo' && item.uri && (
            <Image source={{ uri: item.uri }} style={s.thumb} resizeMode="cover" />
          )}
          {item.kind === 'video' && (
            <View style={[s.thumb, s.placeholder]}>
              <Text style={s.placeholderIcon}>▶</Text>
            </View>
          )}
          {isText && (
            <Text style={s.text} numberOfLines={6}>{item.text}</Text>
          )}
          {!isText && (
            <Text style={s.meta}>
              {item.kind === 'photo' ? 'Photo' : 'Video'}
              {item.bytes ? ` · ${size(item.bytes)}` : ''}
              {item.duration ? ` · ${Math.round(item.duration)}s` : ''}
            </Text>
          )}
          {!isText && !!item.text && <Text style={s.caption}>{item.text}</Text>}
        </View>

        {busy ? (
          <View style={s.busy}>
            <ActivityIndicator color={T.vaultInk} />
            <Text style={s.busyText}>Working…</Text>
          </View>
        ) : (
          <>
            <TouchableOpacity
              style={[s.action, !canSend && s.actionOff]}
              onPress={onSend}
              disabled={!canSend}
            >
              <Text style={s.actionTitle}>Send to your partner</Text>
              <Text style={s.actionSub}>
                {canSend
                  ? isText
                    ? 'Goes as a message. Waits for them if they are away.'
                    : 'Goes straight between the phones and is never saved, on either side.'
                  : 'They need to be in the app — pictures cannot wait anywhere.'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={s.action} onPress={onSetStatus}>
              <Text style={s.actionTitle}>Make it your status</Text>
              <Text style={s.actionSub}>
                {item.kind === 'video'
                  ? 'The caption becomes your status. Video is not kept as a status.'
                  : 'Kept on this phone, encrypted, and shown to your partner for a day. A status photo is stored, unlike anything else here — shrunk down first.'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={s.discard} onPress={onDiscard}>
              <Text style={s.discardText}>Discard</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: T.vaultBg },
  body: { padding: 24 },
  h: { fontSize: 26, fontWeight: '700', color: T.vaultInk },
  sub: { fontSize: 13.5, color: T.vaultInkSoft, marginTop: 8, marginBottom: 22, lineHeight: 20 },

  preview: {
    backgroundColor: T.vaultCard, borderRadius: 16, padding: 16, marginBottom: 24,
    borderWidth: 1, borderColor: T.vaultLine, alignItems: 'center',
  },
  thumb: { width: '100%', height: 220, borderRadius: 12, backgroundColor: '#000' },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  placeholderIcon: { color: T.vaultInkSoft, fontSize: 34 },
  text: { color: T.vaultInk, fontSize: 15.5, lineHeight: 22, alignSelf: 'stretch' },
  meta: { color: T.vaultInkSoft, fontSize: 12, marginTop: 12 },
  caption: { color: T.vaultInk, fontSize: 14, marginTop: 8, textAlign: 'center' },

  action: {
    borderWidth: 1, borderColor: T.vaultLine, borderRadius: 14,
    padding: 18, marginBottom: 12, backgroundColor: T.vaultCard,
  },
  actionOff: { opacity: 0.45 },
  actionTitle: { color: T.vaultInk, fontSize: 16, fontWeight: '600' },
  actionSub: { color: T.vaultInkSoft, fontSize: 12.5, marginTop: 6, lineHeight: 18 },

  discard: { paddingVertical: 16, alignItems: 'center' },
  discardText: { color: T.vaultInkSoft, fontSize: 15 },

  busy: { alignItems: 'center', paddingVertical: 40, gap: 12 },
  busyText: { color: T.vaultInkSoft, fontSize: 14 },
});
