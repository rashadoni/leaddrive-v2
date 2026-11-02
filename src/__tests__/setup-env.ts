// Global test environment setup. Loaded via vitest.config.ts setupFiles.
// Provides minimal env vars that runtime modules assert on import — without
// this the module-load assertion in src/lib/mobile-auth.ts would crash every
// test file that imports an MTM mobile route.
if (!process.env.NEXTAUTH_SECRET) {
  process.env.NEXTAUTH_SECRET = "test-secret-do-not-use-in-production"
}
// Every upload writer seals files under a key derived from this master key
// (src/lib/crypto/tenant-file-encryption.ts). Tests that exercise a missing or
// different key still delete or replace it themselves.
if (!process.env.TENANT_PII_MASTER_KEY) {
  process.env.TENANT_PII_MASTER_KEY = "5e7a0c1d9b2f48e6".repeat(4) // gitleaks:allow — synthetic test key
}
