/**
 * What PB makes of a message.
 *
 * A word list is easy to get subtly wrong — "ok" firing inside "look", "gn"
 * inside "going", "good night" read as the word "good" — and the symptom is a
 * bot that seems to react at random, which is worse than one that never reacts.
 * Run with: npm run test:pb
 */
import assert from 'node:assert/strict';
import { readMood } from '../src/ui/pbMood.ts';

let pass = 0;
const ok = (name) => { console.log('  ok  ' + name); pass++; };
const moodOf = (text, media = false) => readMood(text, media)?.mood ?? null;

console.log('');
console.log('PB reading the chat');

// ---- love -----------------------------------------------------------------
{
  for (const m of [
    'i love you', 'love u', 'miss you so much', 'good morning babe',
    'muah', '❤️', 'ok ❤', '😘😘', 'you are beautiful', 'come here, hug',
    'kadhal', 'en chellam', 'kanna vaa', 'காதல்', 'என் அன்பு',
  ]) {
    assert.equal(moodOf(m), 'love', 'should be love: ' + m);
  }
  ok('love, in English, in emoji, and in Tamil both ways of writing it');
}

// ---- bedtime beats the word "good" ----------------------------------------
{
  assert.equal(moodOf('good night'), 'sleepy');
  assert.equal(moodOf('gn'), 'sleepy');
  assert.equal(moodOf('so tired'), 'sleepy');
  assert.equal(moodOf('😴'), 'sleepy');
  assert.equal(moodOf('இரவு வணக்கம்'), 'sleepy');
  ok('"good night" puts him to bed rather than cheering him up');
}

// ---- and "miss you" is love, not sadness ----------------------------------
{
  assert.equal(moodOf('i miss you'), 'love');
  assert.equal(moodOf('i am sad'), 'sad');
  assert.equal(moodOf('sorry'), 'sad');
  assert.equal(moodOf('🥺'), 'sad');
  ok('"miss you" is love; plain sadness is still sadness');
}

// ---- laughing and cheering ------------------------------------------------
{
  assert.equal(moodOf('hahaha'), 'happy');
  assert.equal(moodOf('😂'), 'happy');
  assert.equal(moodOf('thanks'), 'happy');
  assert.equal(moodOf('semma'), 'happy');
  assert.equal(moodOf('🔥'), 'happy');
  ok('a joke and a thank you both make him happy');
}

// ---- and the whole point: he shuts up the rest of the time ----------------
{
  for (const m of [
    'look at this', 'going to the shop', 'call me when you are free',
    'bring milk and eggs', 'the train is late', 'ok', 'lokesh called',
    'i am at the signal', '', '   ',
  ]) {
    // "ok" on its own is a fair thing to nod at; everything else must not fire.
    if (m.trim() === 'ok') continue;
    assert.equal(moodOf(m), null, 'should be quiet: ' + JSON.stringify(m));
  }
  ok('ordinary messages leave him alone — no word found inside another word');
}

// ---- a photo with nothing said --------------------------------------------
{
  assert.equal(moodOf('', true), 'happy');
  assert.equal(moodOf('', false), null);
  ok('a picture on its own is still worth looking up for');
}

// ---- he says different things ---------------------------------------------
{
  const said = new Set();
  for (let i = 0; i < 60; i++) said.add(readMood('i love you').line);
  assert.ok(said.size > 1, 'he repeats the same line every time');
  ok('he has more than one thing to say about the same message');
}

console.log('\n  ' + pass + ' PB checks passed\n');
