/**
 * C9 manual recompute endpoint tests.
 *
 * Covers: RBAC gate on the real "campaigns" module, org-scoped 404, archived
 * 400, in-flight 409 concurrency guard, and the ASYNC 202 (fire-and-forget —
 * the worker runs off-request and records its own run row, so the route no
 * longer blocks on the sweep nor returns 500 on a worker failure).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: (v: unknown) => v instanceof NextResponse,
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    attributionModel: { findFirst: vi.fn() },
    attributionCalculationRun: { findFirst: vi.fn() },
  },
}))
vi.mock("@/lib/marketing-attribution/recompute-worker", () => ({
  recomputeModel: vi.fn(),
}))

import { POST } from "@/app/api/v1/attribution-models/[id]/recompute/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import { recomputeModel } from "@/lib/marketing-attribution/recompute-worker"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pr = prisma as any
const AUTH = { orgId: "org1", userId: "u1" }
const req = () => new NextRequest("http://localhost/api/v1/attribution-models/m1/recompute", { method: "POST" })
const ctx = (id = "m1") => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(AUTH as never)
  pr.attributionModel.findFirst.mockResolvedValue({ id: "m1", organizationId: "org1", modelType: "linear", config: {}, status: "active" })
  pr.attributionCalculationRun.findFirst.mockResolvedValue(null)
  vi.mocked(recomputeModel).mockResolvedValue({ runId: "run1", status: "succeeded", dealsTotal: 2, dealsProcessed: 2, influencesWritten: 3 } as never)
})

describe("POST /api/v1/attribution-models/[id]/recompute", () => {
  it("gates on the real 'campaigns' RBAC module and 202-queues the recompute", async () => {
    const res = await POST(req(), ctx())
    expect(res.status).toBe(202)
    const json = await res.json()
    expect(json.queued).toBe(true)
    expect(recomputeModel).toHaveBeenCalledWith("org1", expect.objectContaining({ id: "m1" }), {
      triggerSource: "manual",
    })
    expect(requireAuth).toHaveBeenCalledWith(expect.anything(), "campaigns", "write")
  })

  it("404 when the model is not in the tenant", async () => {
    pr.attributionModel.findFirst.mockResolvedValue(null)
    const res = await POST(req(), ctx())
    expect(res.status).toBe(404)
    expect(recomputeModel).not.toHaveBeenCalled()
  })

  it("400 for an archived model", async () => {
    pr.attributionModel.findFirst.mockResolvedValue({ id: "m1", organizationId: "org1", modelType: "linear", config: {}, status: "archived" })
    const res = await POST(req(), ctx())
    expect(res.status).toBe(400)
    expect(recomputeModel).not.toHaveBeenCalled()
  })

  it("409 when a recompute is already in flight for the model", async () => {
    pr.attributionCalculationRun.findFirst.mockResolvedValue({ id: "run-running" })
    const res = await POST(req(), ctx())
    expect(res.status).toBe(409)
    expect(recomputeModel).not.toHaveBeenCalled()
  })

  it("still 202s even when the worker will fail — the failure lands on the run row, not the response", async () => {
    vi.mocked(recomputeModel).mockResolvedValue({ runId: "run1", status: "failed", dealsTotal: 0, dealsProcessed: 0, influencesWritten: 0, errorMessage: "DB exploded" } as never)
    const res = await POST(req(), ctx())
    expect(res.status).toBe(202)
    const json = await res.json()
    expect(json.queued).toBe(true)
    expect(json.error).toBeUndefined()
  })
})
