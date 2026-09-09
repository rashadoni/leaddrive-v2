import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

vi.mock("@/lib/mtm/route-permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mtm/route-permissions")>()
  return { ...actual, resolveMtmRouteActor: vi.fn() }
})

vi.mock("@/lib/geo-utils", () => ({
  calculateDistance: vi.fn(),
}))

import { GET, POST } from "@/app/api/v1/mtm/visits/route"
import {
  DELETE as DELETE_DETAIL,
  GET as GET_DETAIL,
  PUT as PUT_DETAIL,
} from "@/app/api/v1/mtm/visits/[id]/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, requireAuth } from "@/lib/api-auth"
import { calculateDistance } from "@/lib/geo-utils"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"

const ORG = "org-1"

const sampleVisit = {
  id: "visit-1",
  organizationId: ORG,
  agentId: "agent-1",
  customerId: "cust-1",
  checkInAt: new Date("2026-04-10T10:00:00Z"),
  checkInLat: 40.4093,
  checkInLng: 49.8671,
  notes: null,
  agent: { id: "agent-1", name: "John" },
  customer: { id: "cust-1", name: "Customer A", address: "Main St", latitude: 40.41, longitude: 49.87 },
}

function makeReq(url: string): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"))
}

function makePostReq(body: unknown): NextRequest {
  return new NextRequest(new URL("http://localhost:3000/api/v1/mtm/visits"), {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  })
}

function makeDetailMutationReq(id: string, method: "PUT" | "DELETE", body?: unknown): NextRequest {
  return new NextRequest(new URL(`http://localhost:3000/api/v1/mtm/visits/${id}`), {
    method,
    ...(body === undefined ? {} : {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrgId).mockResolvedValue(ORG)
  vi.mocked(getMobileAuth).mockReturnValue(null)
  vi.mocked(resolveMobileAuth).mockResolvedValue(null)
  vi.mocked(requireAuth).mockResolvedValue({
    orgId: ORG,
    userId: "admin-user",
    role: "admin",
    email: "admin@example.com",
    name: "Admin",
  } as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({
    agentId: null,
    role: "ADMIN",
    scopedAgentIds: null,
  } as never)
  // Default: no route point auto-update
  vi.mocked(prisma.mtmRoutePoint.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmRoutePoint.updateMany).mockResolvedValue({ count: 1 } as never)
  vi.mocked(prisma.mtmRoute.updateMany).mockResolvedValue({ count: 1 } as never)
  vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", teamId: null } as any)
  // A customer without coordinates cannot be checked in since audit A6, so
  // the default fixture carries a real pair; the no-coordinates case sets null.
  vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue({
    id: "cust-1", name: "Customer A", category: "B", objectType: "OTHER", latitude: 40.41, longitude: 49.87, geofenceRadius: null,
  } as any)
  vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([{ id: "cust-1" }, { id: "c1" }] as any)
  vi.mocked(prisma.mtmVisitRequirementSnapshot.create).mockResolvedValue({ id: "snapshot-1", requirements: [] } as any)
})

// ─── GET /api/v1/mtm/visits ─────────────────────────────────
describe("GET /api/v1/mtm/visits", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      Response.json({ error: "Unauthorized" }, { status: 401 }) as never,
    )
    const res = await GET(makeReq("/api/v1/mtm/visits"))
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe("Unauthorized")
  })

  it("returns paginated visits", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([sampleVisit] as any)
    vi.mocked(prisma.mtmVisit.count).mockResolvedValue(1)

    const res = await GET(makeReq("/api/v1/mtm/visits"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.visits).toHaveLength(1)
    expect(json.data.total).toBe(1)
  })

  it("filters by agentId and customerId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmVisit.count).mockResolvedValue(0)

    await GET(makeReq("/api/v1/mtm/visits?agentId=agent-1&customerId=cust-1"))

    const callArgs = vi.mocked(prisma.mtmVisit.findMany).mock.calls[0][0] as any
    expect(callArgs.where.agentId).toBe("agent-1")
    expect(callArgs.where.customerId).toBe("cust-1")
  })

  it("filters by from/to date range", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmVisit.count).mockResolvedValue(0)

    await GET(makeReq("/api/v1/mtm/visits?from=2026-04-01&to=2026-04-30"))

    const callArgs = vi.mocked(prisma.mtmVisit.findMany).mock.calls[0][0] as any
    expect(callArgs.where.checkInAt.gte).toEqual(new Date("2026-04-01"))
    expect(callArgs.where.checkInAt.lte).toEqual(new Date("2026-04-30"))
  })

  it("builds friendly history ranges from the tenant-local day boundary", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-22T12:00:00.000Z"))
    try {
      vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([])
      vi.mocked(prisma.mtmVisit.count).mockResolvedValue(0)

      const res = await GET(makeReq("/api/v1/mtm/visits?range=7d"))

      const callArgs = vi.mocked(prisma.mtmVisit.findMany).mock.calls[0][0] as any
      expect(callArgs.where.checkInAt.gte).toEqual(new Date("2026-08-15T20:00:00.000Z"))
      expect(callArgs.where.checkInAt.lt).toEqual(new Date("2026-08-22T20:00:00.000Z"))
      expect(await res.json()).toMatchObject({ data: { range: "7d", timezone: "Asia/Baku" } })
    } finally {
      vi.useRealTimers()
    }
  })

  it("applies fresh manager scope to a bounded historical candidate set without a count leak", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "manager-1",
      role: "MANAGER",
      scopedAgentIds: ["manager-1", "agent-1"],
    } as never)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([])

    const res = await GET(makeReq("/api/v1/mtm/visits"))

    const expectedScope = [
      { agentId: { in: ["manager-1", "agent-1"] } },
      {
        participants: {
          some: {
            organizationId: ORG,
            agentId: { in: ["manager-1", "agent-1"] },
            role: { not: "OBSERVER" },
          },
        },
      },
    ]
    const query = vi.mocked(prisma.mtmVisit.findMany).mock.calls[0][0] as any
    expect(query.where.OR).toEqual(expectedScope)
    expect(query.take).toBe(2_001)
    expect(query.skip).toBeUndefined()
    expect(prisma.mtmVisit.count).not.toHaveBeenCalled()
    expect(await res.json()).toMatchObject({
      data: { total: 0, totalExact: true, sourceTruncated: false, candidateLimit: 2_000 },
    })
  })

  it("scrubs an outside primary for an event-time participant and marks the row read-only", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "agent-1",
      role: "AGENT",
      scopedAgentIds: ["agent-1"],
    } as never)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([{
      ...sampleVisit,
      agentId: "agent-outside",
      agent: { id: "agent-outside", name: "Outside primary" },
      participants: [{
        agentId: "agent-1",
        role: "PARTICIPANT",
        joinedAt: new Date("2026-04-10T09:00:00.000Z"),
        leftAt: null,
      }],
    }] as never)
    vi.mocked(prisma.mtmVisit.count).mockResolvedValue(1)

    const res = await GET(makeReq("/api/v1/mtm/visits"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.visits).toHaveLength(1)
    expect(json.data.visits[0]).toMatchObject({ agentId: null, agent: null, canMutate: false })
    expect(json.data.visits[0]).not.toHaveProperty("participants")
    expect(JSON.stringify(json.data.visits[0])).not.toContain("agent-outside")
    expect(JSON.stringify(json.data.visits[0])).not.toContain("Outside primary")
  })

  it("post-filters a current participant who joined after the visit event", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "agent-1",
      role: "AGENT",
      scopedAgentIds: ["agent-1"],
    } as never)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([{
      ...sampleVisit,
      agentId: "agent-outside",
      agent: { id: "agent-outside", name: "Outside primary" },
      participants: [{
        agentId: "agent-1",
        role: "PARTICIPANT",
        joinedAt: new Date("2026-04-10T10:00:01.000Z"),
        leftAt: null,
      }],
    }] as never)
    vi.mocked(prisma.mtmVisit.count).mockResolvedValue(1)

    const res = await GET(makeReq("/api/v1/mtm/visits"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.visits).toEqual([])
    expect(json.data.total).toBe(0)
    expect(JSON.stringify(json)).not.toContain("agent-outside")
    expect(JSON.stringify(json)).not.toContain("Outside primary")
  })

  it("does not expose an approximate hidden candidate count when the bounded source is truncated", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "agent-1",
      role: "AGENT",
      scopedAgentIds: ["agent-1"],
    } as never)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue(Array.from({ length: 2_001 }, (_, index) => ({
      ...sampleVisit,
      id: `hidden-${index}`,
      agentId: "agent-outside",
      agent: { id: "agent-outside", name: "Outside primary" },
      participants: [{
        agentId: "agent-1",
        role: "PARTICIPANT",
        joinedAt: new Date("2026-04-10T10:00:01.000Z"),
        leftAt: null,
      }],
    })) as never)

    const res = await GET(makeReq("/api/v1/mtm/visits?page=25&limit=50"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.visits).toEqual([])
    expect(json.data).toMatchObject({
      total: null,
      totalExact: false,
      sourceTruncated: true,
      candidateLimit: 2_000,
      page: 25,
      limit: 50,
    })
    expect(JSON.stringify(json)).not.toContain("agent-outside")
    expect(JSON.stringify(json)).not.toContain("Outside primary")
    expect(prisma.mtmVisit.count).not.toHaveBeenCalled()
  })

  it("returns no facts for an out-of-scope agentId", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "agent-1",
      role: "AGENT",
      scopedAgentIds: ["agent-1"],
    } as never)

    const res = await GET(makeReq("/api/v1/mtm/visits?agentId=agent-outside"))

    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ code: "MTM_VISIT_AGENT_NOT_FOUND" })
    expect(prisma.mtmVisit.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmVisit.count).not.toHaveBeenCalled()
  })

  it("returns 500 on prisma error (was silent-success — fixed by F-05)", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmVisit.findMany).mockRejectedValue(new Error("DB error"))
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const res = await GET(makeReq("/api/v1/mtm/visits"))
    const json = await res.json()
    expect(res.status).toBe(500)
    expect(json.error).toBeDefined()
    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })
})

describe("GET /api/v1/mtm/visits/[id] exact drilldown", () => {
  it("returns a historical participant visit outside the paginated list without leaking auth evidence", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "manager-1",
      role: "MANAGER",
      scopedAgentIds: ["manager-1", "agent-1"],
    } as never)
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({
      ...sampleVisit,
      id: "visit-older-than-limit",
      agentId: "agent-outside",
      agent: { id: "agent-outside", name: "Outside primary" },
      checkInAt: new Date("2026-04-10T10:00:00.000Z"),
      contact: null,
      participants: [{
        agentId: "agent-1",
        role: "PARTICIPANT",
        joinedAt: new Date("2026-04-10T08:00:00.000Z"),
        leftAt: new Date("2026-04-11T08:00:00.000Z"),
      }],
    } as never)

    const res = await GET_DETAIL(
      makeReq("/api/v1/mtm/visits/visit-older-than-limit"),
      { params: Promise.resolve({ id: "visit-older-than-limit" }) },
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.id).toBe("visit-older-than-limit")
    expect(json.data.agentId).toBeNull()
    expect(json.data.agent).toBeNull()
    expect(json.data.canMutate).toBe(false)
    expect(json.data).not.toHaveProperty("participants")
    expect(JSON.stringify(json.data)).not.toContain("agent-outside")
    expect(JSON.stringify(json.data)).not.toContain("Outside primary")
    expect(prisma.mtmVisit.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmVisit.count).not.toHaveBeenCalled()
    expect(prisma.mtmVisit.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "visit-older-than-limit",
        organizationId: ORG,
        OR: expect.any(Array),
      }),
    }))
  })

  it("returns 404 when the exact visit has no primary or at-check-in participant in scope", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "agent-1",
      role: "AGENT",
      scopedAgentIds: ["agent-1"],
    } as never)
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({
      ...sampleVisit,
      id: "visit-outside",
      agentId: "agent-outside",
      checkInAt: new Date("2026-04-10T10:00:00.000Z"),
      contact: null,
      participants: [{
        agentId: "agent-1",
        role: "PARTICIPANT",
        joinedAt: new Date("2026-04-09T08:00:00.000Z"),
        leftAt: new Date("2026-04-10T10:00:00.000Z"),
      }],
    } as never)

    const res = await GET_DETAIL(
      makeReq("/api/v1/mtm/visits/visit-outside"),
      { params: Promise.resolve({ id: "visit-outside" }) },
    )

    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ code: "MTM_VISIT_NOT_FOUND" })
  })

  it("does not grant an active participant access when they joined after check-in", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "agent-1",
      role: "AGENT",
      scopedAgentIds: ["agent-1"],
    } as never)
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({
      ...sampleVisit,
      id: "visit-before-participant",
      agentId: "agent-outside",
      checkInAt: new Date("2026-04-10T10:00:00.000Z"),
      contact: null,
      participants: [{
        agentId: "agent-1",
        role: "PARTICIPANT",
        joinedAt: new Date("2026-04-10T10:00:01.000Z"),
        leftAt: null,
      }],
    } as never)

    const res = await GET_DETAIL(
      makeReq("/api/v1/mtm/visits/visit-before-participant"),
      { params: Promise.resolve({ id: "visit-before-participant" }) },
    )

    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ code: "MTM_VISIT_NOT_FOUND" })
  })
})

// ─── POST /api/v1/mtm/visits ────────────────────────────────
describe("PUT/DELETE /api/v1/mtm/visits/[id] mutation scope", () => {
  it("does not let a participant edit an outside-primary visit", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "participant-1",
      role: "AGENT",
      scopedAgentIds: ["participant-1"],
    } as never)
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue(null)

    const res = await PUT_DETAIL(
      makeDetailMutationReq("visit-participant", "PUT", { notes: "should not save" }),
      { params: Promise.resolve({ id: "visit-participant" }) },
    )

    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ code: "MTM_VISIT_NOT_FOUND" })
    expect(prisma.mtmVisit.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "visit-participant",
        organizationId: ORG,
        agentId: { in: ["participant-1"] },
      }),
    }))
    expect(prisma.mtmVisit.updateMany).not.toHaveBeenCalled()
  })

  it("does not let a manager edit a visit whose primary is outside fresh scope", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "manager-1",
      role: "MANAGER",
      scopedAgentIds: ["manager-1", "agent-1"],
    } as never)
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue(null)

    const res = await PUT_DETAIL(
      makeDetailMutationReq("visit-outside", "PUT", { notes: "should not save" }),
      { params: Promise.resolve({ id: "visit-outside" }) },
    )

    expect(res.status).toBe(404)
    expect(prisma.mtmVisit.updateMany).not.toHaveBeenCalled()
  })

  it("does not let a manager reassign an in-scope visit to an out-of-scope agent", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "manager-1",
      role: "MANAGER",
      scopedAgentIds: ["manager-1", "agent-1"],
    } as never)
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({
      agentId: "agent-1",
      customerId: "cust-1",
      contactId: null,
      checkInAt: new Date("2026-04-10T10:00:00.000Z"),
      status: "CHECKED_IN",
    } as never)

    const res = await PUT_DETAIL(
      makeDetailMutationReq("visit-in-scope", "PUT", { agentId: "agent-outside" }),
      { params: Promise.resolve({ id: "visit-in-scope" }) },
    )

    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ code: "MTM_VISIT_AGENT_NOT_FOUND" })
    expect(prisma.mtmAgent.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmVisit.updateMany).not.toHaveBeenCalled()
  })

  it("does not let an agent move a visit to a customer outside field scope", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "agent-1",
      role: "AGENT",
      scopedAgentIds: ["agent-1"],
    } as never)
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({
      agentId: "agent-1",
      customerId: "cust-1",
      contactId: null,
      checkInAt: new Date("2026-04-10T10:00:00.000Z"),
      status: "CHECKED_IN",
    } as never)
    vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue(null)

    const res = await PUT_DETAIL(
      makeDetailMutationReq("visit-in-scope", "PUT", { customerId: "customer-outside" }),
      { params: Promise.resolve({ id: "visit-in-scope" }) },
    )

    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ code: "MTM_VISIT_CUSTOMER_NOT_FOUND" })
    expect(prisma.mtmCustomer.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "customer-outside",
        organizationId: ORG,
        AND: expect.any(Array),
      }),
    }))
    expect(prisma.mtmVisit.updateMany).not.toHaveBeenCalled()
  })

  it("does not let a participant delete an outside-primary visit", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "participant-1",
      role: "AGENT",
      scopedAgentIds: ["participant-1"],
    } as never)
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue(null)

    const res = await DELETE_DETAIL(
      makeDetailMutationReq("visit-participant", "DELETE"),
      { params: Promise.resolve({ id: "visit-participant" }) },
    )

    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ code: "MTM_VISIT_NOT_FOUND" })
    expect(prisma.mtmVisit.updateMany).not.toHaveBeenCalled()
  })

  it("does not let a manager delete a visit whose primary is outside fresh scope", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "manager-1",
      role: "MANAGER",
      scopedAgentIds: ["manager-1", "agent-1"],
    } as never)
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue(null)

    const res = await DELETE_DETAIL(
      makeDetailMutationReq("visit-outside", "DELETE"),
      { params: Promise.resolve({ id: "visit-outside" }) },
    )

    expect(res.status).toBe(404)
    expect(prisma.mtmVisit.updateMany).not.toHaveBeenCalled()
  })

  it("updates a reassignment under the scoped mutation fence", async () => {
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({
      agentId: "agent-1",
      customerId: "cust-1",
      contactId: null,
      checkInAt: new Date("2026-04-10T10:00:00.000Z"),
      status: "CHECKED_IN",
    } as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-2" } as never)
    vi.mocked(prisma.mtmVisit.updateMany).mockResolvedValue({ count: 1 } as never)

    const response = await PUT_DETAIL(
      makeDetailMutationReq("visit-1", "PUT", { agentId: "agent-2" }),
      { params: Promise.resolve({ id: "visit-1" }) },
    )

    expect(response.status).toBe(200)
  })

  it("soft-deletes a visit under the scoped mutation fence", async () => {
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({
      id: "visit-1",
      agentId: "agent-1",
      customerId: "cust-1",
      status: "CHECKED_IN",
    } as never)
    vi.mocked(prisma.mtmVisit.updateMany).mockResolvedValue({ count: 1 } as never)

    const response = await DELETE_DETAIL(
      makeDetailMutationReq("visit-1", "DELETE"),
      { params: Promise.resolve({ id: "visit-1" }) },
    )

    expect(response.status).toBe(200)
  })
})

describe("POST /api/v1/mtm/visits", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      Response.json({ error: "Unauthorized" }, { status: 401 }) as never,
    )
    const res = await POST(makePostReq({ agentId: "a1", customerId: "c1" }))
    expect(res.status).toBe(401)
  })

  it("returns no facts and creates nothing for an out-of-scope target agent", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "agent-1",
      role: "AGENT",
      scopedAgentIds: ["agent-1"],
    } as never)

    const res = await POST(makePostReq({ agentId: "agent-outside", customerId: "cust-1" }))

    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ code: "MTM_VISIT_AGENT_NOT_FOUND" })
    expect(prisma.mtmAgent.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmVisit.create).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("does not create an ad-hoc visit for an observer-only route customer", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "agent-1",
      role: "AGENT",
      scopedAgentIds: ["agent-1"],
    } as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1" } as never)
    vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue(null)

    const res = await POST(makePostReq({ agentId: "agent-1", customerId: "customer-outside" }))

    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ code: "MTM_VISIT_CUSTOMER_NOT_FOUND" })
    expect(prisma.mtmCustomer.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "customer-outside",
        organizationId: ORG,
        AND: expect.any(Array),
      }),
    }))
    const mutationScope = (vi.mocked(prisma.mtmCustomer.findFirst).mock.calls[0][0] as any).where.AND[0]
    expect(mutationScope.OR[1].routePoints.some.route.OR[1]).toEqual({
      assignments: {
        some: {
          agentId: { in: ["agent-1"] },
          removedAt: null,
          role: { not: "OBSERVER" },
        },
      },
    })
    expect(prisma.mtmVisit.create).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("creates a visit without GPS (no geofence check) and returns 201", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmVisit.create).mockResolvedValue({ id: "v-new" } as any)

    const res = await POST(makePostReq({ agentId: "agent-1", customerId: "cust-1", notes: "hello" }))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.success).toBe(true)

    // calculateDistance should NOT be called when no lat/lng provided
    expect(calculateDistance).not.toHaveBeenCalled()
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
    const lockCall = vi.mocked(prisma.$executeRaw).mock.calls[0] as unknown as [TemplateStringsArray, string]
    expect(lockCall[1]).toBe(`mtm-active-visit:${ORG}:agent-1`)
  })

  it("rejects an already-open visit before geofence alerts or create transaction", async () => {
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({ id: "visit-active" } as never)

    const res = await POST(makePostReq({
      agentId: "agent-1",
      customerId: "cust-1",
      latitude: 40.42,
      longitude: 49.88,
    }))

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "MTM_VISIT_ALREADY_ACTIVE", activeVisitId: "visit-active" })
    expect(prisma.mtmAlert.create).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.mtmVisit.create).not.toHaveBeenCalled()
  })

  it("rechecks one-open-visit under the shared slot lock before create", async () => {
    vi.mocked(prisma.mtmVisit.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "visit-race-winner" } as never)

    const res = await POST(makePostReq({ agentId: "agent-1", customerId: "cust-1" }))

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "MTM_VISIT_ALREADY_ACTIVE" })
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
    expect(prisma.mtmVisit.create).not.toHaveBeenCalled()
  })

  it("never auto-matches an observer-only route assignment", async () => {
    vi.mocked(prisma.mtmVisit.create).mockResolvedValue({ id: "v-no-observer-route" } as never)

    const res = await POST(makePostReq({ agentId: "agent-1", customerId: "cust-1" }))

    expect(res.status).toBe(201)
    const routePointWhere = (vi.mocked(prisma.mtmRoutePoint.findFirst).mock.calls[0][0] as any).where
    expect(routePointWhere.route.OR).toEqual([
      { agentId: "agent-1" },
      {
        assignments: {
          some: {
            agentId: "agent-1",
            removedAt: null,
            role: { not: "OBSERVER" },
          },
        },
      },
    ])
  })

  it("starts a planned route when a route-point check-in succeeds", async () => {
    vi.mocked(prisma.mtmRoutePoint.findFirst).mockResolvedValue({
      id: "point-1",
      routeId: "route-1",
      contactId: null,
      route: { status: "PLANNED", assignments: [{ agentId: "agent-1", role: "PRIMARY" }] },
    } as never)
    vi.mocked(prisma.mtmVisit.create).mockResolvedValue({ id: "visit-route-1" } as never)

    const res = await POST(makePostReq({
      agentId: "agent-1",
      customerId: "cust-1",
      routeId: "route-1",
      routePointId: "point-1",
    }))

    expect(res.status).toBe(201)
  })

  it("creates a visit when within geofence radius", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue({
      id: "cust-1", name: "Customer A", category: "B", objectType: "OTHER", latitude: 40.41, longitude: 49.87,
    } as any)
    vi.mocked(prisma.mtmSetting.findFirst).mockResolvedValue({ value: "200" } as any)
    vi.mocked(calculateDistance).mockReturnValue(50) // 50m < 200m
    vi.mocked(prisma.mtmVisit.create).mockResolvedValue({ id: "v-ok" } as any)

    const res = await POST(makePostReq({
      agentId: "agent-1", customerId: "cust-1",
      latitude: 40.4095, longitude: 49.868,
    }))
    expect(res.status).toBe(201)
    expect(prisma.mtmAlert.create).not.toHaveBeenCalled()
  })

  it("blocks visit when outside geofence and no force flag", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue({
      id: "cust-1", name: "Customer A", category: "B", objectType: "OTHER", latitude: 40.41, longitude: 49.87,
    } as any)
    vi.mocked(prisma.mtmSetting.findFirst).mockResolvedValue({ value: "100" } as any)
    vi.mocked(calculateDistance).mockReturnValue(500) // 500m > 100m
    vi.mocked(prisma.mtmAlert.create).mockResolvedValue({} as any)

    const res = await POST(makePostReq({
      agentId: "agent-1", customerId: "cust-1",
      latitude: 40.42, longitude: 49.88,
    }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.code).toBe("MTM_VISIT_OUT_OF_ZONE")
    expect(json.distanceMeters).toBe(500)
    expect(json.geofenceRadius).toBe(100)

    // Alert should have been created
    expect(prisma.mtmAlert.create).toHaveBeenCalledTimes(1)
    const alertData = vi.mocked(prisma.mtmAlert.create).mock.calls[0][0] as any
    expect(alertData.data.type).toBe("OUT_OF_ZONE")
  })

  it("refuses a check-in at a customer without coordinates, force included (audit A6, owner decision 2)", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue({
      id: "cust-1", name: "Customer A", category: "B", objectType: "OTHER", latitude: null, longitude: null, geofenceRadius: null,
    } as any)

    for (const body of [
      { agentId: "agent-1", customerId: "cust-1" },
      { agentId: "agent-1", customerId: "cust-1", latitude: 40.4095, longitude: 49.868 },
      { agentId: "agent-1", customerId: "cust-1", latitude: 40.4095, longitude: 49.868, force: true },
    ]) {
      const res = await POST(makePostReq(body))
      expect(res.status).toBe(422)
      expect(await res.json()).toMatchObject({ code: "MTM_VISIT_CUSTOMER_NO_COORDINATES", customerId: "cust-1" })
    }
    expect(prisma.mtmVisit.create).not.toHaveBeenCalled()
    expect(prisma.mtmAlert.create).not.toHaveBeenCalled()
  })

  it("does not check the geofence when the agent sends no GPS fix", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmVisit.create).mockResolvedValue({ id: "v-no-gps" } as any)

    const res = await POST(makePostReq({ agentId: "agent-1", customerId: "cust-1" }))

    expect(res.status).toBe(201)
    expect(calculateDistance).not.toHaveBeenCalled()
  })

  it("answers an unavailable route point with the contract code (audit A6)", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmRoutePoint.findFirst).mockResolvedValue(null)

    const res = await POST(makePostReq({
      agentId: "agent-1", customerId: "cust-1", routeId: "route-1", routePointId: "point-1",
    }))

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "MTM_ROUTE_POINT_NOT_AVAILABLE" })
    expect(prisma.mtmVisit.create).not.toHaveBeenCalled()
  })

  it("allows visit with force flag even outside geofence for an admin caller", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1" } as any)
    vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue({
      id: "cust-1", name: "Customer A", category: "B", objectType: "OTHER", latitude: 40.41, longitude: 49.87,
    } as any)
    vi.mocked(prisma.mtmSetting.findFirst).mockResolvedValue({ value: "100" } as any)
    vi.mocked(calculateDistance).mockReturnValue(500)
    vi.mocked(prisma.mtmAlert.create).mockResolvedValue({} as any)
    vi.mocked(prisma.mtmVisit.create).mockResolvedValue({ id: "v-forced" } as any)

    const res = await POST(makePostReq({
      agentId: "agent-1", customerId: "cust-1",
      latitude: 40.42, longitude: 49.88, force: true,
    }))
    expect(res.status).toBe(201)
    // Alert is still created even with force
    expect(prisma.mtmAlert.create).toHaveBeenCalledTimes(1)
  })

  it("rejects force flag from regular AGENT role (F-28)", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "agent-1",
      role: "AGENT",
      scopedAgentIds: ["agent-1"],
    } as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1" } as any)

    const res = await POST(makePostReq({
      agentId: "agent-1", customerId: "cust-1",
      latitude: 40.42, longitude: 49.88, force: true,
    }))
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toMatch(/SUPERVISOR|MANAGER|ADMIN/i)
  })

  it("does not let a regular caller borrow the target agent's supervisor role for force", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "agent-1",
      role: "AGENT",
      scopedAgentIds: ["agent-1"],
    } as never)
    // The selected target may itself be a supervisor; authorization still
    // comes from the caller actor resolved above.
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", role: "SUPERVISOR" } as never)

    const res = await POST(makePostReq({
      agentId: "agent-1",
      customerId: "cust-1",
      latitude: 40.42,
      longitude: 49.88,
      force: true,
    }))

    expect(res.status).toBe(403)
    expect(prisma.mtmVisit.create).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("uses default 100m geofence when no setting exists", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue({
      id: "cust-1", name: "Customer A", category: "B", objectType: "OTHER", latitude: 40.41, longitude: 49.87,
    } as any)
    vi.mocked(prisma.mtmSetting.findFirst).mockResolvedValue(null) // no setting
    vi.mocked(calculateDistance).mockReturnValue(150) // 150m > default 100m
    vi.mocked(prisma.mtmAlert.create).mockResolvedValue({} as any)

    const res = await POST(makePostReq({
      agentId: "agent-1", customerId: "cust-1",
      latitude: 40.42, longitude: 49.88,
    }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.geofenceRadius).toBe(100)
  })

  it("returns 400 on create failure", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmVisit.create).mockRejectedValue(new Error("DB constraint"))

    const res = await POST(makePostReq({ agentId: "bad", customerId: "c1" }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe("DB constraint")
  })
})
