import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: vi.fn(), delete: vi.fn() },
    mtmAgentWorkday: { count: vi.fn() },
    mtmAgentWorkdayEvent: { count: vi.fn() },
    mtmAgentLocation: { count: vi.fn() },
    mtmHrmRequest: { count: vi.fn() },
    mtmWorkCalendarDay: { count: vi.fn() },
    mtmAuditLog: { count: vi.fn() },
    workforcePolicy: { count: vi.fn() },
    workforceShiftTemplate: { count: vi.fn() },
    workforceShiftAssignment: { count: vi.fn() },
    workforcePolicySnapshot: { count: vi.fn() },
    workforceShiftSnapshot: { count: vi.fn() },
    workforceAttendanceException: { count: vi.fn() },
    workforceTimeCorrection: { count: vi.fn() },
    workforceTimesheetApproval: { count: vi.fn() },
    contractFile: { findMany: vi.fn() },
    taskAttachment: { findMany: vi.fn() },
    mtmDocument: { findMany: vi.fn() },
    $executeRaw: vi.fn(),
    $executeRawUnsafe: vi.fn(),
    $transaction: vi.fn(),
  },
  logAudit: vi.fn(),
}))

import { prisma } from "@/lib/prisma"
import { hardDeleteTenant, WorkforceRetentionBlockedError } from "@/lib/tenant-provisioning"

type RetentionPrisma = {
  organization: { findUnique: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> }
  mtmAgentWorkday: { count: ReturnType<typeof vi.fn> }
  mtmAgentWorkdayEvent: { count: ReturnType<typeof vi.fn> }
  mtmAgentLocation: { count: ReturnType<typeof vi.fn> }
  mtmHrmRequest: { count: ReturnType<typeof vi.fn> }
  mtmWorkCalendarDay: { count: ReturnType<typeof vi.fn> }
  mtmAuditLog: { count: ReturnType<typeof vi.fn> }
  workforcePolicy: { count: ReturnType<typeof vi.fn> }
  workforceShiftTemplate: { count: ReturnType<typeof vi.fn> }
  workforceShiftAssignment: { count: ReturnType<typeof vi.fn> }
  workforcePolicySnapshot: { count: ReturnType<typeof vi.fn> }
  workforceShiftSnapshot: { count: ReturnType<typeof vi.fn> }
  workforceAttendanceException: { count: ReturnType<typeof vi.fn> }
  workforceTimeCorrection: { count: ReturnType<typeof vi.fn> }
  workforceTimesheetApproval: { count: ReturnType<typeof vi.fn> }
  contractFile: { findMany: ReturnType<typeof vi.fn> }
  taskAttachment: { findMany: ReturnType<typeof vi.fn> }
  mtmDocument: { findMany: ReturnType<typeof vi.fn> }
  $executeRaw: ReturnType<typeof vi.fn>
  $executeRawUnsafe: ReturnType<typeof vi.fn>
  $transaction: ReturnType<typeof vi.fn>
}

const db = prisma as unknown as RetentionPrisma

beforeEach(() => {
  vi.resetAllMocks()
  for (const model of [
    db.mtmAgentWorkday,
    db.mtmAgentWorkdayEvent,
    db.mtmAgentLocation,
    db.mtmHrmRequest,
    db.mtmWorkCalendarDay,
    db.mtmAuditLog,
    db.workforcePolicy,
    db.workforceShiftTemplate,
    db.workforceShiftAssignment,
    db.workforcePolicySnapshot,
    db.workforceShiftSnapshot,
    db.workforceAttendanceException,
    db.workforceTimeCorrection,
    db.workforceTimesheetApproval,
  ]) {
    model.count.mockResolvedValue(0)
  }
  db.contractFile.findMany.mockResolvedValue([])
  db.taskAttachment.findMany.mockResolvedValue([])
  db.mtmDocument.findMany.mockResolvedValue([])
  db.$transaction.mockImplementation(async (callback: (tx: RetentionPrisma) => unknown) => callback(db))
})

describe("Workforce tenant retention guard", () => {
  it("holds the parent fence and normalizes a late immutable-fact cascade block", async () => {
    db.organization.findUnique.mockResolvedValue({ id: "tenant-1", slug: "acme", name: "Acme" })
    db.organization.delete.mockRejectedValue(new Error("Workforce attendance exception facts cannot be deleted"))

    await expect(hardDeleteTenant("tenant-1")).rejects.toBeInstanceOf(WorkforceRetentionBlockedError)
    expect(db.$executeRaw).toHaveBeenCalledTimes(1)
    expect(db.$executeRawUnsafe).toHaveBeenCalledTimes(2)
    expect(db.organization.delete).toHaveBeenCalledTimes(1)
  })

  it("blocks a tenant when only a historical workday audit remains", async () => {
    db.organization.findUnique.mockResolvedValue({ id: "tenant-1", slug: "acme", name: "Acme" })
    db.mtmAuditLog.count.mockResolvedValue(1)

    await expect(hardDeleteTenant("tenant-1")).rejects.toBeInstanceOf(WorkforceRetentionBlockedError)
    expect(db.organization.delete).not.toHaveBeenCalled()
  })

  it("keeps the conservative retention fence for an otherwise unused system default profile", async () => {
    db.organization.findUnique.mockResolvedValue({ id: "tenant-1", slug: "acme", name: "Acme" })
    db.workforcePolicy.count.mockResolvedValue(1)

    await expect(hardDeleteTenant("tenant-1")).rejects.toBeInstanceOf(WorkforceRetentionBlockedError)
    expect(db.organization.delete).not.toHaveBeenCalled()
  })
})
