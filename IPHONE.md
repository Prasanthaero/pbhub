# Building it for iPhone

The code already runs on iOS. Every library it uses — WebRTC for the calls,
camera, audio, video, sharing, notifications, the encryption — supports iPhone,
and `app.json` already carries the iOS configuration. Nothing needs rewriting.

What stands between you and an iPhone build is Apple's rules, not the code.

---

## The short version

| | Android | iPhone |
|---|---|---|
| Build it | Free, on this PC | Needs a Mac, or Expo's cloud Macs |
| Put it on a phone | Copy the file, tap it | Apple Developer account, **$99/year** |
| How long it lasts | Forever | A year, then rebuild |
| Screenshot blocking | Works | Works (iOS 13+) |

If both of you have Android, there is no reason to do this. If one of you has
an iPhone, read on.

---

## Step 0 — See it on iOS before paying anything

You can build for the **iOS Simulator** with no Apple account at all. It needs
someone with a Mac to run it, but it costs nothing and shows you the real app.

```bash
npx eas-cli build --platform ios --profile ios-simulator
```

The simulator has no usable camera or microphone, so calls will not work there.
Everything else will.

---

## Step 1 — Accounts

**Expo account** — free. Sign up at [expo.dev](https://expo.dev). This is what
lets you build without owning a Mac: their cloud Macs do it for you.

**Apple Developer Program** — [developer.apple.com/programs](https://developer.apple.com/programs/),
**$99 a year**. There is no free tier that puts an app on a phone for more than
seven days. This is the cost of the whole exercise.

---

## Step 2 — Log in

```bash
npx eas-cli login
```

---

## Step 3 — Register the iPhones

Apple will only run the app on phones you have registered. Do this once per
phone:

```bash
npx eas-cli device:create
```

It shows a QR code. Open it on the iPhone and follow the prompts — the phone
registers itself with your Apple account.

---

## Step 4 — Build

```bash
npx eas-cli build --platform ios --profile ios-device
```

The first run asks about signing certificates. **Let EAS handle them** — it
creates and stores what Apple needs, and getting certificates right by hand is
the most tedious part of iOS development by a wide margin.

The build runs on their machines and takes 15–30 minutes. You get a link.

---

## Step 5 — Install

Open the link on the iPhone and install. That is it — no App Store involved.

### Or use TestFlight

If you would rather install the way normal apps update:

```bash
npx eas-cli submit --platform ios
```

This puts it in TestFlight, Apple's testing system. Both of you install the
TestFlight app and get it from there, and future updates arrive the usual way.
TestFlight builds expire after **90 days**, so it needs rebuilding quarterly.

---

## What is different on an iPhone

**Screenshot blocking does not really work.** This said it did, and that was
wrong. iOS lets an app blank itself during a *screen recording*, and gives no
app any way to stop a *screenshot* — Apple has never offered one. So the switch
in Settings covers recording only, and the app says so on an iPhone rather than
promising something it cannot do. On Android it covers both. It is off by
default on either platform now.

**Sharing into the app works**, but needs a share extension, which EAS builds
automatically from the `expo-share-intent` configuration already in `app.json`.

**The notification dot works**, with the same limits as Android: no banner, no
preview, and only while iOS leaves the app alive in the background. iOS is
stricter about that than Android, so expect it to last minutes rather than
hours.

**Calls work**, and a call in progress now survives the screen locking: the
build declares the `audio` background mode, without which iOS suspends the app
the moment it leaves the screen and the call dies mid-sentence. That was the
same fault Android had, fixed there by not locking the vault during a call.

Being *reached* for a call while the app is closed is still not something this
design supports on either platform — there is no push service to wake it.

---

## What will not happen

**It will never be on the App Store.** An app whose entire purpose is to look
like something else, with no account system and no way for Apple to see what it
does, is not going to pass review — and submitting it would mean explaining the
design to a reviewer, which rather defeats the point. Internal distribution and
TestFlight are the whole story here.

---

## The yearly cost, plainly

- **$99/year** to Apple. Stop paying and the app stops working on both iPhones.
- **A rebuild each year** when the certificate expires (90 days on TestFlight).
- Android has neither of these.

If one of you is on Android and one on iPhone, the two phones talk to each other
perfectly well — the pairing, the relay and the encryption do not care what the
other end is running. It is only the cost and the yearly upkeep that differ.
