/**
 * C9 #17 — attribution incremental recompute drainer.
 *
 * Recomputes only the dirty (recomputeRequestedAt set) active models, then
 * compare-and-clears the marker. Verifies the recompute call + the
 * compare-and-clear guard (only clears the exact captured timestamp) + cron auth.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    attributionModel: { findMany: vi.fn(), updateMany: vi.fn() },
  },
}))
vi.mock("@/lib/cron-auth", () => ({ requireCronAuth: vi.fn(() => null) }))
vi.mock("@/lib/marketing-attribution/recompute-worker", () => ({
  recomputeModel: vi.fn(async () => ({ status: "succeeded", influencesWritten: 3 })),
}))

import { POST } from "@/app/api/cron/attribution-drain/route"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { recomputeModel } from "@/lib/marketing-attribution/recompute-worker"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pr = prisma as any
const req = () => new NextRequest("http://localhost/api/cron/attribution-drain", { method: "POST" })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireCronAuth).mockReturnValue(null)
  pr.attributionModel.updateMany.mockResolvedValue({ count: 1 })
})

describe("C9 #17 — attribution-drain cron", () => {
  it("recomputes each dirty model and compare-and-clears its exact marker", async () => {
    const ts = new Date("2026-03-01T10:00:00Z")
    pr.attributionModel.findMany.mockResolvedValue([
      { id: "m1", organizationId: "org-1", modelType: "linear", config: {}, recomputeRequestedAt: ts },
    ])

    const res = await POST(req())
    const json = await res.json()

    expect(json.ok).toBe(true)
    expect(json.modelsRun).toBe(1)
    expect(json.succeeded).toBe(1)
    // queried only dirty active models
    expect(pr.attributionModel.findMany.mock.calls[0][0].where).toMatchObject({
      status: "active",
      recomputeRequestedAt: { not: null },
    })
    expect(recomputeModel).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ id: "m1" }),
      { triggerSource: "cron" },
    )
    // compare-and-clear: clears only if the marker still equals the captured ts
    expect(pr.attributionModel.updateMany).toHaveBeenCalledWith({
      where: { id: "m1", recomputeRequestedAt: ts },
      data: { recomputeRequestedAt: null },
    })
  })

  it("no dirty models → modelsRun 0, no recompute", async () => {
    pr.attributionModel.findMany.mockResolvedValue([])
    const res = await POST(req())
    const json = await res.json()
    expect(json.modelsRun).toBe(0)
    expect(recomputeModel).not.toHaveBeenCalled()
    expect(pr.attributionModel.updateMany).not.toHaveBeenCalled()
  })

  it("still clears the marker (counts failed) when a recompute throws", async () => {
    vi.mocked(recomputeModel).mockRejectedValueOnce(new Error("boom"))
    const ts = new Date("2026-03-02T10:00:00Z")
    pr.attributionModel.findMany.mockResolvedValue([
      { id: "m2", organizationId: "org-1", modelType: "linear", config: {}, recomputeRequestedAt: ts },
    ])
    const res = await POST(req())
    const json = await res.json()
    expect(json.failed).toBe(1)
    expect(json.errors[0]).toMatchObject({ modelId: "m2", error: "boom" })
    // marker still compare-and-cleared so a permanently-failing model isn't a hot loop
    expect(pr.attributionModel.updateMany).toHaveBeenCalledWith({
      where: { id: "m2", recomputeRequestedAt: ts },
      data: { recomputeRequestedAt: null },
    })
  })

  it("propagates cron-auth failure", async () => {
    vi.mocked(requireCronAuth).mockReturnValue(
      new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }) as never,
    )
    const res = await POST(req())
    expect(res.status).toBe(401)
    expect(pr.attributionModel.findMany).not.toHaveBeenCalled()
  })
})
