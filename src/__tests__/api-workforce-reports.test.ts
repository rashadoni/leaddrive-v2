import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/with-workforce-rls-auth", () => ({
  withWorkforceSessionAuth: vi.fn((_action, handler) => handler),
}))
vi.mock("@/lib/mtm-settings", () => ({ getMtmSettings: vi.fn() }))

import { GET as getReport } from "@/app/api/v1/workforce/reports/route"
import { prisma } from "@/lib/prisma"
import { getMtmSettings } from "@/lib/mtm-settings"
import { buildWorkforceTimesheetApproval } from "@/lib/workforce/timesheet-approval"

const AUTH = { orgId: "org-workforce", userId: "admin-1", role: "admin", principalType: "session" as const }
const invoke = getReport as unknown as (request: NextRequest, auth: typeof AUTH) => Promise<Response>

function approval() {
  const rows = [{
    workdayId: "day-1", agentId: "agent-1", workDate: "2026-08-28", calculationVersion: 1,
    calculation: {
      calculationVersion: 1, policySnapshotId: "policy-1", shiftSnapshotId: "shift-1", status: "COMPLETED" as const, isFinal: true,
      plan: { plannedStartAt: "2026-08-28T05:00:00.000Z", plannedEndAt: "2026-08-28T14:00:00.000Z", expectedWorkSeconds: 28_800, workDate: "2026-08-28", timezone: "Asia/Baku" },
      fact: { workdayId: "day-1", startedAt: "2026-08-28T05:00:00.000Z", completedAt: "2026-08-28T14:00:00.000Z", workedSeconds: 28_800, pausedSeconds: 3_600, longestPauseSeconds: 3_600 },
      deviations: { lateStartSeconds: 0, undertimeSeconds: 0, overtimeSeconds: 0, longPauseSeconds: 0 }, exceptions: [],
    },
  }]
  const payload = buildWorkforceTimesheetApproval({ periodStart: "2026-08-28", periodEnd: "2026-08-28", agentId: "agent-1", rows })
  return {
    id: "approval-1", agentId: "agent-1", periodStart: new Date("2026-08-28T00:00:00.000Z"), periodEnd: new Date("2026-08-28T00:00:00.000Z"),
    recordKind: "APPROVAL", revision: 1, calculationVersion: 1, rowsHash: payload.rowsHash, factsHash: payload.factsHash, rows,
    approvedAt: new Date("2026-08-29T09:00:00.000Z"),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getMtmSettings).mockResolvedValue({ timezone: "Asia/Baku" } as never)
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({ features: [] } as never)
  vi.mocked(prisma.workforceTimesheetApproval.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([])
})

describe("GET /api/v1/workforce/reports", () => {
  it("returns a private, audited aggregate from hash-verified immutable approvals", async () => {
    vi.mocked(prisma.workforceTimesheetApproval.findMany).mockResolvedValue([approval()] as never)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{ id: "agent-1", name: "Aysel" }] as never)

    const response = await invoke(new NextRequest("http://localhost/api/v1/workforce/reports?start=2026-08-28&end=2026-08-28", {
      headers: { "user-agent": "vitest-workforce-report" },
    }), AUTH)

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        report: {
          source: "HASH_VERIFIED_IMMUTABLE_APPROVALS",
          summary: { employees: 1, workdays: 1, workedSeconds: 28_800 },
          byEmployee: [{ name: "Aysel", pausedSeconds: 3_600 }],
          unavailable: { siteTransitions: "EXCLUDED_FROM_APPROVED_TIMESHEET_FACTS" },
        },
      },
    })
    expect(prisma.workforceTimesheetApproval.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: AUTH.orgId, periodStart: { lte: expect.any(Date) } }),
    }))
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "WORKFORCE_APPROVED_REPORT_VIEWED",
        newData: expect.not.objectContaining({ agentId: expect.anything(), rawEnvelopeCiphertext: expect.anything() }),
      }),
    }))
  })

  it("rejects an invalid range before querying approvals", async () => {
    const response = await invoke(new NextRequest("http://localhost/api/v1/workforce/reports?start=bad&end=2026-08-28"), AUTH)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ code: "WORKFORCE_REPORT_RANGE_INVALID" })
    expect(prisma.workforceTimesheetApproval.findMany).not.toHaveBeenCalled()
  })

  it("requires an exact attendance-read grant for a selected employee after granular cutover", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      features: ["workforce-granular-access-v1"],
    } as never)
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([])

    const denied = await invoke(new NextRequest("http://localhost:3000/api/v1/workforce/reports?start=2026-08-28&end=2026-08-28&agentId=agent-1"), AUTH)

    expect(denied.status).toBe(403)
    await expect(denied.json()).resolves.toMatchObject({ code: "WORKFORCE_APPROVED_REPORT_ACCESS_REQUIRED" })
    expect(prisma.workforceAccessGrant.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: AUTH.orgId, principalUserId: AUTH.userId }),
      take: 201,
    }))
    expect(prisma.workforceTimesheetApproval.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()

    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([{
      id: "grant_report_1",
      organizationId: AUTH.orgId,
      principalUserId: AUTH.userId,
      role: "TIME_APPROVER",
      scopeKind: "AGENT",
      scopeTeamId: null,
      scopeSiteId: null,
      scopeAgentId: "agent-1",
      effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
      effectiveUntil: null,
      revocation: null,
    }] as never)

    const allowed = await invoke(new NextRequest("http://localhost:3000/api/v1/workforce/reports?start=2026-08-28&end=2026-08-28&agentId=agent-1"), AUTH)

    expect(allowed.status).toBe(200)
    expect(prisma.workforceTimesheetApproval.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: AUTH.orgId, agentId: "agent-1" }),
    }))
  })

  it("fails closed on an unavailable approved-report authorization lookup", async () => {
    vi.mocked(prisma.organization.findUnique).mockRejectedValueOnce(new Error("database unavailable"))

    const response = await invoke(new NextRequest("http://localhost:3000/api/v1/workforce/reports?start=2026-08-28&end=2026-08-28"), AUTH)

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ code: "WORKFORCE_APPROVED_REPORT_ACCESS_UNAVAILABLE" })
    expect(prisma.workforceTimesheetApproval.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })
})
