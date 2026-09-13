# Notes

A private messenger for exactly two people, wearing a notes app as a coat.

On the home screen it is called **Notes**, it has a notepad icon, and if you
open it you get a working notes app with groceries and a wifi password in it.
There is no second tab, no login screen, and nothing that says "chat".

Open a new note, type your PIN as the only line in it, and press **Done**.
The note is never saved, and the chat opens instead.

---

## What it does

- **Two people only.** Not a group app. The room holds two devices and refuses a third.
- **Live only.** No notifications and no offline delivery — you are both in the
  app, or there is no conversation. See [below](#you-both-have-to-be-in-the-app-at-the-same-time)
  for why that is the design and not an oversight.
- **Text, voice and video**, all peer-to-peer over WebRTC.
- **Nothing is stored.** Messages live in a JavaScript array and nowhere else —
  no database, no file, no cache. Closing the app empties it on both phones.
- **No accounts.** No phone number, no email, no username, no server-side record
  that either of you exists.
- **One shared phrase** is the whole secret. Both of you type the same phrase and
  you are connected. (You also both point at the same relay — see setup.)

## How the two of you get set up

Do this once, together, on both phones.

1. **Put the relay somewhere.** This is the one piece that has to live on the
   internet — see [Run the relay](#run-the-relay) below. It takes a few minutes
   and costs nothing. You will end up with an address like
   `wss://something.onrender.com`.
2. Install the app on both phones.
3. **Long-press the word "Notes"** at the top of the screen for about a second
   and a half. This is the only way in before a vault exists.
4. On the first phone, tap **"Make one up for us"**. You get eight words:

   > chair chin ash bread block book mask jelly

   Write them down. Type the *same words* into the second phone. This happens
   **once** and is not what you type to get in — you can forget it afterwards.
   (If you lose them, they are in Settings → Pairing phrase on a phone that is
   already set up.)
5. Choose a **PIN** on each phone. This is what you type into a note to open the
   chat. It stays on that phone, so the two phones do not have to match, and it
   can be short — `110490` is fine.
6. Enter the same relay address on both.
7. Both phones show a short code in Settings (`•••`). **Check they match.**

After that, the way back in is the note trick: new note → type your PIN → Done.

It has to be a **new** note, with **no title**, and the PIN as **one word on one
line**. That is how the app knows to even try — and it is why writing an actual
grocery list does not pause for two seconds every time you save it.

**A wrong PIN is never written down.** Get it wrong and nothing is saved and
nothing is said; you are simply back at your notes. An earlier version saved the
attempt as an ordinary note, on the theory that this was good deniability. It
was the opposite: mistype your PIN once and it sat in the notes list in plain
text, one character from the real one, for anyone who picked up the phone.

The cost is that a genuine one-word note needs a title or a second word to be
kept. The editor says so while you are typing one.

The long-press still works too, as a fallback.

> **Nobody can recover any of this.** Not you, not us, not the relay. There is
> no reset. If you both forget your PINs and lose the pairing words, the vault is
> gone and you set up a new one.

## Using it

| | |
|---|---|
| Open the chat | New note → type your PIN as the only line → **Done** |
| Close it fast | **Close** in the top-left, or just switch apps |
| Voice call | **Call** |
| Video call | **Video** |
| Settings | **•••** |

Switching to another app wipes the conversation and locks the vault. That is on
by default; you can turn it off in Settings if it gets annoying.

Screenshots are blocked while the chat is open, and the app shows blank in the
recent-apps switcher.

### You both have to be in the app at the same time

This is the one thing that will annoy you, and it is a direct consequence of
everything above, so it is worth understanding rather than reporting as a bug.

There are **no notifications**. Nothing rings, nothing buzzes, and a message sent
while the other person is out of the app does not arrive later — it is not stored
anywhere to arrive *from*.

Delivering a message to a closed app requires a push notification. Push means
Google's servers, a device token that identifies the phone, and a permanent
registration tying this app to you — the precise things this app exists to avoid.
Holding the connection open in the background instead would need a foreground
service, which Android displays as a permanent notification, which rather
undermines a notes app.

So the working pattern is the old one: agree a time, or send a normal text
saying "now", and both open the app.

**What this costs you:** a message typed while your partner is away is simply
gone. **What it buys you:** there is no server holding an undelivered message, no
account linking the two of you, and nothing on either phone afterwards.

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

**The entire defence is the strength of your phrase**, which is why setup offers
to make one for you. Tap "Make one up for us" and you get seven words drawn
byte-by-byte from the system random generator over a 256-word list — 56 bits,
with no human choice anywhere in it:

> box earth elder ginger bed hill bike

Seven random words are far past what any precomputation can reach. `iloveyou2`
is not, with or without a salt. Use the generator.

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
