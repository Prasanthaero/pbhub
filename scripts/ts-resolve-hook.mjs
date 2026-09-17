/**
 * Packages that only exist inside the app, stubbed so the Node tests can import
 * modules that touch them. The stub has to behave like the real thing, not just
 * satisfy the import — the storage one keeps a Map, because the lockout rules
 * being tested are about what survives a write and a read.
 */
const STUBS = {
  '@react-native-async-storage/async-storage': './stubs/async-storage.mjs',
};

export async function resolve(specifier, context, next) {
  const stub = STUBS[specifier];
  if (stub) {
    return {
      url: new URL(stub, import.meta.url).href,
      format: 'module',
      shortCircuit: true,
    };
  }

  try {
    return await next(specifier, context);
  } catch (err) {
    if (err?.code !== 'ERR_MODULE_NOT_FOUND' || !specifier.startsWith('.')) throw err;
    for (const ext of ['.ts', '.tsx', '/index.ts']) {
      try {
        return await next(specifier + ext, context);
      } catch {}
    }
    throw err;
  }
}
