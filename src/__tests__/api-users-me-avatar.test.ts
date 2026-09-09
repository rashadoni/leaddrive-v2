import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

/**
 * POST /api/v1/users/me/avatar — self-service avatar upload.
 * Mirrors api-inbox-upload.test: mock fs/promises + rate-limit, build a File
 * via new File([Uint8Array], name, { type }), pass req as { formData }.
 * Covers the type/size/extension guards (the real risk) + the happy path that
 * sets User.avatar to an org-scoped /uploads URL.
 */
vi.mock("fs/promises", () => ({
  writeFile: vi.fn(async () => {}),
  mkdir: vi.fn(async () => {}),
  unlink: vi.fn(async () => {}),
}))

const rateState = vi.hoisted(() => ({
  decision: { allowed: true, retryAfterSeconds: 0, unavailable: false },
}))
vi.mock("@/lib/public-abuse-guard", () => ({
  consumePublicRateLimit: vi.fn(async () => rateState.decision),
}))

const state = {
  authOk: true,
  currentAvatar: null as string | null,
  lastUpdate: null as any,
  updateCount: 1,
}
const sharpState = vi.hoisted(() => ({
  metadata: { format: "png", width: 256, height: 256, pages: 1 } as {
    format?: string
    width?: number
    height?: number
    pages?: number
  },
  metadataError: false,
  output: Buffer.from("sanitized-webp"),
}))

vi.mock("sharp", () => ({
  default: vi.fn(() => {
    const pipeline: Record<string, any> = {}
    pipeline.metadata = vi.fn(async () => {
      if (sharpState.metadataError) throw new Error("decode failed")
      return sharpState.metadata
    })
    pipeline.rotate = vi.fn(() => pipeline)
    pipeline.resize = vi.fn(() => pipeline)
    pipeline.webp = vi.fn(() => pipeline)
    pipeline.toBuffer = vi.fn(async () => sharpState.output)
    return pipeline
  }),
}))

vi.mock("@/lib/api-auth", () => ({
  requireSessionAuth: vi.fn(async () => {
    if (!state.authOk) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    return { userId: "u1", orgId: "org-1", role: "sales", email: "me@b.com", name: "Me" }
  }),
  isAuthError: vi.fn((x: any) => x instanceof NextResponse),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findFirst: vi.fn(async () => ({ avatar: state.currentAvatar })),
      updateMany: vi.fn(async ({ where, data }: any) => {
        state.lastUpdate = { where, data }
        return { count: state.updateCount }
      }),
    },
  },
}))

import { POST } from "@/app/api/v1/users/me/avatar/route"
import { unlink, writeFile } from "fs/promises"
import { prisma } from "@/lib/prisma"
import sharp from "sharp"

function reqWith(file: File | null, headers?: Record<string, string>): NextRequest {
  const fd = new FormData()
  if (file) fd.set("file", file)
  return new NextRequest("http://localhost/api/v1/users/me/avatar", {
    method: "POST",
    headers,
    body: fd,
  })
}
const SIGNATURES: Record<string, number[]> = {
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/gif": [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
  "image/webp": [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
}

function fileOf(name: string, type: string, size = 100): File {
  const bytes = new Uint8Array(size)
  bytes.set((SIGNATURES[type] ?? []).slice(0, size))
  return new File([bytes], name, { type })
}

function fileWithBytes(name: string, type: string, bytes: Uint8Array): File {
  return new File([bytes], name, { type })
}

beforeEach(() => {
  state.authOk = true
  state.currentAvatar = null
  state.lastUpdate = null
  state.updateCount = 1
  rateState.decision = { allowed: true, retryAfterSeconds: 0, unavailable: false }
  sharpState.metadata = { format: "png", width: 256, height: 256, pages: 1 }
  sharpState.metadataError = false
  sharpState.output = Buffer.from("sanitized-webp")
  vi.clearAllMocks()
  // clearAllMocks() only clears call history. Restore implementations changed
  // by the disk-failure scenario so it cannot poison the following tests.
  vi.mocked(writeFile).mockResolvedValue(undefined)
  vi.mocked(unlink).mockResolvedValue(undefined)
})

describe("POST /api/v1/users/me/avatar", () => {
  it("401 when unauthenticated — no write", async () => {
    state.authOk = false
    const res = await POST(reqWith(fileOf("a.png", "image/png")))
    expect(res.status).toBe(401)
    expect(writeFile).not.toHaveBeenCalled()
    expect((prisma as any).user.updateMany).not.toHaveBeenCalled()
  })

  it("stores an allowed PNG, sets User.avatar to the org-scoped URL", async () => {
    const res = await POST(reqWith(fileOf("face.png", "image/png", 500)))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.url).toMatch(/^\/uploads\/avatars\/org-1\/av-[0-9a-f]{32}\.webp$/)
    expect(writeFile).toHaveBeenCalled()
    for (const call of vi.mocked(writeFile).mock.calls) {
      expect(call[1]).toEqual(sharpState.output)
    }
    // persisted on the caller's own row only
    expect(state.lastUpdate.where).toEqual({
      id: "u1",
      organizationId: "org-1",
      avatar: null,
    })
    expect(state.lastUpdate.data.avatar).toBe(json.url)
  })

  it("400 when no file is provided", async () => {
    const res = await POST(reqWith(null))
    expect(res.status).toBe(400)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it("400 on a disallowed MIME (SVG — XSS) — no write", async () => {
    const res = await POST(reqWith(fileOf("evil.svg", "image/svg+xml", 10)))
    expect(res.status).toBe(400)
    expect(writeFile).not.toHaveBeenCalled()
    expect((prisma as any).user.updateMany).not.toHaveBeenCalled()
  })

  it("400 on a blocked extension even with a benign MIME", async () => {
    const res = await POST(reqWith(fileOf("evil.svg", "image/png", 10)))
    expect(res.status).toBe(400)
  })

  it("400 on a double-extension filename even with an allowed final extension", async () => {
    const res = await POST(reqWith(fileOf("test.php.jpg", "image/jpeg", 100)))
    expect(res.status).toBe(400)
    expect(sharp).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it("400 when declared MIME does not match the magic bytes", async () => {
    const png = fileOf("face.png", "image/png", 100)
    const res = await POST(reqWith(fileWithBytes(
      "face.jpg",
      "image/jpeg",
      new Uint8Array(await png.arrayBuffer()),
    )))
    expect(res.status).toBe(400)
    expect(sharp).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it("400 on an image/script polyglot", async () => {
    const marker = new TextEncoder().encode("<script>alert(1)</script>")
    const bytes = new Uint8Array(SIGNATURES["image/png"].length + marker.length)
    bytes.set(SIGNATURES["image/png"])
    bytes.set(marker, SIGNATURES["image/png"].length)
    const res = await POST(reqWith(fileWithBytes("face.png", "image/png", bytes)))
    expect(res.status).toBe(400)
    expect(sharp).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it("400 when a signature-valid image cannot be decoded", async () => {
    sharpState.metadataError = true
    const res = await POST(reqWith(fileOf("corrupt.png", "image/png", 100)))
    expect(res.status).toBe(400)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it("400 when decoded dimensions exceed the avatar limit", async () => {
    sharpState.metadata = { format: "png", width: 5000, height: 100, pages: 1 }
    const res = await POST(reqWith(fileOf("huge.png", "image/png", 100)))
    expect(res.status).toBe(400)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it("does not persist a broken avatar URL when every disk write fails", async () => {
    vi.mocked(writeFile).mockRejectedValue(new Error("read-only filesystem"))

    const res = await POST(reqWith(fileOf("face.png", "image/png", 500)))

    expect(res.status).toBe(500)
    expect(state.lastUpdate).toBeNull()
  })

  it("rejects an oversized multipart request before parsing its File", async () => {
    const res = await POST(reqWith(
      fileOf("face.png", "image/png", 100),
      { "content-length": String(3 * 1024 * 1024) },
    ))
    expect(res.status).toBe(413)
    expect(sharp).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it("fails closed when the distributed limiter is unavailable", async () => {
    rateState.decision = { allowed: false, retryAfterSeconds: 1, unavailable: true }
    const res = await POST(reqWith(fileOf("face.png", "image/png", 100)))
    expect(res.status).toBe(503)
    expect(res.headers.get("retry-after")).toBe("1")
    expect(writeFile).not.toHaveBeenCalled()
  })

  it("removes the new file when an optimistic concurrent update loses", async () => {
    state.updateCount = 0
    const res = await POST(reqWith(fileOf("face.png", "image/png", 100)))
    expect(res.status).toBe(409)
    expect(unlink).toHaveBeenCalledOnce()
  })

  it("removes the previous hardened avatar after a successful replacement", async () => {
    state.currentAvatar = `/uploads/avatars/org-1/av-${"a".repeat(32)}.webp`
    const res = await POST(reqWith(fileOf("face.png", "image/png", 100)))
    expect(res.status).toBe(200)
    expect(unlink).toHaveBeenCalledWith(expect.stringMatching(
      new RegExp(`/uploads/avatars/org-1/av-${"a".repeat(32)}\\.webp$`),
    ))
  })

  it("400 when the file exceeds 2MB but the multipart envelope remains within its cap", async () => {
    // MAX_REQUEST_BODY_SIZE deliberately has 64KB of multipart overhead. Keep
    // this body inside that outer cap so this exercises the File-size guard;
    // the separate declared-length test above covers the outer 413 response.
    const res = await POST(reqWith(fileOf("big.jpg", "image/jpeg", 2 * 1024 * 1024 + 1)))
    expect(res.status).toBe(400)
    expect(writeFile).not.toHaveBeenCalled()
  })
})
