# Connecting two phones

Everything the app does — messages, voice, video — goes **directly between the
two phones**. But two phones that have never met cannot find each other on their
own, so one small thing has to live on the internet: the relay. It introduces
them and then drops out.

This is the only piece of setup that is not inside the app.

---

## Step 1 — Put the relay online

Pick one of these. You only do it once.

### Option A — permanent, free, ~5 minutes (recommended)

1. Go to [render.com](https://render.com) and sign in with GitHub.
2. **New → Web Service**, pick the `pbhub` repository.
3. Render reads `render.yaml` and fills everything in. Set the instance type to
   **Free**. Create it.
4. You get an address like `https://pbhub-relay.onrender.com`.
5. **In the app, use it with `wss://` instead of `https://`:**

   ```
   wss://pbhub-relay.onrender.com
   ```

The free tier sleeps when idle, so the first connection of the day takes a few
seconds longer. The app retries by itself — just wait.

### Option B — temporary, for testing right now

Run the relay on your PC and open a public door to it. No account needed.

```bash
npm run relay:dev
```

Then, in a second terminal:

```bash
cloudflared tunnel --url http://127.0.0.1:8080
```

It prints an address like `https://something.trycloudflare.com`. Use it in the
app as `wss://something.trycloudflare.com`.

**This address dies when you close the terminal**, and you get a different one
next time. Fine for trying it out, not for daily use.

### Option C — both phones on your own wifi

No relay on the internet at all, but only works while both phones are on the
same wifi as the PC, and only with a **debug** build (release refuses
unencrypted connections).

```bash
ipconfig
```

Take the IPv4 address (something like `192.168.1.20`) and use
`ws://192.168.1.20:8080`.

---

## Step 2 — Install the app on both phones

The file is:

```
android/app/build/outputs/apk/release/app-release.apk
```

Copy it to each phone (USB, or upload it somewhere and download it). Tap it to
install. Android will warn about installing from an unknown source — that is
normal for an app that is not on the Play Store. Allow it.

Or, with the phone plugged in and USB debugging on:

```bash
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

---

## Step 3 — Pair them

**On the first phone:**

1. Open **Notes**.
2. **Long-press the word "Notes"** at the top for about a second and a half.
3. Tap **"Make one up for us"**. You get eight words, for example:

   > broom frame bone coin otter island east hand

   **Write them down.** You need them for the second phone.
4. Leave the PIN as `110490`, or change it. This is what you will type to get in.
5. Paste in your relay address from Step 1.
6. **Create.** It thinks for about two seconds, then the chat opens.

**On the second phone:**

1. Same: long-press **"Notes"**.
2. **Type the same eight words** into the pairing box. Do *not* tap
   "Make one up for us" — that would create a different, unconnected vault.
3. Set its PIN. It does **not** have to match the first phone's.
4. Paste **the same relay address**.
5. **Create.**

Both phones should now say **Connected, direct**.

If you lose the eight words, they are in **Settings (•••) → Pairing phrase** on a
phone that is already set up.

---

## Step 4 — Using it

Open the app, tap **+** for a new note, type your PIN, press **Done**. The chat
opens and the note is never saved.

- **Message** — type and Send.
- **Call** — voice.
- **Video** — video. The other phone rings; they tap Accept.
- **Close** — leaves instantly and wipes the conversation.

The first time you make a call, Android asks for microphone and camera
permission. Allow it, or calls will not work.

---

## Both of you must be in the app at the same time

There are **no notifications**, and a message sent while the other person is out
of the app does not arrive later — there is nowhere for it to wait.

This is the design, not a missing feature. Push notifications would mean Google's
servers and a device token permanently identifying the phone; keeping the
connection alive in the background would mean a foreground service, which Android
shows as a permanent notification — not a look a notes app can carry.

So: agree a time, or send an ordinary text saying "now", and both open the app.

---

## When it does not connect

**"Relay disconnected"** — the address is wrong, the relay is not running, or
(on a release build) you used `ws://` instead of `wss://`. Release builds refuse
unencrypted connections on purpose.

**"Waiting for partner…" forever** — the other phone is not in the app, or the
two phones have different pairing words. Check **Settings → This pairing** on
both: the short code must be identical. If it is not, one of you typed the eight
words differently.

**Connects, then "Could not find a direct path"** — some mobile networks block
direct connections between phones. Add a TURN server in
**Settings → ICE servers**; a free one from [metered.ca](https://www.metered.ca)
or your own [coturn](https://github.com/coturn/coturn) will do. Everything stays
encrypted end to end either way — a TURN server relays bytes it cannot read.

**Calls connect but no sound or picture** — permissions. Android Settings → Apps
→ Notes → Permissions → allow Microphone and Camera.
