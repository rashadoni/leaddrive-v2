/**
 * Review of #207: queued thumbnail requests must not hold camera originals in
 * memory, the wait queue is bounded (503 instead of parking), and an
 * undecodable original is not re-read and re-decoded on every request.
 * sharp and the file reads are controlled here so saturation is deterministic.
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const sharpControl = vi.hoisted(() => ({
  pending: [] as Array<{ resolve: (b: Buffer) => void; reject: (e: Error) => void }>,
  mode: "defer" as "defer" | "fail",
  calls: 0,
}))

vi.mock("sharp", () => {
  const factory = () => {
    sharpControl.calls += 1
    const chain = {
      rotate: () => chain,
      resize: () => chain,
      webp: () => chain,
      toBuffer: () => sharpControl.mode === "fail"
        ? Promise.reject(new Error("unsupported image format"))
        : new Promise<Buffer>((resolve, reject) => sharpControl.pending.push({ resolve, reject })),
    }
    return chain
  }
  return { default: factory }
})

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>()
  return { ...actual, default: actual, readFile: vi.fn(actual.readFile) }
})

import { readFile } from "node:fs/promises"
import {
  MTM_PHOTO_THUMBNAIL_LIMITS,
  MtmPhotoThumbnailBusyError,
  mtmPhotoThumbnailRenderStateForTests,
  renderMtmPhotoThumbnail,
  resolveDiskMtmPhotoThumbnail,
} from "@/lib/mtm/photo-thumbnail-server"

let root: string

beforeEach(async () => {
  sharpControl.pending.length = 0
  sharpControl.mode = "defer"
  sharpControl.calls = 0
  vi.mocked(readFile).mockClear()
  root = await mkdtemp(path.join(os.tmpdir(), "mtm-thumb-limits-"))
  await mkdir(path.join(root, "mtm-photos"))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function drain() {
  // Resolve renders until every queued waiter has been served.
  for (let i = 0; i < 100 && (sharpControl.pending.length > 0 || mtmPhotoThumbnailRenderStateForTests().activeRenders > 0); i++) {
    for (const job of sharpControl.pending.splice(0)) job.resolve(Buffer.from("thumb"))
    await new Promise((r) => setTimeout(r, 0))
  }
}

describe("thumbnail render queue", () => {
  it("refuses beyond the queue cap and never reads an original while full", async () => {
    const { maxParallelRenders, maxQueuedRenders } = MTM_PHOTO_THUMBNAIL_LIMITS
    const held = Array.from({ length: maxParallelRenders + maxQueuedRenders }, () =>
      renderMtmPhotoThumbnail(Buffer.from("jpeg"), 480))
    await new Promise((r) => setTimeout(r, 0))
    expect(mtmPhotoThumbnailRenderStateForTests()).toMatchObject({
      activeRenders: maxParallelRenders,
      queued: maxQueuedRenders,
    })

    await expect(renderMtmPhotoThumbnail(Buffer.from("jpeg"), 480)).rejects.toBeInstanceOf(MtmPhotoThumbnailBusyError)

    const originalPath = path.join(root, "mtm-photos", "busy.jpg")
    await writeFile(originalPath, Buffer.from("camera original"))
    const result = await resolveDiskMtmPhotoThumbnail({
      uploadsRoot: root, originalPath, fileName: "busy.jpg", width: 480, ifNoneMatch: null,
    })
    expect(result).toEqual({ kind: "busy", retryAfterSeconds: 2 })
    expect(readFile).not.toHaveBeenCalled()

    await drain()
    await expect(Promise.all(held)).resolves.toHaveLength(maxParallelRenders + maxQueuedRenders)
    expect(mtmPhotoThumbnailRenderStateForTests()).toMatchObject({ activeRenders: 0, queued: 0, inflight: 0 })
  })

  it("reads the original only after it holds a render slot", async () => {
    const { maxParallelRenders } = MTM_PHOTO_THUMBNAIL_LIMITS
    const held = Array.from({ length: maxParallelRenders }, () => renderMtmPhotoThumbnail(Buffer.from("jpeg"), 480))
    await new Promise((r) => setTimeout(r, 0))

    const originalPath = path.join(root, "mtm-photos", "queued.jpg")
    await writeFile(originalPath, Buffer.from("camera original"))
    const queued = resolveDiskMtmPhotoThumbnail({
      uploadsRoot: root, originalPath, fileName: "queued.jpg", width: 480, ifNoneMatch: null,
    })
    await vi.waitFor(() => expect(mtmPhotoThumbnailRenderStateForTests().queued).toBe(1))
    expect(readFile).not.toHaveBeenCalled()

    await drain()
    await Promise.all(held)
    expect((await queued).kind).toBe("ok")
    expect(readFile).toHaveBeenCalledWith(originalPath)
  })
})

describe("undecodable negative cache", () => {
  it("falls back immediately on repeat requests, without re-reading or re-decoding", async () => {
    sharpControl.mode = "fail"
    const originalPath = path.join(root, "mtm-photos", "legacy.heic")
    await writeFile(originalPath, Buffer.from("legacy heic bytes"))
    const request = { uploadsRoot: root, originalPath, fileName: "legacy.heic", width: 480 as const, ifNoneMatch: null }

    expect(await resolveDiskMtmPhotoThumbnail(request)).toEqual({ kind: "undecodable" })
    expect(sharpControl.calls).toBe(1)
    expect(readFile).toHaveBeenCalledTimes(1)

    expect(await resolveDiskMtmPhotoThumbnail(request)).toEqual({ kind: "undecodable" })
    expect(await resolveDiskMtmPhotoThumbnail({ ...request, width: 240 })).toEqual({ kind: "undecodable" })
    expect(sharpControl.calls).toBe(1)
    expect(readFile).toHaveBeenCalledTimes(1)
  })

  it("tries again when the original changes (new size or mtime)", async () => {
    sharpControl.mode = "fail"
    const originalPath = path.join(root, "mtm-photos", "replaced.jpg")
    await writeFile(originalPath, Buffer.from("truncated"))
    const request = { uploadsRoot: root, originalPath, fileName: "replaced.jpg", width: 480 as const, ifNoneMatch: null }
    expect((await resolveDiskMtmPhotoThumbnail(request)).kind).toBe("undecodable")

    await writeFile(originalPath, Buffer.from("a complete replacement file"))
    sharpControl.mode = "defer"
    const second = resolveDiskMtmPhotoThumbnail(request)
    await vi.waitFor(() => expect(sharpControl.pending.length).toBe(1))
    await drain()
    expect((await second).kind).toBe("ok")
    expect(sharpControl.calls).toBe(2)
  })
})
