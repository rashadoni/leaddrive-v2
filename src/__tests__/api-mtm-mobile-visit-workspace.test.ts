import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

import { GET } from "@/app/api/v1/mtm/mobile/visits/[id]/workspace/route"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

const AUTH = { orgId: "org-1", agentId: "agent-1" }

function request() {
  return new NextRequest("http://localhost:3000/api/v1/mtm/mobile/visits/visit-1/workspace", {
    headers: { Authorization: "Bearer valid-token" },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveMobileAuth).mockResolvedValue(AUTH as any)
  vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmTask.findMany).mockResolvedValue([])
})

describe("GET /api/v1/mtm/mobile/visits/[id]/workspace", () => {
  it("requires mobile authentication", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(null as any)
    const response = await GET(request(), { params: Promise.resolve({ id: "visit-1" }) })
    expect(response.status).toBe(401)
  })

  it("scopes the workspace to the owner or an active participant", async () => {
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({
      id: "visit-1",
      customerId: "customer-1",
      status: "CHECKED_IN",
      requirementSnapshot: {
        requirements: [{ id: "requirement-1", actionKey: "VISIT_NOTE", mode: "REQUIRED" }],
      },
      actionResults: [],
      customer: { id: "customer-1", name: "Clinic One" },
    } as any)

    const response = await GET(request(), { params: Promise.resolve({ id: "visit-1" }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      data: {
        visit: {
          id: "visit-1",
          requirementSnapshot: { requirements: [expect.objectContaining({ actionKey: "VISIT_NOTE" })] },
        },
        reminders: [],
      },
    })
    const args = vi.mocked(prisma.mtmVisit.findFirst).mock.calls[0][0] as any
    expect(args.where).toEqual({
      id: "visit-1",
      organizationId: "org-1",
      deletedAt: null,
      OR: [
        { agentId: "agent-1" },
        { participants: { some: { agentId: "agent-1", leftAt: null } } },
      ],
    })
  })

  it("does not disclose an out-of-scope visit", async () => {
    const response = await GET(request(), { params: Promise.resolve({ id: "visit-1" }) })
    expect(response.status).toBe(404)
    expect(prisma.mtmTask.findMany).not.toHaveBeenCalled()
  })

  it("hands the field app no coordinates instead of Null Island", async () => {
    // The same rule as every other read path: a customer stored as (0, 0)
    // before the coordinates migration leaves as null/null, so the visit
    // screen never measures a distance to the Gulf of Guinea (audit A1).
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({
      id: "visit-1",
      customerId: "customer-1",
      status: "CHECKED_IN",
      requirementSnapshot: null,
      actionResults: [],
      customer: { id: "customer-1", name: "Clinic Zero", latitude: 0, longitude: 0 },
    } as any)

    const response = await GET(request(), { params: Promise.resolve({ id: "visit-1" }) })
    const json = await response.json()
    expect(json.data.visit.customer).toMatchObject({
      id: "customer-1",
      latitude: null,
      longitude: null,
    })
  })
})
