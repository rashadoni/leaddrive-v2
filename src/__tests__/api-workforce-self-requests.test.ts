import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/with-workforce-rls-auth", () => ({
  withWorkforceRlsAuth: vi.fn((_action, handler) => handler),
  withWorkforceSessionAuth: vi.fn((_action, handler) => handler),
}))
vi.mock("@/lib/mtm-settings", () => ({
  getMtmSettings: vi.fn(),
}))
vi.mock("@/lib/workforce/actor", () => ({
  resolveWorkforceActor: vi.fn(),
}))
vi.mock("@/lib/workforce/self-request", () => ({
  WorkforceSelfRequestSchema: {
    safeParse: vi.fn((value: unknown) => (
      value && typeof value === "object" && (value as { clientRequestId?: unknown }).clientRequestId
        ? { success: true, data: value }
        : { success: false, error: { issues: [{ message: "Invalid self request" }] } }
    )),
  },
  submitWorkforceSelfRequest: vi.fn(),
  cancelWorkforceSelfRequest: vi.fn(),
}))

import { GET as listRequests, POST as submitRequest } from "@/app/api/v1/workforce/requests/route"
import { POST as cancelRequest } from "@/app/api/v1/workforce/requests/[id]/cancel/route"
import { getMtmSettings } from "@/lib/mtm-settings"
import { prisma } from "@/lib/prisma"
import { resolveWorkforceActor } from "@/lib/workforce/actor"
import { cancelWorkforceSelfRequest, submitWorkforceSelfRequest } from "@/lib/workforce/self-request"

const AUTH = { orgId: "org-workforce", userId: "user-1", role: "sales" }
type RouteContext = { params: Promise<{ id: string }> }
const invokeSubmit = submitRequest as unknown as (request: NextRequest, auth: typeof AUTH) => Promise<Response>
const invokeList = listRequests as unknown as (request: NextRequest, auth: typeof AUTH) => Promise<Response>
const invokeCancel = cancelRequest as unknown as (
  request: NextRequest,
  auth: typeof AUTH,
  context: RouteContext,
) => Promise<Response>

function request(body: unknown) {
  return new NextRequest("http://localhost:3000/api/v1/workforce/requests", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "vitest-self-request-route" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getMtmSettings).mockResolvedValue({ timezone: "Asia/Baku" } as never)
  vi.mocked(resolveWorkforceActor).mockResolvedValue({
    agentId: "agent-1", role: "AGENT", scopedAgentIds: ["agent-1"],
  })
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({ features: [] } as never)
})

describe("Workforce self-request web routes", () => {
  it("lists correction choices only from the signed-in employee's own workdays", async () => {
    vi.mocked(prisma.mtmAgentWorkday.findMany).mockResolvedValue([{
      id: "workday-1", workDate: new Date("2026-09-01T00:00:00.000Z"), status: "COMPLETED", completedAt: new Date(),
    }] as never)

    const response = await invokeList(new NextRequest("http://localhost:3000/api/v1/workforce/requests"), AUTH)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { canSubmitSelf: true, selfWorkdays: [{ id: "workday-1" }] },
    })
    expect(prisma.mtmAgentWorkday.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: AUTH.orgId, agentId: "agent-1" },
    }))
  })

  it("submits only through the self-scoped session route", async () => {
    vi.mocked(submitWorkforceSelfRequest).mockResolvedValue({
      kind: "success",
      idempotent: false,
      data: { id: "request-1", status: "PENDING" },
    } as never)

    const response = await invokeSubmit(request({
      clientRequestId: "request-key-123",
      type: "LEAVE",
      startDate: "2026-09-01",
      endDate: "2026-09-01",
      reason: "Annual leave",
    }), AUTH)

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      idempotent: false,
      data: { id: "request-1", status: "PENDING" },
    })
    expect(submitWorkforceSelfRequest).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: AUTH.orgId,
      timezone: "Asia/Baku",
      actor: expect.objectContaining({ agentId: "agent-1", role: "AGENT" }),
    }))
  })

  it("does not let a manager submit an employee request through the self route", async () => {
    vi.mocked(resolveWorkforceActor).mockResolvedValue({
      agentId: null, role: "ADMIN", scopedAgentIds: null,
    })

    const response = await invokeSubmit(request({
      clientRequestId: "request-key-123",
      type: "LEAVE",
      startDate: "2026-09-01",
      endDate: "2026-09-01",
      reason: "Annual leave",
    }), AUTH)

    expect(response.status).toBe(403)
    expect(submitWorkforceSelfRequest).not.toHaveBeenCalled()
  })

  it("returns conflict details without a second write and lets the employee cancel their own pending request", async () => {
    vi.mocked(submitWorkforceSelfRequest).mockResolvedValue({
      kind: "conflict",
      code: "WORKFORCE_SELF_REQUEST_OVERLAP",
      message: "An active Workforce request already covers this time",
      request: { id: "request-other", type: "LEAVE", status: "PENDING", startDate: new Date(), endDate: new Date() },
    } as never)
    const conflict = await invokeSubmit(request({
      clientRequestId: "request-key-123",
      type: "LEAVE",
      startDate: "2026-09-01",
      endDate: "2026-09-01",
      reason: "Annual leave",
    }), AUTH)
    expect(conflict.status).toBe(409)
    await expect(conflict.json()).resolves.toMatchObject({ code: "WORKFORCE_SELF_REQUEST_OVERLAP" })

    vi.mocked(cancelWorkforceSelfRequest).mockResolvedValue({
      kind: "success",
      idempotent: true,
      data: { id: "request-1", status: "CANCELLED" },
    } as never)
    const cancelled = await invokeCancel(request({}), AUTH, { params: Promise.resolve({ id: "request-1" }) })

    expect(cancelled.status).toBe(200)
    await expect(cancelled.json()).resolves.toMatchObject({
      success: true,
      idempotent: true,
      data: { id: "request-1", status: "CANCELLED" },
    })
    expect(cancelWorkforceSelfRequest).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: AUTH.orgId,
      actor: expect.objectContaining({ agentId: "agent-1", role: "AGENT" }),
      requestId: "request-1",
    }))
  })
})
