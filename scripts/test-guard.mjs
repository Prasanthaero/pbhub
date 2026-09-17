/**
 * The door: three wrong PINs, then a wait that grows.
 *
 * These rules are the only thing standing between someone holding the phone and
 * an unlimited number of guesses, so they are worth a test rather than a look.
 * Run with: npm run test:guard
 */
import assert from 'node:assert/strict';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  readGuard, strike, clearGuard, waitLeft, waitWords, MAX_TRIES,
} from '../src/store/guard.ts';

let pass = 0;
const ok = (name) => { console.log('  ok  ' + name); pass++; };

// ---- a clean phone --------------------------------------------------------
{
  const g = await readGuard();
  assert.equal(g.strikes, 0);
  assert.equal(waitLeft(g), 0);
  ok('a phone that has never been guessed at is open');
}

// ---- two wrong guesses ----------------------------------------------------
{
  const a = await strike();
  assert.equal(a.strikes, 1);
  assert.equal(waitLeft(a), 0);

  const b = await strike();
  assert.equal(b.strikes, 2);
  assert.equal(waitLeft(b), 0);
  ok('two wrong guesses leave the door open');
}

// ---- the third ------------------------------------------------------------
{
  const c = await strike();
  const left = waitLeft(c);
  assert.ok(left > 15_000 && left <= 20_000, 'first lockout is about twenty seconds, got ' + left);
  assert.equal(c.rounds, 1);
  assert.equal(c.strikes, 0, 'the count restarts, the wait is what carries');
  ok('the third wrong guess shuts the door');
}

// ---- it survives the app being killed -------------------------------------
{
  // Nothing is cached in the module: a fresh read is what the next launch does.
  const again = await readGuard();
  assert.ok(waitLeft(again) > 0, 'reopening the app must not hand the tries back');
  ok('the wait survives a restart');
}

// ---- and it grows ---------------------------------------------------------
{
  for (let i = 0; i < MAX_TRIES; i++) await strike();
  const second = await readGuard();
  assert.equal(second.rounds, 2);
  const left = waitLeft(second);
  assert.ok(left > 50_000 && left <= 60_000, 'second lockout is a minute, got ' + left);

  for (let i = 0; i < MAX_TRIES; i++) await strike();
  const third = await readGuard();
  assert.equal(third.rounds, 3);
  assert.ok(waitLeft(third) > 4 * 60_000, 'third lockout is five minutes');

  for (let i = 0; i < MAX_TRIES; i++) await strike();
  const fourth = await readGuard();
  assert.ok(waitLeft(fourth) <= 5 * 60_000, 'and it stops growing there');
  ok('each lockout is longer than the last, up to five minutes');
}

// ---- the right PIN forgives everything ------------------------------------
{
  await clearGuard();
  const g = await readGuard();
  assert.equal(g.strikes, 0);
  assert.equal(g.rounds, 0);
  assert.equal(waitLeft(g), 0);
  ok('getting in clears the count and the wait');
}

// ---- a clock moved backwards ----------------------------------------------
{
  // Someone setting the phone's date forward and back must not be able to lock
  // the real owner out until 2087.
  await AsyncStorage.setItem(
    '@nt/spell',
    JSON.stringify({ strikes: 0, rounds: 1, until: Date.now() + 40 * 365 * 24 * 3600_000 }),
  );
  const g = await readGuard();
  assert.ok(waitLeft(g) <= 5 * 60_000, 'a wait is never longer than the longest real one');
  await clearGuard();
  ok('a nonsense clock cannot lock anyone out for good');
}

// ---- how the wait is read out ---------------------------------------------
{
  assert.equal(waitWords(1_000), '1 second');
  assert.equal(waitWords(19_400), '20 seconds');
  assert.equal(waitWords(60_000), '1 minute');
  assert.equal(waitWords(4 * 60_000 + 100), '5 minutes');
  ok('the wait is spelled out in words a person reads');
}

console.log('\n  ' + pass + ' guard checks passed\n');
