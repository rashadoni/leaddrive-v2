import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

type AuthContext = { orgId: string; userId: string; role: string }
type RouteContext = { params: Promise<{ id: string }> }
type RouteHandler = (req: NextRequest, auth: AuthContext, context: RouteContext) => Promise<Response>

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: RouteHandler) =>
    (req: NextRequest, context: RouteContext) => handler(req, { orgId: "org-1", userId: "reviewer-1", role: "manager" }, context),
}))

vi.mock("@/lib/social/monitoring-import-fence", () => ({
  withSocialMonitoringTenantCollectionFence: async (
    _organizationId: string,
    mutate: () => Promise<unknown>,
  ) => ({ allowed: true, value: await mutate() }),
}))

const mockPrisma = vi.hoisted(() => ({
  socialLegalPolicy: { upsert: vi.fn() },
  manualEngagementTask: { updateMany: vi.fn() },
  user: { findFirst: vi.fn() },
}))

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))

vi.mock("@/lib/social/legal-workflow", () => ({
  getOrCreateLegalPolicy: vi.fn(),
}))

import { PATCH as policyPATCH } from "@/app/api/v1/social/legal-policy/route"
import { PATCH as taskPATCH } from "@/app/api/v1/social/manual-engagement-tasks/[id]/route"

function request(url: string, body: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const context: RouteContext = { params: Promise.resolve({ id: "task-1" }) }

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.socialLegalPolicy.upsert.mockResolvedValue({
    id: "policy-1",
    autoPromote: false,
    requireHumanReview: true,
  })
  mockPrisma.manualEngagementTask.updateMany.mockResolvedValue({ count: 1 })
  mockPrisma.user.findFirst.mockResolvedValue({ id: "user-2" })
})

describe("legal workflow safety routes", () => {
  it("rejects any attempt to enable automatic legal-case promotion", async () => {
    const response = await policyPATCH(request("/api/v1/social/legal-policy", {
      autoPromote: true,
      requireHumanReview: false,
    }), context)

    expect(response.status).toBe(400)
    expect(mockPrisma.socialLegalPolicy.upsert).not.toHaveBeenCalled()
  })

  it("persists only the locked human-review policy values", async () => {
    const response = await policyPATCH(request("/api/v1/social/legal-policy", {
      enabled: true,
      candidateThreshold: 0.8,
      autoPromote: false,
      requireHumanReview: true,
    }), context)

    expect(response.status).toBe(200)
    expect(mockPrisma.socialLegalPolicy.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ autoPromote: false, requireHumanReview: true }),
    }))
  })

  it("rejects an assignee that is not active in the current tenant", async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null)

    const response = await taskPATCH(request("/api/v1/social/manual-engagement-tasks/task-1", {
      status: "IN_PROGRESS",
      assignedTo: "foreign-user",
    }), context)

    expect(response.status).toBe(400)
    expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: "foreign-user", organizationId: "org-1", isActive: true },
      select: { id: true },
    })
    expect(mockPrisma.manualEngagementTask.updateMany).not.toHaveBeenCalled()
  })

  it("records the current reviewer when a manual interaction is completed", async () => {
    const response = await taskPATCH(request("/api/v1/social/manual-engagement-tasks/task-1", {
      status: "COMPLETED",
    }), context)

    expect(response.status).toBe(200)
    expect(mockPrisma.manualEngagementTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-1", id: "task-1" },
      data: expect.objectContaining({ status: "COMPLETED", completedBy: "reviewer-1" }),
    }))
  })
})
