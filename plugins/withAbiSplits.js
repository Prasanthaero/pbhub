/**
 * Build one APK per CPU architecture instead of one containing all four.
 *
 * WebRTC ships a large native library, and a universal APK carries a copy for
 * arm64-v8a, armeabi-v7a, x86 and x86_64 — roughly four times what any single
 * phone will ever load. That is 134MB to copy onto a phone, most of it code
 * that device cannot run.
 *
 * Split, the arm64 APK — which is what every phone made in the last several
 * years uses — is a fraction of that. A universal APK is still produced
 * alongside them, for the rare old device or when you simply do not want to
 * think about which file to send.
 *
 * A config plugin rather than an edit to build.gradle because
 * `expo prebuild --clean` regenerates that file.
 */
const { withAppBuildGradle } = require('@expo/config-plugins');

const SPLITS = `
    // --- pbhub ABI splits (injected by plugins/withAbiSplits.js) ---
    splits {
        abi {
            enable true
            reset()
            // arm64 covers essentially every phone in use; the other two are
            // there so an older device or an emulator still has something to
            // install.
            include 'arm64-v8a', 'armeabi-v7a', 'x86_64'
            universalApk true
        }
    }
`;

module.exports = function withAbiSplits(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes('pbhub ABI splits')) return cfg;

    // Drop it inside android { } — right before the signingConfigs block the
    // other plugin adds, so the two do not fight over the same anchor.
    gradle = gradle.replace(/^(\s*)signingConfigs \{/m, `${SPLITS}\n$1signingConfigs {`);

    cfg.modResults.contents = gradle;
    return cfg;
  });
};
