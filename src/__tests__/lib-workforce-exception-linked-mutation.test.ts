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
      return [] as { decisionCode: string }[]
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
      return [{ decisionCode: "REQUEST_EMPLOYEE_RESPONSE" }]
    })

    await expect(lockWorkforceExceptionLinkedMutation({
      db,
      organizationId: "org-1",
      caseId: "case-1",
    })).resolves.toBeUndefined()

    expect(order).toEqual(["lock", "read"])
    expect(db.$executeRaw.mock.calls[0]?.[1])
      .toBe("workforce-exception-decision:org-1:case-1")
    expect(db.workforceExceptionDecision.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", caseId: "case-1" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: MAX_WORKFORCE_EXCEPTION_DECISIONS + 1,
      select: { decisionCode: true },
    })
  })

  it("rejects a new linked mutation after terminal resolution", async () => {
    db.workforceExceptionDecision.findMany.mockResolvedValue([
      { decisionCode: "ACKNOWLEDGE" },
      { decisionCode: "RESOLVE_NO_CHANGE" },
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
      { decisionCode: "RESOLVE_NO_CHANGE" },
    ])
    await expect(lockWorkforceExceptionLinkedMutation({
      db,
      organizationId: "org-1",
      caseId: "case-1",
    })).rejects.toMatchObject({
      code: "WORKFORCE_EXCEPTION_LINKED_MUTATION_HISTORY_INVALID",
    })

    db.workforceExceptionDecision.findMany.mockResolvedValueOnce(
      Array.from({ length: MAX_WORKFORCE_EXCEPTION_DECISIONS }, () => ({
        decisionCode: "ACKNOWLEDGE",
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
})
