/**
 * T8 Cobrowse slice-3c — reaper cron tests.
 *
 * Covers: auth (503 unset / 401 wrong / 200 correct), stale-window
 * filter, status-IN filter, MAX_PER_TICK cap, updateMany
 * conditional-where for race-safety.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    cobrowseSession: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}))

import { POST } from "@/app/api/cron/cobrowse-reaper/route"
import { prisma } from "@/lib/prisma"

const CRON_SECRET = "test-cron-secret"

function makeReq(headers: Record<string, string> = {}) {
  return new NextRequest(new URL("/api/cron/cobrowse-reaper", "http://localhost:3000"), {
    method: "POST",
    headers,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = CRON_SECRET
})

describe("POST /api/cron/cobrowse-reaper — auth", () => {
  it("503 when CRON_SECRET env var is unset", async () => {
    delete process.env.CRON_SECRET
    const res = await POST(makeReq({ "x-cron-secret": "anything" }))
    expect(res.status).toBe(503)
  })

  it("401 when no cron-secret header", async () => {
    const res = await POST(makeReq())
    expect(res.status).toBe(401)
  })

  it("401 on wrong x-cron-secret", async () => {
    const res = await POST(makeReq({ "x-cron-secret": "wrong" }))
    expect(res.status).toBe(401)
  })

  it("200 with correct x-cron-secret", async () => {
    vi.mocked(prisma.cobrowseSession.findMany).mockResolvedValue([])
    const res = await POST(makeReq({ "x-cron-secret": CRON_SECRET }))
    expect(res.status).toBe(200)
  })

  it("accepts Bearer authorization", async () => {
    vi.mocked(prisma.cobrowseSession.findMany).mockResolvedValue([])
    const res = await POST(makeReq({ authorization: `Bearer ${CRON_SECRET}` }))
    expect(res.status).toBe(200)
  })
})

describe("POST /api/cron/cobrowse-reaper — scan", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = CRON_SECRET
  })

  it("scans only stale sessions in active lifecycle states", async () => {
    vi.mocked(prisma.cobrowseSession.findMany).mockResolvedValue([])
    await POST(makeReq({ "x-cron-secret": CRON_SECRET }))
    const call = vi.mocked(prisma.cobrowseSession.findMany).mock.calls[0][0]
    expect((call?.where as Record<string, unknown>).status).toEqual({
      in: ["pending", "awaiting_consent", "active", "paused"],
    })
    // Liveness predicate uses OR: (lastSeenAt < cutoff) OR
    // (lastSeenAt null AND updatedAt < cutoff). Cutoff is ~15min ago.
    const orClauses = (call?.where as { OR: Array<Record<string, unknown>> }).OR
    expect(orClauses).toHaveLength(2)
    expect(orClauses[0]).toMatchObject({ lastSeenAt: expect.objectContaining({ lt: expect.any(Date) }) })
    expect(orClauses[1]).toMatchObject({
      lastSeenAt: null,
      updatedAt: expect.objectContaining({ lt: expect.any(Date) }),
    })
    const lastSeenLt = (orClauses[0].lastSeenAt as { lt: Date }).lt
    const ageMs = Date.now() - lastSeenLt.getTime()
    expect(ageMs).toBeGreaterThan(14 * 60 * 1000)
    expect(ageMs).toBeLessThan(16 * 60 * 1000)
  })

  it("does NOT include `ended` sessions in the scan", async () => {
    vi.mocked(prisma.cobrowseSession.findMany).mockResolvedValue([])
    await POST(makeReq({ "x-cron-secret": CRON_SECRET }))
    const call = vi.mocked(prisma.cobrowseSession.findMany).mock.calls[0][0]
    const statusIn = (call?.where as Record<string, { in: string[] }>).status.in
    expect(statusIn).not.toContain("ended")
  })

  it("caps the scan at 500 rows per tick", async () => {
    vi.mocked(prisma.cobrowseSession.findMany).mockResolvedValue([])
    await POST(makeReq({ "x-cron-secret": CRON_SECRET }))
    expect(prisma.cobrowseSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 500 }),
    )
  })
})

describe("POST /api/cron/cobrowse-reaper — updateMany", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = CRON_SECRET
  })

  it("no-ops cleanly when no stale sessions found", async () => {
    vi.mocked(prisma.cobrowseSession.findMany).mockResolvedValue([])
    const res = await POST(makeReq({ "x-cron-secret": CRON_SECRET }))
    expect(res.status).toBe(200)
    const body: { summary: { scanned: number; reaped: number } } = await res.json()
    expect(body.summary.scanned).toBe(0)
    expect(body.summary.reaped).toBe(0)
    expect(prisma.cobrowseSession.updateMany).not.toHaveBeenCalled()
  })

  it("updates stale rows to ended/timeout", async () => {
    vi.mocked(prisma.cobrowseSession.findMany).mockResolvedValue([
      { id: "s1", status: "active" },
      { id: "s2", status: "paused" },
    ] as any)
    vi.mocked(prisma.cobrowseSession.updateMany).mockResolvedValue({ count: 2 } as any)
    const res = await POST(makeReq({ "x-cron-secret": CRON_SECRET }))
    expect(res.status).toBe(200)
    const body: { summary: { scanned: number; reaped: number } } = await res.json()
    expect(body.summary.scanned).toBe(2)
    expect(body.summary.reaped).toBe(2)

    const call = vi.mocked(prisma.cobrowseSession.updateMany).mock.calls[0][0]
    expect(call?.data).toMatchObject({ status: "ended", endReason: "timeout" })
    expect((call?.data as Record<string, unknown>).endedAt).toBeInstanceOf(Date)
  })

  it("updateMany uses conditional-where on (id IN list, status IN active-states)", async () => {
    vi.mocked(prisma.cobrowseSession.findMany).mockResolvedValue([
      { id: "s1", status: "active" },
      { id: "s2", status: "paused" },
    ] as any)
    vi.mocked(prisma.cobrowseSession.updateMany).mockResolvedValue({ count: 2 } as any)
    await POST(makeReq({ "x-cron-secret": CRON_SECRET }))
    const call = vi.mocked(prisma.cobrowseSession.updateMany).mock.calls[0][0]
    expect((call?.where as Record<string, { in: string[] }>).id.in).toEqual(["s1", "s2"])
    expect((call?.where as Record<string, { in: string[] }>).status.in).toEqual(
      ["pending", "awaiting_consent", "active", "paused"],
    )
  })

  it("reports `reaped < scanned` when a session ended between findMany + updateMany (race)", async () => {
    vi.mocked(prisma.cobrowseSession.findMany).mockResolvedValue([
      { id: "s1", status: "active" },
      { id: "s2", status: "paused" },
    ] as any)
    // Only one row matched the status filter — the other transitioned
    // to ended via a concurrent manual end. updateMany counted 1.
    vi.mocked(prisma.cobrowseSession.updateMany).mockResolvedValue({ count: 1 } as any)
    const res = await POST(makeReq({ "x-cron-secret": CRON_SECRET }))
    const body: { summary: { scanned: number; reaped: number } } = await res.json()
    expect(body.summary.scanned).toBe(2)
    expect(body.summary.reaped).toBe(1)
  })
})

describe("POST /api/cron/cobrowse-reaper — errors", () => {
  it("500 on DB error", async () => {
    process.env.CRON_SECRET = CRON_SECRET
    vi.mocked(prisma.cobrowseSession.findMany).mockRejectedValue(new Error("connection lost"))
    const res = await POST(makeReq({ "x-cron-secret": CRON_SECRET }))
    expect(res.status).toBe(500)
  })
})
