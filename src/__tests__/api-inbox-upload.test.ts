import { describe, it, expect, vi, beforeEach } from "vitest"
import type { NextRequest } from "next/server"

/**
 * Inbox attachment upload (media SEND, Slice 3) — POST /api/v1/inbox/upload.
 * Authed; validates size + mime + blocked extensions; stores org-scoped; returns the /uploads URL.
 */
vi.mock("fs/promises", () => ({ writeFile: vi.fn(async () => {}), mkdir: vi.fn(async () => {}) }))
vi.mock("@/lib/api-auth", () => {
  const getSession = vi.fn()
  return {
    getSession,
    requireSessionAuth: vi.fn(async (req: NextRequest) => {
      const session = await getSession(req)
      return session ?? new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
    }),
    isAuthError: (value: unknown) => value instanceof Response,
  }
})
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => true }))

import { POST } from "@/app/api/v1/inbox/upload/route"
import { getSession } from "@/lib/api-auth"
import { writeFile } from "fs/promises"

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSession).mockResolvedValue({
    orgId: "org-1", userId: "support-1", role: "support", email: "", name: "",
  } as never)
})

function reqWith(file: File | null): NextRequest {
  const fd = new FormData()
  if (file) fd.set("file", file)
  return { formData: async () => fd } as unknown as NextRequest
}
const fileOf = (name: string, type: string, size = 100) =>
  new File([new Uint8Array(size)], name, { type })

describe("POST /api/v1/inbox/upload", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    const res = await POST(reqWith(fileOf("photo.jpg", "image/jpeg")))
    expect(res.status).toBe(401)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it("stores an allowed image + returns the org-scoped /uploads URL", async () => {
    const res = await POST(reqWith(fileOf("photo.jpg", "image/jpeg", 500)))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.data.url).toMatch(/^\/uploads\/inbox\/org-1\/[0-9a-f]+\.jpg$/)
    expect(json.data.type).toBe("image/jpeg")
    expect(json.data.name).toBe("photo.jpg")
    expect(writeFile).toHaveBeenCalled()
  })

  it("allows a PDF document", async () => {
    const res = await POST(reqWith(fileOf("contract.pdf", "application/pdf", 1000)))
    expect(res.status).toBe(201)
    expect((await res.json()).data.url).toMatch(/\.pdf$/)
  })

  it("400 when no file", async () => {
    const res = await POST(reqWith(null))
    expect(res.status).toBe(400)
  })

  it("400 on disallowed MIME (executable) — no write", async () => {
    const res = await POST(reqWith(fileOf("x.exe", "application/x-msdownload", 10)))
    expect(res.status).toBe(400)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it("400 on blocked extension even with a benign MIME", async () => {
    const res = await POST(reqWith(fileOf("evil.svg", "image/png", 10)))
    expect(res.status).toBe(400)
  })

  it("400 on oversize (> 16 MB)", async () => {
    const res = await POST(reqWith(fileOf("big.jpg", "image/jpeg", 17 * 1024 * 1024)))
    expect(res.status).toBe(400)
    expect(writeFile).not.toHaveBeenCalled()
  })
})
