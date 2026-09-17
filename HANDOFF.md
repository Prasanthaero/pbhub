# pbhub — project brief

Context for handing this project to another developer or another AI. Everything
here is true as of the last commit; where something is unfinished or weak, it
says so.

---

## What it is

A private messenger for **exactly two people** — a couple — disguised as a notes
app.

On the phone it is called **Notes**, has a notepad icon, and opens into a
working notes app with groceries and a wifi password in it. There is no second
tab, no login screen and nothing that says "chat". Holding the **+** button for
a second and a half opens a PIN screen; the right PIN opens the conversation.

Stated goal, in the owner's words: *"this app main theme is powerful protection.
safety."* Every design decision below is downstream of that.

- Repo: `https://github.com/Prasanthaero/pbhub`
- Built and tested from **Windows**. No Mac involved.
- Android: shipping as an APK today. iPhone: waiting on an Apple Developer
  account ($99/yr) — the project is configured for it but has never been built
  for iOS.

---

## Stack

| | |
|---|---|
| Framework | Expo SDK **57**, React Native **0.86.3**, React **19.2.3** |
| Language | TypeScript, strict |
| Engine | Hermes, New Architecture |
| Crypto | `@noble/ciphers` (XChaCha20-Poly1305), `@noble/hashes` (HKDF-SHA256, PBKDF2-SHA256) |
| Calls | `react-native-webrtc` 124 |
| Storage | `@react-native-async-storage/async-storage`, `expo-file-system` for media |
| Relay | Node + `ws`, ~400 lines, deployed free on Render |
| Tests | Node's built-in runner via `--experimental-strip-types`, no framework |

~8,100 lines of TypeScript/JS excluding dependencies.

---

## How two phones find each other

There are **no accounts**. No phone number, no email, no username, no
server-side record that either person exists. Phone-number pairing was built at
one point and deliberately removed — a directory of who talks to whom is exactly
the record this app exists not to create.

Instead there is **one shared secret**, 16 random bytes from the system CSPRNG,
created on one phone and carried to the other:

- **QR code** — screen to camera, touches no network.
- **40 digits** — the same 16 bytes, two at a time as five digits
  (`61213 11529 13390 51689 63746 25802 23579 58071`). A group above 65535 cannot have come from this
  app, which catches most single-digit typos at the input rather than an hour
  later.
- Older, half-length codes are refused with the reason — accepting one would
  build a vault the other phone can never meet, and the only symptom would be
  "waiting for partner" forever.

From that secret, labelled HKDF derives one key per job:

| Label | Key | Used for |
|---|---|---|
| `pbhub/room/v3` | room id | the only thing the relay sees |
| `pbhub/message/v3` | message key | chat envelopes, media, the mailbox |
| `pbhub/signal/v3` | signalling key | SDP and ICE, which pass through the relay |

A fourth key, for everything this phone writes to its own disk, comes from a
**store root** that is generated per device and never shared. So the partner
cannot decrypt this phone's files, and setting the two phones up again does not
make this phone's saved history unreadable.

Both phones derive the shared three independently. Nothing about the pairing is
ever transmitted.

## The two-secret design

This trips people up, so plainly:

- The **pairing secret** decides *which conversation this is*. Both phones hold
  the same one.
- The **PIN** only protects the copy of that secret stored on **this** phone. It
  never leaves the device, and the two phones' PINs do not have to match.

The PIN is stretched with PBKDF2-SHA256 (**12,000 rounds**, was 40,000 — the
count is recorded in the blob). The stretched key encrypts the pairing secret
and the store root with XChaCha20-Poly1305. That ciphertext is the only thing on
disk. There is no password hash anywhere.

Vault formats: **v3** is the above. **v2** — one 8-byte secret and one key doing
every job — is still opened and never created, so an install from before this
keeps working until the pair chooses to set up again.

**Was the known weakness:** the pairing secret used to be 64 bits. It is now
**16 bytes, 128 bits**. Not 256, because the secret has to stay carryable by
hand when a camera will not cooperate and 32 bytes is eighty digits to type —
and 128 bits is already past any computation that exists. Vaults made before
this keep working on the old construction; a pair that wants the new one sets
the two phones up again, which takes a QR scan.

Second known weakness: the KDF salt is a **constant**, because two phones that
have never met must derive the same room from the secret alone. That removes the
usual protection against precomputation, which is why the secret is machine-
generated and never chosen by a human.

There is **no forward secrecy**. Raised with the owner, not requested; it is
days of work (a ratchet) and would change the storage format.

---

## The relay

`server/index.js`. Deliberately boring, and deliberately ignorant.

It sees a **room id** (a hash it cannot reverse) and **ciphertext** it has no key
for — including the WebRTC SDP and ICE candidates, which are encrypted with the
message key before they are handed over. Rooms live in memory and vanish. It can
deny service; it cannot read anything.

Protocol frames: `join`, `sig` (relayed signalling), `mail` / `mail-held` /
`mail-done` (offline mailbox), `ack`, `peer`, `live` (ephemeral, e.g. typing),
`peek` / `waiting` / `collect` (a locked phone is told that something arrived
and handed none of it until it unlocks).

Once the two phones find each other, WebRTC takes over and the relay is out of
the loop. TURN is configured (Open Relay) because carrier CGNAT makes STUN-only
calls fail in practice.

---

## What the app does

- **Text, photos, videos, voice notes**, peer-to-peer over a WebRTC data channel
  when both are present.
- **Offline delivery.** Anything sent to a phone that is not there is sealed and
  left at the relay until collected, then dropped. Media too, under a smaller
  size limit, because it sits in memory until pickup.
- **Voice and video calls** over WebRTC, surviving screen-off.
- **Status** ("stories") that expire.
- **Disappearing messages** on a selectable timer; **one-look photos** (the
  receiver's copy is destroyed on close, the sender keeps theirs).
- **Delete for both phones — sender only.** The person who sent it is the only
  one who can remove it from the other phone.
- **Ticks**: one for delivered, two green for seen. Online / offline / last seen,
  and a typing indicator.
- **Idle auto-lock** with a configurable delay, plus a dead man's switch, so a
  forgotten open chat closes itself.
- **Three wrong PINs shuts the door** and drops back into the notes. The count
  is persisted, and the next attempt waits 20s, then a minute, then five minutes.
  A correct PIN clears the count and the wait.
- **A quiet status-bar dot** when something arrives while the app is alive in the
  background. No sender, no preview, no sound.
- **A protocol version on every payload.** An unknown version is dropped, not
  guessed at, and every decrypted envelope is checked against the shape its kind
  requires before anything acts on it.
- **Replay protection that survives a restart.** The ids this phone has accepted
  are kept, sealed, on disk. A sealed message is valid forever and carries no
  counter, so without this a captured one could be handed back after a restart
  and would look new.
- **PB** — a small drawn character (all Views, no image asset) who guards the
  door and lives in the chat. He reacts to wrong PINs, can be poked, opens an
  emoji tray on a long press (tap to send one, hold to put that mood on him),
  and **takes the mood of the conversation** from a word list in English and
  Tamil. That reading is local, over text already on screen, and its entire
  output is which of six faces to wear — nothing sent, nothing stored, no model.
- **Share-to-app** from the system share sheet.
- Screenshots are allowed by default, blockable in Settings.

---

## Layout

```
App.tsx                  the whole app state machine (~1,600 lines)
index.ts                 entry, polyfills getRandomValues
src/crypto/              vault (PIN → key), pairing secret ↔ words/digits/QR
src/net/                 signaling (relay client), peer (WebRTC), transport,
                         notify (the status-bar dot)
src/store/               messages, notes, status, outbox, history, settings,
                         guard (the three-strikes lockout)
src/screens/             NotesList, NoteEditor (the disguise) · VaultGate,
                         PairScreen · Chat, Call, VaultSettings, SharedSheet
src/ui/                  PBBot (the character), pbMood (what he makes of a message)
src/media/               picking, sharing, share-intent
plugins/                 Expo config plugins — release signing, cleartext in
                         debug only, ABI splits, Gradle memory, and the keyboard
                         inset fix for Android 15+
server/index.js          the relay
scripts/test-*.mjs       five suites, ~87 checks, no test framework
```

### Config plugins worth knowing about

`withKeyboardInsets` exists because Android 15+ **enforces edge-to-edge** and
ignores `adjustResize`, so the message box sat under the keyboard and the
navigation bar. It pads the activity's content view by the real IME inset,
measured three ways with the largest winning. This is the kind of thing that
looks like a styling bug and is not.

---

## Testing

```
npm test          # all five suites
npm run typecheck
```

- `test-crypto` — vault round trips, wrong PINs, the round-count migration, the
  QR payload, the 20-digit format over 400 random secrets, expiry, ICE migration
- `test-signaling` — the relay protocol
- `test-mailbox` — offline delivery against a real relay process, including that
  the relay only ever holds ciphertext
- `test-guard` — the three-strikes lockout, including a tampered clock
- `test-pb` — what PB makes of a message, and more importantly what he ignores

Android builds run locally: `cd android && ./gradlew assembleRelease`. Two
emulators (`Pixel_10`, `Pixel_10b`) are used to test both sides of a real
conversation by driving them with `adb`.

Note: `uiautomator dump` times out on any screen with PB on it — he animates
continuously, so the window is never idle. Use screenshots and computed
coordinates instead.

---

## Known limits, stated honestly

1. **64-bit pairing secret.** The main cryptographic weakness. Fix is easy and
   not yet done.
2. **No push notifications.** Android suspends the app minutes after
   backgrounding and the dot stops. Real push means Google's servers holding a
   device token that identifies the phone; a foreground service means a
   permanent "this app is running" notification on a notes app. Both cost more
   than they are worth here, and the app says so in its own Settings.
3. **One relay, free tier.** A single point of failure. It cannot read anything,
   but it can be down.
4. **No forward secrecy.**
5. **Never built for iOS.** Configured — bundle id, permission strings,
   background audio, share extension, WebRTC plugin — but unproven.
6. **Expo Go is preview only.** No WebRTC, no notification dot, no disguise
   (it shows as Expo Go), and its storage does not carry over to a real build.

---

## House style

Worth matching if you touch the code:

- Comments explain **why**, not what — especially where the obvious approach was
  tried and failed. Several comments are the only record of a real bug.
- User-facing text is plain, quiet, and never alarming. No exclamation marks, no
  "Oops!", no security theatre.
- Anything that can fail silently gets a test, not a look.
- Limits are documented rather than glossed over. The README says what the app
  cannot do, in the same voice as what it can.
