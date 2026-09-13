/**
 * Give the Gradle daemon enough memory to compile this project.
 *
 * Expo's generated defaults are -Xmx2048m with 512m of metaspace. Adding
 * expo-updates pushed the Kotlin symbol processor past that, and the build died
 * with `[ksp] java.lang.OutOfMemoryError: Metaspace` — which reads like a code
 * error and is not one.
 *
 * A config plugin rather than an edit to android/gradle.properties, because
 * `expo prebuild` regenerates that file, and rather than the machine's own
 * ~/.gradle/gradle.properties, because a project should not need a note saying
 * "and also change this setting on your computer first".
 */
const { withGradleProperties } = require('@expo/config-plugins');

const SETTINGS = {
  'org.gradle.jvmargs': '-Xmx4096m -XX:MaxMetaspaceSize=1024m',
};

module.exports = function withGradleMemory(config) {
  return withGradleProperties(config, (cfg) => {
    for (const [key, value] of Object.entries(SETTINGS)) {
      const existing = cfg.modResults.find((item) => item.type === 'property' && item.key === key);
      if (existing) {
        existing.value = value;
      } else {
        cfg.modResults.push({ type: 'property', key, value });
      }
    }
    return cfg;
  });
};
