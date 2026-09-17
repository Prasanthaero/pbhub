# Notes

A private messenger for exactly two people, wearing a notes app as a coat.

On the home screen it is called **Notes**, it has a notepad icon, and if you
open it you get a working notes app with groceries and a wifi password in it.
There is no second tab, no login screen, and nothing that says "chat".

Hold down the **+** button and type your PIN. Three wrong ones and the door
closes on its own.

---

## What it does

- **Two people only.** Not a group app. The room holds two devices and refuses a third.
- **Either of you can be away.** A message or a photo sent to a phone that is not
  there waits at the relay, encrypted, until it is collected — then it is dropped.
  What there is no such thing as here is a push notification. See
  [below](#one-of-you-can-be-away-neither-of-you-gets-pinged).
- **Text, voice and video**, all peer-to-peer over WebRTC.
- **Nothing is stored.** Messages live in a JavaScript array and nowhere else —
  no database, no file, no cache. Closing the app empties it on both phones.
- **No accounts.** No phone number, no email, no username, no server-side record
  that either of you exists.
- **One shared code** is the whole secret. One phone makes it, the other scans or
  types it, and you are connected. (You also both point at the same relay — see
  setup.)

## How the two of you get set up

Do this once, together, on both phones.

1. **Put the relay somewhere.** This is the one piece that has to live on the
   internet — see [Run the relay](#run-the-relay) below. It takes a few minutes
   and costs nothing. You will end up with an address like
   `wss://something.onrender.com`.
2. Install the app on both phones.
3. **Hold the + button** on the notes list for about a second and a half. This is
   the way in, before a vault exists and after.
4. On the first phone, tap **"Make or scan a QR code"** and hold the code up to
   the other phone's camera. That is the whole of it — nothing typed, and the
   secret never touches a network.

   If a camera will not cooperate, **"Or use a number instead"** gives you the
   same secret as forty digits:

   > 61213 11529 13390 51689 63746 25802 23579 58071

   Type those into the other phone. This happens **once** and is not what you
   type to get in — you can forget it afterwards. (If you lose it, it is in
   Settings → Pairing code on a phone that is already set up.)
5. Choose a **PIN** on each phone. This is what opens the chat. It stays on that
   phone, so the two phones do not have to match, and it can be short —
   `110490` is fine.
6. Enter the same relay address on both.
7. Both phones show a short code in Settings (`•••`). **Check they match.**

After that, the way back in is to **hold down the + button** on the notes list.
Nobody presses it for a second and a half by accident, and holding the word
**Notes** at the top does the same thing.

### Three tries, and PB shuts the door

**PB** is the small character on the door screen. He is there because a PIN box
that says "wrong" in red tells you nothing about how much trouble you are in,
and because this app is meant to be liked as well as trusted.

- Wrong PIN: he looks miserable and one of the three dots under him turns red.
- Three wrong: he closes his eyes, and the app puts you back in the notes. There
  is nothing on that screen to suggest there was ever another way in.
- Try again straight away and you cannot: the first wait is **20 seconds**, the
  next **a minute**, and after that **five minutes**, every time it happens.

The count is written to storage, so closing the app, force-stopping it or
rebooting the phone does not hand the tries back. The right PIN clears all of
it — the count and the wait — the moment it works.

That is what stands between someone holding your phone and an unlimited number
of guesses. A `1234`-grade PIN is still a `1234`-grade PIN; this only makes
guessing it slow.

### PB in the chat

He sits bottom right, above the message box, and gets out of the way while the
keyboard is up.

- **Tap him** and he says something and throws hearts.
- **Hold him** and a small tray of emoji opens.
  - **Tap one** and it goes to the other phone as a message.
  - **Hold one** and PB wears that mood for a couple of minutes — hold the moon
    and he falls asleep, hold the heart and his eyes go pink. That one stays on
    this phone; it is about him, not about them.
- **hide PB**, in the corner of the tray, puts him away until you next open the
  chat.

He also notices when the other one starts typing, a second or two before
anything appears.

**And he follows the conversation.** A message with a heart in it, or the word
love, or *kadhal*, or *காதல்*, leaves him in love for a minute — pink eyes, a
heart for a mouth. "good night" puts him to sleep. A joke makes him laugh,
*sorry* makes him sulk, a photo makes him look up. An ordinary message about
milk and eggs leaves him alone, which is the harder half.

That reading is a word list in [`src/ui/pbMood.ts`](src/ui/pbMood.ts) — English
and Tamil, typed either way. It runs on the phone, on text that is already
decrypted and already on the screen, and it chooses one of six faces. Nothing is
sent anywhere, nothing is written down, and there is no model and no service
involved. The whole of it is one file you can read in a minute.

> **Nobody can recover any of this.** Not you, not us, not the relay. There is
> no reset. If you both forget your PINs and lose the pairing code, the vault is
> gone and you set up a new one.

## Using it

| | |
|---|---|
| Open the chat | Hold the **+** button → type your PIN → **Open** |
| Close it fast | **Close** in the top-left, or just switch apps |
| Voice call | **Call** |
| Video call | **Video** |
| Settings | **•••** |

Switching to another app wipes the conversation and locks the vault. That is on
by default; you can turn it off in Settings if it gets annoying.

Screenshots are allowed by default and can be blocked in Settings. Blocking them
stops your own phone taking one; it cannot stop the other person pointing a
second camera at their screen, and no app can.

### One of you can be away. Neither of you gets pinged.

A message sent to a phone that is not in the app is sealed and left at the relay.
It is ciphertext there — the relay cannot read it, it holds nothing else about
either of you, and it drops each item the moment the other phone collects it. A
locked phone is told that *something* arrived and is handed none of it until it
is unlocked. Photos and clips travel the same road, with a smaller size limit,
because they have to sit in memory until they are picked up.

What does not exist is a **push notification**. Nothing rings and nothing buzzes.

A red dot appears in the status bar if the app is still alive in the background
when something lands, and that is as far as it goes: Android suspends the app
after a few minutes, and after that nothing arrives to put a dot on. Making it
reliable means either Google's push servers holding a device token that
identifies the phone, or a permanent "this app is running" notification on a
notes app. Both cost more than they are worth.

So: what you send gets there. Neither of you is told when. Agree a time, or send
an ordinary text saying "now".

---

## How the privacy actually works

Being honest about this matters more than the marketing, so here is the whole
picture, including the parts that are not perfect.

### Your phrase never leaves the phone, and is never stored

The phrase is stretched with PBKDF2-HMAC-SHA256 (40,000 rounds) into a master
key. From that, three things are derived:

- a **room id** — what the relay sees
- a **message key** — what everything is encrypted with
- a **marker key** — used only to check you typed the phrase correctly

The only thing written to disk is the *marker*: a short piece of ciphertext. If
your phrase decrypts it, you are in. If it doesn't, nothing happens and the app
cannot tell the difference between a wrong phrase and an ordinary note.

There is no password hash anywhere on the device. Someone with your unlocked
phone and a forensic tool finds two blobs of random-looking bytes in a notes
app's storage.

### The relay is a dumb pipe

Two phones that have never met need something to introduce them. That is
`server/` — about a hundred lines, and deliberately boring.

It sees a **room id** (a hash it cannot reverse without your phrase) and
**ciphertext** (which it has no key for). Even the WebRTC connection details —
the SDP, the ICE candidates — are encrypted with your message key before they
are handed over. The relay cannot read them, cannot tell who you are, and keeps
nothing: rooms live in memory and vanish when you disconnect.

Once the two phones find each other, the relay is out of the loop entirely.
Messages and calls go **directly between the devices**.

It can deny you service. It cannot read you.

### What is still visible, and to whom

No app can hide everything. Here is what leaks:

- **Your internet provider** can see that your phone opened a WebSocket to the
  relay's address, and that you then exchanged UDP traffic with another IP. They
  cannot see content. They *can* see that a conversation happened, and roughly
  how long it lasted.
- **The STUN server** (Google's, by default) learns your IP address. Change it in
  Settings, or [self-host coturn](https://github.com/coturn/coturn), if that
  matters to you.
- **Whoever holds the other phone** sees everything you send. No cryptography
  helps with that.
- **Someone watching you type** sees your phrase. The vault protects a seized
  phone, not a shoulder.
- **The app is on the phone.** Anyone who unpacks the APK learns it is more than
  a notes app. What they cannot learn is your phrase, or that *you specifically*
  ever used the chat — with no vault created, this is genuinely just a notes app,
  and with one created it is two blobs of noise.

### The honest weak spot: a fixed salt

Normally a password is salted with random bytes so that attackers must attack
each target separately. This app cannot do that. Two phones that share nothing
but a spoken phrase have to derive the same room id from it, and a random salt
would send them to different rooms.

So the salt is a constant, and the consequence is real: someone could precompute
a dictionary once and try it against every user of this app, instead of paying
that cost per person.

**The entire defence is the strength of the pairing secret**, which is why you
never choose it. It is sixteen bytes straight from the system random generator —
128 bits, with no human choice anywhere in it — and it reaches the other phone as
a QR code or as the forty digits that spell those same bytes out:

> 61213 11529 13390 51689 63746 25802 23579 58071

Nothing about that is guessable or precomputable. `iloveyou2` would be, with or
without a salt, which is why there is no box anywhere in this app that lets you
pick the secret yourself.

### Why the round count looks low

40,000 rounds is well under what you would use for a password database, and that
is deliberate rather than an oversight.

The app runs in Hermes, which has no JIT. The first version used
PBKDF2-HMAC-SHA512 at 250,000 rounds — half a second on a laptop, and **over a
minute on the phone**, because SHA-512 needs 64-bit arithmetic that Hermes
emulates with pairs of 32-bit operations. Measured on an emulator:

| KDF | Rounds | Laptop | Phone |
|---|---|---|---|
| PBKDF2-SHA512 | 250,000 | ~0.5s | >60s |
| PBKDF2-SHA256 | 120,000 | — | 5.3s |
| PBKDF2-SHA256 | 40,000 | ~0.09s | **1.8s** |

The deeper reason is that stretching is the wrong lever here. Against a constant
salt the attacker precomputes once no matter how high the count goes, so the
work factor buys far less than it does with per-user salts. Entropy in the
phrase is what actually protects you — hence the generator above.

The app logs the derivation time (duration only, never the phrase) so a
regression on a slower device shows up in `adb logcat` instead of looking like
a freeze.

### What this is not

This has not been audited. It is built on well-regarded primitives —
[@noble](https://github.com/paulmillr/noble-ciphers) for crypto, WebRTC's own
DTLS-SRTP for the media — and it is put together carefully, but "careful" and
"audited" are different words. If your safety depends on it, use
[Signal](https://signal.org), which is audited, and which a lot of people have
tried very hard to break.

What this *is*: a small, readable app that does not keep your conversations, does
not know who you are, and does not look like what it is.

---

## Running it

Requires Node 18+, a JDK, and the Android SDK.

```bash
npm install
```

### Tests

```bash
npm test
```

21 checks covering the crypto (pairing, sealing, tampering, the "an ordinary note
must not open the vault" case) and the signaling protocol driven against a real
relay over a real socket.

### Build the Android app

```bash
npm run android:build
```

The APK lands in `android/app/build/outputs/apk/release/`. Copy it to both
phones and install it.

The release keystore lives in `android/` and is gitignored. **Back it up.**
Without it you cannot ship an update that installs over the copy already on the
phones — Android will refuse, and you would have to uninstall (losing the vault)
first.

### Run the relay

<a id="run-the-relay"></a>

**There is no default relay, deliberately.** Hardcoding someone else's address
would funnel every pair of users through a machine none of them control, and a
baked-in URL that later goes dark would break the app with no explanation. So you
run your own. It is a hundred lines and it holds nothing.

Locally, to try it:

```bash
cd server
npm install
npm start
```

To put it online, `render.yaml` and `server/Dockerfile` are in the repo — push
this repository to your own Render/Fly/Railway account and point it at `server/`.
The free tier of anything is plenty: it handles a few hundred bytes per
connection and stores nothing. Then enter that `wss://` address on both phones
during setup.

A free-tier host that sleeps when idle is fine — the app retries with backoff, so
the first connection of the day just takes a few seconds longer.

A `ws://` (unencrypted) relay on your own LAN is fine privacy-wise — the payloads
are already sealed — but Android blocks cleartext sockets by default. Flip
`usesCleartextTraffic` in `app.json` if you need it.

## Layout

```
App.tsx                 screen routing, lock/unlock, call state
src/crypto/vault.ts     key derivation, the marker, sealing
src/net/signaling.ts    WebSocket client to the relay
src/net/peer.ts         WebRTC: data channel, audio, video
src/store/messages.ts   the in-memory message list (this is the whole database)
src/screens/            notes list, note editor, gate, chat, call, settings
server/index.js         the relay
plugins/                release-signing config plugin
scripts/                icon generator, tests
```

## Licence

MIT. See [LICENSE](LICENSE).

## Hardening notes

A few things that are easy to get wrong and are deliberately set here:

- **`allowBackup` is off.** Android's default is to copy app data to the user's
  Google Drive. That would have shipped the vault marker and every note to a
  server, which is the exact opposite of the point.
- **No deep-link scheme.** The app registers no custom URL scheme. A scheme is a
  visible line in the manifest announcing that this is not an ordinary notes app.
- **No `expo-dev-client`** in the build, for the same reason — it registers an
  `exp+pbhub://` scheme that names the project.
- **No OTA updates.** `expo-updates` is disabled, so the app never phones home to
  check for a new version.
- **Cleartext HTTP is blocked** at the platform level.
- **Storage, media, phone-state, bluetooth and overlay permissions are explicitly
  removed** from the merged manifest, so transitive dependencies cannot quietly
  add them back. The app asks for camera, microphone and network. Nothing else.
