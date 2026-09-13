import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

import { prisma } from "@/lib/prisma"
import { WorkforceExceptionCaseWriterError } from "@/lib/workforce/exception-case-writer"
import { materializeAuthorizedWorkforceMissedFinishReviewCase } from "@/lib/workforce/missed-finish-case-materializer"

const INPUT = {
  organizationId: "org-missed-finish-materializer",
  agentId: "agent-missed-finish-materializer",
  workdayId: "workday-missed-finish-materializer",
  asOf: new Date("2026-09-01T16:30:00.000Z"),
  timing: {
    privateReminderAfterSeconds: 15 * 60,
    reviewAfterSeconds: 2 * 60 * 60,
  },
}
const transaction = vi.fn(async (operation: (tx: typeof prisma) => Promise<unknown>) => operation(prisma))
const client = { $transaction: transaction }

function configureStaleOpenWorkday() {
  vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({
    id: INPUT.workdayId,
    status: "STARTED",
  } as never)
  vi.mocked(prisma.workforceShiftSnapshot.findFirst).mockResolvedValue({
    plannedEndAt: new Date("2026-09-01T14:00:00.000Z"),
  } as never)
  vi.mocked(prisma.workforceExceptionCase.create).mockResolvedValue({ id: "case-missed-finish" } as never)
  vi.mocked(prisma.mtmAuditLog.create).mockResolvedValue({ id: "audit-missed-finish" } as never)
}

describe("Workforce missed-finish review-case materializer", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    configureStaleOpenWorkday()
  })

  it("locks, rechecks and records only the stale-open review subject", async () => {
    const authorize = vi.fn().mockResolvedValue(true)
    await expect(materializeAuthorizedWorkforceMissedFinishReviewCase({
      db: client as never,
      ...INPUT,
      authorize,
    })).resolves.toEqual({
      outcome: "REVIEW_CASE_RECORDED",
      caseId: "case-missed-finish",
      idempotent: false,
      workdayId: INPUT.workdayId,
    })
    expect(authorize).toHaveBeenCalledWith({
      operation: "CASE_CREATE",
      organizationId: INPUT.organizationId,
      agentId: INPUT.agentId,
    })
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2)
    expect(prisma.workforceExceptionCase.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: INPUT.organizationId,
        agentId: INPUT.agentId,
        kind: "MISSED_FINISH",
        workdayId: INPUT.workdayId,
        workdayEventId: null,
        segmentId: null,
        expectedWorkDate: null,
      }),
    }))
    expect(JSON.stringify(vi.mocked(prisma.mtmAuditLog.create).mock.calls)).not.toMatch(/latitude|longitude|qr|device|reason/i)
  })

  it("suppresses a case when the locked recheck sees a completed workday", async () => {
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({
      id: INPUT.workdayId,
      status: "COMPLETED",
    } as never)
    await expect(materializeAuthorizedWorkforceMissedFinishReviewCase({
      db: client as never,
      ...INPUT,
      authorize: async () => true,
    })).resolves.toEqual({
      outcome: "NOT_CREATED",
      candidate: {
        outcome: "DO_NOT_ACT",
        code: "WORKFORCE_MISSED_FINISH_WORKDAY_NOT_OPEN",
      },
    })
    expect(prisma.workforceExceptionCase.create).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("does not turn a private reminder candidate into a case or notification", async () => {
    await expect(materializeAuthorizedWorkforceMissedFinishReviewCase({
      db: client as never,
      ...INPUT,
      asOf: new Date("2026-09-01T14:30:00.000Z"),
      authorize: async () => true,
    })).resolves.toMatchObject({
      outcome: "NOT_CREATED",
      candidate: {
        outcome: "ACTION_CANDIDATE",
        proposal: { outcome: "PROPOSE_PRIVATE_REMINDER" },
      },
    })
    expect(prisma.workforceExceptionCase.create).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("fails before the transition lock or workday read without CASE_CREATE authorization", async () => {
    await expect(materializeAuthorizedWorkforceMissedFinishReviewCase({
      db: client as never,
      ...INPUT,
      authorize: async () => false,
    })).rejects.toMatchObject<Partial<WorkforceExceptionCaseWriterError>>({
      code: "WORKFORCE_EXCEPTION_CASE_NOT_AUTHORIZED",
    })
    expect(prisma.$executeRaw).not.toHaveBeenCalled()
    expect(prisma.mtmAgentWorkday.findFirst).not.toHaveBeenCalled()
    expect(prisma.workforceExceptionCase.create).not.toHaveBeenCalled()
  })

  it("keeps an exact stale-open subject idempotent without a second audit", async () => {
    await materializeAuthorizedWorkforceMissedFinishReviewCase({
      db: client as never,
      ...INPUT,
      authorize: async () => true,
    })
    const firstWrite = vi.mocked(prisma.workforceExceptionCase.create).mock.calls[0]?.[0]?.data
    vi.mocked(prisma.workforceExceptionCase.create).mockRejectedValueOnce({ code: "P2002" })
    vi.mocked(prisma.workforceExceptionCase.findFirst).mockResolvedValue({
      id: "case-missed-finish",
      ...firstWrite,
    } as never)

    await expect(materializeAuthorizedWorkforceMissedFinishReviewCase({
      db: client as never,
      ...INPUT,
      authorize: async () => true,
    })).resolves.toMatchObject({
      outcome: "REVIEW_CASE_RECORDED",
      caseId: "case-missed-finish",
      idempotent: true,
    })
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledTimes(1)
  })
})
