import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  buildTaskListWhere: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  logAudit: vi.fn(async () => undefined),
}))

vi.mock("@/lib/tasks/list-query", () => ({
  buildTaskListWhere: mocks.buildTaskListWhere,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: { findMany: mocks.findMany, count: mocks.count },
  },
  logAudit: mocks.logAudit,
}))

import { executeVoiceTaskList } from "@/lib/ai/voice/task-list"

describe("voice list_tasks board scope", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findMany.mockResolvedValue([])
    mocks.count.mockResolvedValue(0)
  })

  it("uses the canonical manager board WHERE for rows and totals", async () => {
    const scopedWhere = {
      organizationId: "org-1",
      deletedAt: null,
      AND: [{ OR: [{ assignedTo: "manager-1" }, { divisionId: { in: ["board-visible"] } }] }],
    }
    mocks.buildTaskListWhere.mockResolvedValue({ where: scopedWhere, blocked: false })

    const result = await executeVoiceTaskList(
      { status: "todo", assignedTo: "me", limit: 10 },
      "org-1",
      { userId: "manager-1", role: "manager" },
    )

    expect(result.success).toBe(true)
    expect(mocks.buildTaskListWhere).toHaveBeenCalledWith(
      "org-1",
      "manager-1",
      "manager",
      expect.objectContaining({
        assignedTo: "manager-1",
        statusParts: ["todo"],
      }),
    )
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: scopedWhere }))
    expect(mocks.count).toHaveBeenCalledWith({ where: scopedWhere })
  })

  it("fails closed without querying tasks when scope resolution fails", async () => {
    mocks.buildTaskListWhere.mockRejectedValue(new Error("board access unavailable"))

    const result = await executeVoiceTaskList(
      {},
      "org-1",
      { userId: "manager-1", role: "manager" },
    )

    expect(result).toEqual({ success: false, error: "ACCESS_SCOPE_UNAVAILABLE" })
    expect(mocks.findMany).not.toHaveBeenCalled()
    expect(mocks.count).not.toHaveBeenCalled()
  })
})
