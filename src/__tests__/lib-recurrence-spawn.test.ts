import { describe, it, expect, vi, beforeEach } from "vitest"
import { Prisma } from "@prisma/client"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: {
      create: vi.fn(),
    },
  },
}))

import { spawnNextRecurringTask } from "@/lib/recurrence/spawn"
import { prisma } from "@/lib/prisma"

const BASE = {
  id: "t-original",
  organizationId: "org-1",
  title: "Weekly status report",
  description: "Write up the team's progress",
  priority: "medium",
  dueDate: new Date(Date.UTC(2026, 5, 1, 12, 0, 0)),
  assignedTo: "u-1",
  relatedType: "company" as string | null,
  relatedId: "c-42" as string | null,
  projectId: "p-7" as string | null,
  customFields: { sprint: "Q3" } as Record<string, unknown>,
  recurrenceParentId: null as string | null,
  createdBy: "u-1",
}

beforeEach(() => { vi.clearAllMocks() })

describe("spawnNextRecurringTask", () => {
  it("returns null when recurrenceRule is missing", async () => {
    const res = await spawnNextRecurringTask({
      task: { ...BASE, recurrenceRule: null, recurrenceEndAt: null, recurrenceCount: null },
    })
    expect(res).toBeNull()
    expect(prisma.task.create).not.toHaveBeenCalled()
  })

  it("returns null when rule is unparseable", async () => {
    const res = await spawnNextRecurringTask({
      task: { ...BASE, recurrenceRule: "garbage", recurrenceEndAt: null, recurrenceCount: null },
    })
    expect(res).toBeNull()
    expect(prisma.task.create).not.toHaveBeenCalled()
  })

  it("returns null when next dueDate would exceed recurrenceEndAt", async () => {
    const res = await spawnNextRecurringTask({
      task: {
        ...BASE,
        recurrenceRule: "weekly",
        recurrenceEndAt: new Date(Date.UTC(2026, 5, 5, 12, 0, 0)), // Jun 5
        recurrenceCount: null,
      },
    })
    // next = Jun 1 + 7 = Jun 8 > Jun 5 → no spawn
    expect(res).toBeNull()
    expect(prisma.task.create).not.toHaveBeenCalled()
  })

  it("returns null when recurrenceCount ≤ 0", async () => {
    const res = await spawnNextRecurringTask({
      task: { ...BASE, recurrenceRule: "daily", recurrenceEndAt: null, recurrenceCount: 0 },
    })
    expect(res).toBeNull()
    expect(prisma.task.create).not.toHaveBeenCalled()
  })

  it("spawns next instance with payload carry-over and decremented count", async () => {
    vi.mocked(prisma.task.create).mockResolvedValue({ id: "t-next" } as any)
    const res = await spawnNextRecurringTask({
      task: { ...BASE, recurrenceRule: "weekly", recurrenceEndAt: null, recurrenceCount: 3 },
    })
    expect(res).not.toBeNull()

    const call = vi.mocked(prisma.task.create).mock.calls[0][0] as any
    expect(call.data.organizationId).toBe("org-1")
    expect(call.data.title).toBe("Weekly status report")
    expect(call.data.priority).toBe("medium")
    expect(call.data.status).toBe("pending")
    expect(call.data.assignedTo).toBe("u-1")
    expect(call.data.relatedType).toBe("company")
    expect(call.data.relatedId).toBe("c-42")
    expect(call.data.projectId).toBe("p-7")
    expect(call.data.customFields).toEqual({ sprint: "Q3" })
    expect(call.data.recurrenceRule).toBe("weekly")
    expect(call.data.recurrenceCount).toBe(2) // 3 → 2
    expect(call.data.recurrenceParentId).toBe("t-original") // chained to first
    // Jun 1 + 7d = Jun 8
    expect((call.data.dueDate as Date).toISOString()).toBe("2026-06-08T12:00:00.000Z")
  })

  it("preserves null count (unlimited)", async () => {
    vi.mocked(prisma.task.create).mockResolvedValue({ id: "t-next" } as any)
    await spawnNextRecurringTask({
      task: { ...BASE, recurrenceRule: "daily", recurrenceEndAt: null, recurrenceCount: null },
    })
    const call = vi.mocked(prisma.task.create).mock.calls[0][0] as any
    expect(call.data.recurrenceCount).toBeNull()
  })

  it("chains every later spawn to the ORIGINAL parent (not the most recent task)", async () => {
    vi.mocked(prisma.task.create).mockResolvedValue({ id: "t-3" } as any)
    await spawnNextRecurringTask({
      task: {
        ...BASE,
        id: "t-2",
        recurrenceRule: "daily",
        recurrenceEndAt: null,
        recurrenceCount: null,
        recurrenceParentId: "t-original-parent", // already a child of an original
      },
    })
    const call = vi.mocked(prisma.task.create).mock.calls[0][0] as any
    expect(call.data.recurrenceParentId).toBe("t-original-parent")
  })

  it("swallows P2002 unique violation (concurrent-completion race fix)", async () => {
    // Architect P1: the DB-level unique on (recurrenceParentId, dueDate)
    // means two simultaneous PATCHes can't both spawn. The loser sees
    // P2002 from Prisma and we silently no-op.
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      { code: "P2002", clientVersion: "test" } as any,
    )
    vi.mocked(prisma.task.create).mockRejectedValueOnce(p2002)

    const res = await spawnNextRecurringTask({
      task: { ...BASE, recurrenceRule: "daily", recurrenceEndAt: null, recurrenceCount: null },
    })
    expect(res).toBeNull()
  })

  it("re-throws non-P2002 Prisma errors", async () => {
    vi.mocked(prisma.task.create).mockRejectedValueOnce(new Error("DB down"))

    await expect(
      spawnNextRecurringTask({
        task: { ...BASE, recurrenceRule: "daily", recurrenceEndAt: null, recurrenceCount: null },
      })
    ).rejects.toThrow("DB down")
  })

  it("falls back to NOW when source task has no dueDate", async () => {
    vi.mocked(prisma.task.create).mockResolvedValue({ id: "t-next" } as any)
    const beforeMs = Date.now()
    await spawnNextRecurringTask({
      task: { ...BASE, dueDate: null, recurrenceRule: "daily", recurrenceEndAt: null, recurrenceCount: null },
    })
    const afterMs = Date.now()
    const call = vi.mocked(prisma.task.create).mock.calls[0][0] as any
    const due = (call.data.dueDate as Date).getTime()
    // Next due is one day after "now" → between (now+24h-eps) and (now+24h+eps)
    expect(due).toBeGreaterThanOrEqual(beforeMs + 86_400_000 - 1000)
    expect(due).toBeLessThanOrEqual(afterMs + 86_400_000 + 1000)
  })
})
