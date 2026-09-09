/**
 * CLM Slice 7d — Unit tests for src/lib/esign/providers/index.ts
 *
 * Coverage:
 *   getEsignProvider:
 *     - "native" → returns null
 *     - "docusign" → returns DocuSignProvider instance
 *     - Unknown → throws
 *
 *   DocuSignProvider (stub):
 *     - send() throws "requires OAuth credentials"
 *     - getStatus() throws "requires OAuth credentials"
 *     - downloadSignedPdf() throws "requires OAuth credentials"
 *     - isNeedsCredsError() is true for the thrown error
 *
 *   resolveEsignProvider:
 *     - "native" (or null/undefined) → always returns { provider: null }
 *       (never hits DB)
 *     - "docusign" + active config exists → returns DocuSignProvider + decrypted creds
 *     - "docusign" + no active config → returns { provider: null }
 *       (no configured DocuSign)
 *     - Corrupt ciphertext → throws
 *
 *   Native send path unaffected:
 *     - resolveEsignProvider("native") returns null without DB access
 *     - This confirms the native HMAC-token flow (which checks provider===null)
 *       is unconditionally preserved
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: {
    esignProviderConfig: {
      findFirst: vi.fn(),
    },
  },
}))

vi.mock("@/lib/crypto/tenant-pii-encryption", () => ({
  decryptForTenant: vi.fn(),
}))

import { prisma } from "@/lib/prisma"
import { decryptForTenant } from "@/lib/crypto/tenant-pii-encryption"
import {
  getEsignProvider,
  DocuSignProvider,
  resolveEsignProvider,
  isNeedsCredsError,
} from "@/lib/esign/providers"

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── getEsignProvider ─────────────────────────────────────────────────────────

describe("getEsignProvider", () => {
  it("returns null for 'native'", () => {
    expect(getEsignProvider("native")).toBeNull()
  })

  it("returns a DocuSignProvider instance for 'docusign'", () => {
    const provider = getEsignProvider("docusign")
    expect(provider).toBeInstanceOf(DocuSignProvider)
  })

  it("throws for an unknown provider name", () => {
    expect(() => getEsignProvider("unknown-provider")).toThrow('Unknown e-sign provider: "unknown-provider"')
  })
})

// ─── DocuSignProvider stub ────────────────────────────────────────────────────

describe("DocuSignProvider stub", () => {
  const stub = new DocuSignProvider()
  const fakeCreds = { clientId: "id", clientSecret: "secret", accountId: "acc" }
  const fakeEnvelope = { id: "env1", subject: "Test", message: null }
  const fakeSigners = [{ fullName: "Alice", email: "alice@example.com", order: 1 }]

  it("send() throws the needs-credentials error", async () => {
    await expect(stub.send(fakeEnvelope, fakeSigners, fakeCreds)).rejects.toThrow(
      "requires OAuth credentials"
    )
  })

  it("getStatus() throws the needs-credentials error", async () => {
    await expect(stub.getStatus("ext-id", fakeCreds)).rejects.toThrow(
      "requires OAuth credentials"
    )
  })

  it("downloadSignedPdf() throws the needs-credentials error", async () => {
    await expect(stub.downloadSignedPdf("ext-id", fakeCreds)).rejects.toThrow(
      "requires OAuth credentials"
    )
  })

  it("isNeedsCredsError returns true for the stub's error", async () => {
    let caughtErr: unknown
    try { await stub.send(fakeEnvelope, fakeSigners, fakeCreds) } catch (e) { caughtErr = e }
    expect(isNeedsCredsError(caughtErr)).toBe(true)
  })

  it("isNeedsCredsError returns false for unrelated errors", () => {
    expect(isNeedsCredsError(new Error("something else"))).toBe(false)
    expect(isNeedsCredsError("string error")).toBe(false)
    expect(isNeedsCredsError(null)).toBe(false)
  })
})

// ─── resolveEsignProvider ─────────────────────────────────────────────────────

describe("resolveEsignProvider", () => {
  it("returns null provider for 'native' without hitting DB", async () => {
    const result = await resolveEsignProvider("org1", "native")
    expect(result.provider).toBeNull()
    expect(result.config).toBeNull()
    // Must NOT query DB — native is resolved entirely in-memory
    expect(prisma.esignProviderConfig.findFirst).not.toHaveBeenCalled()
  })

  it("returns null provider for null/undefined requestedProvider (native default)", async () => {
    const resultNull = await resolveEsignProvider("org1", null)
    expect(resultNull.provider).toBeNull()
    const resultUndefined = await resolveEsignProvider("org1", undefined)
    expect(resultUndefined.provider).toBeNull()
    expect(prisma.esignProviderConfig.findFirst).not.toHaveBeenCalled()
  })

  it("returns docusign provider when active config exists", async () => {
    vi.mocked(prisma.esignProviderConfig.findFirst).mockResolvedValue({
      id: "cfg1",
      provider: "docusign",
      config: "ENCRYPTED_BLOB",
    } as never)
    vi.mocked(decryptForTenant).mockReturnValue(
      JSON.stringify({ clientId: "id", clientSecret: "s", accountId: "a" })
    )

    const result = await resolveEsignProvider("org1", "docusign")
    expect(result.provider).toBeInstanceOf(DocuSignProvider)
    expect(result.config).not.toBeNull()
    expect(result.config?.rawCreds).toEqual({ clientId: "id", clientSecret: "s", accountId: "a" })
    expect(result.config?.id).toBe("cfg1")
  })

  it("returns null provider when no active config exists for docusign", async () => {
    vi.mocked(prisma.esignProviderConfig.findFirst).mockResolvedValue(null)

    const result = await resolveEsignProvider("org1", "docusign")
    expect(result.provider).toBeNull()
    expect(result.config).toBeNull()
  })

  it("throws when config ciphertext is corrupt / can't be decrypted", async () => {
    vi.mocked(prisma.esignProviderConfig.findFirst).mockResolvedValue({
      id: "cfg1",
      provider: "docusign",
      config: "CORRUPT_BLOB",
    } as never)
    vi.mocked(decryptForTenant).mockImplementation(() => {
      throw new Error("GCM tag mismatch")
    })

    await expect(resolveEsignProvider("org1", "docusign")).rejects.toThrow(
      "Failed to decrypt EsignProviderConfig"
    )
  })

  // ── Native send path unaffected ──────────────────────────────────────────
  // This test documents the invariant: resolveEsignProvider("native") → null
  // means the send route's if (requestedProvider !== "native") block is skipped,
  // and the HARDENED native flow executes byte-for-byte unchanged.
  it("INVARIANT: resolveEsignProvider('native') → null → native send path runs unchanged", async () => {
    const result = await resolveEsignProvider("org1", "native")
    // provider===null is the contract: send route checks !== "native" before calling resolver
    expect(result.provider).toBeNull()
    // DB not touched
    expect(prisma.esignProviderConfig.findFirst).not.toHaveBeenCalled()
  })
})
