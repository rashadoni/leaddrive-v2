import { describe, it, expect, vi, beforeEach } from "vitest"

// The helper now runs inside `prisma.$transaction(async tx => ...)`. The tx
// object is a strict subset of the prisma client — we mock $transaction to
// invoke the callback with a stand-in `tx` that exposes the same model
// methods we use (count, updateMany, $executeRaw for the advisory lock).
vi.mock("@/lib/prisma", () => {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    task: { count: vi.fn() },
    projectTask: { count: vi.fn() },
    project: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  }
  return {
    prisma: {
      // Stash tx on the prisma mock so tests can reach it.
      __tx: tx,
      $transaction: vi.fn().mockImplementation(async (cb: any) => cb(tx)),
    },
  }
})

import { recalcProjectCompletion } from "@/lib/project-rollup"
import { prisma } from "@/lib/prisma"

const prismaMock = prisma as typeof prisma & {
  __tx: {
    $executeRaw: ReturnType<typeof vi.fn>
    task: { count: ReturnType<typeof vi.fn> }
    projectTask: { count: ReturnType<typeof vi.fn> }
    project: { updateMany: ReturnType<typeof vi.fn> }
  }
  $transaction: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  vi.clearAllMocks()
  // updateMany default — re-arm after clearAllMocks wipes the implementation
  prismaMock.__tx.project.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.__tx.$executeRaw.mockResolvedValue(1)
})

describe("recalcProjectCompletion", () => {
  it("computes combined percentage from ProjectTask + Task counts", async () => {
    // ProjectTask: 3 total, 1 done. Task: 7 total, 4 completed.
    // Combined: 10 total, 5 done → 50%
    prismaMock.__tx.projectTask.count.mockResolvedValueOnce(3) // total
    prismaMock.__tx.projectTask.count.mockResolvedValueOnce(1) // done
    prismaMock.__tx.task.count.mockResolvedValueOnce(7) // total
    prismaMock.__tx.task.count.mockResolvedValueOnce(4) // completed

    await recalcProjectCompletion("proj-1", "org-1")

    expect(prismaMock.__tx.project.updateMany).toHaveBeenCalledWith({
      where: { id: "proj-1", organizationId: "org-1" },
      data: { completionPercentage: 50 },
    })
  })

  it("resets to 0% when the project has zero tasks of either kind", async () => {
    // Architect P2 fix: previous behaviour froze pct at the prior value
    // when total dropped to zero (e.g. last linked task deleted). Now we
    // write 0 explicitly so the UI tells the truth.
    prismaMock.__tx.projectTask.count.mockResolvedValue(0)
    prismaMock.__tx.task.count.mockResolvedValue(0)

    await recalcProjectCompletion("proj-empty", "org-1")

    expect(prismaMock.__tx.project.updateMany).toHaveBeenCalledWith({
      where: { id: "proj-empty", organizationId: "org-1" },
      data: { completionPercentage: 0 },
    })
  })

  it("handles ProjectTask-only contribution (no linked CRM tasks)", async () => {
    prismaMock.__tx.projectTask.count.mockResolvedValueOnce(4)
    prismaMock.__tx.projectTask.count.mockResolvedValueOnce(3)
    prismaMock.__tx.task.count.mockResolvedValueOnce(0)
    prismaMock.__tx.task.count.mockResolvedValueOnce(0)

    await recalcProjectCompletion("proj-2", "org-1")

    // 3/4 = 75
    expect(prismaMock.__tx.project.updateMany).toHaveBeenCalledWith({
      where: { id: "proj-2", organizationId: "org-1" },
      data: { completionPercentage: 75 },
    })
  })

  it("handles Task-only contribution (no ProjectTask)", async () => {
    prismaMock.__tx.projectTask.count.mockResolvedValueOnce(0)
    prismaMock.__tx.projectTask.count.mockResolvedValueOnce(0)
    prismaMock.__tx.task.count.mockResolvedValueOnce(2)
    prismaMock.__tx.task.count.mockResolvedValueOnce(2)

    await recalcProjectCompletion("proj-3", "org-1")

    // 2/2 = 100
    expect(prismaMock.__tx.project.updateMany).toHaveBeenCalledWith({
      where: { id: "proj-3", organizationId: "org-1" },
      data: { completionPercentage: 100 },
    })
  })

  it("scopes ALL queries (count + updateMany) by organizationId", async () => {
    prismaMock.__tx.projectTask.count.mockResolvedValue(0)
    prismaMock.__tx.task.count.mockResolvedValue(0)

    await recalcProjectCompletion("proj-7", "org-42")

    // Counts include organizationId
    for (const call of prismaMock.__tx.projectTask.count.mock.calls) {
      expect((call[0] as { where: { organizationId: string } }).where.organizationId).toBe("org-42")
    }
    for (const call of prismaMock.__tx.task.count.mock.calls) {
      const where = (call[0] as { where: { organizationId: string; deletedAt: unknown } }).where
      expect(where.organizationId).toBe("org-42")
      // Extensions don't reach the tx client — the soft-delete filter must be
      // explicit so soft-deleted tasks don't inflate the rollup denominator.
      expect(where.deletedAt).toBe(null)
    }
    // updateMany WHERE also carries organizationId — defense-in-depth so a
    // stale orgId from a caller can't ever cross-tenant-write.
    const updateCall = prismaMock.__tx.project.updateMany.mock.calls[0][0] as {
      where: { id: string; organizationId: string }
    }
    expect(updateCall.where.organizationId).toBe("org-42")
    expect(updateCall.where.id).toBe("proj-7")
  })

  it("rounds the percentage to a whole integer", async () => {
    // 1 done / 3 total = 33.33… → 33
    prismaMock.__tx.projectTask.count.mockResolvedValueOnce(3)
    prismaMock.__tx.projectTask.count.mockResolvedValueOnce(1)
    prismaMock.__tx.task.count.mockResolvedValueOnce(0)
    prismaMock.__tx.task.count.mockResolvedValueOnce(0)

    await recalcProjectCompletion("proj-x", "org-1")

    expect(prismaMock.__tx.project.updateMany).toHaveBeenCalledWith({
      where: { id: "proj-x", organizationId: "org-1" },
      data: { completionPercentage: 33 },
    })
  })

  it("takes a per-project advisory lock before reading counts", async () => {
    // Architect P0 fix: concurrent recalcs for the same project must
    // serialize. The helper calls pg_advisory_xact_lock(hashtext(projectId))
    // inside the transaction so PG holds an exclusive int4 advisory lock
    // for the duration. Test asserts the lock SQL runs and that the
    // bound parameter is the projectId.
    prismaMock.__tx.projectTask.count.mockResolvedValue(0)
    prismaMock.__tx.task.count.mockResolvedValue(0)

    await recalcProjectCompletion("proj-lock", "org-1")

    expect(prismaMock.$transaction).toHaveBeenCalledOnce()
    expect(prismaMock.__tx.$executeRaw).toHaveBeenCalledOnce()
    // tagged-template call: ([strings], ...values) — projectId is the only value
    const lockCall = prismaMock.__tx.$executeRaw.mock.calls[0]
    expect(lockCall.slice(1)).toEqual(["proj-lock"])
    // SQL fragments must reference pg_advisory_xact_lock + hashtext
    const sql = (lockCall[0] as TemplateStringsArray).join("?")
    expect(sql).toMatch(/pg_advisory_xact_lock/)
    expect(sql).toMatch(/hashtext/)
  })
})
