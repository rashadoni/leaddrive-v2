/**
 * Field photo thumbnails through the scoped upload proxy:
 *   /uploads/mtm-photos/<file>?w=480
 * Prod 2026-09-14: grids downloaded 2–4 MB camera originals per tile.
 * The contract here is that a thumbnail is authorized exactly like its
 * original — before any byte is read or resized — and that widths are an
 * allowlist.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

vi.mock("fs/promises", () => ({ stat: vi.fn(), readFile: vi.fn() }))
vi.mock("fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("fs")>()),
  createReadStream: vi.fn(),
}))
vi.mock("@/lib/public-abuse-guard", () => ({
  consumePublicRateLimit: vi.fn(),
  acquirePublicConcurrencySlot: vi.fn(),
  releasePublicConcurrencySlot: vi.fn(),
}))
vi.mock("@/lib/api-auth", () => ({
  requireSessionAuth: vi.fn(),
  isAuthError: (v: any) => v instanceof NextResponse,
  orgHasModule: vi.fn(async () => true),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    mtmPhoto: { findFirst: vi.fn() },
    contractFile: { findFirst: vi.fn() },
    mtmAgent: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    mtmTeam: { findFirst: vi.fn(), findMany: vi.fn() },
  },
}))
vi.mock("@/lib/mtm/photo-thumbnail-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mtm/photo-thumbnail-server")>()),
  resolveDiskMtmPhotoThumbnail: vi.fn(),
  renderMtmPhotoThumbnail: vi.fn(),
}))
vi.mock("@/lib/mtm/media-object-lifecycle", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mtm/media-object-lifecycle")>()),
  readCommittedMtmMediaObject: vi.fn(),
}))

import { GET } from "@/app/api/v1/uploads/[...path]/route"
import { stat } from "fs/promises"
import { createReadStream } from "fs"
import { Readable } from "stream"
import { requireSessionAuth } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { resetMtmFieldScopeMemo } from "@/lib/mtm/field-access"
import {
  acquirePublicConcurrencySlot,
  consumePublicRateLimit,
  releasePublicConcurrencySlot,
} from "@/lib/public-abuse-guard"
import {
  objectMtmPhotoThumbnailEtag,
  renderMtmPhotoThumbnail,
  resolveDiskMtmPhotoThumbnail,
} from "@/lib/mtm/photo-thumbnail-server"
import { readCommittedMtmMediaObject } from "@/lib/mtm/media-object-lifecycle"

const AUTH_OK = { orgId: "org-1", userId: "u1", role: "admin" } as any

function pp(parts: string[]) {
  return { params: Promise.resolve({ path: parts }) }
}
function req(query = "", headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new URL(`http://localhost:3000/api/v1/uploads/x${query}`), { headers })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetMtmFieldScopeMemo()
  vi.mocked(requireSessionAuth).mockReset()
  vi.mocked(requireSessionAuth).mockResolvedValue(AUTH_OK)
  vi.mocked(stat).mockReset()
  vi.mocked(stat).mockRejectedValue(new Error("ENOENT"))
  vi.mocked(consumePublicRateLimit).mockResolvedValue({ allowed: true, retryAfterSeconds: 0, unavailable: false })
  vi.mocked(acquirePublicConcurrencySlot).mockResolvedValue({
    allowed: true, retryAfterSeconds: 0, unavailable: false, backend: "memory", key: "k", token: "t",
  })
  vi.mocked(releasePublicConcurrencySlot).mockResolvedValue(undefined)
  vi.mocked(createReadStream).mockReturnValue(Readable.from([Buffer.from([0])]) as any)
  vi.mocked(prisma.mtmPhoto.findFirst).mockResolvedValue({ id: "p1", mediaObject: null } as any)
  vi.mocked(resolveDiskMtmPhotoThumbnail).mockResolvedValue({ kind: "ok", etag: '"e1"', bytes: Buffer.from("webp") })
})

describe("GET /uploads/mtm-photos/<file>?w=", () => {
  it.each(["?w=481", "?w=4080", "?w=", "?w=480&w=240", "?w=abc"])("rejects width %s before any lookup", async (query) => {
    const res = await GET(req(query), pp(["mtm-photos", "a.jpg"]))
    expect(res.status).toBe(404)
    expect(prisma.mtmPhoto.findFirst).not.toHaveBeenCalled()
    expect(resolveDiskMtmPhotoThumbnail).not.toHaveBeenCalled()
  })

  it("never resizes a photo the caller is not scoped to", async () => {
    vi.mocked(prisma.mtmPhoto.findFirst).mockResolvedValueOnce(null)
    const res = await GET(req("?w=480"), pp(["mtm-photos", "other-tenant.jpg"]))
    expect(res.status).toBe(404)
    expect(resolveDiskMtmPhotoThumbnail).not.toHaveBeenCalled()
    expect(renderMtmPhotoThumbnail).not.toHaveBeenCalled()
  })

  it("keeps anonymous thumbnail reads private", async () => {
    vi.mocked(requireSessionAuth).mockResolvedValueOnce(NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as any)
    const res = await GET(req("?w=480"), pp(["mtm-photos", "a.jpg"]))
    expect(res.status).toBe(401)
    expect(resolveDiskMtmPhotoThumbnail).not.toHaveBeenCalled()
  })

  it("runs the same scoped row lookup as the original, then serves a WebP thumbnail", async () => {
    const res = await GET(req("?w=480"), pp(["mtm-photos", "owned.jpg"]))

    expect(res.status).toBe(200)
    const lookup = vi.mocked(prisma.mtmPhoto.findFirst).mock.calls[0]?.[0] as any
    expect(lookup.where).toMatchObject({ url: "/uploads/mtm-photos/owned.jpg", organizationId: "org-1" })
    expect(vi.mocked(prisma.mtmPhoto.findFirst).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(resolveDiskMtmPhotoThumbnail).mock.invocationCallOrder[0])
    expect(resolveDiskMtmPhotoThumbnail).toHaveBeenCalledWith(expect.objectContaining({
      fileName: "owned.jpg",
      width: 480,
      originalPath: expect.stringMatching(/[/\\]mtm-photos[/\\]owned\.jpg$/),
    }))
    expect(res.headers.get("content-type")).toBe("image/webp")
    expect(res.headers.get("etag")).toBe('"e1"')
    expect(res.headers.get("cache-control")).toBe("private, no-cache")
    expect(res.headers.get("vary")).toBe("Cookie, Authorization")
    expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin")
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("webp")
    expect(releasePublicConcurrencySlot).toHaveBeenCalledOnce()
  })

  it("answers a matching If-None-Match with 304 and passes it to the cache", async () => {
    vi.mocked(resolveDiskMtmPhotoThumbnail).mockResolvedValueOnce({ kind: "not-modified", etag: '"e1"' })
    const res = await GET(req("?w=240", { "if-none-match": '"e1"' }), pp(["mtm-photos", "owned.jpg"]))
    expect(res.status).toBe(304)
    expect(res.headers.get("etag")).toBe('"e1"')
    expect(resolveDiskMtmPhotoThumbnail).toHaveBeenCalledWith(expect.objectContaining({ ifNoneMatch: '"e1"', width: 240 }))
  })

  it("returns 404 when the original file is gone, so the tile shows its missing-file placeholder", async () => {
    vi.mocked(resolveDiskMtmPhotoThumbnail).mockResolvedValueOnce({ kind: "missing" })
    const res = await GET(req("?w=480"), pp(["mtm-photos", "seeded.jpg"]))
    expect(res.status).toBe(404)
  })

  it("falls back to the original when the file cannot be decoded", async () => {
    vi.mocked(resolveDiskMtmPhotoThumbnail).mockResolvedValueOnce({ kind: "undecodable" })
    vi.mocked(stat).mockResolvedValue({ isFile: () => true, size: 4 } as any)
    const res = await GET(req("?w=480"), pp(["mtm-photos", "legacy.heic"]))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("image/heic")
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    await res.arrayBuffer()
  })

  it("serves the original unchanged without w", async () => {
    vi.mocked(stat).mockResolvedValue({ isFile: () => true, size: 4 } as any)
    const res = await GET(req(), pp(["mtm-photos", "owned.jpg"]))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("image/jpeg")
    expect(resolveDiskMtmPhotoThumbnail).not.toHaveBeenCalled()
    await res.arrayBuffer()
  })

  describe("object-backed photos", () => {
    const mediaObject = {
      id: "mo1", organizationId: "org-1", kind: "PHOTO", state: "COMMITTED", provider: "S3_COMPATIBLE",
      bucketName: "b", objectKey: "k", checksumSha256: "c".repeat(64), sizeBytes: 10, mimeType: "image/jpeg",
      encryptionKeyId: "key1", retentionUntil: new Date(), legalHold: false, photoId: "p1", documentId: null,
    }

    it("renders in memory, never through the disk cache", async () => {
      vi.mocked(prisma.mtmPhoto.findFirst).mockResolvedValueOnce({ id: "p1", mediaObject } as any)
      vi.mocked(readCommittedMtmMediaObject).mockResolvedValueOnce(Buffer.from("jpeg-bytes"))
      vi.mocked(renderMtmPhotoThumbnail).mockResolvedValueOnce(Buffer.from("thumb"))

      const res = await GET(req("?w=480"), pp(["mtm-photos", "media-abc.jpg"]))

      expect(res.status).toBe(200)
      expect(res.headers.get("content-type")).toBe("image/webp")
      expect(res.headers.get("etag")).toBe(objectMtmPhotoThumbnailEtag(mediaObject.checksumSha256, 480))
      expect(renderMtmPhotoThumbnail).toHaveBeenCalledWith(Buffer.from("jpeg-bytes"), 480)
      expect(resolveDiskMtmPhotoThumbnail).not.toHaveBeenCalled()
    })

    it("answers 304 without reading the object", async () => {
      vi.mocked(prisma.mtmPhoto.findFirst).mockResolvedValueOnce({ id: "p1", mediaObject } as any)
      const etag = objectMtmPhotoThumbnailEtag(mediaObject.checksumSha256, 480)
      const res = await GET(req("?w=480", { "if-none-match": etag }), pp(["mtm-photos", "media-abc.jpg"]))
      expect(res.status).toBe(304)
      expect(readCommittedMtmMediaObject).not.toHaveBeenCalled()
    })
  })
})
