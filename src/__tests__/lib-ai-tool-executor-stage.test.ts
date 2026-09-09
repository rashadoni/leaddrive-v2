/**
 * A12 — AI tool path parity. `executeTool("update_deal_stage", …)` must
 * record a pipeline_stage_transition and gate stageChangedAt on a REAL
 * stage change, same as the REST / bulk / sandbox paths.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    deal: {
      findFirst: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    aiPendingAction: { create: vi.fn() },
  },
  logAudit: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }))

vi.mock("@/lib/revenue-intelligence/transition-recorder", () => ({
  recordStageTransition: vi.fn().mockResolvedValue("t-1"),
}))

import { executeTool } from "@/lib/ai/tool-executor"
import { prisma } from "@/lib/prisma"
import { recordStageTransition } from "@/lib/revenue-intelligence/transition-recorder"

const baseDeal = {
  id: "d1",
  organizationId: "org-1",
  stage: "LEAD",
  valueAmount: 1000,
  currency: "AZN",
  pipelineId: "p1",
  stageChangedAt: new Date("2026-01-01"),
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("executeTool: update_deal_stage", () => {
  it("records a transition + bumps stageChangedAt on a real stage change", async () => {
    vi.mocked(prisma.deal.findFirst).mockResolvedValue({ ...baseDeal } as any)

    const res = await executeTool(
      "update_deal_stage",
      { dealId: "d1", stage: "QUALIFIED" },
      "org-1",
      "u-1",
      true, // skip approval gate
    )
    expect(res.success).toBe(true)

    const updateArg = vi.mocked(prisma.deal.update).mock.calls[0][0] as any
    expect(updateArg.data.stage).toBe("QUALIFIED")
    expect(updateArg.data.stageChangedAt).toBeInstanceOf(Date)

    expect(recordStageTransition).toHaveBeenCalledOnce()
    const rec = vi.mocked(recordStageTransition).mock.calls[0][1] as any
    expect(rec).toMatchObject({
      organizationId: "org-1",
      dealId: "d1",
      fromStage: "LEAD",
      toStage: "QUALIFIED",
      fromAmount: 1000,
      toAmount: 1000,
      currency: "AZN",
      pipelineId: "p1",
      actorUserId: "u-1",
    })
  })

  it("no-op move: does NOT bump stageChangedAt and records nothing", async () => {
    vi.mocked(prisma.deal.findFirst).mockResolvedValue({ ...baseDeal } as any)

    const res = await executeTool(
      "update_deal_stage",
      { dealId: "d1", stage: "LEAD" }, // same as current
      "org-1",
      "u-1",
      true,
    )
    expect(res.success).toBe(true)

    const updateArg = vi.mocked(prisma.deal.update).mock.calls[0][0] as any
    expect(updateArg.data.stage).toBe("LEAD")
    expect(updateArg.data.stageChangedAt).toBeUndefined()
    expect(recordStageTransition).not.toHaveBeenCalled()
  })

  it("deal not found → error, no write, no transition", async () => {
    vi.mocked(prisma.deal.findFirst).mockResolvedValue(null as any)

    const res = await executeTool(
      "update_deal_stage",
      { dealId: "ghost", stage: "QUALIFIED" },
      "org-1",
      "u-1",
      true,
    )
    expect(res.success).toBe(false)
    expect(prisma.deal.update).not.toHaveBeenCalled()
    expect(recordStageTransition).not.toHaveBeenCalled()
  })
})
