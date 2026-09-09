/**
 * Project completion rollup.
 *
 * `Project.completionPercentage` reflects work-done across two sources:
 *   1. `ProjectTask` — tasks living inside the project's own task list,
 *      using `status === "done"` as the completion signal.
 *   2. `Task` — CRM tasks linked via `Task.projectId`, using
 *      `status === "completed"` as the completion signal.
 *
 * Combined into a single percentage so users see one unified progress
 * number on the Project record regardless of which surface the work lives
 * on. Both task-write paths (CRM tasks PATCH, project-tasks PATCH) call
 * this helper so the field stays consistent.
 *
 * ## Concurrency
 *
 * The whole count + update runs inside a transaction with
 * `pg_advisory_xact_lock(hashtext(projectId))` taken at the top. The lock
 * is held until the transaction ends, serializing concurrent recalcs for
 * the same project so two interleaved writes can't clobber each other
 * (architect P0 from Phase 2 review). Different projects don't block on
 * each other — the lock key is per-project.
 *
 * ## Empty-project semantics
 *
 * When BOTH tables have zero tasks for the project, we set the percentage
 * to 0 (not "leave untouched"). Otherwise a project that loses its last
 * task to a delete would freeze at the prior pct (e.g. 50%) forever, which
 * is misleading. 0% is the honest answer when there's no work to count.
 *
 * ## Idempotence + tenancy
 *
 * Safe to call repeatedly — every call recomputes from current state. All
 * count queries AND the update WHERE clause are org-scoped so a stale
 * orgId can never write across tenants (defense-in-depth on top of the
 * upstream caller's projectId-validation guard).
 */

import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"

export async function recalcProjectCompletion(
  projectId: string,
  organizationId: string,
): Promise<void> {
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // Per-project advisory lock — serializes concurrent recalcs for the
    // SAME project without blocking other projects. `hashtext` reduces the
    // arbitrary-length text id to the int4 that pg_advisory_xact_lock
    // expects. Released automatically when the transaction commits/aborts.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${projectId}))`

    const [projectTaskTotal, projectTaskDone, linkedTaskTotal, linkedTaskDone] =
      await Promise.all([
        tx.projectTask.count({ where: { projectId, organizationId } }),
        tx.projectTask.count({
          where: { projectId, organizationId, status: "done" },
        }),
        // deletedAt:null is EXPLICIT here: Prisma query-extensions do NOT apply
        // to the tx client inside an interactive $transaction (verified on
        // @prisma/client 6.19.2), so the global soft-delete filter would
        // otherwise be bypassed and soft-deleted tasks would inflate the
        // completion denominator.
        tx.task.count({ where: { projectId, organizationId, deletedAt: null } }),
        tx.task.count({
          where: { projectId, organizationId, status: "completed", deletedAt: null },
        }),
      ])

    const total = projectTaskTotal + linkedTaskTotal
    const done = projectTaskDone + linkedTaskDone
    // Empty project → 0% (not "freeze at previous"). See header docstring.
    const pct = total === 0 ? 0 : Math.round((done / total) * 100)

    // Org-scoped update for defense-in-depth. updateMany returns a count so
    // we can warn when a caller passed a stale projectId that doesn't match
    // this org — usually means the task's FK pointed at a project from
    // another tenant (data corruption) or the project was deleted between
    // the count and the update (rare; advisory lock makes it harder).
    const result = await tx.project.updateMany({
      where: { id: projectId, organizationId },
      data: { completionPercentage: pct },
    })
    if (result.count === 0) {
      console.warn(
        `[project-rollup] no project matched id=${projectId} orgId=${organizationId} — stale FK or deleted project?`,
      )
    }
  })
}
