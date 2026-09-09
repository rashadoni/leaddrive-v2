import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/api-auth", () => ({ requireAuth: vi.fn(), isAuthError: (value: unknown) => value instanceof Response }))
vi.mock("@/lib/mtm-audit", () => ({ writeMtmAudit: vi.fn(() => Promise.resolve()) }))

import { GET as listRequests, POST as createRequest } from "@/app/api/v1/mtm/customer-create-requests/route"
import { PATCH as resubmitRequest } from "@/app/api/v1/mtm/customer-create-requests/[id]/route"
import { POST as decideRequest } from "@/app/api/v1/mtm/customer-create-requests/[id]/decision/route"
import { POST as acceptRouteOffer } from "@/app/api/v1/mtm/customer-create-requests/[id]/route-offer/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"

const ORG = "org-1"
const agentAuth = { orgId: ORG, userId: "user-agent", role: "sales", email: "agent@example.com", name: "Agent" }
const adminAuth = { orgId: ORG, userId: "admin-user", role: "admin", email: "admin@example.com", name: "Admin" }

function request(path: string, body?: unknown, method = "POST") {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function params(id = "request-1") {
  return { params: Promise.resolve({ id }) }
}

const submitted = {
  id: "request-1",
  organizationId: ORG,
  requestedByAgentId: "agent-1",
  routeId: "route-1",
  approvedCustomerId: null,
  approvedCustomer: null,
  status: "SUBMITTED",
  objectType: "CLINIC",
  externalCode: "C-001",
  name: "Central Clinic",
  address: "Baku",
  city: "Baku",
  district: null,
  latitude: 40.4093,
  longitude: 49.8671,
  contactPerson: "Doctor One",
  phone: "+994501234567",
  category: "A",
  potential: "HIGH",
  territoryCode: null,
  photoUrl: null,
  reason: "New clinic in territory",
  agentComment: null,
  reviewedBy: null,
  decisionComment: null,
  submittedAt: new Date(),
  reviewedAt: null,
  routeOfferAcceptedAt: null,
  routeChangeRequestId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(agentAuth as never)
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
    id: "agent-1", role: "AGENT", name: "Agent One", managerId: "manager-1",
  } as never)
  vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmCustomerCreateRequest.updateMany).mockResolvedValue({ count: 1 } as never)
})

describe("customer create requests", () => {
  it("returns the agent's decided and needs-info requests", async () => {
    vi.mocked(prisma.mtmCustomerCreateRequest.findMany).mockResolvedValue([
      { ...submitted, status: "REJECTED", decisionComment: "Existing clinic" },
      { ...submitted, id: "request-2", status: "NEEDS_INFO", decisionComment: "Add coordinates" },
    ] as never)

    const response = await listRequests(request("/api/v1/mtm/customer-create-requests?mine=1", undefined, "GET"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.requests).toHaveLength(2)
    expect(prisma.mtmCustomerCreateRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ requestedByAgentId: "agent-1" }),
    }))
  })

  it("submits an agent request and notifies the manager", async () => {
    vi.mocked(prisma.mtmCustomerCreateRequest.create).mockResolvedValue(submitted as never)

    const response = await createRequest(request("/api/v1/mtm/customer-create-requests", {
      objectType: "CLINIC",
      externalCode: "C-001",
      name: "Central Clinic",
      phone: "+994501234567",
      latitude: 40.4093,
      longitude: 49.8671,
      category: "A",
      potential: "HIGH",
      reason: "New clinic in territory",
    }))

    expect(response.status).toBe(201)
    expect(prisma.mtmCustomerCreateRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ requestedByAgentId: "agent-1", status: "SUBMITTED" }),
    }))
    expect(prisma.mtmRouteNotificationOutbox.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ agentId: "manager-1", type: "task" }),
      update: {},
    }))
    expect(prisma.mtmNotification.create).not.toHaveBeenCalled()
  })

  it("resubmits only a needs-info request", async () => {
    vi.mocked(prisma.mtmCustomerCreateRequest.findFirst).mockResolvedValue({ ...submitted, status: "NEEDS_INFO" } as never)
    vi.mocked(prisma.mtmCustomerCreateRequest.findUnique).mockResolvedValue({ ...submitted, status: "SUBMITTED" } as never)

    const response = await resubmitRequest(request("/api/v1/mtm/customer-create-requests/request-1", {
      agentComment: "Added the exact entrance coordinates",
      latitude: 40.41,
      longitude: 49.87,
    }, "PATCH"), params())

    expect(response.status).toBe(200)
    expect(prisma.mtmCustomerCreateRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "NEEDS_INFO" }),
      data: expect.objectContaining({ status: "SUBMITTED" }),
    }))
  })

  it("creates exactly one customer on approval", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminAuth as never)
    vi.mocked(prisma.mtmCustomerCreateRequest.findFirst).mockResolvedValue(submitted as never)
    vi.mocked(prisma.mtmCustomer.create).mockResolvedValue({ id: "customer-new", code: "C-001", name: "Central Clinic" } as never)

    const response = await decideRequest(request("/api/v1/mtm/customer-create-requests/request-1/decision", {
      decision: "APPROVED",
      comment: "Verified territory",
    }), params())

    expect(response.status).toBe(200)
    expect(prisma.mtmCustomer.create).toHaveBeenCalledTimes(1)
    expect(prisma.mtmCustomerCreateRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ approvedCustomerId: null }),
      data: expect.objectContaining({ status: "IN_REVIEW" }),
    }))
    expect(prisma.mtmCustomerCreateRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "APPROVED", approvedCustomerId: "customer-new" }),
    }))
    expect(prisma.mtmRouteNotificationOutbox.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ agentId: "agent-1", type: "info" }),
      update: {},
    }))
    expect(prisma.mtmNotification.create).not.toHaveBeenCalled()
  })

  it("replays a completed approval without creating another customer", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminAuth as never)
    vi.mocked(prisma.mtmCustomerCreateRequest.findFirst).mockResolvedValue({
      ...submitted,
      status: "APPROVED",
      approvedCustomerId: "customer-new",
      approvedCustomer: { id: "customer-new", code: "C-001", name: "Central Clinic" },
    } as never)

    const response = await decideRequest(request("/api/v1/mtm/customer-create-requests/request-1/decision", {
      decision: "APPROVED",
    }), params())

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ idempotent: true })
    expect(prisma.mtmCustomer.create).not.toHaveBeenCalled()
  })

  it("blocks approval when an exact customer candidate exists", async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminAuth as never)
    vi.mocked(prisma.mtmCustomerCreateRequest.findFirst).mockResolvedValue(submitted as never)
    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([{
      id: "existing", code: "C-001", name: "Existing Clinic", phone: null, address: null, latitude: null, longitude: null,
    }] as never)

    const response = await decideRequest(request("/api/v1/mtm/customer-create-requests/request-1/decision", {
      decision: "APPROVED",
    }), params())

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "CUSTOMER_DUPLICATE" })
    expect(prisma.mtmCustomer.create).not.toHaveBeenCalled()
  })

  it("adds an approved customer directly to an owned draft", async () => {
    const syncRoute = {
      id: "route-1",
      agentId: "agent-1",
      date: new Date("2026-07-13"),
      name: "Monday route",
      status: "DRAFT",
      version: 3,
      publishedVersion: null,
      publishedAt: null,
      totalPoints: 1,
      visitedPoints: 0,
      startedAt: null,
      completedAt: null,
      notes: null,
      updatedAt: new Date("2026-07-13T09:00:00.000Z"),
      assignments: [{ agentId: "agent-1", role: "PRIMARY", assignedAt: new Date("2026-07-13T08:00:00.000Z") }],
      points: [{
        id: "point-new",
        routeId: "route-1",
        customerId: "customer-new",
        contactId: null,
        orderIndex: 0,
        status: "PENDING",
        version: 1,
        plannedTime: null,
        visitedAt: null,
        updatedAt: new Date("2026-07-13T09:00:00.000Z"),
      }],
    }
    vi.mocked(prisma.mtmCustomerCreateRequest.findFirst).mockResolvedValue({
      ...submitted,
      status: "APPROVED",
      approvedCustomerId: "customer-new",
      approvedCustomer: { id: "customer-new", name: "Central Clinic" },
      route: {
        id: "route-1", organizationId: ORG, agentId: "agent-1", status: "DRAFT", version: 2, date: new Date("2026-07-13"),
        assignments: [{ agentId: "agent-1", role: "PRIMARY" }], points: [],
      },
    } as never)
    vi.mocked(prisma.mtmRoute.findFirst)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(syncRoute as never)
    vi.mocked(prisma.mtmRoute.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.mtmRoutePoint.create).mockResolvedValue({ id: "point-new" } as never)

    const response = await acceptRouteOffer(request("/api/v1/mtm/customer-create-requests/request-1/route-offer"), params())

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { routeId: "route-1", version: 3 } })
    expect(prisma.mtmRoute.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ version: 2 }),
      data: expect.objectContaining({ version: { increment: 1 } }),
    }))
    expect(prisma.mtmRoutePoint.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ routeId: "route-1", customerId: "customer-new" }),
    }))
  })

  it("captures evidence when an approved customer needs active-route approval", async () => {
    vi.mocked(prisma.mtmCustomerCreateRequest.findFirst).mockResolvedValue({
      ...submitted,
      status: "APPROVED",
      approvedCustomerId: "customer-new",
      approvedCustomer: { id: "customer-new", name: "Central Clinic" },
      route: {
        id: "route-1",
        organizationId: ORG,
        agentId: "agent-1",
        status: "PLANNED",
        version: 3,
        publishedVersion: 3,
        totalPoints: 1,
        date: new Date("2026-07-13"),
        assignments: [{ agentId: "agent-1", role: "PRIMARY" }],
        points: [],
      },
    } as never)
    vi.mocked(prisma.mtmRouteChangeRequest.create).mockResolvedValue({ id: "route-change-1" } as never)

    const response = await acceptRouteOffer(request("/api/v1/mtm/customer-create-requests/request-1/route-offer"), params())

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { mode: "APPROVAL", routeChangeRequestId: "route-change-1" } })
    expect(prisma.mtmRouteChangeRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        changeType: "ADD_STOP",
        payload: expect.objectContaining({
          customerId: "customer-new",
          evidence: expect.objectContaining({
            before: expect.objectContaining({ route: expect.objectContaining({ id: "route-1", version: 3, totalPoints: 1 }) }),
            proposed: expect.objectContaining({
              changeType: "ADD_STOP",
              target: expect.objectContaining({ customerId: "customer-new", contactId: null }),
            }),
          }),
        }),
      }),
    }))
  })
})
