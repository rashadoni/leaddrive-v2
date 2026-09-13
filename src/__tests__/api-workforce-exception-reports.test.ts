import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    workforceExceptionCase: { findMany: vi.fn() },
    mtmAuditLog: { create: vi.fn() },
  },
}))
vi.mock("@/lib/with-workforce-rls-auth", () => ({
  withWorkforceSessionExceptionQueueAuth: vi.fn((handler) => handler),
}))
vi.mock("@/lib/mtm-settings", () => ({ getMtmSettings: vi.fn() }))

import { GET } from "@/app/api/v1/workforce/exception-reports/route"
import { getMtmSettings } from "@/lib/mtm-settings"
import { prisma } from "@/lib/prisma"
import { withWorkforceSessionExceptionQueueAuth } from "@/lib/with-workforce-rls-auth"

const AUTH = { orgId: "org-workforce", userId: "admin-1", role: "admin", principalType: "session" as const }
const invoke = GET as unknown as (request: NextRequest, auth: typeof AUTH) => Promise<Response>

function caseRecord(overrides: Record<string, unknown> = {}) {
  return {
    agentId: "agent-1",
    kind: "NO_SHOW",
    decisions: [{ decisionCode: "ACKNOWLEDGE" }],
    employeeResponses: [],
    ...overrides,
  }
}

beforeEach(() => {
  // Preserve the module-load wrapper invocation so the contract can prove
  // this route uses the exception-specific C7 authorization boundary.
  vi.mocked(prisma.workforceExceptionCase.findMany).mockReset()
  vi.mocked(prisma.mtmAuditLog.create).mockReset()
  vi.mocked(getMtmSettings).mockReset()
  vi.mocked(getMtmSettings).mockResolvedValue({ timezone: "Asia/Baku" } as never)
  vi.mocked(prisma.workforceExceptionCase.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmAuditLog.create).mockResolvedValue({} as never)
})

describe("GET /api/v1/workforce/exception-reports", () => {
  it("uses the separate exception grant and returns a tenant-local aggregate with no case or proof data", async () => {
    vi.mocked(prisma.workforceExceptionCase.findMany).mockResolvedValue([
      caseRecord({
        rawLocation: "RAW_LOCATION_MUST_NOT_LEAK",
        decisionReason: "RAW_REASON_MUST_NOT_LEAK",
        employeeResponses: [{ id: "response-internal-1", text: "RAW_RESPONSE_MUST_NOT_LEAK" }],
      }),
      caseRecord({ agentId: "agent-2", kind: "LATE_START", decisions: [] }),
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
    expect(JSON.stringify(body)).not.toMatch(/agent-|RAW_LOCATION|RAW_REASON|RAW_RESPONSE|response-internal/)
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
        decisions: expect.objectContaining({ take: 65, select: { decisionCode: true } }),
      }),
    }))
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "WORKFORCE_EXCEPTION_REPORT_VIEWED",
        newData: expect.not.objectContaining({ agentId: expect.anything(), caseId: expect.anything(), rawEnvelopeCiphertext: expect.anything() }),
      }),
    }))
    expect(withWorkforceSessionExceptionQueueAuth).toHaveBeenCalledTimes(1)
  })

  it("rejects an invalid date range before reading cases", async () => {
    const response = await invoke(new NextRequest("http://localhost:3000/api/v1/workforce/exception-reports?start=bad&end=2026-08-28"), AUTH)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ code: "WORKFORCE_EXCEPTION_REPORT_RANGE_INVALID" })
    expect(prisma.workforceExceptionCase.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("fails explicit rather than returning a false empty aggregate when the C6 case table is unavailable", async () => {
    vi.mocked(prisma.workforceExceptionCase.findMany).mockRejectedValue({ code: "P2021" })

    const response = await invoke(new NextRequest("http://localhost:3000/api/v1/workforce/exception-reports?start=2026-08-28&end=2026-08-28"), AUTH)

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ code: "WORKFORCE_EXCEPTION_REPORT_UNAVAILABLE" })
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
})
