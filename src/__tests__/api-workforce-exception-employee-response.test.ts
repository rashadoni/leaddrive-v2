import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const { transaction, findFirst, organizationFindUnique } = vi.hoisted(() => ({
  transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback({})),
  findFirst: vi.fn(),
  organizationFindUnique: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: transaction,
    organization: { findUnique: organizationFindUnique },
    workforceExceptionCase: { findFirst },
  },
}))
vi.mock("@/lib/with-workforce-rls-auth", () => ({
  withWorkforceSessionAuth: vi.fn((_action, handler) => handler),
}))
vi.mock("@/lib/workforce/actor", () => ({ resolveWorkforceActor: vi.fn() }))
vi.mock("@/lib/workforce/exception-employee-response-writer", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workforce/exception-employee-response-writer")>(
    "@/lib/workforce/exception-employee-response-writer",
  )
  return { ...actual, appendAuthorizedWorkforceExceptionEmployeeResponse: vi.fn() }
})

import { POST } from "@/app/api/v1/workforce/exceptions/[id]/response/route"
import { withWorkforceSessionAuth } from "@/lib/with-workforce-rls-auth"
import { resolveWorkforceActor } from "@/lib/workforce/actor"
import {
  appendAuthorizedWorkforceExceptionEmployeeResponse,
  WorkforceExceptionEmployeeResponseWriterError,
} from "@/lib/workforce/exception-employee-response-writer"
import { WORKFORCE_EXCEPTION_RESPONSE_FLAG } from "@/lib/workforce/exception-response-rollout"

const AUTH = { orgId: "org-1", userId: "user-1", role: "sales" }
const callPost = POST as unknown as (
  request: NextRequest,
  auth: typeof AUTH,
  context: { params: Promise<{ id: string }> },
) => Promise<Response>

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/v1/workforce/exceptions/case-1/response", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  findFirst.mockReset()
  organizationFindUnique.mockReset()
  organizationFindUnique.mockResolvedValue({ features: [WORKFORCE_EXCEPTION_RESPONSE_FLAG] })
  transaction.mockClear()
  vi.mocked(resolveWorkforceActor).mockReset()
  vi.mocked(appendAuthorizedWorkforceExceptionEmployeeResponse).mockReset()
})

describe("Workforce employee exception response API", () => {
  it("uses a session-only write boundary and derives exact own case links on the server", async () => {
    vi.mocked(resolveWorkforceActor).mockResolvedValue({ agentId: "agent-1", role: "AGENT", scopedAgentIds: ["agent-1"] })
    findFirst.mockResolvedValue({ workdayId: "workday-1", segmentId: "segment-1" })
    vi.mocked(appendAuthorizedWorkforceExceptionEmployeeResponse).mockResolvedValue({ responseId: "response-1", idempotent: false })

    const response = await callPost(request({
      responseCode: "CORRECTION_REQUESTED",
      correctionRequestId: "request-1",
      clientResponseId: "response-client-1",
    }), AUTH, { params: Promise.resolve({ id: "case-1" }) })

    expect(response.status).toBe(201)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    await expect(response.json()).resolves.toEqual({ success: true, idempotent: false, data: { responseId: "response-1" } })
    expect(findFirst).toHaveBeenCalledWith({
      where: { organizationId: "org-1", id: "case-1", agentId: "agent-1", workdayId: { not: null } },
      select: { workdayId: true, segmentId: true },
    })
    expect(appendAuthorizedWorkforceExceptionEmployeeResponse).toHaveBeenCalledWith(expect.objectContaining({
      draft: expect.objectContaining({
        organizationId: "org-1",
        caseId: "case-1",
        agentId: "agent-1",
        workdayId: "workday-1",
        segmentId: "segment-1",
        correctionRequestId: "request-1",
        actorUserId: "user-1",
      }),
    }))
    expect(withWorkforceSessionAuth).toHaveBeenCalledWith("write", expect.any(Function))
  })

  it("keeps the acknowledgement writer fenced until the tenant rollout is explicitly enabled", async () => {
    vi.mocked(resolveWorkforceActor).mockResolvedValue({ agentId: "agent-1", role: "AGENT", scopedAgentIds: ["agent-1"] })
    organizationFindUnique.mockResolvedValue({ features: [] })

    const response = await callPost(request({ responseCode: "ACKNOWLEDGED", clientResponseId: "response-client-disabled" }), AUTH, {
      params: Promise.resolve({ id: "case-1" }),
    })

    expect(response.status).toBe(409)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    await expect(response.json()).resolves.toEqual({
      error: "Employee exception acknowledgement is not available for this organization",
      code: "WORKFORCE_EXCEPTION_RESPONSE_MIGRATION_REQUIRED",
    })
    expect(findFirst).not.toHaveBeenCalled()
    expect(appendAuthorizedWorkforceExceptionEmployeeResponse).not.toHaveBeenCalled()
  })

  it("does not use an unavailable or another employee's case as an id oracle", async () => {
    vi.mocked(resolveWorkforceActor).mockResolvedValue({ agentId: "agent-1", role: "AGENT", scopedAgentIds: ["agent-1"] })
    findFirst.mockResolvedValue(null)

    const response = await callPost(request({ responseCode: "ACKNOWLEDGED", clientResponseId: "response-client-2" }), AUTH, {
      params: Promise.resolve({ id: "other-case" }),
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: "This exception is unavailable for an employee response",
      code: "WORKFORCE_EXCEPTION_RESPONSE_UNAVAILABLE",
    })
    expect(appendAuthorizedWorkforceExceptionEmployeeResponse).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
  })

  it("requires a self employee actor and rejects a malformed request before case lookup", async () => {
    vi.mocked(resolveWorkforceActor).mockResolvedValue({ agentId: null, role: "ADMIN", scopedAgentIds: null })
    const denied = await callPost(request({ responseCode: "ACKNOWLEDGED", clientResponseId: "response-client-3" }), AUTH, {
      params: Promise.resolve({ id: "case-1" }),
    })
    expect(denied.status).toBe(403)

    vi.mocked(resolveWorkforceActor).mockResolvedValue({ agentId: "agent-1", role: "AGENT", scopedAgentIds: ["agent-1"] })
    const invalid = await callPost(request({ responseCode: "CORRECTION_REQUESTED", clientResponseId: "response-client-4" }), AUTH, {
      params: Promise.resolve({ id: "case-1" }),
    })
    expect(invalid.status).toBe(400)
    expect(findFirst).not.toHaveBeenCalled()
    expect(appendAuthorizedWorkforceExceptionEmployeeResponse).not.toHaveBeenCalled()
  })

  it("returns an idempotency conflict without making a second response", async () => {
    vi.mocked(resolveWorkforceActor).mockResolvedValue({ agentId: "agent-1", role: "AGENT", scopedAgentIds: ["agent-1"] })
    findFirst.mockResolvedValue({ workdayId: "workday-1", segmentId: null })
    vi.mocked(appendAuthorizedWorkforceExceptionEmployeeResponse).mockRejectedValue(
      new WorkforceExceptionEmployeeResponseWriterError("WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_WRITE_CONFLICT"),
    )

    const response = await callPost(request({ responseCode: "ACKNOWLEDGED", clientResponseId: "response-client-5" }), AUTH, {
      params: Promise.resolve({ id: "case-1" }),
    })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: "This response id was already used for different case details",
      code: "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_WRITE_CONFLICT",
    })
  })
})
