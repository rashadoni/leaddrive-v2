import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))

vi.mock("@/lib/mtm-audit", () => ({
  writeMtmAudit: vi.fn(() => Promise.resolve()),
}))

import { POST as createPolicy } from "@/app/api/v1/mtm/visit-policies/route"
import { POST as previewPolicy } from "@/app/api/v1/mtm/visit-policies/preview/route"
import { POST as createActionResult } from "@/app/api/v1/mtm/visits/[id]/actions/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"

const auth = { orgId: "org-1", userId: "admin-user", role: "admin", email: "admin@example.com", name: "Admin" }

function request(path: string, body: unknown) {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(auth as never)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
})

describe("visit policy API", () => {
  it("blocks policy writes when the rollout flag is disabled", async () => {
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{ key: "visitPoliciesEnabled", value: false }] as never)

    const response = await createPolicy(request("/api/v1/mtm/visit-policies", {
      name: "Disabled policy",
      visitType: "DOCTOR_VISIT",
      priority: 100,
      effectiveFrom: "2026-07-13T00:00:00.000Z",
      isActive: true,
      actions: [],
    }))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_VISIT_POLICIES_DISABLED" })
    expect(prisma.mtmVisitPolicy.create).not.toHaveBeenCalled()
  })

  it("rejects an overlapping active policy at the same scope and priority", async () => {
    vi.mocked(prisma.mtmVisitPolicy.findFirst).mockResolvedValue({ id: "policy-existing", name: "Existing" } as never)
    const response = await createPolicy(request("/api/v1/mtm/visit-policies", {
      name: "Medical representatives",
      teamId: null,
      visitType: "DOCTOR_VISIT",
      priority: 100,
      effectiveFrom: "2026-07-13T00:00:00.000Z",
      effectiveTo: null,
      isActive: true,
      actions: [],
    }))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_POLICY_WINDOW_CONFLICT" })
    expect(prisma.mtmVisitPolicy.create).not.toHaveBeenCalled()
  })

  it("previews the same resolved rule used by check-in", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", teamId: "team-1" } as never)
    vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue({ id: "customer-1", category: "A", objectType: "DOCTOR" } as never)
    vi.mocked(prisma.mtmVisitPolicy.findMany).mockResolvedValue([{
      id: "policy-1",
      name: "Doctor visits",
      teamId: "team-1",
      visitType: "DOCTOR_VISIT",
      priority: 10,
      effectiveFrom: new Date("2026-01-01"),
      actions: [{ actionKey: "PRESENTATION", mode: "REQUIRED", minCount: 1, conditions: null, allowWaiver: false }],
    }] as never)

    const response = await previewPolicy(request("/api/v1/mtm/visit-policies/preview", {
      agentId: "agent-1",
      customerId: "customer-1",
      visitType: "DOCTOR_VISIT",
    }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.sourcePolicyId).toBe("policy-1")
    expect(body.data.requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ actionKey: "PRESENTATION", mode: "REQUIRED" }),
    ]))
  })
})

describe("visit action API", () => {
  it("rejects a hidden action even when called directly", async () => {
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({
      id: "visit-1",
      agentId: "agent-1",
      status: "CHECKED_IN",
      participants: [],
      requirementSnapshot: {
        id: "snapshot-1",
        sourcePolicyId: "policy-1",
        resolvedAt: new Date(),
        requirements: [{ id: "requirement-1", actionKey: "PRESENTATION", mode: "HIDDEN", allowWaiver: false }],
      },
      actionResults: [],
    } as never)

    const response = await createActionResult(
      request("/api/v1/mtm/visits/visit-1/actions", { actionKey: "PRESENTATION", status: "COMPLETED" }),
      { params: Promise.resolve({ id: "visit-1" }) },
    )
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "MTM_VISIT_ACTION_HIDDEN" })
    expect(prisma.mtmVisitActionResult.create).not.toHaveBeenCalled()
  })
})
