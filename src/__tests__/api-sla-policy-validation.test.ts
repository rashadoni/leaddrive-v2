import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
  deleteMany: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    slaPolicy: {
      findMany: mocks.findMany,
      findFirst: mocks.findFirst,
      create: mocks.create,
      updateMany: mocks.updateMany,
      deleteMany: mocks.deleteMany,
    },
  },
}))

vi.mock("@/lib/with-rls", () => ({
  withRls: (handler: (
    request: NextRequest,
    auth: { orgId: string; session: null },
    context?: unknown,
  ) => unknown) => (request: NextRequest, context?: unknown) =>
    handler(request, { orgId: "org-1", session: null }, context),
}))

import { POST } from "@/app/api/v1/sla-policies/route"
import { DELETE, PUT } from "@/app/api/v1/sla-policies/[id]/route"

const request = (path: string, method: string, body?: unknown) => new NextRequest(`http://localhost${path}`, {
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
})
const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.transaction.mockImplementation(async (callback: (tx: { slaPolicy: unknown }) => unknown) => callback({
    slaPolicy: {
      findMany: mocks.findMany,
      findFirst: mocks.findFirst,
      create: mocks.create,
      updateMany: mocks.updateMany,
      deleteMany: mocks.deleteMany,
    },
  }))
})

describe("SLA policy API validation", () => {
  it("rejects resolution earlier than first response before writing", async () => {
    const response = await POST(request("/api/v1/sla-policies", "POST", {
      name: "Invalid", priority: "high", firstResponseHours: 4, resolutionHours: 2,
    }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "RESOLUTION_BEFORE_RESPONSE" })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("rejects a second active policy for the same priority transactionally", async () => {
    mocks.findFirst.mockResolvedValueOnce({ id: "existing" })
    const response = await POST(request("/api/v1/sla-policies", "POST", {
      name: "Duplicate", priority: "critical", firstResponseHours: 1, resolutionHours: 4,
    }))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "ACTIVE_PRIORITY_CONFLICT" })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it("allows an inactive policy with a duplicate priority", async () => {
    mocks.create.mockResolvedValueOnce({ id: "inactive", priority: "critical", isActive: false })
    const response = await POST(request("/api/v1/sla-policies", "POST", {
      name: "Draft alternative", priority: "critical", firstResponseHours: 1,
      resolutionHours: 4, isActive: false,
    }))
    expect(response.status).toBe(201)
    expect(mocks.findFirst).not.toHaveBeenCalled()
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ organizationId: "org-1", isActive: false }),
    }))
  })

  it("merges existing targets and blocks an active conflict on update", async () => {
    mocks.findFirst
      .mockResolvedValueOnce({
        id: "edited", priority: "medium", firstResponseHours: 2, resolutionHours: 8,
        businessHoursOnly: true, isActive: true,
      })
      .mockResolvedValueOnce({ id: "other" })
    const response = await PUT(
      request("/api/v1/sla-policies/edited", "PUT", { priority: "high" }),
      params("edited"),
    )
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "ACTIVE_PRIORITY_CONFLICT" })
    expect(mocks.updateMany).not.toHaveBeenCalled()
  })

  it("validates a partial update against the existing first-response target", async () => {
    mocks.findFirst.mockResolvedValueOnce({
      id: "edited", priority: "medium", firstResponseHours: 4, resolutionHours: 8,
      businessHoursOnly: true, isActive: false,
    })
    const response = await PUT(
      request("/api/v1/sla-policies/edited", "PUT", { resolutionHours: 2 }),
      params("edited"),
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "RESOLUTION_BEFORE_RESPONSE" })
    expect(mocks.updateMany).not.toHaveBeenCalled()
  })

  it("blocks deletion when an entitlement depends on the policy", async () => {
    mocks.findFirst.mockResolvedValueOnce({
      id: "used", _count: { companies: 2, entitlements: 1 },
    })
    const response = await DELETE(request("/api/v1/sla-policies/used", "DELETE"), params("used"))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "POLICY_IN_USE" })
    expect(mocks.deleteMany).not.toHaveBeenCalled()
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "used", organizationId: "org-1" },
    }))
  })
})
