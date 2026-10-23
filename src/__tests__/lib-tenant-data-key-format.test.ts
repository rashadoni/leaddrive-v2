/**
 * Stage 2b of PII encryption: what a stored per-organization data key changes
 * in the value and file formats, with the key ring put into process memory
 * directly (no database — `tenant-data-keys-postgres.test.ts` covers loading).
 *
 *   • wrapping binds a data key to its organization, version and master key;
 *   • with the ring loaded a write is v2 / "d<N>", without it v1 / "t1", and
 *     both keep reading;
 *   • a v2 value whose key is not in memory is refused — never handed back as
 *     if it were plaintext, which a later save would encrypt as the value;
 *   • the sweep keeps each value's AAD and leaves plaintext alone.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  ciphertextVersion,
  decryptForTenant,
  decryptForTenantBound,
  encryptForTenant,
  encryptForTenantBound,
  generateTenantDataKey,
  reencryptForTenantDataKey,
  resetMasterKekCache,
  softDecryptForTenant,
  softDecryptForTenantBound,
  stripCiphertextVersion,
  tenantDataKeyMaterial,
  tenantMasterKeyId,
  unwrapTenantDataKey,
  wrapTenantDataKey,
} from "@/lib/crypto/tenant-pii-encryption"
import {
  forgetTenantDataKeyRings,
  storeTenantDataKeyRing,
  tenantDataKeyRingNeedsRefresh,
  TenantDataKeyUnavailableError,
  TENANT_DATA_KEY_USABLE_MS,
} from "@/lib/crypto/tenant-data-key-cache"
import { runWithTenant } from "@/lib/rls-context"
import {
  decodeTenantFileBytes,
  openTenantFileBytes,
  sealTenantFile,
  tenantFileKeyId,
} from "@/lib/crypto/tenant-file-encryption"

const TEST_KEK = "0123456789abcdef".repeat(4) // gitleaks:allow — synthetic test key
const ALT_KEK = "fedcba9876543210".repeat(4) // gitleaks:allow — synthetic test key
const ORG = "cmorgaaaaaaaaaaaaaaaaaaaa"
const OTHER_ORG = "cmorgbbbbbbbbbbbbbbbbbbbb"

/** Put a ring with the given versions into memory, the newest unretired one current. */
function loadRing(orgId: string, versions: Record<number, Buffer>, loadedAt = Date.now()) {
  const keys = new Map(Object.entries(versions).map(([version, key]) => [Number(version), tenantDataKeyMaterial(orgId, key)]))
  storeTenantDataKeyRing(orgId, { loadedAt, current: Math.max(...keys.keys()), keys })
}

beforeEach(() => {
  process.env.TENANT_PII_MASTER_KEY = TEST_KEK
  resetMasterKekCache()
  forgetTenantDataKeyRings()
})

afterEach(() => {
  delete process.env.TENANT_PII_MASTER_KEY
  resetMasterKekCache()
  forgetTenantDataKeyRings()
})

describe("wrapping a data key under the master key", () => {
  it("round-trips, and is bound to organization, version and master key", () => {
    const key = generateTenantDataKey()
    const { wrappedKey, masterKeyId } = wrapTenantDataKey(ORG, 1, key)
    expect(wrappedKey).toHaveLength(80) // the migration's CHECK
    expect(masterKeyId).toBe(tenantMasterKeyId())
    expect(masterKeyId).toMatch(/^m-[0-9a-f]{16}$/)
    expect(unwrapTenantDataKey(ORG, 1, masterKeyId, wrappedKey).equals(key)).toBe(true)

    expect(() => unwrapTenantDataKey(OTHER_ORG, 1, masterKeyId, wrappedKey)).toThrow()
    expect(() => unwrapTenantDataKey(ORG, 2, masterKeyId, wrappedKey)).toThrow()
    expect(() => unwrapTenantDataKey(ORG, 1, "m-0000000000000000", wrappedKey)).toThrow(/another master key/)
    const tampered = Buffer.from(wrappedKey, "base64")
    tampered[20] ^= 1
    expect(() => unwrapTenantDataKey(ORG, 1, masterKeyId, tampered.toString("base64"))).toThrow()
  })

  it("does not open under another master key", () => {
    const { wrappedKey, masterKeyId } = wrapTenantDataKey(ORG, 1, generateTenantDataKey())
    process.env.TENANT_PII_MASTER_KEY = ALT_KEK
    resetMasterKekCache()
    expect(tenantMasterKeyId()).not.toBe(masterKeyId)
    expect(() => unwrapTenantDataKey(ORG, 1, masterKeyId, wrappedKey)).toThrow()
  })

  it("never derives the data key from the master key: two keys for one organization differ", () => {
    expect(generateTenantDataKey().equals(generateTenantDataKey())).toBe(false)
  })
})

describe("PII column values", () => {
  it("are v1 while the ring is not loaded, v2 with its current version once it is", () => {
    const v1 = encryptForTenant(ORG, "Aysel Məmmədova")
    expect(ciphertextVersion(v1)).toBe(1)

    loadRing(ORG, { 1: generateTenantDataKey(), 3: generateTenantDataKey() })
    const v2 = encryptForTenant(ORG, "Aysel Məmmədova")
    expect(v2).toMatch(/^v2:3:[A-Za-z0-9+/]+=*$/)
    expect(decryptForTenant(ORG, v2)).toBe("Aysel Məmmədova")
    expect(decryptForTenant(ORG, v1)).toBe("Aysel Məmmədova")
    expect(softDecryptForTenant(ORG, v2)).toBe("Aysel Məmmədova")
    expect(stripCiphertextVersion(v2)).toBe(v2.slice("v2:3:".length))
  })

  it("keep the column-bound AAD under the data key", () => {
    loadRing(ORG, { 1: generateTenantDataKey() })
    const value = encryptForTenantBound(ORG, "citizens", "taxId", "AZ1234567")
    expect(value.startsWith("v2:1:")).toBe(true)
    expect(decryptForTenantBound(ORG, "citizens", "taxId", value)).toBe("AZ1234567")
    expect(softDecryptForTenantBound(ORG, "citizens", "taxId", value)).toBe("AZ1234567")
    // Moved to another column it does not open there.
    expect(() => decryptForTenantBound(ORG, "citizens", "fullName", value)).toThrow()
    // The soft path also accepts an orgId-only v2 value (route migration fallback).
    expect(softDecryptForTenantBound(ORG, "citizens", "city", encryptForTenant(ORG, "Bakı"))).toBe("Bakı")
  })

  it("do not open for another organization even when it has a ring of its own", () => {
    loadRing(ORG, { 1: generateTenantDataKey() })
    loadRing(OTHER_ORG, { 1: generateTenantDataKey() })
    const value = encryptForTenant(ORG, "secret")
    expect(() => decryptForTenant(OTHER_ORG, value)).toThrow()
    expect(softDecryptForTenant(OTHER_ORG, value)).toBe(value)
  })

  it("refuse to read v2 without the key, in the strict and the soft paths alike", () => {
    loadRing(ORG, { 1: generateTenantDataKey() })
    const value = encryptForTenantBound(ORG, "citizens", "fullName", "Rəşad")
    const unbound = encryptForTenant(ORG, "Rəşad")
    forgetTenantDataKeyRings(ORG)

    expect(() => decryptForTenant(ORG, unbound)).toThrow(TenantDataKeyUnavailableError)
    expect(() => softDecryptForTenant(ORG, unbound)).toThrow(TenantDataKeyUnavailableError)
    expect(() => decryptForTenantBound(ORG, "citizens", "fullName", value)).toThrow(TenantDataKeyUnavailableError)
    expect(() => softDecryptForTenantBound(ORG, "citizens", "fullName", value)).toThrow(TenantDataKeyUnavailableError)
  })

  it("refuse a version newer than the loaded ring and ask for a reload", () => {
    const key2 = generateTenantDataKey()
    loadRing(ORG, { 1: generateTenantDataKey(), 2: key2 })
    const written = encryptForTenant(ORG, "later")
    loadRing(ORG, { 1: generateTenantDataKey() })
    expect(tenantDataKeyRingNeedsRefresh(ORG)).toBe(false)
    expect(() => softDecryptForTenant(ORG, written)).toThrow(TenantDataKeyUnavailableError)
    expect(tenantDataKeyRingNeedsRefresh(ORG)).toBe(true)
    loadRing(ORG, { 1: generateTenantDataKey(), 2: key2 })
    expect(decryptForTenant(ORG, written)).toBe("later")
  })

  it("stop using a ring that has aged out of memory", () => {
    loadRing(ORG, { 1: generateTenantDataKey() }, Date.now() - TENANT_DATA_KEY_USABLE_MS - 1)
    expect(ciphertextVersion(encryptForTenant(ORG, "x".repeat(3)))).toBe(1)
  })

  it("still treat short and non-base64 strings as legacy plaintext", () => {
    loadRing(ORG, { 1: generateTenantDataKey() })
    expect(softDecryptForTenant(ORG, "plain text")).toBe("plain text")
    expect(softDecryptForTenant(ORG, "v2:note")).toBe("v2:note")
    expect(softDecryptForTenantBound(ORG, "citizens", "city", "Gəncə")).toBe("Gəncə")
  })
})

describe("the v1 → v2 sweep of one value", () => {
  it("re-encrypts under the current key and keeps the AAD the value was written with", () => {
    const bound = encryptForTenantBound(ORG, "citizens", "taxId", "AZ1")
    const unbound = encryptForTenant(ORG, "note")
    loadRing(ORG, { 1: generateTenantDataKey() })

    const nextBound = reencryptForTenantDataKey(ORG, "citizens", "taxId", bound)!
    const nextUnbound = reencryptForTenantDataKey(ORG, "citizens", "taxId", unbound)!
    expect(nextBound.startsWith("v2:1:")).toBe(true)
    expect(decryptForTenantBound(ORG, "citizens", "taxId", nextBound)).toBe("AZ1")
    expect(nextUnbound.startsWith("v2:1:")).toBe(true)
    expect(decryptForTenant(ORG, nextUnbound)).toBe("note")
  })

  it("leaves plaintext, v2 values and another tenant's values alone", () => {
    const foreign = encryptForTenant(OTHER_ORG, "theirs")
    loadRing(ORG, { 1: generateTenantDataKey() })
    expect(reencryptForTenantDataKey(ORG, "t", "c", "Plain name")).toBeNull()
    expect(reencryptForTenantDataKey(ORG, "t", "c", encryptForTenant(ORG, "already"))).toBeNull()
    expect(reencryptForTenantDataKey(ORG, "t", "c", foreign)).toBeNull()
  })

  it("needs the key loaded", () => {
    const value = encryptForTenant(ORG, "x1")
    expect(() => reencryptForTenantDataKey(ORG, "t", "c", value)).toThrow(TenantDataKeyUnavailableError)
  })
})

describe("file envelopes", () => {
  const bytes = Buffer.from("%PDF-1.7 customer contract")

  it("are written under the data key when it is loaded and under t1 otherwise; both read", async () => {
    const derived = sealTenantFile(ORG, bytes)
    expect(tenantFileKeyId(derived)).toBe("t1")

    loadRing(ORG, { 2: generateTenantDataKey() })
    const onDataKey = sealTenantFile(ORG, bytes)
    expect(tenantFileKeyId(onDataKey)).toBe("d2")
    expect(decodeTenantFileBytes(ORG, onDataKey).equals(bytes)).toBe(true)
    expect(decodeTenantFileBytes(ORG, derived).equals(bytes)).toBe(true)
    expect(await openTenantFileBytes(ORG, onDataKey)).toEqual(bytes)
    expect(() => decodeTenantFileBytes(OTHER_ORG, onDataKey)).toThrow()
    expect(tenantFileKeyId(bytes)).toBeNull()
  })

  it("refuse a d<N> envelope whose key is not in memory instead of reporting corruption", () => {
    loadRing(ORG, { 1: generateTenantDataKey() })
    const sealed = sealTenantFile(ORG, bytes)
    forgetTenantDataKeyRings(ORG)
    expect(() => decodeTenantFileBytes(ORG, sealed)).toThrow(TenantDataKeyUnavailableError)
  })
})

describe("runWithTenant", () => {
  // Fire-and-forget callers (`logAudit`, the public form's view counter) rely on
  // the callback starting at once; only a due key load may delay it.
  it("starts its callback synchronously when no key load is due", () => {
    let started = 0
    loadRing(ORG, { 1: generateTenantDataKey() })
    void runWithTenant(ORG, () => { started += 1 })
    expect(started).toBe(1)

    forgetTenantDataKeyRings()
    delete process.env.TENANT_PII_MASTER_KEY
    resetMasterKekCache()
    void runWithTenant(ORG, () => { started += 1 })
    expect(started).toBe(2)
  })
})
