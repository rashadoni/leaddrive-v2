import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  lockWorkforceExceptionLinkedMutation,
  WorkforceExceptionLinkedMutationError,
} from "@/lib/workforce/exception-linked-mutation"
import { MAX_WORKFORCE_EXCEPTION_DECISIONS } from "@/lib/workforce/exception-workbench"

const order: string[] = []
const db = {
  $executeRaw: vi.fn(async () => { order.push("lock") }),
  workforceExceptionDecision: {
    findMany: vi.fn(async () => {
      order.push("read")
      return [] as { decisionCode: string; caseRevision: number }[]
    }),
  },
}

beforeEach(() => {
  order.length = 0
  vi.clearAllMocks()
  db.workforceExceptionDecision.findMany.mockResolvedValue([])
})

describe("Workforce exception linked-mutation lock", () => {
  it("takes the canonical case lock before reading the lifecycle", async () => {
    db.workforceExceptionDecision.findMany.mockImplementationOnce(async () => {
      order.push("read")
      return [{ decisionCode: "REQUEST_EMPLOYEE_RESPONSE", caseRevision: 1 }]
    })

    await expect(lockWorkforceExceptionLinkedMutation({
      db,
      organizationId: "org-1",
      caseId: "case-1",
    })).resolves.toEqual({ caseRevision: 1 })

    expect(order).toEqual(["lock", "read"])
    expect(db.$executeRaw.mock.calls[0]?.[1])
      .toBe("workforce-exception-decision:org-1:case-1")
    expect(db.workforceExceptionDecision.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", caseId: "case-1" },
      orderBy: { caseRevision: "asc" },
      take: MAX_WORKFORCE_EXCEPTION_DECISIONS + 1,
      select: { decisionCode: true, caseRevision: true },
    })
  })

  it("rejects a new linked mutation after terminal resolution", async () => {
    db.workforceExceptionDecision.findMany.mockResolvedValue([
      { decisionCode: "ACKNOWLEDGE", caseRevision: 1 },
      { decisionCode: "RESOLVE_NO_CHANGE", caseRevision: 2 },
    ])

    await expect(lockWorkforceExceptionLinkedMutation({
      db,
      organizationId: "org-1",
      caseId: "case-1",
    })).rejects.toMatchObject<Partial<WorkforceExceptionLinkedMutationError>>({
      code: "WORKFORCE_EXCEPTION_LINKED_MUTATION_RESOLVED",
    })
  })

  it("fails closed for an invalid or capacity-bound decision stream", async () => {
    db.workforceExceptionDecision.findMany.mockResolvedValueOnce([
      { decisionCode: "RESOLVE_NO_CHANGE", caseRevision: 1 },
    ])
    await expect(lockWorkforceExceptionLinkedMutation({
      db,
      organizationId: "org-1",
      caseId: "case-1",
    })).rejects.toMatchObject({
      code: "WORKFORCE_EXCEPTION_LINKED_MUTATION_HISTORY_INVALID",
    })

    db.workforceExceptionDecision.findMany.mockResolvedValueOnce(
      Array.from({ length: MAX_WORKFORCE_EXCEPTION_DECISIONS }, (_, index) => ({
        decisionCode: "ACKNOWLEDGE",
        caseRevision: index + 1,
      })),
    )
    await expect(lockWorkforceExceptionLinkedMutation({
      db,
      organizationId: "org-1",
      caseId: "case-1",
    })).rejects.toMatchObject({
      code: "WORKFORCE_EXCEPTION_LINKED_MUTATION_HISTORY_INVALID",
    })
  })

  it("fails closed on a missing or duplicate revision", async () => {
    db.workforceExceptionDecision.findMany.mockResolvedValueOnce([
      { decisionCode: "ACKNOWLEDGE", caseRevision: 2 },
    ])
    await expect(lockWorkforceExceptionLinkedMutation({
      db,
      organizationId: "org-1",
      caseId: "case-1",
    })).rejects.toMatchObject({
      code: "WORKFORCE_EXCEPTION_LINKED_MUTATION_HISTORY_INVALID",
    })
  })
})
