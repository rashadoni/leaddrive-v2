/**
 * CDP Calculated Insights — daily snapshot cron tests.
 *
 * Covers: auth (503 unset / 401 wrong / 200 correct), one snapshot per active
 * org with aggregates from the shared computeOrgInsights() written via a
 * deterministic per-day id (`${orgId}:${YYYY-MM-DD}`) upsert, per-day
 * idempotency (findUnique fast-path skip), and per-org error isolation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findMany: vi.fn() },
    customerInsightsSnapshot: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}))
vi.mock("@/lib/calculated-insights/compute-org-insights", () => ({
  computeOrgInsights: vi.fn(),
}))

import { POST } from "@/app/api/cron/customer-insights-snapshot/route"
import { prisma } from "@/lib/prisma"
import { computeOrgInsights } from "@/lib/calculated-insights/compute-org-insights"

const CRON_SECRET = "test-cron-secret"
const DAY_ID_RE = /^org-\w+:\d{4}-\d{2}-\d{2}$/

const orgFindMany = () => prisma.organization.findMany as ReturnType<typeof vi.fn>
const snapFindUnique = () => prisma.customerInsightsSnapshot.findUnique as ReturnType<typeof vi.fn>
const snapUpsert = () => prisma.customerInsightsSnapshot.upsert as ReturnType<typeof vi.fn>
const compute = () => computeOrgInsights as ReturnType<typeof vi.fn>

function makeReq(headers: Record<string, string> = {}) {
  return new NextRequest(
    new URL("/api/cron/customer-insights-snapshot", "http://localhost:3000"),
    { method: "POST", headers },
  )
}

function aggregates(over: Partial<Record<string, unknown>> = {}) {
  return {
    items: [],
    totalItems: 0,
    totalProfiles: 569,
    highRiskCount: 2,
    avgEngagement: 18.4,
    ltvCurrencyTotals: [{ currency: "AZN", total: 1_900_000 }],
    dominantLtv: { currency: "AZN", total: 1_900_000 },
    truncated: false,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = CRON_SECRET
})

describe("POST /api/cron/customer-insights-snapshot — auth", () => {
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
})

describe("POST /api/cron/customer-insights-snapshot — snapshot write", () => {
  it("upserts one snapshot per active org under a deterministic per-day id", async () => {
    orgFindMany().mockResolvedValue([{ id: "org-1" }, { id: "org-2" }])
    snapFindUnique().mockResolvedValue(null) // no snapshot today
    snapUpsert().mockResolvedValue({ id: "snap" })
    compute().mockResolvedValue(aggregates())

    const res = await POST(makeReq({ "x-cron-secret": CRON_SECRET }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.created).toBe(2)
    expect(body.skipped).toBe(0)
    expect(snapUpsert()).toHaveBeenCalledTimes(2)

    const firstCall = snapUpsert().mock.calls[0][0]
    expect(firstCall.where.id).toMatch(DAY_ID_RE)
    expect(firstCall.update).toEqual({}) // idempotent — keep first of the day
    expect(firstCall.create).toMatchObject({
      organizationId: "org-1",
      totalProfiles: 569,
      highRiskCount: 2,
      avgEngagement: 18.4,
      dominantLtv: 1_900_000,
      dominantCurrency: "AZN",
      capturedBy: null,
    })
    expect(firstCall.create.id).toBe(firstCall.where.id) // create id == lookup id
    // Computed with the UI's default page size so the snapshot matches the live KPI.
    expect(compute()).toHaveBeenCalledWith("org-1", { limit: 50 })
  })

  it("is idempotent per day — findUnique fast-path skips an org already snapshotted today", async () => {
    orgFindMany().mockResolvedValue([{ id: "org-1" }, { id: "org-2" }])
    snapFindUnique()
      .mockResolvedValueOnce({ id: "org-1:2026-06-02" }) // already today
      .mockResolvedValueOnce(null)
    snapUpsert().mockResolvedValue({ id: "snap" })
    compute().mockResolvedValue(aggregates())

    const res = await POST(makeReq({ "x-cron-secret": CRON_SECRET }))
    const body = await res.json()

    expect(body.created).toBe(1)
    expect(body.skipped).toBe(1)
    expect(snapUpsert()).toHaveBeenCalledTimes(1)
    expect(snapUpsert().mock.calls[0][0].create.organizationId).toBe("org-2")
    // org-1 was skipped before the expensive recompute.
    expect(compute()).toHaveBeenCalledTimes(1)
    expect(compute()).toHaveBeenCalledWith("org-2", { limit: 50 })
  })

  it("isolates per-org failures — one org throwing does not abort the rest", async () => {
    orgFindMany().mockResolvedValue([{ id: "org-bad" }, { id: "org-good" }])
    snapFindUnique().mockResolvedValue(null)
    snapUpsert().mockResolvedValue({ id: "snap" })
    compute()
      .mockRejectedValueOnce(new Error("compute boom"))
      .mockResolvedValueOnce(aggregates())

    const res = await POST(makeReq({ "x-cron-secret": CRON_SECRET }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.created).toBe(1)
    expect(body.errors).toHaveLength(1)
    expect(body.errors[0]).toMatchObject({ organizationId: "org-bad" })
    expect(snapUpsert().mock.calls[0][0].create.organizationId).toBe("org-good")
  })
})
