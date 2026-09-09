import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

// Pattern mirrors api-tasks-bulk.test.ts — deals bulk endpoint exposes the
// same shape (`{ ids, action, value }`) so the front-end's EntityBulkBar
// can stay consistent across entities. See Roadmap #19 Phase B.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    deal: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
  logAudit: vi.fn(),
}))

// A12 — update_stage records pipeline_stage_transitions (fire-and-forget).
// Mock the helper so the bulk test stays focused on routing + the args
// handed to the recorder; the recorder itself is unit-tested separately.
vi.mock("@/lib/revenue-intelligence/transition-recorder", () => ({
  recordStageTransitionsForDeals: vi.fn().mockResolvedValue(0),
}))

// Delete branch fires clearTaskRelationsMany (fire-and-forget task back-ref cleanup,
// queries prisma.task — absent from this entity-only prisma mock). Pre-existing gap,
// not the codemod; mock it so the delete happy-path validates auth + org-scoped delete.
vi.mock("@/lib/tasks/clear-task-relations", () => ({
  clearTaskRelationsMany: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((r: any) => r instanceof NextResponse),
}))

vi.mock("@/lib/webhooks", () => ({
  fireWebhooks: vi.fn().mockResolvedValue(undefined),
}))

import { POST } from "@/app/api/v1/deals/bulk/route"
import { prisma } from "@/lib/prisma"
import { requireAuth, isAuthError } from "@/lib/api-auth"
import { recordStageTransitionsForDeals } from "@/lib/revenue-intelligence/transition-recorder"

function makeRequest(body: any) {
  return new Request("http://localhost/api/v1/deals/bulk", {
    method: "POST",
    body: JSON.stringify(body),
  }) as any
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1", userId: "u-1", role: "admin" } as any)
  vi.mocked(isAuthError).mockReturnValue(false)
})

describe("POST /api/v1/deals/bulk → action: delete", () => {
  it("re-checks deals:delete permission separately", async () => {
    // Route does ONE requireAuth (via withRlsAuth "deals","write") + an inline
    // checkPermission(auth.role,"deals","delete"). NOTE: "sales" now HAS deals:delete
    // in the permission matrix, so use "support" (deals:read, no delete) to exercise
    // the delete-gate. Real checkPermission runs (permissions lib not mocked) → 403.
    // requireAuth is mocked (returns the role) → the OUTER write-gate is mocked-through;
    // this test exercises only the inline delete-gate.
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1", userId: "u-1", role: "support" } as any)
    vi.mocked(isAuthError).mockReturnValue(false)

    const res = await POST(makeRequest({ ids: ["d1", "d2"], action: "delete" }))
    expect(res.status).toBe(403)
    expect(prisma.deal.deleteMany).not.toHaveBeenCalled()
  })

  it("deletes scoped by organizationId", async () => {
    const res = await POST(makeRequest({ ids: ["d1", "d2"], action: "delete" }))
    expect(res.status).toBe(200)
    expect(prisma.deal.deleteMany).toHaveBeenCalledOnce()
    const call = vi.mocked(prisma.deal.deleteMany).mock.calls[0][0] as any
    expect(call.where).toEqual({ id: { in: ["d1", "d2"] }, organizationId: "org-1" })
  })
})

describe("POST /api/v1/deals/bulk → action: update_stage", () => {
  it("requires value (returns 400 when missing)", async () => {
    const res = await POST(makeRequest({ ids: ["d1"], action: "update_stage" }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain("stage")
    expect(prisma.deal.updateMany).not.toHaveBeenCalled()
  })

  it("writes new stage + bumps stageChangedAt, scoped to deals not already there", async () => {
    const res = await POST(makeRequest({ ids: ["d1", "d2", "d3"], action: "update_stage", value: "NEGOTIATION" }))
    expect(res.status).toBe(200)
    const call = vi.mocked(prisma.deal.updateMany).mock.calls[0][0] as any
    expect(call.data.stage).toBe("NEGOTIATION")
    expect(call.data.stageChangedAt).toBeInstanceOf(Date)
    expect(call.where.organizationId).toBe("org-1")
    // No-op moves are excluded so stageChangedAt isn't bumped pointlessly.
    expect(call.where.stage).toEqual({ not: "NEGOTIATION" })
  })

  it("records a stage transition per moved deal (waterfall parity)", async () => {
    vi.mocked(prisma.deal.findMany).mockResolvedValueOnce([
      { id: "d1", stage: "PROPOSAL", valueAmount: 1000, currency: "AZN", pipelineId: "p1", stageChangedAt: new Date("2026-01-01") },
      { id: "d2", stage: "LEAD", valueAmount: 500, currency: "USD", pipelineId: null, stageChangedAt: null },
    ] as any)

    const res = await POST(makeRequest({ ids: ["d1", "d2"], action: "update_stage", value: "NEGOTIATION" }))
    expect(res.status).toBe(200)
    expect(recordStageTransitionsForDeals).toHaveBeenCalledOnce()
    const arg = vi.mocked(recordStageTransitionsForDeals).mock.calls[0][1] as any
    expect(arg.organizationId).toBe("org-1")
    expect(arg.toStage).toBe("NEGOTIATION")
    expect(arg.actorUserId).toBe("u-1")
    expect(arg.deals).toEqual([
      { id: "d1", fromStage: "PROPOSAL", amount: 1000, currency: "AZN", pipelineId: "p1", priorStageChangedAt: new Date("2026-01-01") },
      { id: "d2", fromStage: "LEAD", amount: 500, currency: "USD", pipelineId: null, priorStageChangedAt: null },
    ])
  })
})

describe("POST /api/v1/deals/bulk → action: reassign", () => {
  it("assigns to specified user", async () => {
    const res = await POST(makeRequest({ ids: ["d1"], action: "reassign", value: "u-42" }))
    expect(res.status).toBe(200)
    const call = vi.mocked(prisma.deal.updateMany).mock.calls[0][0] as any
    expect(call.data.assignedTo).toBe("u-42")
  })

  it("unassigns when value is empty string (clear ownership)", async () => {
    const res = await POST(makeRequest({ ids: ["d1"], action: "reassign", value: "" }))
    expect(res.status).toBe(200)
    const call = vi.mocked(prisma.deal.updateMany).mock.calls[0][0] as any
    // `value: ""` → null on the DB (architect-cleared FK semantics)
    expect(call.data.assignedTo).toBe(null)
  })
})

describe("POST /api/v1/deals/bulk → validation", () => {
  it("rejects ids array > 100 (bulk-flood guard)", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `d${i}`)
    const res = await POST(makeRequest({ ids, action: "delete" }))
    expect(res.status).toBe(400)
  })

  it("rejects unknown action", async () => {
    const res = await POST(makeRequest({ ids: ["d1"], action: "nuke_everything" }))
    expect(res.status).toBe(400)
  })

  it("rejects empty ids array", async () => {
    const res = await POST(makeRequest({ ids: [], action: "delete" }))
    expect(res.status).toBe(400)
  })
})
