/**
 * Files of tasks brought over from Bordio, fetched by the server itself
 * (Zeytun, 2026-11-12: «əvvəlki tasklardaki koment hissədə ki fayllar foto
 * şəkillər açmır»). Only Bordio's file host, only for an admin; a file already
 * on the task is skipped; the bytes are stored sealed, as an upload is.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const state = vi.hoisted(() => ({
  role: "admin",
  written: [] as { path: string; bytes: Buffer }[],
  rows: [] as Record<string, unknown>[],
  fetched: [] as { url: string; redirect?: string }[],
  served: {} as Record<string, { status: number; body: Buffer; length?: number } | "throw">,
}))
vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_m: string, _a: string, handler: (req: NextRequest, auth: unknown) => Promise<Response>) =>
    (req: NextRequest) => handler(req, { orgId: "org-z", userId: "u-admin", role: state.role }),
}))
vi.mock("fs/promises", async (orig) => ({
  ...(await orig<typeof import("fs/promises")>()),
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async (p: string, bytes: Buffer) => { state.written.push({ path: p, bytes }) }),
}))
vi.mock("@/lib/runtime-paths", () => ({ runtimePublicUploadDirectory: () => "/uploads/tasks" }))
vi.mock("@/lib/crypto/tenant-file-encryption", () => ({
  sealTenantFile: (org: string, bytes: Buffer) => Buffer.concat([Buffer.from(`sealed:${org}:`), bytes]),
}))
vi.mock("@/lib/prisma", () => ({
  logAudit: vi.fn(),
  prisma: {
    task: {
      findMany: vi.fn(async ({ where }: { where: { organizationId: string; externalSource: string; externalId: { in: string[] } } }) =>
        [
          { id: "t1", externalId: "b1", attachments: [{ originalName: "already.png" }] },
          { id: "t2", externalId: "b2", attachments: [] },
        ].filter((t) => where.organizationId === "org-z" && where.externalSource === "bordio" && where.externalId.in.includes(t.externalId))),
    },
    taskAttachment: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { state.rows.push(data); return { id: `a${state.rows.length}` } }) },
  },
}))

const { POST } = await import("@/app/api/v1/tasks/import-external/files/route")
const link = (n: number) => `https://files.prod.bordio.com/f/00000000-0000-0000-0000-${String(n).padStart(12, "0")}`
const post = (body: unknown) => POST(new NextRequest("http://crm.test/api/v1/tasks/import-external/files", { method: "POST", body: JSON.stringify(body) }), {} as never)

beforeEach(() => {
  state.role = "admin"
  state.written = []
  state.rows = []
  state.fetched = []
  state.served = {}
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    state.fetched.push({ url, redirect: init?.redirect })
    const served = state.served[url]
    if (served === "throw" || !served) throw new TypeError("fetch failed")
    return new Response(new Uint8Array(served.body), { status: served.status, headers: served.length ? { "content-length": String(served.length) } : {} })
  }))
})

describe("POST /api/v1/tasks/import-external/files", () => {
  it("stores a Bordio file on its task, sealed, under the name the message gives it", async () => {
    state.served[link(1)] = { status: 200, body: PNG }
    const res = await post({ source: "bordio", items: [{ externalId: "b2", name: "84xetaiyenicek.png", url: link(1) }] })
    expect(res.status).toBe(200)
    expect((await res.json()).data.counts).toEqual({ ok: 1 })
    expect(state.fetched).toEqual([{ url: link(1), redirect: "error" }])
    expect(state.rows).toEqual([expect.objectContaining({ organizationId: "org-z", taskId: "t2", originalName: "84xetaiyenicek.png", mimeType: "image/png", fileSize: PNG.length, uploadedBy: "u-admin" })])
    expect(state.written).toHaveLength(1)
    expect(state.written[0].path).toMatch(/^\/uploads\/tasks\/[0-9a-f]{32}\.png$/u)
    expect(state.written[0].bytes.subarray(0, 13).toString()).toBe("sealed:org-z:")
  })

  it("skips a file already on the task, a task it does not know, and the same name twice in one list", async () => {
    state.served[link(2)] = { status: 200, body: PNG }
    const res = await post({ source: "bordio", items: [
      { externalId: "b1", name: "already.png", url: link(2) },
      { externalId: "nope", name: "x.png", url: link(2) },
      { externalId: "b2", name: "twice.png", url: link(2) },
      { externalId: "b2", name: "twice.png", url: link(2) },
    ] })
    const body = await res.json()
    expect(body.data.results.map((r: { outcome: string }) => r.outcome)).toEqual(["skip", "notask", "ok", "skip"])
    expect(state.rows).toHaveLength(1)
  })

  it("refuses what it may not keep, and writes nothing for it", async () => {
    state.served[link(3)] = { status: 200, body: Buffer.alloc(16), length: 101 * 1024 * 1024 }
    state.served[link(4)] = { status: 200, body: Buffer.from("not a png at all") }
    state.served[link(5)] = { status: 404, body: Buffer.alloc(0) }
    state.served[link(6)] = "throw"
    const res = await post({ source: "bordio", items: [
      { externalId: "b2", name: "big.png", url: link(3) },
      { externalId: "b2", name: "fake.png", url: link(4) },
      { externalId: "b2", name: "gone.png", url: link(5) },
      { externalId: "b2", name: "net.png", url: link(6) },
      { externalId: "b2", name: "clip.webm", url: link(3) },
    ] })
    const outcomes = (await res.json()).data.results.map((r: { outcome: string }) => r.outcome)
    expect(outcomes).toEqual(["too_big", "content", "fetch", "fetch", "type"])
    expect(state.rows).toEqual([])
    expect(state.written).toEqual([])
  })

  it("fetches only Bordio's own file links, and only for an admin", async () => {
    for (const url of ["http://files.prod.bordio.com/f/00000000-0000-0000-0000-000000000001", "https://evil.test/f/00000000-0000-0000-0000-000000000001", "https://files.prod.bordio.com/f/../../etc", "http://127.0.0.1:3001/api"]) {
      expect((await post({ source: "bordio", items: [{ externalId: "b2", name: "a.png", url }] })).status, url).toBe(400)
    }
    state.role = "manager"
    expect((await post({ source: "bordio", items: [{ externalId: "b2", name: "a.png", url: link(1) }] })).status).toBe(403)
    expect(state.fetched).toEqual([])
  })

  // Owner, 2026-11-12: «Да, разрешить» — the reels, brand books and CorelDraw sources left behind at 10 MB.
  it("keeps the marketing team's videos and design sources, up to 100 MB", async () => {
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42"), Buffer.alloc(12 * 1024 * 1024)])
    const cdr = Buffer.concat([Buffer.from("RIFF"), Buffer.from([1, 2, 3, 4]), Buffer.from("CDRvvrsn"), Buffer.alloc(8)])
    const psd = Buffer.concat([Buffer.from("8BPS"), Buffer.alloc(20)])
    state.served[link(7)] = { status: 200, body: mp4 }
    state.served[link(8)] = { status: 200, body: cdr }
    state.served[link(9)] = { status: 200, body: psd }
    const res = await post({ source: "bordio", items: [
      { externalId: "b2", name: "Sima Noreva Oktyabr.mp4", url: link(7) },
      { externalId: "b2", name: "banner.cdr", url: link(8) },
      { externalId: "b2", name: "afişa.psd", url: link(9) },
    ] })
    expect((await res.json()).data.counts).toEqual({ ok: 3 })
    // Stored in parallel: compare in name order.
    expect(state.rows.map((r) => [r.originalName, r.mimeType, r.fileSize]).sort()).toEqual([
      ["Sima Noreva Oktyabr.mp4", "video/mp4", mp4.length],
      ["afişa.psd", "image/vnd.adobe.photoshop", psd.length],
      ["banner.cdr", "application/vnd.corel-draw", cdr.length],
    ].sort())
  })
})
