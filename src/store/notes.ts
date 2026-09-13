/** The cover story. Real, working notes — persisted in the clear, because a
 *  notes app with no notes in it is the thing that looks suspicious. */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@nt/items';

export type Note = {
  id: string;
  title: string;
  body: string;
  updatedAt: number;
};

export async function loadNotes(): Promise<Note[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return seed();
    const parsed = JSON.parse(raw) as Note[];
    return parsed.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function saveNotes(notes: Note[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(notes));
}

export function newNote(): Note {
  return { id: String(Date.now()) + Math.random().toString(36).slice(2, 7), title: '', body: '', updatedAt: Date.now() };
}

/** A few plausible notes on first launch. */
async function seed(): Promise<Note[]> {
  const now = Date.now();
  const notes: Note[] = [
    { id: 'a1', title: 'Groceries', body: 'milk\neggs\nrice\nonions\ncooking oil', updatedAt: now - 86400000 },
    { id: 'a2', title: 'Wifi', body: 'router admin: 192.168.1.1', updatedAt: now - 3 * 86400000 },
    { id: 'a3', title: 'Books to read', body: '- Project Hail Mary\n- Piranesi', updatedAt: now - 9 * 86400000 },
  ];
  await saveNotes(notes);
  return notes;
}
