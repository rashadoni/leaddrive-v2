import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

type RouteHandler = (request: NextRequest, auth: Record<string, unknown>) => Promise<Response> | Response

const state = vi.hoisted(() => ({
  authenticated: true,
  permitted: true,
  writable: true,
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  transaction: vi.fn(),
  applyRecordFilter: vi.fn(),
  logAudit: vi.fn(),
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsSessionAuth: (handler: RouteHandler) => (request: NextRequest) => {
    if (!state.authenticated) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }
    return handler(request, {
      orgId: "org-1",
      userId: "agent-1",
      role: "ticketing",
      email: "agent@example.test",
      name: "Support Agent",
    })
  },
}))

vi.mock("@/lib/permissions", () => ({
  checkPermission: () => state.permitted,
}))

vi.mock("@/lib/field-filter", () => ({
  getFieldPermissions: vi.fn().mockResolvedValue({}),
  filterWritableFields: (value: Record<string, unknown>) => state.writable ? value : {},
}))

vi.mock("@/lib/sharing-rules", () => ({
  applyRecordFilter: (...args: unknown[]) => state.applyRecordFilter(...args),
}))

vi.mock("@/lib/prisma", () => {
  const prisma = {
    ticket: {
      findFirst: state.findFirst,
      updateMany: state.updateMany,
    },
    $transaction: state.transaction,
  }
  return { prisma, logAudit: (...args: unknown[]) => state.logAudit(...args) }
})

import { POST } from "@/app/api/v1/tickets/take-next/route"

function request(body: unknown = {}) {
  return new NextRequest("http://localhost/api/v1/tickets/take-next", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  state.authenticated = true
  state.permitted = true
  state.writable = true
  state.applyRecordFilter.mockImplementation(async (_orgId, _userId, _role, _entity, where) => where)
  state.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
    ticket: { findFirst: state.findFirst, updateMany: state.updateMany },
  }))
})

describe("POST /api/v1/tickets/take-next", () => {
  it("requires an authenticated browser session", async () => {
    state.authenticated = false

    const response = await POST(request())

    expect(response.status).toBe(401)
    expect(state.findFirst).not.toHaveBeenCalled()
  })

  it("fails closed when role or field permissions forbid assignment", async () => {
    state.permitted = false
    const roleDenied = await POST(request())
    expect(roleDenied.status).toBe(403)
    expect(state.findFirst).not.toHaveBeenCalled()

    state.permitted = true
    state.writable = false
    const fieldDenied = await POST(request())
    expect(fieldDenied.status).toBe(403)
    expect(state.findFirst).not.toHaveBeenCalled()
  })

  it("atomically claims the oldest urgent accessible ticket for the current tenant", async () => {
    state.findFirst.mockResolvedValue({ id: "ticket-1", ticketNumber: "TKT-001", subject: "Payment blocked" })
    state.updateMany.mockResolvedValue({ count: 1 })

    const response = await POST(request())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(payload.data.id).toBe("ticket-1")
    expect(state.applyRecordFilter).toHaveBeenCalledWith(
      "org-1",
      "agent-1",
      "ticketing",
      "ticket",
      expect.objectContaining({ organizationId: "org-1", assignedTo: null }),
    )
    expect(state.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: "org-1", assignedTo: null }),
      orderBy: [
        { slaDueAt: { sort: "asc", nulls: "last" } },
        { createdAt: "asc" },
      ],
    }))
    expect(state.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { AND: [
        expect.objectContaining({ organizationId: "org-1", assignedTo: null }),
        expect.objectContaining({ id: "ticket-1", organizationId: "org-1", assignedTo: null }),
      ] },
      data: { assignedTo: "agent-1" },
    }))
    expect(state.logAudit).toHaveBeenCalledWith(
      "org-1",
      "update",
      "ticket",
      "ticket-1",
      "Payment blocked",
      { newValue: { assignedTo: "agent-1", source: "take_next" } },
    )
  })

  it("returns a recoverable empty-queue response", async () => {
    state.findFirst.mockResolvedValue(null)

    const response = await POST(request())

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "no_unassigned_tickets" })
    expect(state.updateMany).not.toHaveBeenCalled()
  })

  it("does not double-assign when another agent wins the race", async () => {
    state.findFirst.mockResolvedValue({ id: "ticket-1", ticketNumber: "TKT-001", subject: "Payment blocked" })
    state.updateMany.mockResolvedValue({ count: 0 })

    const response = await POST(request())

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: "ticket_claim_conflict" })
    expect(state.findFirst).toHaveBeenCalledTimes(3)
    expect(state.updateMany).toHaveBeenCalledTimes(3)
    expect(state.logAudit).not.toHaveBeenCalled()
  })

  it("rejects extra client-controlled assignment input", async () => {
    const response = await POST(request({ assignedTo: "another-user" }))

    expect(response.status).toBe(400)
    expect(state.findFirst).not.toHaveBeenCalled()
  })
})
