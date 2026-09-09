import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Secure inbox-attachment read (media SEND, Slice 3b). The attachmentUrl is client-supplied —
 * these tests pin the org-injection + path-traversal guards.
 */
vi.mock("fs/promises", () => ({ readFile: vi.fn() }))

import { readInboxAttachment, isImageMime } from "@/lib/inbox-attachment"
import { readFile } from "fs/promises"

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(readFile).mockResolvedValue(Buffer.from([1, 2, 3, 4]))
})

describe("readInboxAttachment", () => {
  it("reads a valid own-org attachment → buffer + mime from ext", async () => {
    const res = await readInboxAttachment("/uploads/inbox/org-1/abcdef0123456789.jpg", "org-1")
    expect(res).not.toBeNull()
    expect(res!.mime).toBe("image/jpeg")
    expect(res!.filename).toBe("abcdef0123456789.jpg")
    expect(readFile).toHaveBeenCalled()
  })

  it("CROSS-TENANT: rejects a URL whose org segment ≠ the session org — no read", async () => {
    const res = await readInboxAttachment("/uploads/inbox/OTHER-ORG/abcdef0123456789.jpg", "org-1")
    expect(res).toBeNull()
    expect(readFile).not.toHaveBeenCalled()
  })

  it("rejects path traversal in the URL (regex never matches a multi-segment path)", async () => {
    const res = await readInboxAttachment("/uploads/inbox/org-1/../../../etc/passwd", "org-1")
    expect(res).toBeNull()
    expect(readFile).not.toHaveBeenCalled()
  })

  it("rejects a non-inbox subdir (e.g. /uploads/whatsapp/...) — only /uploads/inbox/<org>/ is readable", async () => {
    const res = await readInboxAttachment("/uploads/whatsapp/org-1/abcdef0123456789.jpg", "org-1")
    expect(res).toBeNull()
    expect(readFile).not.toHaveBeenCalled()
  })

  it("rejects a non-hex / script filename", async () => {
    expect(await readInboxAttachment("/uploads/inbox/org-1/evil.php", "org-1")).toBeNull()
    expect(readFile).not.toHaveBeenCalled()
  })

  it("rejects empty inputs", async () => {
    expect(await readInboxAttachment("", "org-1")).toBeNull()
    expect(await readInboxAttachment("/uploads/inbox/org-1/abcdef0123456789.jpg", "")).toBeNull()
  })

  it("returns null when the file is missing (readFile throws)", async () => {
    vi.mocked(readFile).mockRejectedValueOnce(new Error("ENOENT"))
    const res = await readInboxAttachment("/uploads/inbox/org-1/abcdef0123456789.jpg", "org-1")
    expect(res).toBeNull()
  })

  it("isImageMime distinguishes images from documents", () => {
    expect(isImageMime("image/png")).toBe(true)
    expect(isImageMime("application/pdf")).toBe(false)
  })
})
