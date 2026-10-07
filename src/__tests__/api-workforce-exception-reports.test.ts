import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const reportDb = vi.hoisted(() => ({
  workforceExceptionCase: { findMany: vi.fn() },
  workforceTimeCorrection: { findMany: vi.fn() },
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    ...reportDb,
    $transaction: vi.fn(async (callback: (db: typeof reportDb) => Promise<unknown>) => callback(reportDb)),
    mtmAuditLog: { create: vi.fn() },
  },
}))
vi.mock("@/lib/with-workforce-rls-auth", () => ({
  withWorkforceSessionExceptionQueueAuth: vi.fn((handler) => handler),
}))
vi.mock("@/lib/mtm-settings", () => ({ getMtmSettings: vi.fn() }))
vi.mock("@/lib/workforce/approved-report-rate-limit", () => ({
  requireWorkforceExceptionReportRateLimit: vi.fn(async () => null),
}))
vi.mock("@/lib/workforce/sensitive-operation-log", () => ({
  logWorkforceSensitiveOperationFailure: vi.fn(),
}))

import { GET } from "@/app/api/v1/workforce/exception-reports/route"
import { getMtmSettings } from "@/lib/mtm-settings"
import { prisma } from "@/lib/prisma"
import { withWorkforceSessionExceptionQueueAuth } from "@/lib/with-workforce-rls-auth"
import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"
import { requireWorkforceExceptionReportRateLimit } from "@/lib/workforce/approved-report-rate-limit"

const AUTH = { orgId: "org-workforce", userId: "admin-1", role: "admin", principalType: "session" as const }
const invoke = GET as unknown as (request: NextRequest, auth: typeof AUTH) => Promise<Response>

function caseRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "case-internal-1",
    organizationId: AUTH.orgId,
    workdayId: "workday-internal-1",
    createdAt: new Date("2026-08-28T00:00:00Z"),
    agentId: "agent-1",
    kind: "NO_SHOW",
    decisions: [{ decisionCode: "ACKNOWLEDGE", caseRevision: 1, createdAt: new Date("2026-08-28T01:00:00Z") }],
    employeeResponses: [],
    ...overrides,
  }
}

beforeEach(() => {
  // Preserve the module-load wrapper invocation so the contract can prove
  // this route uses the exception-specific C7 authorization boundary.
  vi.mocked(prisma.workforceExceptionCase.findMany).mockReset()
  vi.mocked(prisma.workforceTimeCorrection.findMany).mockReset()
  vi.mocked(prisma.$transaction).mockClear()
  vi.mocked(prisma.mtmAuditLog.create).mockReset()
  vi.mocked(getMtmSettings).mockReset()
  vi.mocked(getMtmSettings).mockResolvedValue({ timezone: "Asia/Baku" } as never)
  vi.mocked(prisma.workforceExceptionCase.findMany).mockResolvedValue([])
  vi.mocked(prisma.workforceTimeCorrection.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmAuditLog.create).mockResolvedValue({} as never)
  vi.mocked(requireWorkforceExceptionReportRateLimit).mockResolvedValue(null)
})

describe("GET /api/v1/workforce/exception-reports", () => {
  it("uses the separate exception grant and returns a tenant-local aggregate with no case or proof data", async () => {
    vi.mocked(prisma.workforceExceptionCase.findMany).mockResolvedValue([
      caseRecord({
        rawLocation: "RAW_LOCATION_MUST_NOT_LEAK",
        decisionReason: "RAW_REASON_MUST_NOT_LEAK",
        employeeResponses: [{ id: "response-internal-1", text: "RAW_RESPONSE_MUST_NOT_LEAK" }],
      }),
      caseRecord({ id: "case-internal-2", agentId: "agent-2", kind: "LATE_START", decisions: [] }),
    ] as never)

    const response = await invoke(new NextRequest("http://localhost:3000/api/v1/workforce/exception-reports?start=2026-08-28&end=2026-08-28", {
      headers: { "user-agent": "vitest-exception-report" },
    }), AUTH)

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    const body = await response.json()
    expect(body).toMatchObject({
      success: true,
      data: {
        timezone: "Asia/Baku",
        start: "2026-08-28",
        end: "2026-08-28",
        dateBasis: "CASE_RECORDED_AT",
        report: {
          source: "APPEND_ONLY_EXCEPTION_CASES",
          summary: { employees: 2, cases: 2, open: 1, hrReview: 1, employeeResponsesReceived: 1 },
          unavailable: {
            employeeDetails: "EXCLUDED_FROM_AGGREGATE",
            rawEvidence: "EXCLUDED_FROM_AGGREGATE",
            attendanceConclusion: "CASE_COUNTS_ARE_NOT_PRESENCE_OR_DISCIPLINARY_CONCLUSIONS",
          },
        },
      },
    })
    expect(JSON.stringify(body)).not.toMatch(/agent-|RAW_LOCATION|RAW_REASON|RAW_RESPONSE|response-internal|case-internal|workday-internal|request-internal/)
    expect(prisma.workforceExceptionCase.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: AUTH.orgId,
        createdAt: {
          gte: new Date("2026-08-27T20:00:00.000Z"),
          lt: new Date("2026-08-28T20:00:00.000Z"),
        },
      },
      take: 5_001,
      select: expect.objectContaining({
        decisions: expect.objectContaining({
          orderBy: { caseRevision: "asc" },
          take: 65,
          select: { decisionCode: true, caseRevision: true, createdAt: true },
        }),
      }),
    }))
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "WORKFORCE_EXCEPTION_REPORT_VIEWED",
        newData: expect.not.objectContaining({ agentId: expect.anything(), caseId: expect.anything(), rawEnvelopeCiphertext: expect.anything() }),
      }),
    }))
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "RepeatableRead", maxWait: 5_000, timeout: 10_000,
    })
    expect(withWorkforceSessionExceptionQueueAuth).toHaveBeenCalledTimes(1)
  })

  it("rejects an invalid date range before reading cases", async () => {
    const response = await invoke(new NextRequest("http://localhost:3000/api/v1/workforce/exception-reports?start=bad&end=2026-08-28"), AUTH)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ code: "WORKFORCE_EXCEPTION_REPORT_RANGE_INVALID" })
    expect(prisma.workforceExceptionCase.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("stops before settings, case reads and audit when rate limited", async () => {
    vi.mocked(requireWorkforceExceptionReportRateLimit).mockResolvedValueOnce(
      new Response(null, { status: 429 }) as never,
    )

    const response = await invoke(new NextRequest("http://localhost:3000/api/v1/workforce/exception-reports"), AUTH)

    expect(response.status).toBe(429)
    expect(getMtmSettings).not.toHaveBeenCalled()
    expect(prisma.workforceExceptionCase.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("fails explicit rather than returning a false empty aggregate when the C6 case table is unavailable", async () => {
    vi.mocked(prisma.workforceExceptionCase.findMany).mockRejectedValue({ code: "P2021" })

    const response = await invoke(new NextRequest("http://localhost:3000/api/v1/workforce/exception-reports?start=2026-08-28&end=2026-08-28"), AUTH)

    expect(response.status).toBe(503)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    await expect(response.json()).resolves.toMatchObject({ code: "WORKFORCE_EXCEPTION_REPORT_UNAVAILABLE" })
    expect(logWorkforceSensitiveOperationFailure).toHaveBeenCalledWith({
      operation: "read-exception-case-report",
    })
  })

  it("refuses an oversized period rather than truncating its count", async () => {
    vi.mocked(prisma.workforceExceptionCase.findMany).mockResolvedValue(
      Array.from({ length: 5_001 }, () => caseRecord()) as never,
    )

    const response = await invoke(new NextRequest("http://localhost:3000/api/v1/workforce/exception-reports?start=2026-08-28&end=2026-08-28"), AUTH)

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toMatchObject({ code: "WORKFORCE_EXCEPTION_REPORT_LIMIT_EXCEEDED" })
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  function linkedProof(overrides: Record<string, unknown> = {}) {
    return {
      organizationId: AUTH.orgId, agentId: "agent-1", workdayId: "workday-internal-1",
      requestId: "request-internal-1", source: "REQUEST_APPROVAL",
      request: {
        id: "request-internal-1", organizationId: AUTH.orgId, agentId: "agent-1", type: "TIME_CORRECTION",
        status: "APPROVED", correctionWorkdayId: "workday-internal-1", exceptionCaseId: "case-internal-1",
      }, ...overrides,
    }
  }

  it("returns recorded links and first resolution counters while all relationship IDs stay internal", async () => {
    vi.mocked(prisma.workforceExceptionCase.findMany).mockResolvedValue([caseRecord({ decisions: [
      { caseRevision: 1, decisionCode: "ACKNOWLEDGE", createdAt: new Date("2026-08-28T00:00:01Z") },
      { caseRevision: 2, decisionCode: "RESOLVE_WITH_CORRECTION", createdAt: new Date("2026-08-28T00:00:03Z") },
    ] })] as never)
    vi.mocked(prisma.workforceTimeCorrection.findMany).mockResolvedValue([linkedProof({ reason: "RAW_PROOF_REASON" })] as never)
    const response = await invoke(new NextRequest("http://localhost:3000/api/v1/workforce/exception-reports?start=2026-08-28&end=2026-08-28"), AUTH)
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.data.report.recordedOutcomes).toMatchObject({
      cohortBasis: "CASE_RECORDED_AT",
      linkedCorrection: { cohortCases: 1, recordedLinkedCorrectionCases: 1, share: 1 },
      firstResolution: { sampleCount: 1, unresolvedCases: 0, integrityExcludedCases: 0, minMs: 3_000, maxMs: 3_000, meanMs: 3_000 },
      finalClassification: { falsePositive: { sampleCount: 0, share: null, unclassifiedResolvedCases: 1 }, appeal: { sampleCount: 0, fullyUpheldShare: null, partiallyUpheldShare: null, rejectedShare: null, unclassifiedResolvedCases: 1 }, unfinishedCases: 0 },
    })
    expect(prisma.workforceTimeCorrection.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: AUTH.orgId, source: "REQUEST_APPROVAL", request: { is: {
        organizationId: AUTH.orgId, type: "TIME_CORRECTION", status: "APPROVED", exceptionCaseId: { in: ["case-internal-1"] },
      } } },
      take: 5_001,
    }))
    const audit = vi.mocked(prisma.mtmAuditLog.create).mock.calls[0][0]
    expect(audit.data.newData).toMatchObject({ recordedLinkedCorrectionCases: 1, firstResolutionSampleCount: 1 })
    expect(JSON.stringify(body)).not.toMatch(/agent-|case-internal|workday-internal|request-internal|RAW_PROOF/)
    expect(JSON.stringify(audit.data.newData)).not.toMatch(/agent-|case-internal|workday-internal|request-internal|RAW_PROOF/)
  })

  it("skips linked proofs for an empty cohort and keeps sample and share null", async () => {
    const response = await invoke(new NextRequest("http://localhost:3000/api/v1/workforce/exception-reports?start=2026-08-28&end=2026-08-28"), AUTH)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.report.recordedOutcomes.linkedCorrection.share).toBeNull()
    expect(body.data.report.recordedOutcomes.firstResolution.meanMs).toBeNull()
    expect(prisma.workforceTimeCorrection.findMany).not.toHaveBeenCalled()
  })

  it("refuses 5001 linked proof rows instead of presenting a truncated correction rate", async () => {
    vi.mocked(prisma.workforceExceptionCase.findMany).mockResolvedValue([caseRecord()] as never)
    vi.mocked(prisma.workforceTimeCorrection.findMany).mockResolvedValue(Array.from({ length: 5_001 }, () => linkedProof()) as never)
    const response = await invoke(new NextRequest("http://localhost:3000/api/v1/workforce/exception-reports?start=2026-08-28&end=2026-08-28"), AUTH)
    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toMatchObject({ code: "WORKFORCE_EXCEPTION_REPORT_LIMIT_EXCEEDED" })
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("fails unavailable on correction proof query error without leaking driver payload", async () => {
    vi.mocked(prisma.workforceExceptionCase.findMany).mockResolvedValue([caseRecord()] as never)
    vi.mocked(prisma.workforceTimeCorrection.findMany).mockRejectedValue(new Error("RAW_DRIVER_CONNECTION_MARKER"))
    const response = await invoke(new NextRequest("http://localhost:3000/api/v1/workforce/exception-reports?start=2026-08-28&end=2026-08-28"), AUTH)
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.code).toBe("WORKFORCE_EXCEPTION_REPORT_UNAVAILABLE")
    expect(JSON.stringify(body)).not.toContain("RAW_DRIVER_CONNECTION_MARKER")
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("marks corrupt timestamps or a 65-row decision sentinel for integrity review and excludes timing", async () => {
    for (const decisions of [
      [ { caseRevision: 1, decisionCode: "ACKNOWLEDGE", createdAt: new Date("2026-08-27T23:59:59Z") } ],
      Array.from({ length: 65 }, (_, index) => ({ caseRevision: index + 1, decisionCode: "ACKNOWLEDGE", createdAt: new Date("2026-08-28T00:01:00Z") })),
    ]) {
      vi.mocked(prisma.workforceExceptionCase.findMany).mockResolvedValue([caseRecord({ decisions })] as never)
      const response = await invoke(new NextRequest("http://localhost:3000/api/v1/workforce/exception-reports?start=2026-08-28&end=2026-08-28"), AUTH)
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.data.report.summary).toMatchObject({ dataIntegrityReview: 1, hrReview: 0 })
      expect(body.data.report.recordedOutcomes.firstResolution).toMatchObject({ sampleCount: 0, unresolvedCases: 0, integrityExcludedCases: 1 })
    }
  })

})
