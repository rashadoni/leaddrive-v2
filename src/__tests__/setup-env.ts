// Global test environment setup. Loaded via vitest.config.ts setupFiles.
// Provides minimal env vars that runtime modules assert on import — without
// this the module-load assertion in src/lib/mobile-auth.ts would crash every
// test file that imports an MTM mobile route.
if (!process.env.NEXTAUTH_SECRET) {
  process.env.NEXTAUTH_SECRET = "test-secret-do-not-use-in-production"
}
