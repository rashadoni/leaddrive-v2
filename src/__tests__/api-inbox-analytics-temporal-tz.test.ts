/**
 * `?tz=` on the inbox's temporal report (2026-11-15, the inbox «Bu gün» card).
 * The trend's days are the requested zone's calendar days: Baku's day starts at
 * 20:00 UTC, so UTC days would put last night's messages into today. The zone
 * goes to Postgres as a bound value, never as SQL text, and a name the runtime
 * does not know is dropped (UTC days, as before) rather than turned into a 500.
 *
 * The SQL itself — `("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE $n` over the
 * `timestamp(3)` column, grouped by its alias — was run on postgres:16 with
 * 23:30 and 00:30 Baku rows: Asia/Baku put them on two days, UTC on one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { Prisma } from "@prisma/client"

vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: vi.fn() } }))
vi.mock("@/lib/api-auth", () => {
  const getOrgId = vi.fn()
  return {
    getOrgId,
    getSession: vi.fn().mockResolvedValue(null),
    requireAuth: vi.fn(async () => ({ orgId: "org_1", userId: "u1", role: "admin", email: "", name: "" })),
    isAuthError: (value: unknown) => value instanceof Response,
  }
})

import { GET } from "@/app/api/v1/inbox/analytics/temporal/route"
import { prisma } from "@/lib/prisma"

const queryRaw = prisma.$queryRaw as unknown as ReturnType<typeof vi.fn>

/** The trend query (the second one) as Postgres receives it: text and bound values. */
function trendQuery() {
  const call = queryRaw.mock.calls[1] as [TemplateStringsArray, ...unknown[]]
  const sql = Prisma.sql(call[0], ...(call.slice(1) as Prisma.Sql[]))
  return { text: sql.sql, values: sql.values }
}

describe("GET /api/v1/inbox/analytics/temporal ?tz=", () => {
  beforeEach(() => {
    queryRaw.mockReset()
    queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { day: "2026-11-14", direction: "inbound", count: 1 },
      { day: "2026-11-15", direction: "inbound", count: 2 },
    ])
  })

  it("buckets the trend by the requested zone's days, with the zone as a bound value", async () => {
    const res = await GET(new NextRequest("http://localhost/api/v1/inbox/analytics/temporal?from=2026-11-09T20:00:00.000Z&tz=Asia%2FBaku"))
    expect(res.status).toBe(200)
    const { text, values } = trendQuery()
    expect(text).toMatch(/date_trunc\('day', \("createdAt" AT TIME ZONE 'UTC'\) AT TIME ZONE \?\)/)
    expect(values).toContain("Asia/Baku")
    expect((await res.json()).data.trend).toEqual([
      { date: "2026-11-14", inbound: 1, outbound: 0 },
      { date: "2026-11-15", inbound: 2, outbound: 0 },
    ])
  })

  it("keeps UTC days without a zone, as the analytics page asks", async () => {
    await GET(new NextRequest("http://localhost/api/v1/inbox/analytics/temporal"))
    const { text } = trendQuery()
    expect(text).not.toContain("AT TIME ZONE")
    expect(text).toContain(`date_trunc('day', "createdAt")`)
  })

  it.each([
    ["an unknown zone", "Mars/Olympus"],
    ["SQL in the parameter", "UTC') ; DROP TABLE channel_messages; --"],
    ["a too-long name", `Europe/${"x".repeat(80)}`],
  ])("ignores %s instead of failing", async (_label, tz) => {
    const res = await GET(new NextRequest(`http://localhost/api/v1/inbox/analytics/temporal?tz=${encodeURIComponent(tz)}`))
    expect(res.status).toBe(200)
    const { text, values } = trendQuery()
    expect(text).not.toContain("AT TIME ZONE")
    expect(values).not.toContain(tz)
  })
})
