/**
 * Teaches the generated Android project to sign release builds with a real
 * keystore instead of the shared debug key.
 *
 * This lives in a config plugin rather than as an edit to android/app/build.gradle
 * because `expo prebuild --clean` regenerates that file. A hand-edit would come
 * back as debug-signed without saying anything, and a debug-signed APK cannot be
 * upgraded in place by a properly signed one later.
 *
 * Credentials come from android/keystore.properties, which is gitignored. If
 * that file is absent (a fresh clone, CI without secrets) the build falls back
 * to debug signing so it still succeeds.
 */
const { withAppBuildGradle } = require('@expo/config-plugins');

const LOADER = `
// --- pbhub release signing (injected by plugins/withReleaseSigning.js) ---
def pbhubKeystoreProps = new Properties()
def pbhubKeystoreFile = rootProject.file('keystore.properties')
if (pbhubKeystoreFile.exists()) {
    pbhubKeystoreProps.load(new FileInputStream(pbhubKeystoreFile))
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
