import React, { useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList,
  KeyboardAvoidingView, Platform, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { T } from '../theme';
import type { Msg } from '../store/messages';

type Props = {
  messages: Msg[];
  status: string;
  connected: boolean;
  onSend: (text: string) => void;
  onCall: (kind: 'audio' | 'video') => void;
  onLock: () => void;
  onSettings: () => void;
};

const clock = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export default function Chat({
  messages, status, connected, onSend, onCall, onLock, onSettings,
}: Props) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList<Msg>>(null);

  const send = () => {
    const t = draft.trim();
    if (!t || !connected) return;
    onSend(t);
    setDraft('');
  };

  return (
    <SafeAreaView style={s.wrap} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor={T.vaultBg} />

      <View style={s.bar}>
        <TouchableOpacity onPress={onLock} hitSlop={12}>
          <Text style={s.lock}>Close</Text>
        </TouchableOpacity>

        <View style={{ alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={[s.dot, { backgroundColor: connected ? T.ok : T.vaultInkSoft }]} />
            <Text style={s.status}>{status}</Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 16 }}>
          <TouchableOpacity onPress={() => onCall('audio')} disabled={!connected} hitSlop={10}>
            <Text style={[s.icon, !connected && s.iconOff]}>Call</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onCall('video')} disabled={!connected} hitSlop={10}>
            <Text style={[s.icon, !connected && s.iconOff]}>Video</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onSettings} hitSlop={10}>
            <Text style={s.icon}>•••</Text>
          </TouchableOpacity>
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={8}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 14, paddingBottom: 8 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => {
            if (item.kind === 'system') {
              return <Text style={s.system}>{item.body}</Text>;
            }
            const mine = item.kind === 'out';
            return (
              <View style={[s.row, { justifyContent: mine ? 'flex-end' : 'flex-start' }]}>
                <View style={[s.bubble, mine ? s.mine : s.theirs]}>
                  <Text style={s.msg}>{item.body}</Text>
                  <Text style={s.time}>{clock(item.at)}</Text>
                </View>
              </View>
            );
          }}
          ListHeaderComponent={
            <Text style={s.preamble}>
              Nothing here is saved. Close the app and this conversation is gone from both phones.
            </Text>
          }
        />

        <View style={s.composer}>
          <TextInput
            style={s.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={connected ? 'Message' : 'Waiting for your partner…'}
            placeholderTextColor={T.vaultInkSoft}
            multiline
            editable={connected}
            autoCorrect={false}
          />
          <TouchableOpacity
            style={[s.send, (!connected || !draft.trim()) && { opacity: 0.35 }]}
            onPress={send}
            disabled={!connected || !draft.trim()}
          >
            <Text style={s.sendText}>Send</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: T.vaultBg },
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: T.vaultLine,
  },
  lock: { color: T.vaultInkSoft, fontSize: 15 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  status: { color: T.vaultInkSoft, fontSize: 12 },
  icon: { color: T.vaultInk, fontSize: 14, fontWeight: '600' },
  iconOff: { color: T.vaultInkSoft, opacity: 0.5 },
  preamble: {
    color: T.vaultInkSoft, fontSize: 12, textAlign: 'center',
    marginBottom: 18, marginTop: 6, paddingHorizontal: 20, lineHeight: 18,
  },
  system: { color: T.vaultInkSoft, fontSize: 12, textAlign: 'center', marginVertical: 8 },
  row: { flexDirection: 'row', marginBottom: 8 },
  bubble: { maxWidth: '78%', borderRadius: 16, paddingHorizontal: 13, paddingVertical: 9 },
  mine: { backgroundColor: T.mine, borderBottomRightRadius: 5 },
  theirs: { backgroundColor: T.theirs, borderBottomLeftRadius: 5 },
  msg: { color: '#fff', fontSize: 15.5, lineHeight: 21 },
  time: { color: 'rgba(255,255,255,0.55)', fontSize: 10, marginTop: 4, alignSelf: 'flex-end' },
  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: T.vaultLine,
  },
  input: {
    flex: 1, maxHeight: 120, backgroundColor: T.vaultCard, borderRadius: 20,
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10,
    color: T.vaultInk, fontSize: 15.5, borderWidth: 1, borderColor: T.vaultLine,
  },
  send: {
    backgroundColor: T.mine, borderRadius: 20, paddingHorizontal: 18, paddingVertical: 11,
  },
  sendText: { color: '#fff', fontWeight: '600', fontSize: 14 },
});
