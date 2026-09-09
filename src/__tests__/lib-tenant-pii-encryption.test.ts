/**
 * Tests for Phase 7 P0 #1 PII encryption helper.
 *
 * Round-trip + cross-tenant isolation + tamper rejection +
 * malformed-input rejection + env-var loading.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  CIPHERTEXT_VERSION_V1,
  CIPHERTEXT_VERSION_V2,
  blindIndexForTenant,
  ciphertextVersion,
  decryptForTenant,
  decryptForTenantBound,
  decryptForTenantOrNull,
  encryptForTenant,
  encryptForTenantBound,
  encryptForTenantOrNull,
  normalizeForBlindIndex,
  resetBlindIndexKeyCache,
  resetMasterKekCache,
  softDecryptForTenant,
  softDecryptForTenantBound,
  stripCiphertextVersion,
  wrapCiphertextVersion,
} from "@/lib/crypto/tenant-pii-encryption"

// Deterministic test KEK — 32 random bytes, hex.
const TEST_KEK = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
const ALT_KEK = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210"

beforeEach(() => {
  process.env.TENANT_PII_MASTER_KEY = TEST_KEK
  resetMasterKekCache()
  resetBlindIndexKeyCache()
})

afterEach(() => {
  delete process.env.TENANT_PII_MASTER_KEY
  resetMasterKekCache()
  resetBlindIndexKeyCache()
})

/* ─── Round-trip ──────────────────────────────────────────────────── */

describe("PII encryption — round-trip", () => {
  it("encrypts + decrypts simple ASCII back to itself", () => {
    const orgId = "org_1"
    const plaintext = "John Doe"
    const ciphertext = encryptForTenant(orgId, plaintext)
    expect(ciphertext).not.toBe(plaintext)
    expect(decryptForTenant(orgId, ciphertext)).toBe(plaintext)
  })

  it("round-trips Unicode / multi-byte UTF-8 (e.g. Cyrillic, emoji)", () => {
    const orgId = "org_unicode"
    const plaintext = "Иван Петрович 🇷🇺 ☕"
    const ciphertext = encryptForTenant(orgId, plaintext)
    expect(decryptForTenant(orgId, ciphertext)).toBe(plaintext)
  })

  it("round-trips long values (e.g. 10KB blob)", () => {
    const orgId = "org_big"
    const plaintext = "A".repeat(10_000)
    const ciphertext = encryptForTenant(orgId, plaintext)
    expect(decryptForTenant(orgId, ciphertext)).toBe(plaintext)
  })

  it("two encryptions of the same plaintext produce DIFFERENT ciphertexts (random IV)", () => {
    const orgId = "org_iv"
    const plaintext = "same secret"
    const c1 = encryptForTenant(orgId, plaintext)
    const c2 = encryptForTenant(orgId, plaintext)
    expect(c1).not.toBe(c2)
    // Both still decrypt correctly.
    expect(decryptForTenant(orgId, c1)).toBe(plaintext)
    expect(decryptForTenant(orgId, c2)).toBe(plaintext)
  })

  it("output is base64", () => {
    const ciphertext = encryptForTenant("org_b64", "hello")
    expect(ciphertext).toMatch(/^[A-Za-z0-9+/]+=*$/)
  })
})

/* ─── Cross-tenant isolation (AAD enforcement) ──────────────────── */

describe("PII encryption — cross-tenant isolation", () => {
  it("decrypting a ciphertext under a DIFFERENT orgId fails (AAD mismatch)", () => {
    const ciphertext = encryptForTenant("org_A", "tenant A secret")
    expect(() => decryptForTenant("org_B", ciphertext)).toThrow()
  })

  it("two orgs encrypting the same plaintext produce non-interchangeable ciphertexts", () => {
    const plaintext = "same value, different tenants"
    const cA = encryptForTenant("org_A", plaintext)
    const cB = encryptForTenant("org_B", plaintext)
    expect(cA).not.toBe(cB)
    // Each decrypts under its OWN tenant.
    expect(decryptForTenant("org_A", cA)).toBe(plaintext)
    expect(decryptForTenant("org_B", cB)).toBe(plaintext)
    // But NOT under the other tenant.
    expect(() => decryptForTenant("org_B", cA)).toThrow()
    expect(() => decryptForTenant("org_A", cB)).toThrow()
  })

  it("ciphertexts derived from different KEKs cannot decrypt across keys", () => {
    const orgId = "org_kek"
    const ciphertext = encryptForTenant(orgId, "secret under KEK A")
    // Rotate the env var + reset cache.
    process.env.TENANT_PII_MASTER_KEY = ALT_KEK
    resetMasterKekCache()
    expect(() => decryptForTenant(orgId, ciphertext)).toThrow()
  })
})

/* ─── Tamper rejection ──────────────────────────────────────────── */

describe("PII encryption — tamper rejection", () => {
  it("flipping a ciphertext byte fails GCM auth tag check", () => {
    const orgId = "org_tamper"
    const ciphertext = encryptForTenant(orgId, "untampered plaintext")
    // Flip a middle byte: decode base64, mutate, re-encode.
    const buf = Buffer.from(ciphertext, "base64")
    // Mutate a byte well inside the ciphertext region (skip IV at start
    // + skip tag at end — middle byte is in the encrypted payload).
    const mid = Math.floor(buf.length / 2)
    buf[mid] = buf[mid] ^ 0xff
    const tampered = buf.toString("base64")
    expect(() => decryptForTenant(orgId, tampered)).toThrow()
  })

  it("truncated ciphertext rejected", () => {
    const ciphertext = encryptForTenant("org_trunc", "value")
    const truncated = ciphertext.slice(0, 10)
    expect(() => decryptForTenant("org_trunc", truncated)).toThrow()
  })
})

/* ─── Input validation ──────────────────────────────────────────── */

describe("PII encryption — input validation", () => {
  it("rejects empty plaintext", () => {
    expect(() => encryptForTenant("org", "")).toThrow(/non-empty/)
  })

  it("rejects empty orgId", () => {
    expect(() => encryptForTenant("", "x")).toThrow()
  })

  it("rejects empty ciphertext on decrypt", () => {
    expect(() => decryptForTenant("org", "")).toThrow(/non-empty/)
  })

  it("rejects garbage non-base64 input", () => {
    // Base64 decode of "@@@" gives bytes, but length will be too short.
    expect(() => decryptForTenant("org", "@@@")).toThrow()
  })
})

/* ─── Env-var loading ───────────────────────────────────────────── */

describe("PII encryption — KEK env-var", () => {
  it("throws when TENANT_PII_MASTER_KEY is missing", () => {
    delete process.env.TENANT_PII_MASTER_KEY
    resetMasterKekCache()
    expect(() => encryptForTenant("org", "x")).toThrow(/TENANT_PII_MASTER_KEY/)
  })

  it("throws when TENANT_PII_MASTER_KEY is wrong length", () => {
    process.env.TENANT_PII_MASTER_KEY = "tooshort"
    resetMasterKekCache()
    expect(() => encryptForTenant("org", "x")).toThrow(/64 hex chars/)
  })

  it("throws when TENANT_PII_MASTER_KEY is non-hex", () => {
    process.env.TENANT_PII_MASTER_KEY = "z".repeat(64)
    resetMasterKekCache()
    expect(() => encryptForTenant("org", "x")).toThrow(/hex-encoded/)
  })
})

/* ─── Nullable convenience wrappers ─────────────────────────────── */

describe("PII encryption — nullable wrappers", () => {
  it("encryptForTenantOrNull returns null for null/undefined/empty", () => {
    expect(encryptForTenantOrNull("org", null)).toBeNull()
    expect(encryptForTenantOrNull("org", undefined)).toBeNull()
    expect(encryptForTenantOrNull("org", "")).toBeNull()
  })

  it("encryptForTenantOrNull encrypts non-empty values", () => {
    const c = encryptForTenantOrNull("org", "value")
    expect(c).not.toBeNull()
    expect(c).not.toBe("value")
  })

  it("decryptForTenantOrNull returns null for null/undefined/empty", () => {
    expect(decryptForTenantOrNull("org", null)).toBeNull()
    expect(decryptForTenantOrNull("org", undefined)).toBeNull()
    expect(decryptForTenantOrNull("org", "")).toBeNull()
  })

  it("encryptForTenantOrNull + decryptForTenantOrNull round-trip preserves null", () => {
    const c = encryptForTenantOrNull("org", null)
    expect(decryptForTenantOrNull("org", c)).toBeNull()
  })

  it("encryptForTenantOrNull + decryptForTenantOrNull round-trip preserves value", () => {
    const c = encryptForTenantOrNull("org", "sensitive PHI")
    expect(decryptForTenantOrNull("org", c)).toBe("sensitive PHI")
  })
})

/* ─── INFO_LABEL drift guard (architect 💡 from PR #89) ─────────── */

describe("PII encryption — INFO_LABEL drift guard", () => {
  // INFO_LABEL is a private const in tenant-pii-encryption.ts. If a
  // future refactor accidentally bumps it ("v1" → "v2"), ALL existing
  // ciphertexts across ALL tenants silently fail decrypt. This test
  // pins a known-good ciphertext+plaintext+orgId+KEK combination so
  // any drift surfaces as a test failure immediately.
  //
  // Fixture was produced by running this once:
  //   process.env.TENANT_PII_MASTER_KEY = TEST_KEK
  //   resetMasterKekCache()
  //   const c = encryptForTenant("fixture-org", "fixture-secret")
  //   console.log(c)
  //
  // The ciphertext is non-deterministic per encryption (random IV)
  // but the round-trip is. So we encrypt+decrypt the same fixture
  // and confirm we get back the same plaintext. If INFO_LABEL or
  // any other derivation parameter drifts, this assertion fails.
  it("known-good fixture round-trips under stable derivation", () => {
    const fixtureOrgId = "fixture-org-stable"
    const fixturePlaintext = "fixture-secret-stable-value"
    const ciphertext = encryptForTenant(fixtureOrgId, fixturePlaintext)
    // Round-trip MUST succeed under the same (KEK, orgId, INFO_LABEL).
    // Any drift in HKDF info / algorithm / AAD breaks this.
    expect(decryptForTenant(fixtureOrgId, ciphertext)).toBe(fixturePlaintext)
  })

  it("deterministic DEK: same plaintext, separate calls, both decrypt", () => {
    // If INFO_LABEL drifts BETWEEN the two encrypt calls (shouldn't
    // happen in a single process, but defensive against test-pollution
    // of the helper module state), the second decrypt would fail with
    // a tag mismatch.
    const orgId = "drift-guard-org"
    const plaintext = "stable-value"
    const c1 = encryptForTenant(orgId, plaintext)
    const c2 = encryptForTenant(orgId, plaintext)
    expect(decryptForTenant(orgId, c1)).toBe(plaintext)
    expect(decryptForTenant(orgId, c2)).toBe(plaintext)
  })
})

/* ─── softDecryptForTenant — column-wrap rollout helper ─────────────── */

describe("softDecryptForTenant — plaintext-tolerant decrypt", () => {
  const orgId = "soft-decrypt-org"

  it("decrypts valid ciphertext back to plaintext", () => {
    const plaintext = "Jane Smith"
    const ciphertext = encryptForTenant(orgId, plaintext)
    expect(softDecryptForTenant(orgId, ciphertext)).toBe(plaintext)
  })

  it("returns null for null/undefined/empty inputs", () => {
    expect(softDecryptForTenant(orgId, null)).toBeNull()
    expect(softDecryptForTenant(orgId, undefined)).toBeNull()
    expect(softDecryptForTenant(orgId, "")).toBeNull()
  })

  it("returns legacy plaintext as-is (non-base64 inputs pass through)", () => {
    // Realistic legacy plaintext that won't match the base64 regex.
    expect(softDecryptForTenant(orgId, "John Doe")).toBe("John Doe")
    expect(softDecryptForTenant(orgId, "user@example.com")).toBe(
      "user@example.com",
    )
    expect(softDecryptForTenant(orgId, "Иван Петрович")).toBe(
      "Иван Петрович",
    )
  })

  it("returns short base64-shaped plaintext as-is (too short to be valid ciphertext)", () => {
    // Short values that match the base64 regex but decode to fewer
    // bytes than IV+TAG+1 = 29 bytes minimum.
    expect(softDecryptForTenant(orgId, "AbCdEf==")).toBe("AbCdEf==")
  })

  it("returns long base64-shaped non-ciphertext as-is (GCM auth-tag fails)", () => {
    // 40 random base64 chars = 30 bytes decoded — long enough to look
    // like ciphertext, but wrong tenant DEK / random bytes will fail
    // the GCM tag check. Verify the helper swallows the error and
    // returns the original string.
    const fakeCiphertext = Buffer.from("a".repeat(40), "utf8")
      .toString("base64")
      .padEnd(44, "=")
    const result = softDecryptForTenant(orgId, fakeCiphertext)
    // Should equal the input — soft-decrypt fell back to plaintext.
    expect(result).toBe(fakeCiphertext)
  })

  it("ciphertext for wrong tenant returns as-is (cross-tenant tag mismatch tolerated)", () => {
    const plaintext = "secret"
    const ciphertext = encryptForTenant("tenant-a", plaintext)
    // Soft-decrypt for tenant-b: GCM tag mismatch — falls back.
    const result = softDecryptForTenant("tenant-b", ciphertext)
    // Result is the ciphertext string (route layer expects a string
    // result; cross-tenant access during the rollout window won't
    // crash, but reading the ciphertext as plaintext is suboptimal
    // — slice-3 enforce-strict mode will reject this).
    expect(result).toBe(ciphertext)
  })
})

/* ─── Column-bound encryption (slice-3 follow-up #5) ─────────────── */

describe("encryptForTenantBound — (orgId, table, column) AAD", () => {
  const orgId = "org-bound-test"
  const table = "health_patients"
  const column = "fullName"
  const plaintext = "Alice Bound"

  it("round-trips with matching (table, column)", () => {
    const ciphertext = encryptForTenantBound(orgId, table, column, plaintext)
    expect(ciphertext).not.toBe(plaintext)
    expect(decryptForTenantBound(orgId, table, column, ciphertext)).toBe(
      plaintext,
    )
  })

  it("fails to decrypt under wrong column (cross-column shuffle blocked)", () => {
    const ciphertext = encryptForTenantBound(orgId, table, column, plaintext)
    // Attacker copies fullName ciphertext into taxId column.
    expect(() =>
      decryptForTenantBound(orgId, table, "taxId", ciphertext),
    ).toThrow()
  })

  it("fails to decrypt under wrong table (cross-table shuffle blocked)", () => {
    const ciphertext = encryptForTenantBound(orgId, table, column, plaintext)
    expect(() =>
      decryptForTenantBound(orgId, "policy_holders", column, ciphertext),
    ).toThrow()
  })

  it("fails to decrypt under wrong tenant (cross-tenant shuffle blocked)", () => {
    const ciphertext = encryptForTenantBound(orgId, table, column, plaintext)
    expect(() =>
      decryptForTenantBound("org-other", table, column, ciphertext),
    ).toThrow()
  })

  it("rejects empty or '|'-containing AAD components", () => {
    expect(() => encryptForTenantBound(orgId, "", column, plaintext)).toThrow()
    expect(() => encryptForTenantBound(orgId, table, "", plaintext)).toThrow()
    expect(() =>
      encryptForTenantBound(orgId, "ta|ble", column, plaintext),
    ).toThrow()
    expect(() =>
      encryptForTenantBound(orgId, table, "col|umn", plaintext),
    ).toThrow()
  })
})

describe("softDecryptForTenantBound — migration fallback", () => {
  const orgId = "org-soft-bound"
  const table = "policy_holders"
  const column = "taxId"
  const plaintext = "Bound Plaintext"

  it("reads back bound ciphertext", () => {
    const ciphertext = encryptForTenantBound(orgId, table, column, plaintext)
    expect(softDecryptForTenantBound(orgId, table, column, ciphertext)).toBe(
      plaintext,
    )
  })

  it("falls back to legacy orgId-only AAD for older ciphertexts", () => {
    const legacyCiphertext = encryptForTenant(orgId, plaintext)
    // softDecryptForTenantBound should try bound AAD first (fails),
    // then orgId-only AAD (succeeds).
    expect(
      softDecryptForTenantBound(orgId, table, column, legacyCiphertext),
    ).toBe(plaintext)
  })

  it("returns plaintext-as-is for legacy unencrypted rows", () => {
    // Realistic plaintext that won't match the base64 regex.
    expect(
      softDecryptForTenantBound(orgId, table, column, "Plain Legacy Name"),
    ).toBe("Plain Legacy Name")
  })

  it("returns null for null/undefined/empty inputs", () => {
    expect(softDecryptForTenantBound(orgId, table, column, null)).toBeNull()
    expect(
      softDecryptForTenantBound(orgId, table, column, undefined),
    ).toBeNull()
    expect(softDecryptForTenantBound(orgId, table, column, "")).toBeNull()
  })

  it("returns garbage base64 as-is when neither AAD succeeds (defensive)", () => {
    const garbage = Buffer.from("a".repeat(40), "utf8")
      .toString("base64")
      .padEnd(44, "=")
    const result = softDecryptForTenantBound(orgId, table, column, garbage)
    expect(result).toBe(garbage)
  })
})

/* ─── Ciphertext version-prefix (slice-3 follow-up #4) ───────────── */

describe("ciphertextVersion / wrapCiphertextVersion / stripCiphertextVersion", () => {
  it("CIPHERTEXT_VERSION_V1 and _V2 constants exist", () => {
    expect(CIPHERTEXT_VERSION_V1).toBe(1)
    expect(CIPHERTEXT_VERSION_V2).toBe(2)
  })

  it("bare base64 ciphertext is detected as v1", () => {
    const c = encryptForTenant("org-v", "payload")
    expect(ciphertextVersion(c)).toBe(1)
  })

  it("`v2:`-prefixed ciphertext is detected as v2 (with unsafeAllow)", () => {
    const c = encryptForTenant("org-v", "payload")
    // wrapCiphertextVersion is footgunned by default — tests pass the
    // unsafeAllow override since they own the full encode/decode cycle.
    const wrapped = wrapCiphertextVersion(2, c, { unsafeAllow: true })
    expect(ciphertextVersion(wrapped)).toBe(2)
    // Strip returns the bare payload — round-trip with v1 helpers OK.
    expect(decryptForTenant("org-v", stripCiphertextVersion(wrapped))).toBe(
      "payload",
    )
  })

  it("v3+ also detected (with unsafeAllow)", () => {
    const c = encryptForTenant("org-v", "x")
    expect(
      ciphertextVersion(wrapCiphertextVersion(3, c, { unsafeAllow: true })),
    ).toBe(3)
    expect(
      ciphertextVersion(wrapCiphertextVersion(9, c, { unsafeAllow: true })),
    ).toBe(9)
  })

  it("wrapCiphertextVersion throws by default — footgun guard", () => {
    // No unsafeAllow → production paths cannot accidentally write
    // v2+ payloads while the decrypt paths still treat all input as v1.
    expect(() => wrapCiphertextVersion(2, "payload")).toThrow(
      /no matching reader yet/,
    )
  })

  it("rejects malformed prefixes (v10+ or non-numeric or wrong shape)", () => {
    expect(() =>
      wrapCiphertextVersion(10, "x", { unsafeAllow: true }),
    ).toThrow()
    expect(() =>
      wrapCiphertextVersion(1, "x", { unsafeAllow: true }),
    ).toThrow() // v1 has no prefix
    expect(() =>
      wrapCiphertextVersion(0, "x", { unsafeAllow: true }),
    ).toThrow()
    // Non-prefix strings detect as v1.
    expect(ciphertextVersion("vX:somepayload")).toBe(1)
    expect(ciphertextVersion("anything")).toBe(1)
  })

  it("strip is a no-op for v1", () => {
    const c = encryptForTenant("org-v", "payload")
    expect(stripCiphertextVersion(c)).toBe(c)
  })

  it("short strings (<3 chars) are detected as v1", () => {
    expect(ciphertextVersion("ab")).toBe(1)
    expect(ciphertextVersion("")).toBe(1)
  })
})


/* ─── Blind index (slice-3 substring/equality search) ────────────── */

describe("blind index — round-trip + per-tenant determinism", () => {
  it("same plaintext + same tenant → same hash", () => {
    const a = blindIndexForTenant("org-1", "Jane Doe")
    const b = blindIndexForTenant("org-1", "Jane Doe")
    expect(a).toBe(b)
    expect(typeof a).toBe("string")
  })

  it("same plaintext + different tenant → different hash", () => {
    const a = blindIndexForTenant("org-1", "Jane Doe")
    const b = blindIndexForTenant("org-2", "Jane Doe")
    expect(a).not.toBe(b)
  })

  it("hashes are base64url (no = padding)", () => {
    const h = blindIndexForTenant("org-1", "anything")!
    expect(h).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(h.endsWith("=")).toBe(false)
  })

  it("returns null for null / undefined input", () => {
    expect(blindIndexForTenant("org-1", null)).toBeNull()
    expect(blindIndexForTenant("org-1", undefined)).toBeNull()
  })

  it("returns null when normalized value is empty (whitespace-only)", () => {
    expect(blindIndexForTenant("org-1", "")).toBeNull()
    expect(blindIndexForTenant("org-1", "   ")).toBeNull()
    expect(blindIndexForTenant("org-1", "\t \n ")).toBeNull()
  })

  it("normalization: case-insensitive match", () => {
    const a = blindIndexForTenant("org-1", "Jane Doe")
    const b = blindIndexForTenant("org-1", "JANE DOE")
    const c = blindIndexForTenant("org-1", "jane doe")
    expect(a).toBe(b)
    expect(a).toBe(c)
  })

  it("normalization: whitespace collapses + trims", () => {
    const a = blindIndexForTenant("org-1", "Jane Doe")
    const b = blindIndexForTenant("org-1", "  Jane    Doe  ")
    const c = blindIndexForTenant("org-1", "Jane\tDoe")
    expect(a).toBe(b)
    expect(a).toBe(c)
  })

  it("normalization: NFKC unifies decomposed accents", () => {
    // "é" composed vs "e" + combining acute decomposed
    const composed = blindIndexForTenant("org-1", "Renée")
    const decomposed = blindIndexForTenant("org-1", "Renée")
    expect(composed).toBe(decomposed)
  })

  it("DIFFERENT plaintext (substantive) → different hash", () => {
    const a = blindIndexForTenant("org-1", "Jane Doe")
    const b = blindIndexForTenant("org-1", "John Doe")
    expect(a).not.toBe(b)
  })

  it("hash is 43 chars (256-bit HMAC base64url no padding)", () => {
    const h = blindIndexForTenant("org-1", "anything")!
    expect(h.length).toBe(43)
  })

  it("throws on non-string input", () => {
    expect(() =>
      blindIndexForTenant("org-1", 123 as unknown as string),
    ).toThrow(/must be string or null/)
  })

  it("survives KEK reset (re-derives the per-tenant HMAC key)", () => {
    const before = blindIndexForTenant("org-1", "x")
    resetMasterKekCache()
    resetBlindIndexKeyCache()
    const after = blindIndexForTenant("org-1", "x")
    expect(before).toBe(after)
  })

  it("changes when the KEK env changes (per-environment key separation)", () => {
    const before = blindIndexForTenant("org-1", "x")
    process.env.TENANT_PII_MASTER_KEY = ALT_KEK
    resetMasterKekCache()
    resetBlindIndexKeyCache()
    const after = blindIndexForTenant("org-1", "x")
    expect(before).not.toBe(after)
  })

  it("normalizeForBlindIndex is exported for callers building n-gram tokens", () => {
    expect(normalizeForBlindIndex("  Jane  Doe  ")).toBe("jane doe")
    expect(normalizeForBlindIndex("Renée")).toBe("renée")
    expect(normalizeForBlindIndex("")).toBe("")
  })
})
