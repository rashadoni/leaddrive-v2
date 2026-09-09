import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  buildVoiceTaskWhere: vi.fn(),
  getVoiceAccessibleDivisionIds: vi.fn(),
  boardColumnFindMany: vi.fn(),
  taskGroupBy: vi.fn(),
  taskCount: vi.fn(),
  divisionFindMany: vi.fn(),
}))

vi.mock("@/lib/ai/voice/task-scope", () => ({
  buildVoiceTaskWhere: mocks.buildVoiceTaskWhere,
  getVoiceAccessibleDivisionIds: mocks.getVoiceAccessibleDivisionIds,
  narrowVoiceTaskWhere: (where: Record<string, unknown>, predicate: Record<string, unknown>) => ({
    ...where,
    AND: [...(Array.isArray(where.AND) ? where.AND : []), predicate],
  }),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    boardColumn: { findMany: mocks.boardColumnFindMany },
    task: { groupBy: mocks.taskGroupBy, count: mocks.taskCount },
    division: { findMany: mocks.divisionFindMany },
  },
}))

import { buildBoardsSummary } from "@/lib/ai/voice/summaries"

describe("voice boards summary lane counts", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.buildVoiceTaskWhere.mockResolvedValue({ organizationId: "org-1", deletedAt: null })
    mocks.getVoiceAccessibleDivisionIds.mockResolvedValue(["board-a", "board-b"])
    mocks.taskCount.mockResolvedValue(0)
    mocks.divisionFindMany.mockResolvedValue([])
  })

  it("does not duplicate a canonical status shared by two boards", async () => {
    mocks.boardColumnFindMany.mockResolvedValue([
      {
        divisionId: "board-a",
        key: "todo",
        label: "TO DO",
        mapsToStatus: "todo",
        sortOrder: 1,
      },
      {
        divisionId: "board-b",
        key: "todo",
        label: "TO DO",
        mapsToStatus: "todo",
        sortOrder: 1,
      },
    ])
    mocks.taskGroupBy.mockImplementation(async ({ by }: { by: string[] }) => (
      by.length > 1
        ? [
          { divisionId: "board-a", status: "todo", boardColumnKey: "todo", _count: { _all: 2 } },
          { divisionId: "board-b", status: "todo", boardColumnKey: "todo", _count: { _all: 3 } },
        ]
        : []
    ))

    const result = await buildBoardsSummary(
      "org-1",
      new Date("2026-08-12T08:00:00.000Z"),
      { userId: "manager-1", role: "manager" },
    )

    expect(mocks.taskGroupBy).toHaveBeenCalledWith(expect.objectContaining({
      by: ["divisionId", "status", "boardColumnKey"],
    }))
    expect(result).toMatchObject({
      totalOpen: 5,
      columns: [{ label: "TO DO", tasks: 5 }],
      uncolumned: 0,
    })
    expect(result.columns.reduce((total, lane) => total + lane.tasks, 0)).toBe(result.totalOpen)
  })

  it("reports each named board separately, so a report on ONE board is possible", async () => {
    // The owner asked for a report on a board and was told no such tool exists.
    // It existed — it just answered with one org-wide total and columns merged
    // by label across every board, which no named board could be read out of.
    mocks.getVoiceAccessibleDivisionIds.mockResolvedValue(["board-a", "board-b"])
    mocks.divisionFindMany.mockResolvedValue([
      { id: "board-a", name: "Продажи" },
      { id: "board-b", name: "Внедрение" },
    ])
    mocks.boardColumnFindMany.mockResolvedValue([
      { divisionId: "board-a", key: "todo", label: "TO DO", mapsToStatus: "todo", sortOrder: 1 },
      { divisionId: "board-a", key: "doing", label: "В работе", mapsToStatus: "in_progress", sortOrder: 2 },
      { divisionId: "board-b", key: "todo", label: "TO DO", mapsToStatus: "todo", sortOrder: 1 },
    ])
    mocks.taskGroupBy.mockImplementation(async ({ by, where }: { by: string[]; where: Record<string, unknown> }) => {
      if (by.length > 1) {
        return [
          { divisionId: "board-a", status: "todo", boardColumnKey: "todo", _count: { _all: 2 } },
          { divisionId: "board-a", status: "in_progress", boardColumnKey: "doing", _count: { _all: 4 } },
          { divisionId: "board-b", status: "todo", boardColumnKey: "todo", _count: { _all: 3 } },
        ]
      }
      const predicate = (where.AND as Record<string, unknown>[]).at(-1) ?? {}
      if ("dueDate" in predicate) return [{ divisionId: "board-a", _count: { _all: 1 } }]
      if ("assignedTo" in predicate) return [{ divisionId: "board-b", _count: { _all: 3 } }]
      return [{ divisionId: "board-a", _count: { _all: 2 } }]
    })

    const result = await buildBoardsSummary(
      "org-1",
      new Date("2026-08-12T08:00:00.000Z"),
      { userId: "manager-1", role: "manager" },
    )

    expect(result.boards).toEqual([
      {
        name: "Продажи",
        totalOpen: 6,
        columns: [{ label: "TO DO", tasks: 2 }, { label: "В работе", tasks: 4 }],
        overdue: 1,
        unassigned: 0,
        highPriority: 2,
      },
      {
        name: "Внедрение",
        totalOpen: 3,
        columns: [{ label: "TO DO", tasks: 3 }],
        overdue: 0,
        unassigned: 3,
        highPriority: 0,
      },
    ])
    // Same spoken label on two boards is still one merged org-wide lane, and
    // the per-board rows must add up to the org totals.
    expect(result.columns).toContainEqual({ label: "TO DO", tasks: 5 })
    expect(result.boards.reduce((n, board) => n + board.totalOpen, 0)).toBe(result.totalOpen)
    expect(result.boardsOmitted).toBe(0)
  })

  it("never lists a department container, which holds no tasks of its own", async () => {
    mocks.divisionFindMany.mockResolvedValue([])
    mocks.boardColumnFindMany.mockResolvedValue([])
    mocks.taskGroupBy.mockResolvedValue([])

    await buildBoardsSummary("org-1", new Date(), { userId: "manager-1", role: "manager" })
    expect(mocks.divisionFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ isDepartment: false, isActive: true }),
    }))
  })
})
