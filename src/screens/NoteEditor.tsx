import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { T } from '../theme';
import { inExpoGo } from '../env';
import type { Note } from '../store/notes';

type Props = {
  note: Note;
  onSave: (n: Note) => void;
  onDelete: (n: Note) => void;
  onCancel: () => void;
};

/**
 * A notes editor, and nothing else.
 *
 * It used to also be the way into the vault: type the PIN as the only line of a
 * new note and press Done. That was clever and it was a mess — it needed rules
 * about titles, spaces and word counts that nobody could keep straight, it ran
 * a two-second key derivation when saving ordinary notes, a wrong PIN had to
 * fail silently so it looked identical to the app being broken, and a genuine
 * one-word note could not be saved at all.
 *
 * Holding the + button does the same job, cannot be triggered by accident, and
 * says plainly when the PIN is wrong. All of that logic is gone from here.
 */
export default function NoteEditor({ note, onSave, onDelete, onCancel }: Props) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);

  const done = () => {
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
          <TouchableOpacity onPress={done} hitSlop={12}>
            <Text style={[s.barBtn, { fontWeight: '700' }]}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Off in a real Android build: the activity pads itself by the keyboard
          inset (plugins/withKeyboardInsets.js), and adjusting again on top of
          that would move the page twice. Inside Expo Go that plugin is not
          there, so this has to do the work. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        enabled={Platform.OS === 'ios' || inExpoGo}
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
