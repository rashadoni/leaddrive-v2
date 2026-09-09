/**
 * Tests for the A12 transition-recorder pure helpers.
 * Slice-2 hook called from /api/v1/deals/[id] PUT route.
 */
import { describe, expect, it, vi } from "vitest"
import {
  classifyStageTransition,
  computeDurationSeconds,
  recordStageTransitionsForDeals,
} from "@/lib/revenue-intelligence/transition-recorder"
import { DEFAULT_STAGE_PROBABILITIES } from "@/lib/revenue-intelligence/types"

describe("A12 transition-recorder — classifyStageTransition", () => {
  it("toStage=WON → won (regardless of fromStage)", () => {
    expect(classifyStageTransition("PROPOSAL", "WON")).toBe("won")
    expect(classifyStageTransition("LEAD", "WON")).toBe("won")
    expect(classifyStageTransition("NEGOTIATION", "WON")).toBe("won")
  })

  it("toStage=LOST → lost", () => {
    expect(classifyStageTransition("PROPOSAL", "LOST")).toBe("lost")
    expect(classifyStageTransition("QUALIFIED", "LOST")).toBe("lost")
  })

  it("fromStage IN (WON, LOST) + toStage non-terminal → reopened", () => {
    expect(classifyStageTransition("WON", "PROPOSAL")).toBe("reopened")
    expect(classifyStageTransition("LOST", "QUALIFIED")).toBe("reopened")
  })

  it("WON → LOST is treated as lost (terminal takes precedence)", () => {
    expect(classifyStageTransition("WON", "LOST")).toBe("lost")
  })

  it("forward probability move → advanced", () => {
    expect(classifyStageTransition("LEAD", "QUALIFIED")).toBe("advanced")
    expect(classifyStageTransition("QUALIFIED", "PROPOSAL")).toBe("advanced")
    expect(classifyStageTransition("PROPOSAL", "NEGOTIATION")).toBe("advanced")
  })

  it("backward probability move → regressed", () => {
    expect(classifyStageTransition("NEGOTIATION", "PROPOSAL")).toBe("regressed")
    expect(classifyStageTransition("PROPOSAL", "QUALIFIED")).toBe("regressed")
    expect(classifyStageTransition("QUALIFIED", "LEAD")).toBe("regressed")
  })

  it("equal-probability stages default to advanced", () => {
    const probs = { ...DEFAULT_STAGE_PROBABILITIES, OTHER: 0.25 }
    // QUALIFIED has 0.15 probability, OTHER has 0.25 — that's advanced.
    // But same-probability case:
    const equal = { ...DEFAULT_STAGE_PROBABILITIES, ALT: 0.15 }
    expect(classifyStageTransition("QUALIFIED", "ALT", equal)).toBe("advanced")
  })

  it("unknown stages default to advanced (conservative)", () => {
    expect(classifyStageTransition("MYSTERY1", "MYSTERY2")).toBe("advanced")
  })

  it("custom probability map respected", () => {
    const custom = { A: 0.1, B: 0.9 }
    expect(classifyStageTransition("A", "B", custom)).toBe("advanced")
    expect(classifyStageTransition("B", "A", custom)).toBe("regressed")
  })
})

describe("A12 transition-recorder — computeDurationSeconds", () => {
  it("returns elapsed seconds between two dates", () => {
    const a = new Date("2026-05-19T10:00:00Z")
    const b = new Date("2026-05-19T11:00:00Z")
    expect(computeDurationSeconds(a, b)).toBe(3600)
  })

  it("null prior → null", () => {
    expect(computeDurationSeconds(null, new Date())).toBeNull()
    expect(computeDurationSeconds(undefined, new Date())).toBeNull()
  })

  it("negative duration (clock skew) → null", () => {
    const future = new Date("2026-05-19T11:00:00Z")
    const past = new Date("2026-05-19T10:00:00Z")
    expect(computeDurationSeconds(future, past)).toBeNull()
  })

  it("floors to whole seconds", () => {
    const a = new Date("2026-05-19T10:00:00.000Z")
    const b = new Date("2026-05-19T10:00:01.999Z")
    expect(computeDurationSeconds(a, b)).toBe(1) // not 2
  })
})

describe("A12 transition-recorder — recordStageTransitionsForDeals", () => {
  function makePrismaSpy() {
    const created: any[] = []
    const prisma = {
      pipelineStageTransition: {
        create: vi.fn(async ({ data }: any) => {
          created.push(data)
          return { id: `t-${created.length}` }
        }),
      },
    }
    return { prisma, created }
  }

  it("writes one row per deal whose stage changed, skips no-op moves", async () => {
    const { prisma, created } = makePrismaSpy()
    const n = await recordStageTransitionsForDeals(prisma, {
      organizationId: "org-1",
      toStage: "NEGOTIATION",
      actorUserId: "u-1",
      deals: [
        { id: "d1", fromStage: "PROPOSAL", amount: 1000, currency: "AZN", pipelineId: "p1", priorStageChangedAt: null },
        { id: "d2", fromStage: "NEGOTIATION", amount: 200 }, // already there → skipped
        { id: "d3", fromStage: "LEAD", amount: 50 },
      ],
    })
    expect(n).toBe(2)
    expect(prisma.pipelineStageTransition.create).toHaveBeenCalledTimes(2)
    expect(created.map((c) => c.dealId)).toEqual(["d1", "d3"])
    // Stage move keeps the value constant → fromAmount === toAmount.
    expect(created[0]).toMatchObject({
      organizationId: "org-1",
      dealId: "d1",
      fromStage: "PROPOSAL",
      toStage: "NEGOTIATION",
      transitionType: "advanced",
      fromAmount: 1000,
      toAmount: 1000,
      currency: "AZN",
      pipelineId: "p1",
      actorUserId: "u-1",
    })
  })

  it("returns 0 when every move is a no-op", async () => {
    const { prisma } = makePrismaSpy()
    const n = await recordStageTransitionsForDeals(prisma, {
      organizationId: "org-1",
      toStage: "WON",
      deals: [{ id: "d1", fromStage: "WON", amount: 10 }],
    })
    expect(n).toBe(0)
    expect(prisma.pipelineStageTransition.create).not.toHaveBeenCalled()
  })
})

describe("classifyStageTransition — написание стадии", () => {
  it("считает CLOSED_WON победой, а не продвижением", () => {
    expect(classifyStageTransition("PROPOSAL", "CLOSED_WON")).toBe("won")
    expect(classifyStageTransition("PROPOSAL", "CLOSED_LOST")).toBe("lost")
  })

  it("видит возврат из закрытой стадии как переоткрытие при любом написании", () => {
    expect(classifyStageTransition("CLOSED_WON", "NEGOTIATION")).toBe("reopened")
  })

  it("принимает стадию, названную организацией по-своему", () => {
    expect(classifyStageTransition("PROPOSAL", "Müqavilə imzalandı", undefined, ["Müqavilə imzalandı"])).toBe("won")
    expect(classifyStageTransition("PROPOSAL", "İmtina", undefined, [], ["İmtina"])).toBe("lost")
  })
})
