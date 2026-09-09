import { beforeEach, describe, expect, it, vi } from "vitest"

const authContext = vi.hoisted(() => ({ role: "admin" }))

vi.mock("@/lib/prisma", () => {
  const prismaMock = {
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(prismaMock)),
    entitlementTicketMilestone: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    entitlementAuditEvent: {
      create: vi.fn(),
    },
    ticketComment: {
      create: vi.fn(),
    },
  }
  return { prisma: prismaMock }
})

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: WaiveRouteHandler) => {
    return (req: Request, context: { params: Promise<{ id: string; milestoneId: string }> }) =>
      handler(req, { orgId: "org-1", userId: "user-1", role: authContext.role }, context)
  },
}))

import { POST } from "@/app/api/v1/tickets/[id]/entitlement-milestones/[milestoneId]/waive/route"
import { prisma } from "@/lib/prisma"

type WaiveRouteHandler = (
  req: Request,
  auth: { orgId: string; userId: string; role: string },
  context: { params: Promise<{ id: string; milestoneId: string }> },
) => unknown
type MockFn = ReturnType<typeof vi.fn>
type WaivePrismaMock = typeof prisma & {
  $transaction: MockFn
  entitlementTicketMilestone: { findFirst: MockFn; updateMany: MockFn }
  entitlementAuditEvent: { create: MockFn }
  ticketComment: { create: MockFn }
}
const waivePrisma = prisma as unknown as WaivePrismaMock

const existingMilestone = {
  id: "tm-1",
  organizationId: "org-1",
  ticketId: "tk-1",
  type: "resolution",
  status: "missed",
  metadata: {},
  ticket: { id: "tk-1", ticketNumber: "DV-1", subject: "Broken SLA" },
  definition: { name: "Resolution", type: "resolution" },
}

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/v1/tickets/tk-1/entitlement-milestones/tm-1/waive", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

function makeParams() {
  return { params: Promise.resolve({ id: "tk-1", milestoneId: "tm-1" }) }
}

function postWaive(body: unknown) {
  return POST(makeRequest(body) as Parameters<typeof POST>[0], makeParams())
}

beforeEach(() => {
  vi.clearAllMocks()
  authContext.role = "admin"
  vi.mocked(waivePrisma.$transaction).mockImplementation(async (callback: (tx: unknown) => unknown) => callback(prisma))
  vi.mocked(waivePrisma.entitlementTicketMilestone.findFirst).mockResolvedValue(existingMilestone)
  vi.mocked(waivePrisma.entitlementTicketMilestone.updateMany).mockResolvedValue({ count: 1 })
  vi.mocked(waivePrisma.entitlementAuditEvent.create).mockResolvedValue({ id: "audit-1" })
  vi.mocked(waivePrisma.ticketComment.create).mockResolvedValue({ id: "comment-1" })
})

describe("POST /api/v1/tickets/:id/entitlement-milestones/:milestoneId/waive", () => {
  it("blocks ticketing agents from waiving milestones", async () => {
    authContext.role = "ticketing"

    const res = await postWaive({ reason: "Customer approved exception" })

    expect(res.status).toBe(403)
    expect(waivePrisma.entitlementTicketMilestone.findFirst).not.toHaveBeenCalled()
    expect(waivePrisma.entitlementTicketMilestone.updateMany).not.toHaveBeenCalled()
  })

  it("allows support managers to waive milestones", async () => {
    authContext.role = "manager"

    const res = await postWaive({ reason: "Customer approved exception" })

    expect(res.status).toBe(200)
    expect(waivePrisma.entitlementTicketMilestone.updateMany).toHaveBeenCalled()
  })

  it("requires a waiver reason", async () => {
    const res = await postWaive({ reason: "" })
    expect(res.status).toBe(400)
  })

  it("returns 404 when runtime milestone is not found", async () => {
    vi.mocked(waivePrisma.entitlementTicketMilestone.findFirst).mockResolvedValueOnce(null)

    const res = await postWaive({ reason: "Customer approved exception" })

    expect(res.status).toBe(404)
  })

  it("waives an open runtime milestone with audit event and internal note", async () => {
    const res = await postWaive({ reason: "Customer approved exception" })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(waivePrisma.entitlementTicketMilestone.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "tm-1",
        ticketId: "tk-1",
        status: { in: ["pending", "in_progress", "missed"] },
      }),
      data: expect.objectContaining({
        status: "waived",
        waivedReason: "Customer approved exception",
      }),
    }))
    expect(waivePrisma.entitlementAuditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventType: "milestone_waived",
        actorUserId: "user-1",
      }),
    }))
    expect(waivePrisma.ticketComment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        ticketId: "tk-1",
        isInternal: true,
      }),
    }))
  })
})
