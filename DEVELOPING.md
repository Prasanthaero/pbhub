# Developing

Where the code is, how to run it, and how to get it onto the emulator.

## Where you work

```
D:\my apps\MOBILE APPS\pbhub
```

Open that folder in VS Code:

```bash
code "D:\my apps\MOBILE APPS\pbhub"
```

The files you will actually edit:

| What you want to change | File |
|---|---|
| The notes list (the cover story) | `src/screens/NotesList.tsx` |
| The note editor / the unlock trick | `src/screens/NoteEditor.tsx` |
| The chat screen | `src/screens/Chat.tsx` |
| The call screen | `src/screens/Call.tsx` |
| Setup and unlock screen | `src/screens/VaultGate.tsx` |
| Settings inside the vault | `src/screens/VaultSettings.tsx` |
| Colours | `src/theme.ts` |
| Screen routing, lock/unlock, calls | `App.tsx` |
| Encryption | `src/crypto/vault.ts` |
| The relay server | `server/index.js` |

## Important: Expo Go does not work here

The usual Expo workflow — install "Expo Go" from the Play Store, scan a QR code
— **will not run this app.** Expo Go only contains the native code Expo ships
with it, and this app uses `react-native-webrtc` for the calls, which is not in
there. You would get a red error screen about a missing native module.

Instead you build the app **once** onto the emulator or phone, and after that
your JavaScript changes reload instantly without rebuilding.

## Running it

### First time (or after changing anything native)

Start the emulator first — or plug in a phone with USB debugging on — then:

```bash
npm run dev
```

That is `expo run:android`. It compiles the native project, installs it on the
emulator, and starts Metro. **The first run takes 10–25 minutes** because it
compiles the Android side from scratch. Later runs take seconds.

You need to re-run this only when you change `app.json`, add a native package,
or edit anything in `plugins/`. Changing `.tsx` or `.ts` files does not need it.

### Every day after that

The app is already installed, so you only need the JavaScript server:

```bash
npm start
```

Open the app on the emulator. Save a file in VS Code and the screen updates by
itself. Press `r` in the terminal to force a reload.

### Starting the emulator by hand

```bash
"%LOCALAPPDATA%\Android\Sdk\emulator\emulator.exe" -avd Pixel_10
```

Check it is connected:

```bash
"%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" devices
```

You should see `emulator-5554   device`.

## Using Android Studio

Android Studio is genuinely useful here, but for the native half only. The split
is worth getting right:

| Job | Use |
|---|---|
| Editing screens, chat, crypto (`.tsx`, `.ts`) | VS Code |
| Creating and starting emulators | Android Studio → Device Manager |
| Running / installing onto a device | Either |
| Reading crash logs (Logcat) | Android Studio |
| Installing SDK pieces | Android Studio → SDK Manager |

### Open the right folder

**Open `pbhubandroid`, not `pbhub`.** The project root is a Node project and
Android Studio will not recognise it. The Gradle project is the `android`
subfolder:

```
D:my appsMOBILE APPSpbhubandroid
```

Let it finish "Gradle sync" the first time. Then the green Run button builds and
installs to whichever device is selected in the toolbar.

### Read this before you edit anything in there

**`android/` is generated code.** It is produced by `expo prebuild` from
`app.json`, it is gitignored, and `npx expo prebuild --clean` deletes and
recreates the whole folder. Anything you type into `AndroidManifest.xml` or
`build.gradle` inside Android Studio will be silently thrown away the next time
that runs.

So when you need a native change — a permission, an app name, a signing config —
change it in one of these instead, and they survive:

- `app.json` for permissions, icons, the app name, SDK versions
- `plugins/*.js` for anything `app.json` cannot express

That is why release signing lives in `plugins/withReleaseSigning.js` rather than
in `build.gradle` where you would normally put it.

### Running a debug build from Android Studio

The Run button installs the app, but a debug build loads its JavaScript from
Metro, so start that first in a terminal:

```bash
npm start
```

Without it the app opens to a blank or red screen saying it cannot connect to the
development server. `npm run dev` does both steps in one command, which is why
it is the simpler path day to day.

### Making a second emulator

Android Studio → Device Manager → Add a device. You need two to test the chat —
see below.

## Testing the chat needs two devices

This is the part people get stuck on. The app connects **two** phones — one
device alone can open the vault but will sit on "Waiting for partner…" forever.

You have three options:

1. **Emulator + your real phone.** Build to the emulator with `npm run dev`,
   then install `app-release.apk` on your phone. Easiest.
2. **Two emulators.** Create a second device in Android Studio's Device Manager,
   start both, then `npm run dev` picks one — install the APK on the other with
   `adb -s <device-id> install`.
3. **One device + the relay test.** `npm test` already proves the pairing and
   message flow work without any phone at all.

### Point them at a relay

Run the relay on your PC:

```bash
npm run relay:dev
```

It listens on port 8080. Now, the address to type into the app's setup screen
depends on where the app is running:

| App is running on | Relay address to enter |
|---|---|
| Android emulator | `ws://10.0.2.2:8080` |
| Real phone, same wifi as the PC | `ws://192.168.x.x:8080` (your PC's LAN IP) |
| Anywhere, deployed relay | `wss://your-relay.onrender.com` |

`10.0.2.2` is the emulator's special alias for "the computer I am running on" —
`localhost` inside the emulator means the emulator itself, which is why it fails.

Plain `ws://` works in **debug builds only**. Release builds refuse unencrypted
connections on purpose, so a shipped app needs a real `wss://` address. That is
handled by `plugins/withDebugCleartext.js`.

Find your PC's LAN IP with:

```bash
ipconfig
```

## Checking your work

Types:

```bash
npm run typecheck
```

Crypto and relay protocol (21 checks, no device needed):

```bash
npm test
```

Catch broken imports without a full native build — this is the fast one, it
bundles the whole app in about ten seconds:

```bash
npx expo export --platform android --output-dir .expo-check
```

## Building the APK to give to someone

```bash
npm run android:build
```

Output:

```
android/app/build/outputs/apk/release/app-release.apk
```

Copy that file to both phones and install it. Android will warn about
installing from an unknown source; that is normal for an app not on the Play
Store.

## Things that will bite you

**"SDK location not found"** — `android/local.properties` is missing or has a
BOM at the start. It must be a plain ASCII file containing exactly:

```
sdk.dir=C:/Users/user/AppData/Local/Android/Sdk
```

Do not write it with PowerShell's `Set-Content -Encoding utf8` — Windows
PowerShell adds a byte-order mark that corrupts the first key.

**Gradle hangs downloading** — it fetches Gradle, the NDK and the SDK platform
on first build, several gigabytes in total. It is not frozen. Do not kill it
part-way: an interrupted NDK install leaves a broken folder and the next build
fails with `did not have a source.properties file`. If that happens, delete
`%LOCALAPPDATA%\Android\Sdk\ndk\<version>` and build again.

**Red screen about a missing native module** — you are running in Expo Go.
Use `npm run dev` instead.

**Changed `app.json` and nothing happened** — run `npx expo prebuild --platform
android` to regenerate the native project, then `npm run dev`.

**Lost the keystore** — `android/keystore.properties` and
`android/pbhub-release.keystore` are gitignored and exist only on this PC. Back
them up. Without them you cannot build an update that installs over an
already-installed copy.
