/**
 * A card's file in parts (Nazrin, 2026-11-15: a promo video answered «server
 * error» — the Next proxy hands a route only the first 10 MB of a body). The
 * parts land sealed on a real disk, the last one puts the file together, and
 * the stored file decrypts to exactly the bytes sent; a refusal is decided at
 * the first part, and one person's parts never finish another's file.
 */
import { mkdtemp, mkdir, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const state = vi.hoisted(() => ({
  root: "",
  userId: "u-1",
  rows: [] as Record<string, unknown>[],
}))
vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_m: string, _a: string, handler: (req: NextRequest, auth: unknown, ctx: unknown) => Promise<Response>) =>
    (req: NextRequest, ctx: unknown) => handler(req, { orgId: "org-z", userId: state.userId, role: "sales" }, ctx),
}))
vi.mock("@/lib/runtime-paths", () => ({
  resolveRuntimePaths: () => ({ runtimeRoot: state.root }),
  runtimePublicUploadDirectory: (sub: string) => path.join(state.root, "uploads", sub),
}))
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => true }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; organizationId: string } }) =>
        (where.id === "t1" && where.organizationId === "org-z" ? { id: "t1" } : null)),
    },
    taskAttachment: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { state.rows.push(data); return { id: `a${state.rows.length}`, ...data } }),
    },
  },
}))

import { resetMasterKekCache } from "@/lib/crypto/tenant-pii-encryption"
import { decodeTenantFileBytes } from "@/lib/crypto/tenant-file-encryption"
import { TASK_FILE_PART_SIZE } from "@/lib/tasks/task-file-rules"

const TEST_KEK = "0123456789abcdef".repeat(4) // gitleaks:allow — synthetic test key
const { POST } = await import("@/app/api/v1/tasks/[id]/files/parts/route")
const single = await import("@/app/api/v1/tasks/[id]/files/route")

const UPLOAD = "0123456789abcdef0123456789abcdef"
function mp4(size: number): Buffer {
  const bytes = Buffer.alloc(size)
  for (let i = 0; i < size; i += 1) bytes[i] = (i * 31 + 7) % 251
  bytes.write("ftyp", 4, "latin1")
  return bytes
}
function send(file: Buffer, index: number, opts: { name?: string; type?: string; upload?: string; size?: number; count?: number; body?: Buffer; task?: string } = {}) {
  const size = opts.size ?? file.length
  const count = opts.count ?? Math.ceil(size / TASK_FILE_PART_SIZE)
  const body = opts.body ?? file.subarray(index * TASK_FILE_PART_SIZE, Math.min(file.length, (index + 1) * TASK_FILE_PART_SIZE))
  const query = new URLSearchParams({
    upload: opts.upload ?? UPLOAD, index: String(index), count: String(count), size: String(size),
    name: opts.name ?? "Promo/reels 1.mp4", type: opts.type ?? "video/mp4",
  })
  const task = opts.task ?? "t1"
  return POST(
    new NextRequest(`http://crm.test/api/v1/tasks/${task}/files/parts?${query}`, { method: "POST", body: new Uint8Array(body) }),
    { params: Promise.resolve({ id: task }) } as never,
  )
}
async function storedFiles(): Promise<string[]> {
  return readdir(path.join(state.root, "uploads", "tasks")).catch(() => [])
}
const partsDir = (user = "u-1", upload = UPLOAD) => path.join(state.root, "upload-parts", "tasks", "org-z", user, upload)

beforeAll(async () => { state.root = await mkdtemp(path.join(tmpdir(), "task-parts-")) })
afterAll(async () => { await rm(state.root, { recursive: true, force: true }) })
beforeEach(async () => {
  process.env.TENANT_PII_MASTER_KEY = TEST_KEK
  resetMasterKekCache()
  state.userId = "u-1"
  state.rows = []
  await rm(path.join(state.root, "uploads"), { recursive: true, force: true })
  await rm(path.join(state.root, "upload-parts"), { recursive: true, force: true })
})
afterEach(() => { delete process.env.TENANT_PII_MASTER_KEY; resetMasterKekCache() })

describe("POST /api/v1/tasks/[id]/files/parts", () => {
  it("a 20 MB video goes in three parts and is stored once, byte for byte, sealed", async () => {
    const video = mp4(2 * TASK_FILE_PART_SIZE + 12_345)
    expect((await send(video, 0)).status).toBe(202)
    expect((await send(video, 1)).status).toBe(202)
    // The parts wait sealed, not as the video.
    const waiting = await readFile(path.join(partsDir(), "1.part"))
    expect(waiting.includes(video.subarray(TASK_FILE_PART_SIZE, TASK_FILE_PART_SIZE + 64))).toBe(false)
    expect(state.rows).toHaveLength(0)

    const last = await send(video, 2)
    expect(last.status).toBe(201)
    expect(state.rows).toEqual([expect.objectContaining({
      organizationId: "org-z", taskId: "t1", originalName: "Promo/reels 1.mp4", fileSize: video.length, mimeType: "video/mp4", uploadedBy: "u-1",
    })])
    const [stored] = await storedFiles()
    expect(stored).toMatch(/^[0-9a-f]{32}\.mp4$/u)
    const onDisk = await readFile(path.join(state.root, "uploads", "tasks", stored))
    expect(onDisk.equals(video)).toBe(false)
    expect(decodeTenantFileBytes("org-z", onDisk).equals(video)).toBe(true)
    // Nothing is left waiting.
    expect(await readdir(partsDir()).catch(() => null)).toBeNull()
  })

  it("a small file is one part and is stored at once", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
    const res = await send(png, 0, { name: "logo.png", type: "image/png" })
    expect(res.status).toBe(201)
    expect(state.rows[0]).toMatchObject({ originalName: "logo.png", mimeType: "image/png", fileSize: png.length })
  })

  it("an Illustrator logo, a print TIFF and a RAR archive are taken; an SVG is not", async () => {
    const ai = Buffer.from("%PDF-1.6\n% Adobe Illustrator\n")
    const tif = Buffer.from([0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0])
    const rar = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00])
    expect((await send(ai, 0, { name: "logo.ai", type: "application/postscript" })).status).toBe(201)
    expect((await send(tif, 0, { name: "afisha.tiff", type: "" })).status).toBe(201)
    expect((await send(rar, 0, { name: "brandbook.rar", type: "application/x-rar-compressed" })).status).toBe(201)
    expect(state.rows.map((row) => row.mimeType)).toEqual(["application/postscript", "image/tiff", "application/vnd.rar"])
    const svg = await send(Buffer.from("<svg onload=alert(1)>"), 0, { name: "logo.svg", type: "image/svg+xml" })
    expect(svg.status).toBe(415)
    expect(await svg.json()).toMatchObject({ refusal: "type" })
  })

  it("refuses at the first part what the task will not take — before 100 MB cross the network", async () => {
    const tooBig = await send(Buffer.alloc(1), 0, { size: 100 * 1024 * 1024 + 1, count: 13 })
    expect(tooBig.status).toBe(413)
    expect(await tooBig.json()).toMatchObject({ refusal: "too_big" })
    expect((await send(Buffer.from("MZ"), 0, { name: "setup.exe", type: "application/octet-stream" })).status).toBe(415)
    // A «.mp4» whose head is not a video.
    const fake = Buffer.alloc(TASK_FILE_PART_SIZE + 10, 0x41)
    const notVideo = await send(fake, 0)
    expect(notVideo.status).toBe(400)
    expect(await notVideo.json()).toMatchObject({ refusal: "content" })
    expect(await readdir(partsDir()).catch(() => null)).toBeNull()
    expect(state.rows).toHaveLength(0)
  })

  it("a part of the wrong length, a count that does not fit the size, or an unknown task are refused", async () => {
    const video = mp4(TASK_FILE_PART_SIZE + 100)
    expect((await send(video, 0, { body: video.subarray(0, 1000) })).status).toBe(400)
    expect((await send(video, 0, { count: 3 })).status).toBe(400)
    expect((await send(video, 0, { upload: "../../etc" })).status).toBe(400)
    expect((await send(video, 0, { task: "t9" })).status).toBe(404)
    expect(state.rows).toHaveLength(0)
  })

  it("a last part without the ones before stores nothing and asks for the file again", async () => {
    const video = mp4(2 * TASK_FILE_PART_SIZE + 5)
    expect((await send(video, 0)).status).toBe(202)
    const res = await send(video, 2)
    expect(res.status).toBe(409)
    expect(state.rows).toHaveLength(0)
    expect(await storedFiles()).toEqual([])
  })

  it("one person's parts never finish another's file", async () => {
    const video = mp4(TASK_FILE_PART_SIZE + 5)
    expect((await send(video, 0)).status).toBe(202)
    state.userId = "u-2"
    expect((await send(video, 1)).status).toBe(409)
    expect(state.rows).toHaveLength(0)
    state.userId = "u-1"
    expect((await send(video, 1)).status).toBe(201)
  })

  it("an upload left unfinished for six hours is swept when the next one starts", async () => {
    const old = partsDir("u-7", "f".repeat(32))
    await mkdir(old, { recursive: true })
    await writeFile(path.join(old, "0.part"), "x")
    const hoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000)
    await utimes(old, hoursAgo, hoursAgo)
    const fresh = partsDir("u-8", "e".repeat(32))
    await mkdir(fresh, { recursive: true })

    const video = mp4(TASK_FILE_PART_SIZE + 5)
    expect((await send(video, 0)).status).toBe(202)
    expect(await readdir(old).catch(() => null)).toBeNull()
    expect(await readdir(fresh)).toEqual([])
  })
})

describe("POST /api/v1/tasks/[id]/files — one request", () => {
  it("a body longer than the proxy passes is refused in words, not «server error»", async () => {
    const res = await single.POST(
      new NextRequest("http://crm.test/api/v1/tasks/t1/files", { method: "POST", headers: { "content-length": String(30 * 1024 * 1024) }, body: "x" }),
      { params: Promise.resolve({ id: "t1" }) } as never,
    )
    expect(res.status).toBe(413)
    expect(await res.json()).toMatchObject({ refusal: "too_big" })
  })

  it("a cut form is a 400 asking to send it again", async () => {
    const res = await single.POST(
      new NextRequest("http://crm.test/api/v1/tasks/t1/files", {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=XYZ" },
        body: "--XYZ\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.mp4\"\r\n\r\nabc",
      }),
      { params: Promise.resolve({ id: "t1" }) } as never,
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain("incomplete")
  })
})
