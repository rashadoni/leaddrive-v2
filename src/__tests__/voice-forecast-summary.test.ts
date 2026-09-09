import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  pipelineStageFindMany: vi.fn(),
  salesQuotaFindMany: vi.fn(),
  transitionFindMany: vi.fn(),
  dealCount: vi.fn(),
  dealGroupBy: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    pipelineStage: { findMany: mocks.pipelineStageFindMany },
    salesQuota: { findMany: mocks.salesQuotaFindMany },
    pipelineStageTransition: { findMany: mocks.transitionFindMany },
    deal: { count: mocks.dealCount, groupBy: mocks.dealGroupBy },
  },
}))

import { buildForecastSummary } from "@/lib/ai/voice/summaries"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.pipelineStageFindMany
    .mockResolvedValueOnce([
      { name: "won", displayName: "Won", isWon: true, isLost: false, sortOrder: 1 },
      { name: "open", displayName: "Open", isWon: false, isLost: false, sortOrder: 0 },
    ])
    .mockResolvedValueOnce([
      { name: "won", probability: 100 },
      { name: "open", probability: 50 },
    ])
  mocks.salesQuotaFindMany.mockResolvedValue([{ amount: 5_000, currency: "AZN" }])
  mocks.transitionFindMany.mockResolvedValue([
    {
      id: "transition-1",
      dealId: "deal-1",
      toAmount: 1_000,
      currency: "AZN",
      transitionedAt: new Date("2026-08-03T08:00:00.000Z"),
    },
    {
      id: "transition-2",
      dealId: "deal-1",
      toAmount: 1_200,
      currency: "AZN",
      transitionedAt: new Date("2026-08-05T08:00:00.000Z"),
    },
    {
      id: "transition-3",
      dealId: "deal-2",
      toAmount: 800,
      currency: "AZN",
      transitionedAt: new Date("2026-08-06T08:00:00.000Z"),
    },
  ])
  mocks.dealCount.mockResolvedValue(3)
  mocks.dealGroupBy.mockResolvedValue([
    { stage: "open", currency: "AZN", _count: { _all: 2 }, _sum: { valueAmount: 4_000 } },
  ])
})

describe("voice forecast uses immutable win events", () => {
  it("attributes won value by transitionedAt and surfaces incomplete history", async () => {
    const from = new Date("2026-07-01T00:00:00.000Z")
    const toExclusive = new Date("2026-08-12T08:00:00.000Z")
    const pipelineToExclusive = new Date("2026-09-30T20:00:00.000Z")

    const result = await buildForecastSummary("org-1", toExclusive, {
      from,
      toExclusive,
      timezone: "Asia/Baku",
      label: "2026-07-01—2026-08-12",
    }, pipelineToExclusive)

    expect(mocks.transitionFindMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        transitionType: "won",
        transitionedAt: { gte: from, lt: toExclusive },
        deal: { is: { stage: { in: ["won"] } } },
      },
      select: {
        id: true,
        dealId: true,
        toAmount: true,
        currency: true,
        transitionedAt: true,
      },
    })
    expect(mocks.dealCount).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        stage: { in: ["won"] },
        stageTransitions: { none: { transitionType: "won" } },
      },
    })
    expect(mocks.dealGroupBy).toHaveBeenCalledTimes(1)
    expect(mocks.dealGroupBy.mock.calls[0]?.[0]?.where).not.toHaveProperty("updatedAt")
    expect(mocks.dealGroupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        expectedClose: { gte: from, lt: pipelineToExclusive },
      }),
    }))
    expect(result).toMatchObject({
      year: 2026,
      quarter: 3,
      currency: "AZN",
      quotaTotal: 5_000,
      wonThisQuarter: 2_000,
      openWeighted: 2_000,
      openTotal: 4_000,
      wonDealsWithoutHistory: 3,
    })
  })
})
