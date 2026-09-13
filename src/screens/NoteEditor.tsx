import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
  KeyboardAvoidingView, Platform, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { T } from '../theme';
import type { Note } from '../store/notes';

type Props = {
  note: Note;
  /** Try the typed text as a passphrase. Resolves true if it opened the vault. */
  tryUnlock: (candidate: string) => Promise<boolean>;
  onSave: (n: Note) => void;
  onDelete: (n: Note) => void;
  onCancel: () => void;
};

export default function NoteEditor({ note, tryUnlock, onSave, onDelete, onCancel }: Props) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [checking, setChecking] = useState(false);

  const done = async () => {
    const candidates = [body.trim(), title.trim()].filter(Boolean);
    if (candidates.length) {
      setChecking(true);
      // Yield a frame so the spinner paints before the KDF blocks the thread.
      await new Promise((r) => setTimeout(r, 30));
      for (const c of candidates) {
        if (await tryUnlock(c)) return; // Vault opened — this text is never written down.
      }
      setChecking(false);
    }
    if (!title.trim() && !body.trim()) return onCancel();
    onSave({ ...note, title: title.trim(), body, updatedAt: Date.now() });
  };

  return (
    <SafeAreaView style={s.wrap} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor={T.paper} />
      <View style={s.bar}>
        <TouchableOpacity onPress={onCancel} hitSlop={12}>
          <Text style={s.barBtn}>Back</Text>
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
          <TouchableOpacity onPress={() => onDelete(note)} hitSlop={12}>
            <Text style={[s.barBtn, { color: T.inkSoft }]}>Delete</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={done} hitSlop={12} disabled={checking}>
            {checking ? <ActivityIndicator size="small" color={T.ink} />
              : <Text style={[s.barBtn, { fontWeight: '700' }]}>Done</Text>}
          </TouchableOpacity>
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TextInput
          style={s.title}
          placeholder="Title"
          placeholderTextColor={T.inkSoft}
          value={title}
          onChangeText={setTitle}
          autoCorrect={false}
        />
        <TextInput
          style={s.body}
          placeholder="Start writing…"
          placeholderTextColor={T.inkSoft}
          value={body}
          onChangeText={setBody}
          multiline
          autoCorrect={false}
          autoCapitalize="none"
          textAlignVertical="top"
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: T.paper },
  bar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  barBtn: { fontSize: 16, color: T.ink },
  title: {
    fontSize: 24, fontWeight: '700', color: T.ink, paddingHorizontal: 16, paddingVertical: 8,
  },
  body: {
    flex: 1, fontSize: 16, color: T.ink, paddingHorizontal: 16, lineHeight: 24, paddingBottom: 24,
  },
});
