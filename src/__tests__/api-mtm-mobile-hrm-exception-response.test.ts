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

vi.mock("@/lib/workforce/exception-employee-response-rate-limit", () => ({
  requireWorkforceExceptionEmployeeResponseRateLimit: vi.fn(),
}))

vi.mock("@/lib/workforce/exception-employee-response-writer", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workforce/exception-employee-response-writer")>(
    "@/lib/workforce/exception-employee-response-writer",
  )
  return {
    ...actual,
    appendRevisionBoundAuthorizedWorkforceExceptionEmployeeResponse: vi.fn(),
  }
})

vi.mock("@/lib/workforce/sensitive-operation-log", () => ({
  logWorkforceSensitiveOperationFailure: vi.fn(),
}))

import { POST } from "@/app/api/v1/mtm/mobile/hrm/exceptions/[id]/response/route"
import { prisma } from "@/lib/prisma"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { requireWorkforceExceptionEmployeeResponseRateLimit } from "@/lib/workforce/exception-employee-response-rate-limit"
import {
  appendRevisionBoundAuthorizedWorkforceExceptionEmployeeResponse,
  WorkforceExceptionEmployeeResponseWriterError,
} from "@/lib/workforce/exception-employee-response-writer"
import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"

const OPERATION_ID = "11111111-1111-4111-8111-111111111111"
const AUTH = {
  orgId: "org-1",
  agentId: "agent-1",
  userId: "user-1",
  email: "employee@example.test",
  name: "Employee",
  role: "AGENT",
  tenantCapabilities: {
    routeField: false,
    workforceHrm: true,
    workforceExceptionResponse: true,
  },
}

function request(
  body: unknown = { operationId: OPERATION_ID, expectedCaseRevision: 2 },
  caseId = "case-1",
): NextRequest {
  return new NextRequest(`http://localhost/api/v1/mtm/mobile/hrm/exceptions/${caseId}/response`, {
    method: "POST",
    headers: {
      authorization: "Bearer mobile",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  })
}

function rawRequest(body: string): NextRequest {
  return new NextRequest("http://localhost/api/v1/mtm/mobile/hrm/exceptions/case-1/response", {
    method: "POST",
    headers: {
      authorization: "Bearer mobile",
      "content-type": "application/json",
    },
    body,
  })
}

const context = (id = "case-1") => ({ params: Promise.resolve({ id }) })

function expectPrivate(response: Response): void {
  expect(response.headers.get("cache-control")).toBe("private, no-store")
  expect(response.headers.get("x-content-type-options")).toBe("nosniff")
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveMobileAuth).mockResolvedValue(AUTH as never)
  vi.mocked(prisma.workforceExceptionCase.findFirst).mockResolvedValue({
    workdayId: "workday-1",
    segmentId: "segment-1",
  } as never)
  vi.mocked(requireWorkforceExceptionEmployeeResponseRateLimit).mockResolvedValue(null)
  vi.mocked(appendRevisionBoundAuthorizedWorkforceExceptionEmployeeResponse).mockResolvedValue({
    responseId: "private-ledger-id",
    idempotent: false,
  })
})

describe("POST /api/v1/mtm/mobile/hrm/exceptions/[id]/response", () => {
  it("records only a revision-bound acknowledgement derived from fresh mobile scope", async () => {
    const response = await POST(request(), context())

    expect(response.status).toBe(201)
    expectPrivate(response)
    const body = await response.json()
    expect(body).toEqual({
      success: true,
      idempotent: false,
      data: { caseId: "case-1", responseCode: "ACKNOWLEDGED" },
    })
    expect(JSON.stringify(body)).not.toMatch(/private-ledger-id|responseId|observedCaseRevision|proof|location|qr|device/i)
    expect(requireWorkforceExceptionEmployeeResponseRateLimit).toHaveBeenCalledWith({
      organizationId: "org-1",
      principalUserId: "user-1",
    })
    expect(prisma.workforceExceptionCase.findFirst).toHaveBeenCalledWith({
      where: {
        id: "case-1",
        organizationId: "org-1",
        agentId: "agent-1",
        workdayId: { not: null },
      },
      select: { workdayId: true, segmentId: true },
    })
    expect(appendRevisionBoundAuthorizedWorkforceExceptionEmployeeResponse).toHaveBeenCalledWith({
      db: prisma,
      draft: {
        organizationId: "org-1",
        caseId: "case-1",
        agentId: "agent-1",
        workdayId: "workday-1",
        segmentId: "segment-1",
        correctionRequestId: null,
        responseCode: "ACKNOWLEDGED",
        clientResponseId: OPERATION_ID,
        actorUserId: "user-1",
      },
      expectedCaseRevision: 2,
      authorize: expect.any(Function),
    })
    const authorize = vi.mocked(appendRevisionBoundAuthorizedWorkforceExceptionEmployeeResponse)
      .mock.calls[0][0].authorize
    await expect(authorize({
      operation: "EMPLOYEE_RESPONSE_APPEND",
      organizationId: "org-1",
      caseId: "case-1",
      agentId: "agent-1",
      actorUserId: "user-1",
    })).resolves.toBe(true)
    await expect(authorize({
      operation: "EMPLOYEE_RESPONSE_APPEND",
      organizationId: "other-org",
      caseId: "case-1",
      agentId: "agent-1",
      actorUserId: "user-1",
    })).resolves.toBe(false)
  })

  it("returns a minimized 200 response for an exact completed replay", async () => {
    vi.mocked(appendRevisionBoundAuthorizedWorkforceExceptionEmployeeResponse).mockResolvedValueOnce({
      responseId: "private-replay-id",
      idempotent: true,
    })

    const response = await POST(request(), context())

    expect(response.status).toBe(200)
    expectPrivate(response)
    await expect(response.json()).resolves.toEqual({
      success: true,
      idempotent: true,
      data: { caseId: "case-1", responseCode: "ACKNOWLEDGED" },
    })
  })

  it.each([
    ["unknown field", { operationId: OPERATION_ID, expectedCaseRevision: 2, responseCode: "ACKNOWLEDGED" }],
    ["non-UUID operation", { operationId: "mobile-operation-1", expectedCaseRevision: 2 }],
    ["negative revision", { operationId: OPERATION_ID, expectedCaseRevision: -1 }],
    ["over-bound revision", { operationId: OPERATION_ID, expectedCaseRevision: 64 }],
    ["fractional revision", { operationId: OPERATION_ID, expectedCaseRevision: 1.5 }],
  ])("rejects %s before rate limiting or database access", async (_label, body) => {
    const response = await POST(request(body), context())

    expect(response.status).toBe(400)
    expectPrivate(response)
    await expect(response.json()).resolves.toMatchObject({
      code: "WORKFORCE_EXCEPTION_RESPONSE_INVALID",
    })
    expect(requireWorkforceExceptionEmployeeResponseRateLimit).not.toHaveBeenCalled()
    expect(prisma.workforceExceptionCase.findFirst).not.toHaveBeenCalled()
    expect(appendRevisionBoundAuthorizedWorkforceExceptionEmployeeResponse).not.toHaveBeenCalled()
  })

  it("rejects malformed JSON and an invalid case reference before rate limiting", async () => {
    const malformed = await POST(rawRequest("{"), context())
    const invalidPath = await POST(request(), context("bad/case"))

    expect(malformed.status).toBe(400)
    expect(invalidPath.status).toBe(400)
    expectPrivate(malformed)
    expectPrivate(invalidPath)
    expect(requireWorkforceExceptionEmployeeResponseRateLimit).not.toHaveBeenCalled()
    expect(prisma.workforceExceptionCase.findFirst).not.toHaveBeenCalled()
  })

  it("keeps rollout-disabled and unlinked principals outside the limiter and writer", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValueOnce({
      ...AUTH,
      tenantCapabilities: { ...AUTH.tenantCapabilities, workforceExceptionResponse: false },
    } as never)
    const rolloutDisabled = await POST(request(), context())
    expect(rolloutDisabled.status).toBe(409)
    expectPrivate(rolloutDisabled)
    await expect(rolloutDisabled.json()).resolves.toMatchObject({
      code: "WORKFORCE_EXCEPTION_RESPONSE_MIGRATION_REQUIRED",
    })

    vi.mocked(resolveMobileAuth).mockResolvedValueOnce({ ...AUTH, userId: "" } as never)
    const unlinked = await POST(request(), context())
    expect(unlinked.status).toBe(403)
    expectPrivate(unlinked)
    await expect(unlinked.json()).resolves.toMatchObject({
      code: "WORKFORCE_EXCEPTION_RESPONSE_ACCOUNT_LINK_REQUIRED",
    })

    expect(requireWorkforceExceptionEmployeeResponseRateLimit).not.toHaveBeenCalled()
    expect(prisma.workforceExceptionCase.findFirst).not.toHaveBeenCalled()
    expect(appendRevisionBoundAuthorizedWorkforceExceptionEmployeeResponse).not.toHaveBeenCalled()
  })

  it("requires mutate permission before parsing or accessing response state", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({ ...AUTH, role: "UNKNOWN" } as never)

    const response = await POST(request(), context())

    expect(response.status).toBe(403)
    expectPrivate(response)
    await expect(response.json()).resolves.toMatchObject({
      code: "MTM_MOBILE_PERMISSION_REQUIRED",
      permission: "WORKTIME_SELF_MUTATE",
    })
    expect(requireWorkforceExceptionEmployeeResponseRateLimit).not.toHaveBeenCalled()
    expect(prisma.workforceExceptionCase.findFirst).not.toHaveBeenCalled()
  })

  it.each([
    [429, "60"],
    [503, "1"],
  ])("preserves a %s limiter response and never looks up the case", async (status, retryAfter) => {
    vi.mocked(requireWorkforceExceptionEmployeeResponseRateLimit).mockResolvedValueOnce(
      new Response(null, { status, headers: { "Retry-After": retryAfter } }) as never,
    )

    const response = await POST(request(), context())

    expect(response.status).toBe(status)
    expect(response.headers.get("Retry-After")).toBe(retryAfter)
    expectPrivate(response)
    expect(prisma.workforceExceptionCase.findFirst).not.toHaveBeenCalled()
    expect(appendRevisionBoundAuthorizedWorkforceExceptionEmployeeResponse).not.toHaveBeenCalled()
  })

  it("does not distinguish a missing, foreign or reassigned case", async () => {
    vi.mocked(prisma.workforceExceptionCase.findFirst).mockResolvedValue(null as never)

    const response = await POST(request(), context("foreign-case"))

    expect(response.status).toBe(404)
    expectPrivate(response)
    await expect(response.json()).resolves.toEqual({
      error: "This exception is unavailable for an employee response",
      code: "WORKFORCE_EXCEPTION_RESPONSE_UNAVAILABLE",
    })
    expect(appendRevisionBoundAuthorizedWorkforceExceptionEmployeeResponse).not.toHaveBeenCalled()
  })

  it.each([
    [
      "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_REVISION_CONFLICT" as const,
      "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_REVISION_CONFLICT",
    ],
    [
      "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_CASE_UNAVAILABLE" as const,
      "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_CASE_UNAVAILABLE",
    ],
    [
      "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_WRITE_CONFLICT" as const,
      "WORKFORCE_EXCEPTION_EMPLOYEE_RESPONSE_WRITE_CONFLICT",
    ],
  ])("maps %s to a contained conflict", async (writerCode, responseCode) => {
    vi.mocked(appendRevisionBoundAuthorizedWorkforceExceptionEmployeeResponse).mockRejectedValueOnce(
      new WorkforceExceptionEmployeeResponseWriterError(writerCode),
    )

    const response = await POST(request(), context())

    expect(response.status).toBe(409)
    expectPrivate(response)
    await expect(response.json()).resolves.toMatchObject({ code: responseCode })
  })

  it("contains database-link races without exposing constraint details", async () => {
    vi.mocked(appendRevisionBoundAuthorizedWorkforceExceptionEmployeeResponse).mockRejectedValueOnce({
      code: "P2003",
      message: "private database detail",
    })

    const response = await POST(request(), context())

    expect(response.status).toBe(409)
    expectPrivate(response)
    const body = await response.json()
    expect(body).toEqual({
      error: "This exception is unavailable for that employee response",
      code: "WORKFORCE_EXCEPTION_RESPONSE_LINK_INVALID",
    })
    expect(JSON.stringify(body)).not.toContain("private database detail")
  })

  it("logs only a fixed operation label for an unexpected failure", async () => {
    vi.mocked(prisma.workforceExceptionCase.findFirst).mockRejectedValueOnce(
      new Error("private case and operation identifiers"),
    )

    const response = await POST(request(), context())

    expect(response.status).toBe(500)
    expectPrivate(response)
    await expect(response.json()).resolves.toEqual({
      error: "Failed to record Workforce exception acknowledgement",
    })
    expect(logWorkforceSensitiveOperationFailure).toHaveBeenCalledWith({
      operation: "review-exception-response-write",
    })
    expect(JSON.stringify(vi.mocked(logWorkforceSensitiveOperationFailure).mock.calls))
      .not.toMatch(/private case|operation identifiers/i)
  })
})
