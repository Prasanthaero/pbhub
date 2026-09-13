/**
 * Build-time config, layered on top of app.json.
 *
 * The only thing this decides is whether `expo-dev-client` is in the build.
 *
 * It has to be in a development build: that is the piece that lets a phone
 * connect to Metro running on this PC and reload JavaScript as it is saved,
 * which is the entire reason iOS development is possible from Windows at all.
 *
 * It must NOT be in a release build. It registers an `exp+pbhub://` URL scheme,
 * which puts the project's real name in the manifest for anyone who looks at
 * the installed app — and an app pretending to be a notes app should not carry
 * the name of a chat project in its plumbing.
 *
 * EAS sets EAS_BUILD_PROFILE to the profile being built. A local
 * `npx expo run:android` sets nothing, so it gets the release shape by default,
 * which is the safe direction to be wrong in.
 */
const base = require('./app.json');

const DEV_PROFILES = new Set(['development', 'ios-simulator']);
const isDevBuild =
  DEV_PROFILES.has(process.env.EAS_BUILD_PROFILE ?? '') || process.env.PBHUB_DEV_CLIENT === '1';

module.exports = () => {
  const expo = { ...base.expo };

  /**
   * Over-the-air updates stay switched off until there is somewhere to ask.
   *
   * `eas update:configure` is what writes `updates.url` into app.json, and it
   * needs an Expo account, so it cannot be done from here. Until it has been
   * run, a build with expo-updates in it and no address to check would either
   * complain at build time or sit there asking nothing. Keyed off the url, the
   * feature simply is not there yet, and turns itself on the moment it is.
   */
  expo.updates = { ...base.expo.updates, enabled: Boolean(base.expo.updates?.url) };

  if (isDevBuild) {
    expo.plugins = [...expo.plugins, 'expo-dev-client'];

    /**
     * A development build installs beside the real app, not over it.
     *
     * It is signed with the debug key, so Android would refuse to install it
     * over the release app, and the only way through would be to uninstall —
     * taking the vault, the pairing and every note with it. Its own package name
     * avoids the question entirely: the real app keeps its data, and the test
     * app is obviously the test app on the home screen.
     */
    expo.name = 'Notes (test)';
    expo.android = { ...expo.android, package: `${base.expo.android.package}.dev` };
  }

  return expo;
};
