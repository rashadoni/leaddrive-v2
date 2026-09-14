import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  mtmPhotoThumbnailUrl,
  parseMtmPhotoThumbnailWidth,
} from "@/lib/mtm/photo-thumbnail-url"
import {
  diskMtmPhotoThumbnailEtag,
  etagMatches,
  mtmPhotoThumbnailCachePath,
  mtmPhotoThumbnailRenderStateForTests,
  renderMtmPhotoThumbnail,
  resolveDiskMtmPhotoThumbnail,
} from "@/lib/mtm/photo-thumbnail-server"

describe("mtmPhotoThumbnailUrl", () => {
  it("adds an allowlisted width to a stored field photo URL", () => {
    expect(mtmPhotoThumbnailUrl("/uploads/mtm-photos/a-1.jpg")).toBe("/uploads/mtm-photos/a-1.jpg?w=480")
    expect(mtmPhotoThumbnailUrl("/uploads/mtm-photos/a-1.jpg", 960)).toBe("/uploads/mtm-photos/a-1.jpg?w=960")
  })

  it("leaves anything else untouched so it is always a usable image source", () => {
    for (const url of [
      "",
      "https://cdn.example.com/x.jpg",
      "/uploads/contracts/x.jpg",
      "/uploads/mtm-photos/x.jpg?w=240",
      "/uploads/mtm-photos/.thumbs/x.jpg",
      "/uploads/mtm-photos/",
    ]) {
      expect(mtmPhotoThumbnailUrl(url)).toBe(url)
    }
  })
})

describe("parseMtmPhotoThumbnailWidth", () => {
  const parse = (query: string) => parseMtmPhotoThumbnailWidth(new URLSearchParams(query))

  it("returns null without w and the width for allowlisted values", () => {
    expect(parse("")).toBeNull()
    expect(parse("w=240")).toBe(240)
    expect(parse("w=480")).toBe(480)
    expect(parse("w=960")).toBe(960)
  })

  it("rejects widths outside the allowlist, garbage and repeats", () => {
    for (const query of ["w=481", "w=0", "w=4080", "w=", "w=480px", "w=-480", "w=480&w=240", "w=1e3"]) {
      expect(parse(query)).toBe("invalid")
    }
  })
})

describe("etagMatches", () => {
  it("matches exact, weak and wildcard If-None-Match values only", () => {
    expect(etagMatches('"a"', '"a"')).toBe(true)
    expect(etagMatches('W/"a", "b"', '"a"')).toBe(true)
    expect(etagMatches("*", '"a"')).toBe(true)
    expect(etagMatches('"b"', '"a"')).toBe(false)
    expect(etagMatches(null, '"a"')).toBe(false)
  })
})

async function jpeg(width: number, height: number, orientation?: number): Promise<Buffer> {
  const image = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } }).jpeg()
  return orientation ? image.withMetadata({ orientation }).toBuffer() : image.toBuffer()
}

describe("renderMtmPhotoThumbnail", () => {
  it("shrinks to the requested width as WebP and never enlarges", async () => {
    const big = await sharp(await renderMtmPhotoThumbnail(await jpeg(2000, 1500), 480) as Buffer).metadata()
    expect(big).toMatchObject({ format: "webp", width: 480, height: 360 })

    const small = await sharp(await renderMtmPhotoThumbnail(await jpeg(100, 50), 480) as Buffer).metadata()
    expect(small).toMatchObject({ width: 100, height: 50 })
  })

  it("applies EXIF orientation before resizing so portrait shots stay upright", async () => {
    // Stored landscape 800×400 with orientation 6 (rotate 90°) is a portrait photo.
    const out = await sharp(await renderMtmPhotoThumbnail(await jpeg(800, 400, 6), 240) as Buffer).metadata()
    expect(out.width).toBe(240)
    expect(out.height).toBe(480)
    expect(out.orientation ?? 1).toBe(1)
  })

  it("returns null for bytes that are not a decodable raster", async () => {
    expect(await renderMtmPhotoThumbnail(Buffer.from("not an image"), 480)).toBeNull()
    expect(await renderMtmPhotoThumbnail(Buffer.alloc(0), 480)).toBeNull()
    expect(mtmPhotoThumbnailRenderStateForTests()).toMatchObject({ activeRenders: 0, queued: 0 })
  })
})

describe("resolveDiskMtmPhotoThumbnail", () => {
  let root: string
  let originalPath: string
  const fileName = "1789390010977-vrbaf0-328bqxw0.jpg"

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "mtm-thumb-"))
    await mkdir(path.join(root, "mtm-photos"))
    originalPath = path.join(root, "mtm-photos", fileName)
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it("keeps the cache next to the original, under .thumbs", () => {
    expect(mtmPhotoThumbnailCachePath("/data/uploads", fileName, 480))
      .toBe(`/data/uploads/mtm-photos/.thumbs/${fileName}.w480.webp`)
  })

  it("generates on the first request, caches, and serves the cache afterwards without touching the original", async () => {
    const original = await jpeg(1600, 1200)
    await writeFile(originalPath, original)
    const request = { uploadsRoot: root, originalPath, fileName, width: 480 as const, ifNoneMatch: null }

    const first = await resolveDiskMtmPhotoThumbnail(request)
    expect(first.kind).toBe("ok")
    const cachePath = mtmPhotoThumbnailCachePath(root, fileName, 480)
    const cached = await readFile(cachePath)
    expect(first.kind === "ok" && first.bytes.equals(cached)).toBe(true)
    expect((await sharp(cached).metadata()).width).toBe(480)

    // Poison the cache: a second request must return the cached bytes, which
    // proves no regeneration happened.
    await writeFile(cachePath, Buffer.from("cached-marker"))
    const second = await resolveDiskMtmPhotoThumbnail(request)
    expect(second.kind === "ok" && second.bytes.toString()).toBe("cached-marker")
    expect(second.kind === "ok" && first.kind === "ok" && second.etag).toBe(first.kind === "ok" ? first.etag : "")

    expect((await readFile(originalPath)).equals(original)).toBe(true)
  })

  it("answers If-None-Match with not-modified before reading any bytes", async () => {
    await writeFile(originalPath, await jpeg(600, 400))
    const etag = diskMtmPhotoThumbnailEtag(await stat(originalPath), 240)
    const result = await resolveDiskMtmPhotoThumbnail({ uploadsRoot: root, originalPath, fileName, width: 240, ifNoneMatch: etag })
    expect(result).toEqual({ kind: "not-modified", etag })
    await expect(stat(mtmPhotoThumbnailCachePath(root, fileName, 240))).rejects.toThrow()
  })

  it("regenerates a cache entry older than its original", async () => {
    await writeFile(originalPath, await jpeg(1200, 900))
    const cachePath = mtmPhotoThumbnailCachePath(root, fileName, 480)
    await mkdir(path.dirname(cachePath), { recursive: true })
    await writeFile(cachePath, Buffer.from("stale"))
    const old = new Date(Date.now() - 60_000)
    await utimes(cachePath, old, old)

    const result = await resolveDiskMtmPhotoThumbnail({ uploadsRoot: root, originalPath, fileName, width: 480, ifNoneMatch: null })
    expect(result.kind).toBe("ok")
    expect(result.kind === "ok" && result.bytes.toString()).not.toBe("stale")
  })

  it("reports a missing original and an undecodable one distinctly, writing no cache", async () => {
    expect(await resolveDiskMtmPhotoThumbnail({ uploadsRoot: root, originalPath, fileName, width: 480, ifNoneMatch: null }))
      .toEqual({ kind: "missing" })

    await writeFile(originalPath, Buffer.from("legacy heic bytes"))
    expect(await resolveDiskMtmPhotoThumbnail({ uploadsRoot: root, originalPath, fileName, width: 480, ifNoneMatch: null }))
      .toEqual({ kind: "undecodable" })
    await expect(stat(mtmPhotoThumbnailCachePath(root, fileName, 480))).rejects.toThrow()
  })
})
