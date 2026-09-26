import { describe, expect, it, vi } from "vitest"
import {
  planWorkforceTimeDecisionRetention,
  workforceTimeDecisionRetentionCutoff,
} from "@/lib/workforce/time-decision-retention"

const organizationId = "org-retention"
const now = new Date("2027-08-30T12:00:00.000Z")

function db(activeLegalHolds = 0) {
  return {
    workforceLegalHold: { count: vi.fn().mockResolvedValue(activeLegalHolds) },
    mtmAgentWorkday: { count: vi.fn().mockResolvedValue(1) },
    mtmAgentWorkdayEvent: { count: vi.fn().mockResolvedValue(2) },
    mtmHrmRequest: { count: vi.fn().mockResolvedValue(3) },
    workforceAttendanceException: { count: vi.fn().mockResolvedValue(4) },
    workforceTimeCorrection: { count: vi.fn().mockResolvedValue(5) },
    workforceWorkdayReopen: { count: vi.fn().mockResolvedValue(9) },
    workforceTimesheetApproval: { count: vi.fn().mockResolvedValue(6) },
    workforceEvidenceAssessment: { count: vi.fn().mockResolvedValue(7) },
    mtmAuditLog: { count: vi.fn().mockResolvedValue(8) },
  }
}

describe("Workforce one-year time/decision retention plan", () => {
  it("uses a calendar-year cutoff and inventories only eligible closed decision classes", async () => {
    const retentionDb = db()

    await expect(planWorkforceTimeDecisionRetention(retentionDb, { organizationId, now })).resolves.toEqual({
      retentionCutoff: "2026-08-30T12:00:00.000Z",
      eligibleClasses: ["TIME_FACT", "DERIVED_VERDICT", "REQUEST_REASON", "AUDIT_RECORD"],
      activeLegalHoldCount: 0,
      blockedByLegalHold: false,
      candidates: {
        workdays: 1,
        workdayEvents: 2,
        decidedRequests: 3,
        resolvedExceptions: 4,
        corrections: 5,
        reopens: 9,
        approvals: 6,
        derivedAssessments: 7,
        workforceAudits: 8,
      },
      execution: "NOT_AVAILABLE",
    })
    expect(retentionDb.workforceLegalHold.count).toHaveBeenCalledWith({
      where: { organizationId, scope: "TIME_DECISION", status: "ACTIVE" },
    })
    expect(retentionDb.mtmHrmRequest.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ["APPROVED", "REJECTED", "CANCELLED"] } }),
    }))
    expect(retentionDb.workforceAttendanceException.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "RESOLVED" }),
    }))
    expect(retentionDb.mtmAgentWorkday.count).toHaveBeenCalledTimes(1)
    // A manager reopen is a time decision like a correction: its ledger and
    // its WORKDAY_REOPEN audit record age out on the same one-year clock.
    expect(retentionDb.workforceWorkdayReopen.count).toHaveBeenCalledWith({
      where: { organizationId, occurredAt: { lt: new Date("2026-08-30T12:00:00.000Z") } },
    })
    expect(retentionDb.mtmAuditLog.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { action: { in: expect.arrayContaining(["WORKDAY_REOPEN", "WORKDAY_FINISH"]) } },
        ]),
      }),
    })
  })

  it("fails closed on an active legal hold without reading retention candidates", async () => {
    const retentionDb = db(1)

    await expect(planWorkforceTimeDecisionRetention(retentionDb, { organizationId, now })).resolves.toMatchObject({
      activeLegalHoldCount: 1,
      blockedByLegalHold: true,
      candidates: {
        workdays: 0,
        approvals: 0,
        workforceAudits: 0,
      },
      execution: "NOT_AVAILABLE",
    })
    expect(retentionDb.mtmAgentWorkday.count).not.toHaveBeenCalled()
    expect(retentionDb.workforceTimesheetApproval.count).not.toHaveBeenCalled()
    expect(retentionDb.workforceWorkdayReopen.count).not.toHaveBeenCalled()
  })

  it("propagates an unavailable hold check instead of inventing a no-hold result", async () => {
    const retentionDb = db()
    retentionDb.workforceLegalHold.count.mockRejectedValueOnce(new Error("hold store unavailable"))

    await expect(planWorkforceTimeDecisionRetention(retentionDb, { organizationId, now })).rejects.toThrow("hold store unavailable")
    expect(retentionDb.mtmAgentWorkday.count).not.toHaveBeenCalled()
  })

  it("rejects an invalid tenant before the fail-closed hold lookup", async () => {
    const retentionDb = db()
    await expect(planWorkforceTimeDecisionRetention(retentionDb, {
      organizationId: " ",
      now,
    })).rejects.toThrow("organizationId is invalid")
    expect(retentionDb.workforceLegalHold.count).not.toHaveBeenCalled()
  })

  it("does not purge early across a leap-day boundary", () => {
    expect(workforceTimeDecisionRetentionCutoff(new Date("2028-02-29T03:04:05.006Z"))).toEqual(new Date("2027-03-01T03:04:05.006Z"))
  })
})
