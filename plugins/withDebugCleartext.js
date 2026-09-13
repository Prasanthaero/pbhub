/**
 * Allows plain ws:// and http:// in DEBUG builds only.
 *
 * Release builds set usesCleartextTraffic="false", which is correct for
 * shipping. But it also blocks the normal development loop: a relay running on
 * your own PC is reached from the emulator at ws://10.0.2.2:8080, and the
 * platform refuses that connection with no useful error — the socket simply
 * never opens.
 *
 * This writes a debug-only manifest overlay. Android merges it into debug
 * builds and ignores it entirely for release, so the shipped APK still refuses
 * cleartext.
 *
 * It is a plugin rather than a checked-in file under android/ because
 * `expo prebuild --clean` deletes that directory.
 */
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<!--
  Debug builds only. Lets the app reach a relay running on your development
  machine (ws://10.0.2.2:8080 from an emulator). Release builds do not merge
  this file and continue to refuse cleartext traffic.
-->
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
          xmlns:tools="http://schemas.android.com/tools">
  <application
      android:usesCleartextTraffic="true"
      tools:replace="android:usesCleartextTraffic" />
</manifest>
`;

module.exports = function withDebugCleartext(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const dir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'debug');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'AndroidManifest.xml'), MANIFEST);
      return cfg;
    },
  ]);
};
