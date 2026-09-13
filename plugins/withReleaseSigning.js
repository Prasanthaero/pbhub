/**
 * Teaches the generated Android project to sign release builds with a real
 * keystore instead of the shared debug key.
 *
 * This lives in a config plugin rather than as an edit to android/app/build.gradle
 * because `expo prebuild --clean` regenerates that file. A hand-edit would come
 * back as debug-signed without saying anything, and a debug-signed APK cannot be
 * upgraded in place by a properly signed one later.
 *
 * Credentials come from signing/keystore.properties in the project root, which
 * is gitignored. They deliberately live OUTSIDE android/: that folder is
 * generated, so a 'prebuild --clean' deletes everything in it. Keeping the
 * keystore there meant it vanished without a word and release builds quietly
 * fell back to the debug key — which is a key everybody has, and which cannot
 * later be upgraded over.
 *
 * If the file is absent (a fresh clone, CI without secrets) the build still
 * falls back to debug signing rather than failing, but it says so, because a
 * silent fallback is exactly how this went wrong the first time.
 */
const { withAppBuildGradle } = require('@expo/config-plugins');

const LOADER = `
// --- pbhub release signing (injected by plugins/withReleaseSigning.js) ---
def pbhubKeystoreProps = new Properties()
// ../signing: outside android/, so prebuild --clean cannot delete it.
def pbhubKeystoreFile = rootProject.file('../signing/keystore.properties')
if (pbhubKeystoreFile.exists()) {
    pbhubKeystoreProps.load(new FileInputStream(pbhubKeystoreFile))
} else {
    logger.warn('[pbhub] signing/keystore.properties not found - release builds will use the DEBUG key')
}
`;

const SIGNING_BLOCK = `        release {
            if (pbhubKeystoreProps['storeFile']) {
                storeFile rootProject.file(pbhubKeystoreProps['storeFile'])
                storePassword pbhubKeystoreProps['storePassword']
                keyAlias pbhubKeystoreProps['keyAlias']
                keyPassword pbhubKeystoreProps['keyPassword']
            }
        }
`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;

    if (gradle.includes('pbhubKeystoreProps')) return cfg;

    // Load the properties file before the android { } block is evaluated.
    gradle = gradle.replace(/^android \{/m, `${LOADER}\nandroid {`);

    // Add a release signing config alongside the stock debug one.
    gradle = gradle.replace(
      /(signingConfigs \{\n(?:.*\n)*?        \}\n)/,
      `$1${SIGNING_BLOCK}`,
    );

    // Point the release build type at it, but only when a keystore is present.
    gradle = gradle.replace(
      /(        release \{\n)(\s*)\/\/ Caution![^\n]*\n\s*\/\/ see[^\n]*\n\s*signingConfig signingConfigs\.debug\n/,
      `$1$2signingConfig pbhubKeystoreProps['storeFile'] ? signingConfigs.release : signingConfigs.debug\n`,
    );

    cfg.modResults.contents = gradle;
    return cfg;
  });
};
