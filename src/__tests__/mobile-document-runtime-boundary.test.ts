import { afterEach, describe, expect, it, vi } from "vitest"
import { mobileDocumentStorageRoot } from "@/lib/mtm/mobile-document"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("mobile document runtime storage boundary", () => {
  it("rejects a production document root outside the canonical upload root", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("APP_DIR", "/opt/leaddrive-v2")
    vi.stubEnv("MTM_DOCUMENT_STORAGE_DIR", "/opt/leaddrive-v2/uploads/mtm-documents")

    expect(() => mobileDocumentStorageRoot()).toThrow(
      "MTM_DOCUMENT_STORAGE_DIR must stay inside the canonical production upload root",
    )
  })

  it("rejects a transient production document root", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("APP_DIR", "/opt/leaddrive-v2")
    vi.stubEnv("MTM_DOCUMENT_STORAGE_DIR", "/tmp/mtm-documents")

    expect(() => mobileDocumentStorageRoot()).toThrow(
      "MTM_DOCUMENT_STORAGE_DIR must stay inside the canonical production upload root",
    )
  })

  it("accepts a dedicated external production document root", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("APP_DIR", "/opt/leaddrive-v2")
    vi.stubEnv("MTM_DOCUMENT_STORAGE_DIR", "/var/lib/leaddrive-v2/uploads/mtm-documents")

    expect(mobileDocumentStorageRoot()).toBe("/var/lib/leaddrive-v2/uploads/mtm-documents")
  })
})
