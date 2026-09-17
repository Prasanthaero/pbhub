/**
 * PB reading the conversation.
 *
 * He watches what arrives and takes the mood of it: a message with a heart in
 * it leaves him in love for a while, a joke makes him laugh, "good night" puts
 * him to sleep. It is the difference between a decoration and something that
 * appears to be listening.
 *
 * Everything here happens on the phone, on text that is already decrypted and
 * already on screen. Nothing is sent anywhere, nothing is stored, and no
 * message is examined for any reason other than choosing which of six faces to
 * put on. This file is the whole of it — there is no model, no service and no
 * list of what anyone said.
 *
 * Tamil written in English letters is matched as well as English, because that
 * is how the two people using this actually type to each other.
 */
import type { PBMood } from './PBBot';

export type PBReaction = { mood: PBMood; line: string };

/** Emoji are read first: they say the same thing in every language. */
const LOVE_MARKS = ['❤', '♥', '💖', '💕', '💗', '💓', '💞', '💘', '😘', '😍', '🥰', '💋', '😻', '😚', '🫶', '🤗'];
const LAUGH_MARKS = ['😂', '🤣', '😆', '😹', '😄', '😁'];
const SAD_MARKS = ['😢', '😭', '🥺', '😔', '😞', '💔', '🙁'];
const SLEEP_MARKS = ['😴', '🥱', '💤', '🌙', '🌛', '🌜'];
const CHEER_MARKS = ['🔥', '👍', '✨', '🎉', '😎', '💪', '👏', '🙌'];

/**
 * Word lists.
 *
 * Latin words are matched on word boundaries — "ok" must not fire inside
 * "look", and "gn" must not fire inside "going". Tamil script needs no such
 * care, since nothing else in a message will contain those letters by accident.
 */
const LOVE_WORDS = [
  'love', 'loves', 'loved', 'luv', 'ily', 'kiss', 'kisses', 'muah', 'mwah',
  'babe', 'baby', 'darling', 'honey', 'sweetheart', 'sweetie', 'cutie',
  'beautiful', 'handsome', 'hug', 'hugs', 'cuddle', 'my love', 'miss you',
  'missing you', 'miss u', 'love u', 'love you',
  // Tamil, as it is typed
  'kadhal', 'kaadhal', 'kadhali', 'chellam', 'chellama', 'kanmani', 'kanna',
  'anbu', 'aasai', 'thangam', 'uyire', 'kannamma',
];
const LOVE_TAMIL = ['காதல்', 'அன்பு', 'செல்லம்', 'கண்ணா', 'முத்தம்', 'ஆசை', 'தங்கம்', 'உயிரே'];

const LAUGH_WORDS = ['lol', 'lmao', 'rofl', 'haha', 'hahaha', 'hehe', 'hihi', 'funny', 'comedy', 'siripu'];
const LAUGH_TAMIL = ['சிரிப்பு'];

const SAD_WORDS = ['sorry', 'sad', 'cry', 'crying', 'upset', 'hurt', 'alone', 'lonely', 'kavalai', 'valikuthu'];
const SAD_TAMIL = ['கவலை', 'மன்னிச்சு', 'வலிக்குது'];

const SLEEP_WORDS = [
  'good night', 'goodnight', 'gud night', 'gn', 'nite', 'night night',
  'sleep', 'sleeping', 'sleepy', 'tired', 'bed now', 'going to bed',
  'thookam', 'thoongu', 'thoonguren',
];
const SLEEP_TAMIL = ['இரவு வணக்கம்', 'தூக்கம்', 'தூங்கு'];

const CHEER_WORDS = [
  'thanks', 'thank you', 'thank u', 'ty', 'super', 'nice', 'wow', 'great',
  'awesome', 'perfect', 'congrats', 'happy', 'yay', 'well done', 'proud',
  'semma', 'romba nalla', 'nalla iruku', 'vera level', 'sooper',
];
const CHEER_TAMIL = ['நன்றி', 'அருமை', 'சூப்பர்', 'வாழ்த்துக்கள்'];

/** A few ways of saying each, so he does not repeat himself all evening. */
const LINES: Record<Exclude<PBMood, 'locked' | 'idle'>, string[]> = {
  love: ['awww', 'oh my', 'my heart', 'that was sweet', 'say it back', 'i felt that one'],
  happy: ['ha!', 'nice one', 'good', 'i like this', 'keep going'],
  sad: ['oh no', 'aw', 'go on, cheer them up', 'be nice'],
  sleepy: ['night night', 'sleepy now', 'good night', 'bedtime'],
};

const pick = (mood: Exclude<PBMood, 'locked' | 'idle'>): PBReaction => {
  const list = LINES[mood];
  return { mood, line: list[Math.floor(Math.random() * list.length)] };
};

const hasMark = (text: string, marks: string[]) => marks.some((m) => text.includes(m));
const hasTamil = (text: string, words: string[]) => words.some((w) => text.includes(w));

const hasWord = (text: string, words: string[]) =>
  words.some((w) => {
    // Escaped because some entries are phrases, and a stray regex character in
    // a word list should be a typo rather than a crash.
    const safe = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|[^a-z])' + safe + '([^a-z]|$)', 'i').test(text);
  });

/**
 * What PB makes of one message, or null if it is just a message.
 *
 * Order matters: "miss you" is love before it is sadness, and "good night" is
 * bedtime before it is the word "good".
 */
export function readMood(body: string, hasMedia = false): PBReaction | null {
  const text = String(body ?? '').toLowerCase();

  if (hasMark(text, LOVE_MARKS) || hasWord(text, LOVE_WORDS) || hasTamil(body, LOVE_TAMIL)) {
    return pick('love');
  }
  if (hasMark(text, SLEEP_MARKS) || hasWord(text, SLEEP_WORDS) || hasTamil(body, SLEEP_TAMIL)) {
    return pick('sleepy');
  }
  if (hasMark(text, LAUGH_MARKS) || hasWord(text, LAUGH_WORDS) || hasTamil(body, LAUGH_TAMIL)) {
    return pick('happy');
  }
  if (hasMark(text, SAD_MARKS) || hasWord(text, SAD_WORDS) || hasTamil(body, SAD_TAMIL)) {
    return pick('sad');
  }
  if (hasMark(text, CHEER_MARKS) || hasWord(text, CHEER_WORDS) || hasTamil(body, CHEER_TAMIL)) {
    return pick('happy');
  }

  // A photo or a clip with nothing said is still worth a look up.
  if (hasMedia) return { mood: 'happy', line: 'ooh' };

  return null;
}
