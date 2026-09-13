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
  /** True for a note that has never been saved. */
  isNew: boolean;
  /** Try the typed text as a passphrase. Resolves true if it opened the vault. */
  tryUnlock: (candidate: string) => Promise<boolean>;
  onSave: (n: Note) => void;
  onDelete: (n: Note) => void;
  onCancel: () => void;
};

export default function NoteEditor({ note, isNew, tryUnlock, onSave, onDelete, onCancel }: Props) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [checking, setChecking] = useState(false);

  /**
   * Whether this note is even shaped like a PIN attempt.
   *
   * Key derivation is deliberately slow — about two seconds on a phone — so
   * running it on every save would make the cover story itself feel broken:
   * jotting down a grocery list should not pause. A PIN is typed as the only
   * line of a fresh, untitled note, so anything with a title, a second line, or
   * an existing id is saved immediately without touching the KDF.
   *
   * No spaces, because that is what separates a PIN from a note. It decides
   * more than speed — see `done` — so the rule has to be one a person can hold
   * in their head: one word, no spaces, on a new note with no title.
   *
   * The lower bound is 4 to match the shortest PIN setup will accept. It must
   * never drift above that: a PIN the app allows but this refuses to try would
   * lock someone out of their own vault, with no error to explain why.
   */
  const candidate = body.trim();
  const looksLikeAttempt =
    isNew &&
    !title.trim() &&
    !body.includes('\n') &&
    !/\s/.test(candidate) &&
    candidate.length >= 4 &&
    candidate.length <= 64;

  const done = async () => {
    if (looksLikeAttempt) {
      setChecking(true);
      // Yield a frame so the spinner paints before the KDF blocks the thread.
      await new Promise((r) => setTimeout(r, 30));
      // Vault opened: this text is never written down.
      if (await tryUnlock(candidate)) return;

      /**
       * Wrong PIN. Never written down, and never thrown away either.
       *
       * It must not be saved: mistype your PIN once and it would sit in the
       * notes list in plain text, one character from the real one, for anyone
       * who picks up the phone to read and try.
       *
       * But it used to also close the editor, which made the typing vanish with
       * no explanation — indistinguishable from the app simply not working,
       * which is exactly how it was reported. Staying put with the text still on
       * screen lets the owner see what they typed and fix it, and says nothing
       * at all to anyone who does not already know there is something to fix.
       */
      setChecking(false);
      return;
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
        {looksLikeAttempt && (
          <Text style={s.hint}>
            A single word is not saved as a note. Add a title or a second word to keep it.
          </Text>
        )}
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
    flex: 1, fontSize: 16, color: T.ink, paddingHorizontal: 16, lineHeight: 24, paddingBottom: 8,
  },
  hint: {
    color: T.inkSoft, fontSize: 12, paddingHorizontal: 16, paddingBottom: 16, lineHeight: 17,
  },
});
