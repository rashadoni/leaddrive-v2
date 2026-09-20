import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/with-mtm-rls-auth", () => ({
  withRouteFieldRlsAuth: (_action: unknown, handler: (...args: unknown[]) => unknown) =>
    (req: NextRequest, ctx: unknown) => handler(req, {
      orgId: "org-1",
      userId: "manager-user",
      role: "admin",
      email: "manager@example.test",
      name: "Manager",
      agentId: null,
      principal: "web",
    }, ctx),
}))
vi.mock("@/lib/mtm/route-permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mtm/route-permissions")>()
  return { ...actual, resolveMtmRouteActor: vi.fn() }
})

import { POST } from "@/app/api/v1/mtm/contact-create-requests/[id]/decision/route"
import { prisma } from "@/lib/prisma"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"

const submitted = {
  id: "request-1",
  organizationId: "org-1",
  requestedByAgentId: "agent-1",
  status: "SUBMITTED",
  displayName: "Dr Aydin Aliyev",
  specialtyName: "Cardiology",
  phone: "+994 50 111 22 33",
  clinicName: "North Clinic",
  address: "Nizami 10",
  notes: "New doctor",
  approvedContact: null,
}

function request() {
  return new NextRequest("http://localhost/api/v1/mtm/contact-create-requests/request-1/decision", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision: "APPROVED" }),
  })
}

const context = { params: Promise.resolve({ id: "request-1" }) }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({
    agentId: null,
    role: "ADMIN",
    scopedAgentIds: null,
  } as never)
  vi.mocked(prisma.mtmContactCreateRequest.findFirst).mockResolvedValue(submitted as never)
  vi.mocked(prisma.mtmContactCreateRequest.updateMany).mockResolvedValue({ count: 1 } as never)
  vi.mocked(prisma.mtmContact.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmContact.create).mockResolvedValue({
    id: "doctor-1",
    displayName: submitted.displayName,
  } as never)
  vi.mocked(prisma.mtmContactCreateRequest.update).mockResolvedValue({
    ...submitted,
    status: "APPROVED",
  } as never)
  vi.mocked(prisma.mtmCustomerAgentAssignment.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmCustomerAgentAssignment.create).mockResolvedValue({ id: "customer-assignment-1" } as never)
})

describe("doctor create request approval", () => {
  it("assigns a newly created clinic to the requesting agent", async () => {
    vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmCustomer.create).mockResolvedValue({ id: "clinic-new" } as never)

    const response = await POST(request(), context)

    expect(response.status).toBe(200)
    expect(prisma.mtmCustomerAgentAssignment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        customerId: "clinic-new",
        agentId: "agent-1",
        role: "PRIMARY",
        source: "CONTACT_CREATE_APPROVAL",
      }),
    })
    expect(prisma.mtmContact.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        workplaces: { create: expect.objectContaining({ customerId: "clinic-new" }) },
        agentAssignments: { create: expect.objectContaining({ agentId: "agent-1" }) },
      }),
    }))
  })

  it("adds non-destructive workplace visibility for an existing clinic", async () => {
    vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue({ id: "clinic-existing" } as never)

    const response = await POST(request(), context)

    expect(response.status).toBe(200)
    expect(prisma.mtmCustomer.create).not.toHaveBeenCalled()
    expect(prisma.mtmCustomerAgentAssignment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customerId: "clinic-existing",
        agentId: "agent-1",
        role: "SECONDARY",
      }),
    })
  })

  it("does not duplicate an active clinic assignment", async () => {
    vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue({ id: "clinic-existing" } as never)
    vi.mocked(prisma.mtmCustomerAgentAssignment.findFirst).mockResolvedValue({ id: "assignment-existing" } as never)

    const response = await POST(request(), context)

    expect(response.status).toBe(200)
    expect(prisma.mtmCustomerAgentAssignment.create).not.toHaveBeenCalled()
  })
})
