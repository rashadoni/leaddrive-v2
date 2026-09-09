/**
 * C9 recompute-worker tests (Phase 3).
 *
 * Drives the full pipeline through the REAL pure helpers (evaluator →
 * aggregator → allocator) with prisma mocked, asserting: won-stage resolution
 * (PipelineStage.isWon + "WON" fallback), relevance touchpoint gather, the
 * evaluate→aggregate→allocate math landing in upserts, stale-influence
 * deletion, the run lifecycle (pending→running→succeeded), and the failure
 * path (→failed with errorMessage, never throws).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => {
  const m = {
    pipelineStage: { findMany: vi.fn() },
    deal: { findMany: vi.fn() },
    contact: { findMany: vi.fn() },
    campaignTouchpoint: { findMany: vi.fn() },
    attributionCalculationRun: { create: vi.fn(), update: vi.fn() },
    campaignInfluence: { upsert: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(m)),
  }
  return { prisma: m }
})

import { recomputeModel } from "@/lib/marketing-attribution/recompute-worker"
import { prisma } from "@/lib/prisma"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pr = prisma as any

const MODEL = { id: "m1", organizationId: "org1", modelType: "linear", config: {} }

beforeEach(() => {
  vi.clearAllMocks()
  pr.attributionCalculationRun.create.mockResolvedValue({ id: "run1" })
  pr.attributionCalculationRun.update.mockResolvedValue({})
  pr.campaignInfluence.upsert.mockResolvedValue({})
  pr.campaignInfluence.deleteMany.mockResolvedValue({ count: 0 })
  // wonStageNames queries isWon:true, lostStageNames queries isLost:true — return
  // distinct sets so the #18 won/open/lost partition is exercised.
  pr.pipelineStage.findMany.mockImplementation((args: { where?: { isWon?: boolean; isLost?: boolean } }) =>
    args?.where?.isWon ? [{ name: "Closed Won" }] : args?.where?.isLost ? [{ name: "Closed Lost" }] : [],
  )
  pr.contact.findMany.mockResolvedValue([])
})

describe("recomputeModel", () => {
  it("fetches all non-lost deals (won ∪ open), excluding lost stages (#18)", async () => {
    pr.deal.findMany.mockResolvedValue([])
    await recomputeModel("org1", MODEL, { triggerSource: "manual" })
    const where = pr.deal.findMany.mock.calls[0]![0].where
    expect(where.organizationId).toBe("org1")
    // lostStageNames = isLost ∪ "LOST"; the query excludes those.
    expect(new Set(where.stage.notIn)).toEqual(new Set(["Closed Lost", "LOST"]))
  })

  it("linear: splits one deal's revenue across two campaigns and upserts", async () => {
    pr.deal.findMany.mockResolvedValue([
      {
        id: "d1",
        stage: "WON",
        valueAmount: 1000,
        contactId: "c1",
        stageChangedAt: new Date("2026-02-01"),
        updatedAt: new Date("2026-02-02"),
        contactRoles: [],
      },
    ])
    pr.campaignTouchpoint.findMany.mockResolvedValue([
      { id: "t1", campaignId: "cam1", occurredAt: new Date("2026-01-01") },
      { id: "t2", campaignId: "cam2", occurredAt: new Date("2026-01-15") },
    ])

    const res = await recomputeModel("org1", MODEL, { triggerSource: "manual" })

    expect(res.status).toBe("succeeded")
    expect(res.dealsTotal).toBe(1)
    expect(res.dealsProcessed).toBe(1)
    expect(res.influencesWritten).toBe(2)

    // Two influence upserts, 0.5 weight + 500 revenue each (linear over 2 tps).
    expect(pr.campaignInfluence.upsert).toHaveBeenCalledTimes(2)
    const byCampaign = Object.fromEntries(
      pr.campaignInfluence.upsert.mock.calls.map((c: any[]) => [
        c[0].where.dealId_campaignId_modelId.campaignId,
        c[0].create,
      ]),
    )
    expect(byCampaign.cam1).toMatchObject({ dealId: "d1", modelId: "m1", weight: 0.5, attributedRevenue: 500, touchpointCount: 1 })
    expect(byCampaign.cam2).toMatchObject({ weight: 0.5, attributedRevenue: 500 })
  })

  it("gathers relevant touchpoints (linked OR unlinked-by-contact up to conversion)", async () => {
    pr.deal.findMany.mockResolvedValue([
      {
        id: "d1",
        stage: "WON",
        valueAmount: 0,
        contactId: "c1",
        stageChangedAt: new Date("2026-02-01"),
        updatedAt: new Date("2026-02-02"),
        contactRoles: [{ contactId: "c2" }],
      },
    ])
    pr.campaignTouchpoint.findMany.mockResolvedValue([])
    await recomputeModel("org1", MODEL, { triggerSource: "manual" })
    const where = pr.campaignTouchpoint.findMany.mock.calls[0]![0].where
    expect(where.organizationId).toBe("org1")
    expect(where.OR[0]).toEqual({ dealId: "d1" })
    expect(where.OR[1]).toMatchObject({ dealId: null, occurredAt: { lte: new Date("2026-02-01") } })
    expect(new Set(where.OR[1].contactId.in)).toEqual(new Set(["c1", "c2"]))
  })

  it("rolls up company contacts' touchpoints (account-based, deal has no direct contact)", async () => {
    pr.deal.findMany.mockResolvedValue([
      { id: "d1", stage: "WON", valueAmount: 500, contactId: null, companyId: "co1", stageChangedAt: null, updatedAt: new Date(), contactRoles: [] },
    ])
    pr.contact.findMany.mockResolvedValue([
      { id: "cc1", companyId: "co1" },
      { id: "cc2", companyId: "co1" },
    ])
    pr.campaignTouchpoint.findMany.mockResolvedValue([])
    await recomputeModel("org1", MODEL, { triggerSource: "manual" })
    // company contacts fetched once, batched by the deal's company
    expect(pr.contact.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org1", companyId: { in: ["co1"] } },
      select: { id: true, companyId: true },
    })
    // the touchpoint gather includes the company's contacts in the IN clause
    const where = pr.campaignTouchpoint.findMany.mock.calls[0]![0].where
    expect(new Set(where.OR[1].contactId.in)).toEqual(new Set(["cc1", "cc2"]))
  })

  it("config.accountRollup=false narrows to the deal's own contacts (skips the company sibling roll-up)", async () => {
    pr.deal.findMany.mockResolvedValue([
      { id: "d1", stage: "WON", valueAmount: 500, contactId: "c1", companyId: "co1", stageChangedAt: null, updatedAt: new Date(), contactRoles: [{ contactId: "c2" }] },
    ])
    pr.contact.findMany.mockResolvedValue([
      { id: "c1", companyId: "co1" },
      { id: "sibling", companyId: "co1" }, // would be rolled up under the default
    ])
    pr.campaignTouchpoint.findMany.mockResolvedValue([])
    await recomputeModel("org1", { ...MODEL, config: { accountRollup: false } }, { triggerSource: "manual" })
    // prefetch skipped — no company-contacts query when rollup is off
    expect(pr.contact.findMany).not.toHaveBeenCalled()
    // gather = the deal's own contact + its contact-roles only, NOT the sibling
    const where = pr.campaignTouchpoint.findMany.mock.calls[0]![0].where
    expect(new Set(where.OR[1].contactId.in)).toEqual(new Set(["c1", "c2"]))
  })

  it("deletes stale influences for campaigns that dropped out", async () => {
    pr.deal.findMany.mockResolvedValue([
      { id: "d1", stage: "WON", valueAmount: 100, contactId: "c1", stageChangedAt: null, updatedAt: new Date(), contactRoles: [] },
    ])
    pr.campaignTouchpoint.findMany.mockResolvedValue([
      { id: "t1", campaignId: "cam1", occurredAt: new Date("2026-01-01") },
    ])
    await recomputeModel("org1", MODEL, { triggerSource: "manual" })
    const del = pr.campaignInfluence.deleteMany.mock.calls[0]![0].where
    expect(del).toMatchObject({ organizationId: "org1", dealId: "d1", modelId: "m1" })
    expect(del.campaignId.notIn).toEqual(["cam1"])
  })

  it("keeps a single-campaign deal's weight within the [0,1] DB CHECK", async () => {
    // 9 untyped touchpoints all on cam1 → after linear + engagement renormalize
    // the campaign holds ~100% credit, landing a hair off 1.0 in IEEE-754
    // (the worker's Math.min(1, …) clamp guards the weight<=1 CHECK either way).
    pr.deal.findMany.mockResolvedValue([
      { id: "d1", stage: "WON", valueAmount: 100, contactId: "c1", stageChangedAt: null, updatedAt: new Date(), contactRoles: [] },
    ])
    pr.campaignTouchpoint.findMany.mockResolvedValue(
      Array.from({ length: 9 }, (_, i) => ({ id: `t${i}`, campaignId: "cam1", occurredAt: new Date(2026, 0, i + 1) })),
    )
    const res = await recomputeModel("org1", MODEL, { triggerSource: "manual" })
    expect(res.status).toBe("succeeded")
    const w = pr.campaignInfluence.upsert.mock.calls[0]![0].create.weight
    expect(w).toBeLessThanOrEqual(1)
    expect(w).toBeCloseTo(1, 10)
  })

  it("#12 engagement-weights a click over a send, and collapses same-type repeats", async () => {
    pr.deal.findMany.mockResolvedValue([
      { id: "d1", stage: "WON", valueAmount: 600, contactId: "c1", stageChangedAt: null, updatedAt: new Date(), contactRoles: [] },
    ])
    pr.campaignTouchpoint.findMany.mockResolvedValue([
      { id: "t1", campaignId: "cam1", occurredAt: new Date("2026-01-01"), touchpointType: "email_clicked" },
      { id: "t2", campaignId: "cam2", occurredAt: new Date("2026-01-02"), touchpointType: "email_sent" },
      { id: "t3", campaignId: "cam2", occurredAt: new Date("2026-01-03"), touchpointType: "email_sent" }, // dup → collapses with t2
    ])
    const res = await recomputeModel("org1", MODEL, { triggerSource: "manual" })
    expect(res.status).toBe("succeeded")
    // Dedup → cam1(clicked) + cam2(one send). Linear 0.5/0.5 → engagement
    // [1.0, 0.2] → renormalize [5/6, 1/6]. Revenue 600 → 500 / 100.
    const byCampaign = Object.fromEntries(
      pr.campaignInfluence.upsert.mock.calls.map((c: any[]) => [
        c[0].where.dealId_campaignId_modelId.campaignId,
        c[0].create,
      ]),
    )
    expect(byCampaign.cam1.weight).toBeCloseTo(5 / 6, 6)
    expect(byCampaign.cam2.weight).toBeCloseTo(1 / 6, 6)
    expect(byCampaign.cam1.attributedRevenue).toBe(500)
    expect(byCampaign.cam2.attributedRevenue).toBe(100)
    expect(byCampaign.cam2.touchpointCount).toBe(1) // two sends collapsed
  })

  it("#18 attributes an OPEN deal as pipeline at probability-weighted value", async () => {
    pr.deal.findMany.mockResolvedValue([
      // "QUALIFIED" is neither won nor lost → open → pipeline, 40% probability.
      { id: "d9", stage: "QUALIFIED", probability: 40, valueAmount: 1000, contactId: "c1", companyId: null, stageChangedAt: null, updatedAt: new Date(), contactRoles: [] },
    ])
    pr.campaignTouchpoint.findMany.mockResolvedValue([
      { id: "t1", campaignId: "cam1", occurredAt: new Date("2026-01-01"), touchpointType: "email_clicked" },
    ])
    const res = await recomputeModel("org1", MODEL, { triggerSource: "manual" })
    expect(res.status).toBe("succeeded")
    const create = pr.campaignInfluence.upsert.mock.calls[0]![0].create
    expect(create.kind).toBe("pipeline")
    expect(create.weight).toBeCloseTo(1, 10) // single campaign
    expect(create.attributedRevenue).toBe(400) // 1000 × 40% expected value
  })

  it("#18 clears influences for deals no longer won/open (lost-deal cleanup)", async () => {
    pr.deal.findMany.mockResolvedValue([]) // all deals now lost/gone
    await recomputeModel("org1", MODEL, { triggerSource: "manual" })
    // The org+model cleanup deleteMany runs with an empty processed set
    // (dealId notIn []) → clears every influence for the model.
    const cleanup = pr.campaignInfluence.deleteMany.mock.calls.find(
      (c: any[]) => c[0].where.dealId?.notIn !== undefined && c[0].where.campaignId === undefined,
    )
    expect(cleanup).toBeTruthy()
    expect(cleanup![0].where).toMatchObject({ organizationId: "org1", modelId: "m1" })
    expect(cleanup![0].where.dealId.notIn).toEqual([])
  })

  it("drives the run lifecycle pending → running → succeeded", async () => {
    pr.deal.findMany.mockResolvedValue([])
    await recomputeModel("org1", MODEL, { triggerSource: "cron" })
    expect(pr.attributionCalculationRun.create.mock.calls[0]![0].data).toMatchObject({
      organizationId: "org1",
      modelId: "m1",
      status: "pending",
      triggerSource: "cron",
    })
    const updates = pr.attributionCalculationRun.update.mock.calls.map((c: any[]) => c[0].data)
    expect(updates[0]).toMatchObject({ status: "running" })
    expect(updates[0].startedAt).toBeInstanceOf(Date)
    expect(updates[1]).toMatchObject({ status: "succeeded", dealsTotal: 0, dealsProcessed: 0, influencesWritten: 0 })
    expect(updates[1].endedAt).toBeInstanceOf(Date)
  })

  it("marks the run failed (never throws) when a query errors", async () => {
    pr.deal.findMany.mockRejectedValue(new Error("DB exploded"))
    const res = await recomputeModel("org1", MODEL, { triggerSource: "manual" })
    expect(res.status).toBe("failed")
    expect(res.errorMessage).toContain("DB exploded")
    const lastUpdate = pr.attributionCalculationRun.update.mock.calls.at(-1)![0].data
    expect(lastUpdate).toMatchObject({ status: "failed" })
    expect(lastUpdate.errorMessage).toContain("DB exploded")
    expect(lastUpdate.endedAt).toBeInstanceOf(Date)
  })

  it("reports REAL partial counts when a deal transaction fails mid-loop", async () => {
    pr.deal.findMany.mockResolvedValue([
      { id: "d1", stage: "WON", valueAmount: 100, contactId: "c1", stageChangedAt: null, updatedAt: new Date(), contactRoles: [] },
      { id: "d2", stage: "WON", valueAmount: 200, contactId: "c2", stageChangedAt: null, updatedAt: new Date(), contactRoles: [] },
    ])
    pr.campaignTouchpoint.findMany.mockResolvedValue([
      { id: "t1", campaignId: "cam1", occurredAt: new Date("2026-01-01") },
    ])
    // First deal's transaction commits; the second one throws.
    let call = 0
    pr.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      call++
      if (call === 2) throw new Error("tx boom on deal 2")
      return cb(pr)
    })

    const res = await recomputeModel("org1", MODEL, { triggerSource: "manual" })

    expect(res.status).toBe("failed")
    expect(res.errorMessage).toContain("boom")
    // Real partials, NOT zeros: deal 1 processed (1 influence), deal 2 failed.
    expect(res.dealsTotal).toBe(2)
    expect(res.dealsProcessed).toBe(1)
    expect(res.influencesWritten).toBe(1)
    const lastUpdate = pr.attributionCalculationRun.update.mock.calls.at(-1)![0].data
    expect(lastUpdate).toMatchObject({ status: "failed", dealsTotal: 2, dealsProcessed: 1, influencesWritten: 1 })

    // Restore the default $transaction passthrough for any later test.
    pr.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(pr))
  })
})
