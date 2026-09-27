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

vi.mock("@/lib/workforce/sensitive-operation-log", () => ({
  logWorkforceSensitiveOperationFailure: vi.fn(),
}))

import { GET } from "@/app/api/v1/mtm/mobile/hrm/exceptions/route"
import { prisma } from "@/lib/prisma"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"

function request() {
  return new NextRequest("http://localhost/api/v1/mtm/mobile/hrm/exceptions", {
    headers: { Authorization: "Bearer mobile" },
  })
}

const AUTH = {
  orgId: "org-1",
  agentId: "agent-1",
  userId: "user-1",
  role: "AGENT",
  tenantCapabilities: { routeField: false, workforceHrm: true },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveMobileAuth).mockResolvedValue(AUTH as never)
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1" } as never)
  vi.mocked(prisma.workforceExceptionCase.findMany).mockResolvedValue([])
})

describe("GET /api/v1/mtm/mobile/hrm/exceptions", () => {
  it("returns only the authenticated employee's bounded generic correction cards", async () => {
    vi.mocked(prisma.workforceExceptionCase.findMany).mockResolvedValue([{
      id: "case-00000001",
      kind: "LATE_START",
      createdAt: new Date("2026-08-31T09:00:00.000Z"),
      workday: { id: "workday-1", workDate: new Date("2026-08-30T00:00:00.000Z") },
      rawLocation: "RAW_LOCATION_MUST_NOT_LEAK",
      qrPayload: "RAW_QR_MUST_NOT_LEAK",
      deviceProof: "RAW_DEVICE_MUST_NOT_LEAK",
      reason: "RAW_REASON_MUST_NOT_LEAK",
      decisions: [{
        decisionCode: "REQUEST_EMPLOYEE_RESPONSE",
        caseRevision: 1,
        reason: "RAW_DECISION_REASON_MUST_NOT_LEAK",
      }],
      employeeResponses: [{
        id: "response-private",
        observedCaseRevision: 1,
        responseCode: "ACKNOWLEDGED",
        reason: "RAW_RESPONSE_REASON_MUST_NOT_LEAK",
      }],
    }] as never)

    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    const body = await response.json()
    expect(body).toMatchObject({
      success: true,
      data: {
        disposition: "SELF_SERVICE_CORRECTION_ONLY",
        responseRecording: "MIGRATION_REQUIRED",
        cases: [{
          caseId: "case-00000001",
          displayReference: "WF-00000001",
          type: "LATE_START",
          workdayId: "workday-1",
          availableAction: "REQUEST_CORRECTION",
          responseState: "UNAVAILABLE",
          availableResponseAction: null,
        }],
      },
    })
    expect(JSON.stringify(body)).not.toMatch(/RAW_|response-private|ACKNOWLEDGED/)
    expect(prisma.workforceExceptionCase.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", agentId: "agent-1", workdayId: { not: null } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 101,
      select: {
        id: true,
        kind: true,
        createdAt: true,
        workday: { select: { id: true, workDate: true } },
      },
    })
  })

  it("projects only bounded current-cycle response state for a rolled-out tenant", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      ...AUTH,
      tenantCapabilities: {
        ...AUTH.tenantCapabilities,
        workforceExceptionResponse: true,
      },
    } as never)
    vi.mocked(prisma.workforceExceptionCase.findMany).mockResolvedValue([
      {
        id: "case-acknowledged",
        kind: "LATE_START",
        createdAt: new Date("2026-08-31T09:00:00.000Z"),
        workday: { id: "workday-1", workDate: new Date("2026-08-30T00:00:00.000Z") },
        decisions: [{
          decisionCode: "REQUEST_EMPLOYEE_RESPONSE",
          caseRevision: 1,
          reason: "PRIVATE_DECISION_REASON",
        }],
        employeeResponses: [{
          id: "private-response-id",
          observedCaseRevision: 1,
          responseCode: "ACKNOWLEDGED",
          reason: "PRIVATE_RESPONSE_REASON",
        }],
      },
      {
        id: "case-not-acknowledged",
        kind: "MISSING_FINISH",
        createdAt: new Date("2026-08-30T18:00:00.000Z"),
        workday: { id: "workday-2", workDate: new Date("2026-08-29T00:00:00.000Z") },
        decisions: [{ decisionCode: "REQUEST_EMPLOYEE_RESPONSE", caseRevision: 1 }],
        employeeResponses: [],
      },
      {
        id: "case-future-response",
        kind: "DELAYED_CLAIM",
        createdAt: new Date("2026-08-29T09:00:00.000Z"),
        workday: { id: "workday-3", workDate: new Date("2026-08-28T00:00:00.000Z") },
        decisions: [{ decisionCode: "REQUEST_EMPLOYEE_RESPONSE", caseRevision: 1 }],
        employeeResponses: [{ observedCaseRevision: 2 }],
      },
    ] as never)

    const response = await GET(request())

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toMatchObject({
      responseRecording: "AVAILABLE",
      cases: [
        {
          caseId: "case-acknowledged",
          responseState: "ACKNOWLEDGED",
          availableResponseAction: null,
        },
        {
          caseId: "case-not-acknowledged",
          responseState: "NOT_ACKNOWLEDGED",
          availableResponseAction: { kind: "ACKNOWLEDGE", expectedCaseRevision: 1 },
        },
        {
          caseId: "case-future-response",
          responseState: "UNAVAILABLE",
          availableResponseAction: null,
        },
      ],
    })
    expect(JSON.stringify(body)).not.toMatch(/PRIVATE_|private-response-id|responseCode|observedCaseRevision|decisionCode/)
    expect(prisma.workforceExceptionCase.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", agentId: "agent-1", workdayId: { not: null } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 101,
      select: {
        id: true,
        kind: true,
        createdAt: true,
        workday: { select: { id: true, workDate: true } },
        decisions: {
          orderBy: { caseRevision: "asc" },
          take: 65,
          select: { decisionCode: true, caseRevision: true },
        },
        employeeResponses: {
          where: { observedCaseRevision: { not: null } },
          orderBy: [{ observedCaseRevision: "desc" }, { id: "desc" }],
          take: 1,
          select: { observedCaseRevision: true },
        },
      },
    })
  })

  it("withholds acknowledgement authority from an unlinked mobile principal", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      ...AUTH,
      userId: "",
      tenantCapabilities: {
        ...AUTH.tenantCapabilities,
        workforceExceptionResponse: true,
      },
    } as never)
    vi.mocked(prisma.workforceExceptionCase.findMany).mockResolvedValue([{
      id: "case-not-acknowledged",
      kind: "MISSING_FINISH",
      createdAt: new Date("2026-08-30T18:00:00.000Z"),
      workday: { id: "workday-2", workDate: new Date("2026-08-29T00:00:00.000Z") },
      decisions: [{ decisionCode: "REQUEST_EMPLOYEE_RESPONSE", caseRevision: 1 }],
      employeeResponses: [],
    }] as never)

    const response = await GET(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: {
        cases: [{
          caseId: "case-not-acknowledged",
          responseState: "NOT_ACKNOWLEDGED",
          availableResponseAction: null,
        }],
      },
    })
  })

  it("rejects a disabled tenant before reading employee or exception records", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      ...AUTH,
      tenantCapabilities: { routeField: true, workforceHrm: false },
    } as never)

    const response = await GET(request())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      code: "TENANT_CAPABILITY_DISABLED",
      capabilityId: "workforce-hrm",
    })
    expect(prisma.mtmAgent.findFirst).not.toHaveBeenCalled()
    expect(prisma.workforceExceptionCase.findMany).not.toHaveBeenCalled()
  })

  it("fails closed instead of silently truncating more than one safe page", async () => {
    vi.mocked(prisma.workforceExceptionCase.findMany).mockResolvedValue(
      Array.from({ length: 101 }, () => ({
        id: "case-00000001",
        kind: "LATE_START",
        createdAt: new Date("2026-08-31T09:00:00.000Z"),
        workday: { id: "workday-1", workDate: new Date("2026-08-30T00:00:00.000Z") },
      })) as never,
    )

    const response = await GET(request())

    expect(response.status).toBe(413)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    await expect(response.json()).resolves.toMatchObject({ code: "WORKFORCE_SELF_EXCEPTION_LIMIT_EXCEEDED" })
  })

  it("contains an unexpected read failure behind a fixed privacy-safe log label", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockRejectedValueOnce(
      new Error("private employee and tenant identifiers"),
    )

    const response = await GET(request())

    expect(response.status).toBe(500)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    await expect(response.json()).resolves.toEqual({
      error: "Failed to load personal Workforce exceptions",
    })
    expect(logWorkforceSensitiveOperationFailure).toHaveBeenCalledWith({
      operation: "read-exception-queue",
    })
    expect(JSON.stringify(vi.mocked(logWorkforceSensitiveOperationFailure).mock.calls))
      .not.toMatch(/private employee|tenant identifiers/i)
  })
})
