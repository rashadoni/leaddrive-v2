import path from "node:path"
import { randomBytes } from "node:crypto"
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises"
import sharp from "sharp"
import type { MtmPhotoThumbnailWidth } from "@/lib/mtm/photo-thumbnail-url"

/**
 * Field photo thumbnails — the server half. Callers MUST have completed the
 * full authorization for the original photo before calling anything here:
 * these helpers read and resize bytes, they do not decide who may see them.
 *
 * Disk-backed photos: the thumbnail is generated on first request and cached
 * next to the original as `mtm-photos/.thumbs/<file>.w<width>.webp`. Originals
 * are never modified or removed. A cache entry older than its original is
 * regenerated. The `.thumbs` directory is not reachable through the proxy:
 * the proxy resolves `mtm-photos/<name>` against `MtmPhoto.url`, and no photo
 * row is named `.thumbs`.
 *
 * Object-backed photos are encrypted at rest in object storage; their
 * thumbnails are rendered in memory and never written to local disk.
 */

export const MTM_PHOTO_THUMBNAIL_DIR = ".thumbs"
const THUMBNAIL_FORMAT_VERSION = "v1"
const THUMBNAIL_QUALITY = 75
// A 4080×3060 phone photo is 12.5 MP; leave headroom for 50 MP sensors but
// refuse decompression bombs.
const MAX_INPUT_PIXELS = 64_000_000
const MAX_INPUT_BYTES = 50 * 1024 * 1024
// Resizing a camera original costs a few hundred ms of CPU. A gallery opening
// for the first time can ask for dozens; never let that starve the app.
const MAX_PARALLEL_RENDERS = 2
// Beyond this many waiters the request is refused (503 + Retry-After) rather
// than parked: every waiter also holds a download-concurrency slot.
const MAX_QUEUED_RENDERS = 16
export const MTM_PHOTO_THUMBNAIL_BUSY_RETRY_AFTER_SECONDS = 2
// Files that failed to decode (legacy HEIC, truncated uploads) are remembered
// by path + size + mtime, so later `?w=` requests fall back to the original
// without re-reading and re-decoding megabytes each time.
const MAX_UNDECODABLE_ENTRIES = 512

let activeRenders = 0
const renderQueue: Array<() => void> = []
const inflight = new Map<string, Promise<Buffer | null>>()
const undecodable = new Map<string, true>()

/** All render slots and the bounded wait queue are taken. */
export class MtmPhotoThumbnailBusyError extends Error {
  readonly retryAfterSeconds = MTM_PHOTO_THUMBNAIL_BUSY_RETRY_AFTER_SECONDS
  constructor() {
    super("MTM_PHOTO_THUMBNAIL_BUSY")
    this.name = "MtmPhotoThumbnailBusyError"
  }
}

async function withRenderSlot<T>(work: () => Promise<T>): Promise<T> {
  if (activeRenders >= MAX_PARALLEL_RENDERS) {
    if (renderQueue.length >= MAX_QUEUED_RENDERS) throw new MtmPhotoThumbnailBusyError()
    await new Promise<void>((resolve) => renderQueue.push(resolve))
  } else {
    activeRenders += 1
  }
  try {
    return await work()
  } finally {
    const next = renderQueue.shift()
    if (next) next()
    else activeRenders -= 1
  }
}

async function decodeThumbnail(input: Buffer, width: MtmPhotoThumbnailWidth): Promise<Buffer | null> {
  if (input.byteLength < 1 || input.byteLength > MAX_INPUT_BYTES) return null
  try {
    return await sharp(input, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS, animated: false })
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: THUMBNAIL_QUALITY })
      .toBuffer()
  } catch {
    return null
  }
}

function undecodableKey(originalPath: string, original: { size: number; mtimeMs: number }): string {
  return `${originalPath}\0${original.size}\0${Math.trunc(original.mtimeMs)}`
}

function rememberUndecodable(key: string): void {
  undecodable.delete(key)
  undecodable.set(key, true)
  while (undecodable.size > MAX_UNDECODABLE_ENTRIES) {
    const oldest = undecodable.keys().next().value
    if (oldest === undefined) break
    undecodable.delete(oldest)
  }
}

/**
 * Rotates by EXIF orientation first (so a portrait shot stays upright once
 * metadata is stripped), then shrinks to at most `width` wide. Never enlarges.
 * Returns null when the bytes are not a decodable raster (legacy HEIC, a
 * truncated upload) — the caller then serves the original as before.
 * Throws `MtmPhotoThumbnailBusyError` when the render queue is full.
 */
export async function renderMtmPhotoThumbnail(
  input: Buffer,
  width: MtmPhotoThumbnailWidth,
): Promise<Buffer | null> {
  if (input.byteLength < 1 || input.byteLength > MAX_INPUT_BYTES) return null
  return withRenderSlot(() => decodeThumbnail(input, width))
}

export function mtmPhotoThumbnailCachePath(
  uploadsRoot: string,
  fileName: string,
  width: MtmPhotoThumbnailWidth,
): string {
  return path.join(uploadsRoot, "mtm-photos", MTM_PHOTO_THUMBNAIL_DIR, `${fileName}.w${width}.webp`)
}

export function diskMtmPhotoThumbnailEtag(
  original: { size: number; mtimeMs: number },
  width: MtmPhotoThumbnailWidth,
): string {
  return `"mtmthumb-${THUMBNAIL_FORMAT_VERSION}-w${width}-${original.size}-${Math.trunc(original.mtimeMs)}"`
}

export function objectMtmPhotoThumbnailEtag(
  checksumSha256: string,
  width: MtmPhotoThumbnailWidth,
): string {
  return `"mtmthumb-${THUMBNAIL_FORMAT_VERSION}-w${width}-${checksumSha256.slice(0, 32)}"`
}

/** True when an `If-None-Match` header already names this ETag. */
export function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false
  const bare = etag.replace(/^W\//, "")
  return ifNoneMatch.split(",").some((candidate) => {
    const value = candidate.trim()
    return value === "*" || value.replace(/^W\//, "") === bare
  })
}

export type DiskThumbnailResult =
  | { kind: "missing" }
  | { kind: "not-modified"; etag: string }
  | { kind: "ok"; etag: string; bytes: Buffer }
  | { kind: "undecodable" }
  | { kind: "busy"; retryAfterSeconds: number }

/**
 * Serves `mtm-photos/<fileName>` at `width` from the disk cache, generating it
 * on a miss (lazy backfill for every existing photo). `originalPath` must be
 * the already-validated canonical path of the authorized original.
 */
export async function resolveDiskMtmPhotoThumbnail(input: {
  uploadsRoot: string
  originalPath: string
  fileName: string
  width: MtmPhotoThumbnailWidth
  ifNoneMatch: string | null
}): Promise<DiskThumbnailResult> {
  let original
  try {
    original = await stat(input.originalPath)
  } catch {
    return { kind: "missing" }
  }
  if (!original.isFile()) return { kind: "missing" }

  const etag = diskMtmPhotoThumbnailEtag(original, input.width)
  if (etagMatches(input.ifNoneMatch, etag)) return { kind: "not-modified", etag }

  const cachePath = mtmPhotoThumbnailCachePath(input.uploadsRoot, input.fileName, input.width)
  try {
    const cached = await stat(cachePath)
    if (cached.isFile() && cached.size > 0 && cached.mtimeMs >= original.mtimeMs) {
      return { kind: "ok", etag, bytes: await readFile(cachePath) }
    }
  } catch {
    // Cache miss — generate below.
  }

  if (original.size > MAX_INPUT_BYTES) return { kind: "undecodable" }
  const failureKey = undecodableKey(input.originalPath, original)
  if (undecodable.has(failureKey)) return { kind: "undecodable" }

  let pending = inflight.get(cachePath)
  if (!pending) {
    // The render slot is taken BEFORE the original is read: a queued request
    // must not hold megabytes of camera bytes while it waits.
    pending = withRenderSlot(async () => {
      const bytes = await decodeThumbnail(await readFile(input.originalPath), input.width)
      if (bytes) await writeCacheAtomically(cachePath, bytes)
      else rememberUndecodable(failureKey)
      return bytes
    }).finally(() => inflight.delete(cachePath))
    inflight.set(cachePath, pending)
  }

  let bytes: Buffer | null
  try {
    bytes = await pending
  } catch (error) {
    if (error instanceof MtmPhotoThumbnailBusyError) {
      return { kind: "busy", retryAfterSeconds: error.retryAfterSeconds }
    }
    return { kind: "missing" }
  }
  return bytes ? { kind: "ok", etag, bytes } : { kind: "undecodable" }
}

async function writeCacheAtomically(cachePath: string, bytes: Buffer): Promise<void> {
  // A failed cache write must not fail the response: the thumbnail is served
  // from memory and simply regenerated next time.
  const temp = `${cachePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`
  try {
    await mkdir(path.dirname(cachePath), { recursive: true })
    await writeFile(temp, bytes, { flag: "wx" })
    await rename(temp, cachePath)
  } catch {
    await unlink(temp).catch(() => {})
  }
}

/** Test hook: the render queue and negative cache are module state. */
export function mtmPhotoThumbnailRenderStateForTests() {
  return { activeRenders, queued: renderQueue.length, inflight: inflight.size, undecodable: undecodable.size }
}

export const MTM_PHOTO_THUMBNAIL_LIMITS = {
  maxParallelRenders: MAX_PARALLEL_RENDERS,
  maxQueuedRenders: MAX_QUEUED_RENDERS,
  maxUndecodableEntries: MAX_UNDECODABLE_ENTRIES,
} as const
