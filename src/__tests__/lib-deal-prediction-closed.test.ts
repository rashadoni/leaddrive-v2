import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    deal: { findFirst: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
    activity: { findMany: vi.fn() },
    pipelineStage: { findMany: vi.fn() },
  },
}))
vi.mock("@/lib/adaptive-ai/adjustments", () => ({
  applyAdjustment: vi.fn((_o: unknown, _k: unknown, v: number) => v),
  getAdjustment: vi.fn(async () => null),
}))

import { predictDealWin } from "@/lib/ai/predictive"
import { prisma } from "@/lib/prisma"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pr = prisma as any

function setup(stage: string) {
  pr.deal.findFirst.mockResolvedValue({
    id: "d1",
    stage,
    probability: 25,
    valueAmount: 999999,
    createdAt: new Date("2026-07-24"),
    expectedClose: new Date("2027-12-24"),
    pipeline: { stages: [{ name: "WON", probability: 100 }] },
  })
  pr.deal.groupBy.mockResolvedValue([{ stage: "WON" }, { stage: "CLOSED_WON" }, { stage: "LEAD" }])
  pr.pipelineStage.findMany.mockResolvedValue([])
  pr.deal.findMany.mockResolvedValue([])
  pr.activity.findMany.mockResolvedValue([])
}

beforeEach(() => vi.clearAllMocks())

/**
 * The owner opened a deal closed as CLOSED_WON and the card offered him a
 * 44% chance of winning it, next to a risk that nothing had happened on it for
 * 17 days. Both statements were about a race that had already finished.
 */
describe("predictDealWin — закрытая сделка", () => {
  it("для CLOSED_WON возвращает факт, а не прогноз", async () => {
    setup("CLOSED_WON")
    const r = await predictDealWin("d1", "org-1")
    expect(r.winProbability).toBe(100)
    expect(r.confidence).toBe(100)
    expect(r.riskFactors).toEqual([])
  })

  it("для проигранной сделки — ноль без факторов риска", async () => {
    setup("CLOSED_LOST")
    const r = await predictDealWin("d1", "org-1")
    expect(r.winProbability).toBe(0)
    expect(r.riskFactors).toEqual([])
  })

  it("не читает активности закрытой сделки — считать по ним нечего", async () => {
    setup("WON")
    await predictDealWin("d1", "org-1")
    expect(pr.activity.findMany).not.toHaveBeenCalled()
  })

  it("открытую сделку по-прежнему прогнозирует", async () => {
    setup("LEAD")
    const r = await predictDealWin("d1", "org-1")
    expect(pr.activity.findMany).toHaveBeenCalled()
    expect(r.confidence).toBeLessThan(100)
  })
})
