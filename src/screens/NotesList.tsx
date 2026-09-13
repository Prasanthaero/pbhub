import React from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, Pressable, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { T } from '../theme';
import type { Note } from '../store/notes';

type Props = {
  notes: Note[];
  onOpen: (n: Note) => void;
  onNew: () => void;
  /** Long-press the title. The only entrance that exists before a vault does. */
  onSecretGesture: () => void;
};

const when = (ts: number) => {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
};

export default function NotesList({ notes, onOpen, onNew, onSecretGesture }: Props) {
  return (
    <SafeAreaView style={s.wrap} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor={T.paper} />
      <Pressable onLongPress={onSecretGesture} delayLongPress={1400}>
        <Text style={s.h1}>Notes</Text>
      </Pressable>
      <Text style={s.count}>{notes.length} {notes.length === 1 ? 'note' : 'notes'}</Text>

      <FlatList
        data={notes}
        keyExtractor={(n) => n.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}
        renderItem={({ item }) => (
          <TouchableOpacity style={s.card} activeOpacity={0.7} onPress={() => onOpen(item)}>
            <Text style={s.title} numberOfLines={1}>{item.title || 'Untitled'}</Text>
            <Text style={s.body} numberOfLines={2}>{item.body || 'No additional text'}</Text>
            <Text style={s.date}>{when(item.updatedAt)}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={s.empty}>Nothing here yet.</Text>}
      />

      <TouchableOpacity style={s.fab} onPress={onNew} activeOpacity={0.85}>
        <Text style={s.fabText}>+</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: T.paper },
  h1: { fontSize: 34, fontWeight: '700', color: T.ink, paddingHorizontal: 16, paddingTop: 8 },
  count: { fontSize: 13, color: T.inkSoft, paddingHorizontal: 16, marginBottom: 12 },
  card: {
    backgroundColor: T.card, borderRadius: 14, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: T.line,
  },
  title: { fontSize: 16, fontWeight: '600', color: T.ink },
  body: { fontSize: 14, color: T.inkSoft, marginTop: 4, lineHeight: 19 },
  date: { fontSize: 11, color: T.inkSoft, marginTop: 8 },
  empty: { textAlign: 'center', color: T.inkSoft, marginTop: 60 },
  fab: {
    position: 'absolute', right: 22, bottom: 34, width: 60, height: 60, borderRadius: 30,
    backgroundColor: T.ink, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabText: { color: T.paper, fontSize: 32, lineHeight: 36, fontWeight: '300' },
});
