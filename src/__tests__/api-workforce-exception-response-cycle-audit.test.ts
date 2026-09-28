import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    mtmAuditLog: { create: vi.fn() },
  },
}))
vi.mock("@/lib/with-workforce-rls-auth", () => ({
  withWorkforceSessionExceptionQueueAuth: vi.fn((handler) => handler),
}))
vi.mock("@/lib/workforce/attendance-route", () => ({
  requireWorkforceAttendanceSecurityMfa: vi.fn(async () => null),
}))
vi.mock("@/lib/workforce/exception-response-cycle-audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workforce/exception-response-cycle-audit")>()
  return { ...actual, runWorkforceExceptionResponseCycleAudit: vi.fn() }
})
vi.mock("@/lib/workforce/exception-response-cycle-audit-rate-limit", () => ({
  requireWorkforceExceptionResponseCycleAuditRateLimit: vi.fn(async () => null),
}))

import { GET } from "@/app/api/v1/workforce/configuration/exception-response-cycle-audit/route"
import { prisma } from "@/lib/prisma"
import { requireWorkforceAttendanceSecurityMfa } from "@/lib/workforce/attendance-route"
import { runWorkforceExceptionResponseCycleAudit } from "@/lib/workforce/exception-response-cycle-audit"
import { requireWorkforceExceptionResponseCycleAuditRateLimit } from "@/lib/workforce/exception-response-cycle-audit-rate-limit"

const AUTH = {
  orgId: "org-cycle-audit",
  userId: "custodian-1",
  role: "admin",
  principalType: "session" as const,
}
const invoke = GET as unknown as (
  request: NextRequest,
  auth: typeof AUTH,
) => Promise<Response>
const report = {
  mode: "DRY_RUN" as const,
  status: "DUPLICATE_CYCLES_DETECTED" as const,
  observedAt: "2026-09-28T12:00:00.000Z",
  duplicateCycleGroups: 2,
  duplicateResponseRows: 5,
  excessResponseRows: 3,
  legacyNullRevisionRows: 4,
  automaticAction: "NONE" as const,
  uniquenessMigrationAuthorized: false as const,
  version: "v1" as const,
}

function request() {
  return new NextRequest(
    "http://localhost/api/v1/workforce/configuration/exception-response-cycle-audit",
    { headers: { "x-real-ip": "203.0.113.55", "user-agent": "cycle-audit-test" } },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireWorkforceAttendanceSecurityMfa).mockResolvedValue(null)
  vi.mocked(requireWorkforceExceptionResponseCycleAuditRateLimit).mockResolvedValue(null)
  vi.mocked(runWorkforceExceptionResponseCycleAudit).mockResolvedValue(report)
  vi.mocked(prisma.mtmAuditLog.create).mockResolvedValue({ id: "audit-1" } as never)
})

describe("GET /api/v1/workforce/configuration/exception-response-cycle-audit", () => {
  it("uses the organization-wide exception-read wrapper and releases only aggregate counts", async () => {
    const response = await invoke(request(), AUTH)

    expect(requireWorkforceAttendanceSecurityMfa).toHaveBeenCalledWith(AUTH.orgId, AUTH)
    expect(requireWorkforceExceptionResponseCycleAuditRateLimit).toHaveBeenCalledWith({
      organizationId: AUTH.orgId,
      principalUserId: AUTH.userId,
    })
    expect(runWorkforceExceptionResponseCycleAudit).toHaveBeenCalledWith(
      expect.anything(),
      { organizationId: AUTH.orgId },
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    await expect(response.json()).resolves.toEqual({ success: true, data: { report } })

    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: AUTH.orgId,
        actorUserId: AUTH.userId,
        action: "WORKFORCE_EXCEPTION_RESPONSE_CYCLE_AUDIT_VIEWED",
        newData: expect.objectContaining({
          status: report.status,
          duplicateCycleGroups: 2,
          legacyNullRevisionRows: 4,
          uniquenessMigrationAuthorized: false,
        }),
      }),
    }))
    const audit = vi.mocked(prisma.mtmAuditLog.create).mock.calls[0]?.[0] as {
      data: { newData: unknown }
    }
    expect(JSON.stringify(audit.data.newData)).not.toMatch(
      /caseId|responseId|agentId|workdayId|requestId|employee/i,
    )
  })

  it("stops before the scan on MFA or shared-budget denial and contains delegated responses", async () => {
    vi.mocked(requireWorkforceAttendanceSecurityMfa).mockResolvedValueOnce(
      NextResponse.json({ code: "WORKFORCE_ATTENDANCE_MFA_REQUIRED" }, { status: 403 }),
    )
    const mfaDenied = await invoke(request(), AUTH)
    expect(mfaDenied.status).toBe(403)
    expect(mfaDenied.headers.get("cache-control")).toBe("private, no-store")
    expect(requireWorkforceExceptionResponseCycleAuditRateLimit).not.toHaveBeenCalled()
    expect(runWorkforceExceptionResponseCycleAudit).not.toHaveBeenCalled()

    vi.mocked(requireWorkforceAttendanceSecurityMfa).mockResolvedValueOnce(null)
    vi.mocked(requireWorkforceExceptionResponseCycleAuditRateLimit).mockResolvedValueOnce(
      NextResponse.json({ code: "RATE_LIMITED" }, { status: 429 }),
    )
    const rateDenied = await invoke(request(), AUTH)
    expect(rateDenied.status).toBe(429)
    expect(rateDenied.headers.get("x-content-type-options")).toBe("nosniff")
    expect(runWorkforceExceptionResponseCycleAudit).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("does not release a successful snapshot before its audit append settles", async () => {
    let releaseAudit!: () => void
    vi.mocked(prisma.mtmAuditLog.create).mockImplementationOnce(() => new Promise((resolve) => {
      releaseAudit = () => resolve({ id: "audit-delayed" } as never)
    }))
    let responseSettled = false
    const pendingResponse = invoke(request(), AUTH).then((response) => {
      responseSettled = true
      return response
    })

    await vi.waitFor(() => expect(prisma.mtmAuditLog.create).toHaveBeenCalledTimes(1))
    expect(responseSettled).toBe(false)
    releaseAudit()

    await expect(pendingResponse).resolves.toMatchObject({ status: 200 })
  })

  it("fails closed when the scan or mandatory audit cannot complete", async () => {
    const privateFailure = new Error("case-private response-private")
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    vi.mocked(runWorkforceExceptionResponseCycleAudit).mockRejectedValueOnce(privateFailure)

    const scanFailure = await invoke(request(), AUTH)
    expect(scanFailure.status).toBe(503)
    await expect(scanFailure.json()).resolves.toEqual({
      error: "Workforce exception-response cycle audit is unavailable.",
      code: "WORKFORCE_EXCEPTION_RESPONSE_CYCLE_AUDIT_UNAVAILABLE",
    })
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith(
      "[workforce/privacy] sensitive operation failed",
      { operation: "configuration-exception-response-cycle-audit" },
    )
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(privateFailure.message)

    vi.mocked(runWorkforceExceptionResponseCycleAudit).mockResolvedValueOnce(report)
    vi.mocked(prisma.mtmAuditLog.create).mockRejectedValueOnce(privateFailure)
    const auditFailure = await invoke(request(), AUTH)
    expect(auditFailure.status).toBe(503)
    expect(auditFailure.headers.get("cache-control")).toBe("private, no-store")
  })
})
