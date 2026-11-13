/**
 * A task's file is saved under the name its author gave it, and a task's large
 * file can be opened at all.
 *
 * Güllü (Zeytun), 2026-11-13: «при нажатии для скачивания визуала кидает на
 * другую страницу и сохраняет не с наименованием, которое задавал дизайнер…
 * в наименовании обычно бывают даты и порядок». The browser offered the random
 * name on disk. Found beside it: tasks take files up to 100 MB, the proxy
 * served up to 50 — 33 of Zeytun's own files answered 413.
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
  isAuthError: (v: unknown) => v instanceof NextResponse,
  orgHasModule: vi.fn(async () => true),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    mtmPhoto: { findFirst: vi.fn() },
    contractFile: { findFirst: vi.fn() },
    taskAttachment: { findFirst: vi.fn() },
  },
}))

import { GET } from "@/app/api/v1/uploads/[...path]/route"
import { stat } from "fs/promises"
import { createReadStream } from "fs"
import { Readable } from "stream"
import { requireSessionAuth } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { acquirePublicConcurrencySlot, consumePublicRateLimit, releasePublicConcurrencySlot } from "@/lib/public-abuse-guard"
import { announcedFileName, contentDisposition } from "@/lib/tasks/file-download-name"
import { MAX_TASK_FILE_SIZE } from "@/lib/tasks/task-file-store"

const STORED = "63b9b4adef53e4d87af100e7ac51fcc6.png"
const pp = (parts: string[]) => ({ params: Promise.resolve({ path: parts }) })
const req = (query = "") => new NextRequest(new URL(`http://localhost:3000/api/v1/uploads/x${query}`))
const fileOf = (originalName: string | null) => vi.mocked(prisma.taskAttachment.findFirst).mockResolvedValue({ id: "ta1", originalName } as never)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireSessionAuth).mockReset()
  vi.mocked(requireSessionAuth).mockResolvedValue({ orgId: "org-1", userId: "u1", role: "sales" } as never)
  vi.mocked(stat).mockReset()
  vi.mocked(stat).mockResolvedValue({ isFile: () => true, size: 1024 } as never)
  vi.mocked(consumePublicRateLimit).mockResolvedValue({ allowed: true, retryAfterSeconds: 0, unavailable: false })
  vi.mocked(acquirePublicConcurrencySlot).mockResolvedValue({ allowed: true, retryAfterSeconds: 0, unavailable: false, backend: "memory", key: "k", token: "t" })
  vi.mocked(releasePublicConcurrencySlot).mockResolvedValue(undefined)
  vi.mocked(createReadStream).mockReturnValue(Readable.from([Buffer.from([0])]) as never)
})

describe("a task's file keeps its author's name", () => {
  it("opened in the browser, it is still saved under the designer's name — in any alphabet", async () => {
    fileOf("13.11.2026-Qan-şəkəri-4.png")
    const res = await GET(req(), pp(["tasks", STORED]))
    expect(res.status).toBe(200)
    const header = res.headers.get("content-disposition")!
    expect(header.startsWith("inline; ")).toBe(true)
    // The exact name for today's browsers, a plain one for the rest; neither is the name on disk.
    expect(decodeURIComponent(header.split("filename*=UTF-8''")[1])).toBe("13.11.2026-Qan-şəkəri-4.png")
    expect(header).toContain('filename="13.11.2026-Qan-sekeri-4.png"')
    expect(header).not.toContain("63b9b4a")
    expect(res.headers.get("content-type")).toBe("image/png")
    // The row is the caller's own organization's, as before.
    expect((vi.mocked(prisma.taskAttachment.findFirst).mock.calls[0]?.[0] as { where: unknown }).where).toEqual({ fileName: STORED, organizationId: "org-1" })
  })

  it("«download» saves it instead of opening it", async () => {
    fileOf("buccoterm endirim2.png")
    const res = await GET(req("?download=1"), pp(["tasks", STORED]))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="buccoterm endirim2.png"; filename*=UTF-8''buccoterm%20endirim2.png`)
  })

  it("the name is the row's, not the link's: nothing in the address changes it", async () => {
    fileOf("visual.png")
    const res = await GET(req("?download=1&name=evil.html&filename=evil.html"), pp(["tasks", STORED]))
    expect(res.headers.get("content-disposition")).toContain('filename="visual.png"')
    expect(res.headers.get("content-disposition")).not.toContain("evil")
  })

  it("a file with no name of its own keeps the stored one", async () => {
    fileOf(null)
    const res = await GET(req(), pp(["tasks", STORED]))
    expect(res.headers.get("content-disposition")).toContain(`filename="${STORED}"`)
  })

  it("another organization's file is still not found, whatever is asked", async () => {
    vi.mocked(prisma.taskAttachment.findFirst).mockResolvedValue(null)
    expect((await GET(req("?download=1"), pp(["tasks", STORED]))).status).toBe(404)
  })
})

describe("a task's large file can be opened", () => {
  it("a 96 MB video a task was allowed to take is served", async () => {
    fileOf("reels final.mp4")
    vi.mocked(stat).mockResolvedValue({ isFile: () => true, size: 96 * 1024 * 1024 } as never)
    const res = await GET(req("?download=1"), pp(["tasks", "aa11.mp4"]))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-disposition")).toContain('attachment; filename="reels final.mp4"')
  })

  it("what a task could never have taken is still refused", async () => {
    fileOf("huge.mp4")
    vi.mocked(stat).mockResolvedValue({ isFile: () => true, size: MAX_TASK_FILE_SIZE + 8 * 1024 * 1024 } as never)
    expect((await GET(req(), pp(["tasks", "aa11.mp4"]))).status).toBe(413)
  })

  it("other kinds of files keep the 50 MB ceiling", async () => {
    vi.mocked(prisma.contractFile.findFirst).mockResolvedValue({ id: "cf1" } as never)
    vi.mocked(stat).mockResolvedValue({ isFile: () => true, size: 50 * 1024 * 1024 + 1 } as never)
    expect((await GET(req(), pp(["contracts", "big.pdf"]))).status).toBe(413)
  })
})

describe("the announced name", () => {
  it("ends in the stored file's extension, whatever the original claims", () => {
    expect(announcedFileName("report.html", "ab12.pdf")).toBe("report.html.pdf")
    expect(announcedFileName("Şəkil", "ab12.png")).toBe("Şəkil.png")
    expect(announcedFileName("photo.PNG", "ab12.png")).toBe("photo.png")
  })

  it("carries no path, no control characters and nothing a disk refuses", () => {
    expect(announcedFileName("..\\..\\etc/passwd\r\nX-Evil: 1.png", "ab12.png")).toBe("etc passwd X-Evil 1.png")
    expect(announcedFileName('a"b<c>d|e?.png', "ab12.png")).toBe("a b c d e.png")
    expect(announcedFileName("   ", "ab12.png")).toBe("ab12.png")
    expect([...announcedFileName(`${"ü".repeat(400)}.png`, "ab12.png")].length).toBeLessThanOrEqual(180)
  })

  it("the header is plain ASCII, so any name can be sent", () => {
    const header = contentDisposition("attachment", "Bütün vebsayt bannerləri (3 dil) 'son'.png")
    expect(/^[\x20-\x7e]+$/.test(header)).toBe(true)
    expect(decodeURIComponent(header.split("filename*=UTF-8''")[1])).toBe("Bütün vebsayt bannerləri (3 dil) 'son'.png")
    expect(header).toContain(`filename="Butun vebsayt bannerleri (3 dil) 'son'.png"`)
  })
})
