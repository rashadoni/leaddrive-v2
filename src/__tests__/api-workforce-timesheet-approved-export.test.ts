import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/with-workforce-rls-auth", () => ({
  withWorkforceSessionAuth: vi.fn((_action, handler) => handler),
}))
vi.mock("@/lib/workforce/timesheet-export-access", () => ({
  requireWorkforceTimesheetExportAccess: vi.fn().mockResolvedValue(null),
}))
vi.mock("@/lib/workforce/attendance-route", () => ({
  requireWorkforceAttendanceSecurityMfa: vi.fn(async () => null),
}))
vi.mock("@/lib/workforce/timesheet-export-rate-limit", () => ({
  requireWorkforceTimesheetExportRateLimit: vi.fn(async () => null),
}))

import { GET as exportApproval } from "@/app/api/v1/workforce/timesheet/approvals/[id]/export/route"
import { prisma } from "@/lib/prisma"
import { requireWorkforceTimesheetExportAccess } from "@/lib/workforce/timesheet-export-access"
import { requireWorkforceAttendanceSecurityMfa } from "@/lib/workforce/attendance-route"
import { requireWorkforceTimesheetExportRateLimit } from "@/lib/workforce/timesheet-export-rate-limit"
import { buildWorkforceTimesheetApproval } from "@/lib/workforce/timesheet-approval"

const AUTH = { orgId: "org-workforce", userId: "admin-1", role: "admin", principalType: "session" as const }
type RouteContext = { params: Promise<{ id: string }> }
const invoke = exportApproval as unknown as (
  request: NextRequest,
  auth: typeof AUTH,
  context: RouteContext,
) => Promise<Response>

function approvalRecord(overrides: Record<string, unknown> = {}) {
  const rows = [{
    workdayId: "day-1", agentId: "agent-1", workDate: "2026-08-28", calculationVersion: 1,
    calculation: {
      calculationVersion: 1, policySnapshotId: "policy", shiftSnapshotId: "shift", status: "COMPLETED" as const, isFinal: true,
      plan: { plannedStartAt: "2026-08-28T09:00:00.000Z", plannedEndAt: "2026-08-28T18:00:00.000Z", expectedWorkSeconds: 28800, workDate: "2026-08-28", timezone: "UTC" },
      fact: { workdayId: "day-1", startedAt: "2026-08-28T09:00:00.000Z", completedAt: "2026-08-28T18:00:00.000Z", workedSeconds: 28800, pausedSeconds: 600, longestPauseSeconds: 600 },
      deviations: { lateStartSeconds: 0, undertimeSeconds: 0, overtimeSeconds: 0, longPauseSeconds: 0 }, exceptions: [],
    },
  }]
  const payload = buildWorkforceTimesheetApproval({
    periodStart: "2026-08-28", periodEnd: "2026-08-28", agentId: "agent-1", rows,
  })
  return {
    id: "approval-1",
    agentId: "agent-1",
    periodStart: new Date("2026-08-28T00:00:00.000Z"),
    periodEnd: new Date("2026-08-28T00:00:00.000Z"),
    recordKind: "APPROVAL",
    revision: 1,
    calculationVersion: 1,
    rowsHash: payload.rowsHash,
    factsHash: payload.factsHash,
    rows,
    approvedAt: new Date("2026-08-29T10:00:00.000Z"),
    ...overrides,
  }
}

function request(purpose = "HR_RECORD_REVIEW") {
  return new NextRequest(
    `http://localhost:3000/api/v1/workforce/timesheet/approvals/approval-1/export?purpose=${purpose}`,
    { headers: { "user-agent": "vitest-export" } },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireWorkforceTimesheetExportAccess).mockResolvedValue(null)
  vi.mocked(requireWorkforceAttendanceSecurityMfa).mockResolvedValue(null)
  vi.mocked(requireWorkforceTimesheetExportRateLimit).mockResolvedValue(null)
})

describe("GET /api/v1/workforce/timesheet/approvals/:id/export", () => {
  it("exports one verified immutable approval and appends only a metadata audit", async () => {
    const approval = approvalRecord()
    vi.mocked(prisma.workforceTimesheetApproval.findFirst)
      .mockResolvedValueOnce({ id: approval.id, agentId: approval.agentId } as never)
      .mockResolvedValueOnce(approval as never)

    const response = await invoke(request(), AUTH, { params: Promise.resolve({ id: "approval-1" }) })

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("content-disposition")).toContain("attachment")
    await expect(response.json()).resolves.toMatchObject({
      approvalId: "approval-1",
      export: { format: "workforce-approved-timesheet-v1", rows: [{ workdayId: "day-1", workedSeconds: 28800 }] },
    })
    expect(requireWorkforceAttendanceSecurityMfa).toHaveBeenCalledWith(AUTH.orgId, AUTH)
    expect(requireWorkforceTimesheetExportRateLimit).toHaveBeenCalledWith({
      organizationId: AUTH.orgId, principalUserId: AUTH.userId,
    })
    expect(requireWorkforceTimesheetExportAccess).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: AUTH.orgId, approvalAgentId: "agent-1",
    }))
    expect(prisma.workforceTimesheetApproval.findFirst).toHaveBeenNthCalledWith(1, {
      where: { id: "approval-1", organizationId: AUTH.orgId },
      select: { id: true, agentId: true },
    })
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: AUTH.orgId,
        action: "WORKFORCE_TIMESHEET_APPROVED_EXPORT_VIEWED",
        newData: expect.objectContaining({ purpose: "HR_RECORD_REVIEW", recipient: "SESSION_DIRECT_DOWNLOAD" }),
      }),
    }))
    const audit = vi.mocked(prisma.mtmAuditLog.create).mock.calls[0]?.[0] as { data: { newData: Record<string, unknown> } }
    expect(audit.data.newData).not.toHaveProperty("rows")
  })

  it("requires MFA and validates identifier/purpose before charging or reading", async () => {
    vi.mocked(requireWorkforceAttendanceSecurityMfa).mockResolvedValueOnce(new Response(null, { status: 403 }) as never)
    const mfaDenied = await invoke(request(), AUTH, { params: Promise.resolve({ id: "approval-1" }) })
    expect(mfaDenied.status).toBe(403)
    expect(requireWorkforceTimesheetExportRateLimit).not.toHaveBeenCalled()
    expect(prisma.workforceTimesheetApproval.findFirst).not.toHaveBeenCalled()

    const malformed = await invoke(request(), AUTH, { params: Promise.resolve({ id: "bad id" }) })
    expect(malformed.status).toBe(400)
    expect(requireWorkforceTimesheetExportRateLimit).not.toHaveBeenCalled()

    const unsupported = await invoke(request("PAYROLL"), AUTH, { params: Promise.resolve({ id: "approval-1" }) })
    expect(unsupported.status).toBe(400)
    expect(requireWorkforceTimesheetExportRateLimit).not.toHaveBeenCalled()
  })

  it("stops before approval lookup or audit when the shared guard denies", async () => {
    vi.mocked(requireWorkforceTimesheetExportRateLimit).mockResolvedValueOnce(new Response(null, { status: 429 }) as never)
    const response = await invoke(request(), AUTH, { params: Promise.resolve({ id: "approval-1" }) })
    expect(response.status).toBe(429)
    expect(prisma.workforceTimesheetApproval.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("reads no approval rows when historic export scope is denied", async () => {
    vi.mocked(prisma.workforceTimesheetApproval.findFirst)
      .mockResolvedValueOnce({ id: "approval-1", agentId: "agent-1" } as never)
    vi.mocked(requireWorkforceTimesheetExportAccess).mockResolvedValueOnce(new Response(null, { status: 403 }))

    const response = await invoke(request(), AUTH, { params: Promise.resolve({ id: "approval-1" }) })
    expect(response.status).toBe(403)
    expect(prisma.workforceTimesheetApproval.findFirst).toHaveBeenCalledTimes(1)
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("does not export a missing, disappeared or hash-inconsistent approval", async () => {
    vi.mocked(prisma.workforceTimesheetApproval.findFirst).mockResolvedValueOnce(null as never)
    const missing = await invoke(request(), AUTH, { params: Promise.resolve({ id: "approval-1" }) })
    expect(missing.status).toBe(404)
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()

    vi.mocked(prisma.workforceTimesheetApproval.findFirst)
      .mockResolvedValueOnce({ id: "approval-1", agentId: "agent-1" } as never)
      .mockResolvedValueOnce(null as never)
    const disappeared = await invoke(request(), AUTH, { params: Promise.resolve({ id: "approval-1" }) })
    expect(disappeared.status).toBe(404)

    const inconsistent = approvalRecord({ rowsHash: "x".repeat(64) })
    vi.mocked(prisma.workforceTimesheetApproval.findFirst)
      .mockResolvedValueOnce({ id: "approval-1", agentId: "agent-1" } as never)
      .mockResolvedValueOnce(inconsistent as never)
    const invalid = await invoke(request(), AUTH, { params: Promise.resolve({ id: "approval-1" }) })
    expect(invalid.status).toBe(409)
    await expect(invalid.json()).resolves.toMatchObject({ code: "WORKFORCE_TIMESHEET_EXPORT_INTEGRITY_INVALID" })
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("contains unexpected approval reads and audit failures without reflecting details", async () => {
    const privateFailure = new Error("raw private export failure employee-42")
    vi.mocked(prisma.workforceTimesheetApproval.findFirst).mockRejectedValueOnce(privateFailure)
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)

    const response = await invoke(request(), AUTH, { params: Promise.resolve({ id: "approval-1" }) })
    expect(response.status).toBe(500)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(JSON.stringify(await response.json())).not.toContain(privateFailure.message)
    expect(consoleError).toHaveBeenCalledWith(
      "[workforce/privacy] sensitive operation failed",
      { operation: "review-timesheet-approval-export" },
    )
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(privateFailure.message)
  })
})
