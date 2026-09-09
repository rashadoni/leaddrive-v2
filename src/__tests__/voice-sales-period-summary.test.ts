import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  pipelineStageFindMany: vi.fn(),
  dealGroupBy: vi.fn(),
  transitionFindMany: vi.fn(),
  dealCount: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    pipelineStage: { findMany: mocks.pipelineStageFindMany },
    deal: { groupBy: mocks.dealGroupBy, count: mocks.dealCount },
    pipelineStageTransition: { findMany: mocks.transitionFindMany },
  },
}))

import { buildSalesPeriodSummary } from "@/lib/ai/voice/summaries"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.pipelineStageFindMany.mockResolvedValue([
    { name: "won", displayName: "Won", isWon: true, isLost: false, sortOrder: 1 },
  ])
  mocks.dealGroupBy.mockResolvedValue([{ stage: "won" }])
  mocks.transitionFindMany.mockResolvedValue([
    {
      id: "transition-1",
      dealId: "deal-1",
      transitionType: "won",
      toAmount: 1_000,
      currency: "AZN",
      transitionedAt: new Date("2026-07-03T08:00:00.000Z"),
    },
    {
      id: "transition-2",
      dealId: "deal-1",
      transitionType: "won",
      toAmount: 1_200,
      currency: "AZN",
      transitionedAt: new Date("2026-07-05T08:00:00.000Z"),
    },
    {
      id: "transition-3",
      dealId: "deal-2",
      transitionType: "lost",
      toAmount: 500,
      currency: "AZN",
      transitionedAt: new Date("2026-07-06T08:00:00.000Z"),
    },
  ])
  mocks.dealCount.mockResolvedValue(2)
})

describe("sales-period summary event boundaries", () => {
  it("uses a half-open transition window and counts only won deals without a won event", async () => {
    const from = new Date("2026-07-01T00:00:00.000Z")
    const toExclusive = new Date("2026-08-01T00:00:00.000Z")

    const result = await buildSalesPeriodSummary("org-1", from, toExclusive, "июль 2026")

    expect(mocks.transitionFindMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        transitionType: { in: ["won", "lost"] },
        transitionedAt: { gte: from, lt: toExclusive },
      },
      select: {
        id: true,
        dealId: true,
        transitionType: true,
        toAmount: true,
        currency: true,
        transitionedAt: true,
      },
    })
    expect(mocks.dealCount).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        stage: { in: ["WON", "won"] },
        stageTransitions: { none: { transitionType: "won" } },
      },
    })
    expect(result).toMatchObject({
      from: from.toISOString(),
      to: "2026-07-31T23:59:59.999Z",
      wonCount: 1,
      lostCount: 1,
      money: { amount: 1_200, currency: "AZN", mixedCurrencies: false },
      wonDealsWithoutHistory: 2,
    })
  })
})
