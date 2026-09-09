import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  createMobileDocumentStorageKey,
  mobileDocumentSha256,
  normalizeMobileDocumentName,
  parseMobileDocumentState,
  resolveMobileDocumentStoragePath,
  validateMobileDocument,
  validateMobileDocumentBytes,
} from "@/lib/mtm/mobile-document"

describe("mobile private document contract", () => {
  it("accepts a safe MIME/extension pair and rejects spoofed executables", () => {
    expect(validateMobileDocument({ name: "plan.pdf", type: "application/pdf", size: 512 }).error).toBeNull()
    expect(validateMobileDocument({ name: "plan.exe", type: "application/pdf", size: 512 }).error).toMatch(/extension/)
    expect(validateMobileDocument({ name: "plan.pdf", type: "application/x-msdownload", size: 512 }).error).toMatch(/type/)
    expect(validateMobileDocumentBytes("application/pdf", Buffer.from("MZ executable"))).toMatch(/valid PDF/)
    expect(validateMobileDocumentBytes("application/pdf", Buffer.from("%PDF-1.7"))).toBeNull()
    expect(validateMobileDocumentBytes("application/vnd.openxmlformats-officedocument.wordprocessingml.document", Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBeNull()
  })

  it("normalizes display names and keeps storage keys opaque", () => {
    expect(normalizeMobileDocumentName("../../report\u0000.pdf")).toBe("report.pdf")
    const storageKey = createMobileDocumentStorageKey()
    expect(storageKey).toMatch(/^[a-f0-9]{48}$/)
    expect(path.basename(resolveMobileDocumentStoragePath(storageKey))).toBe(storageKey)
    expect(() => resolveMobileDocumentStoragePath("../../etc/passwd")).toThrow(/storage key/)
  })

  it("hashes immutable bytes and parses offline state receipts", () => {
    expect(mobileDocumentSha256(Buffer.from("hello"))).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824")
    const now = new Date("2026-07-16T10:00:00.000Z")
    expect(parseMobileDocumentState({
      documentId: "document-1",
      state: "DOWNLOADED",
      occurredAt: now.toISOString(),
    }, now).input).toMatchObject({ state: "DOWNLOADED" })
  })
})
