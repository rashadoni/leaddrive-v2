/**
 * Spawn the next instance of a recurring task — Roadmap #22.
 *
 * Called by the task PATCH handler when a recurring task enters
 * status="completed". Computes the next dueDate from the rule and
 * inserts a fresh task with the same payload, ready to be worked.
 *
 * Stop conditions (return null without inserting):
 *   - No `recurrenceRule` on the task (not a recurring series)
 *   - Rule doesn't parse
 *   - `recurrenceEndAt` is set and the next dueDate would exceed it
 *   - `recurrenceCount` is set and has already hit zero
 *
 * Chaining: every spawned instance's `recurrenceParentId` points back to
 * the FIRST task in the series (not the most-recently-completed one),
 * so the UI can show "task #5 of a recurring series" and operators can
 * stop the chain by clearing the rule on the parent.
 */

import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { nextDueDate } from "./parse"

interface SpawnArgs {
  task: {
    id: string
    organizationId: string
    title: string
    description: string | null
    priority: string
    dueDate: Date | null
    assignedTo: string | null
    relatedType: string | null
    relatedId: string | null
    projectId: string | null
    customFields: unknown // JSONB — Prisma's Json scalar
    recurrenceRule: string | null
    recurrenceEndAt: Date | null
    recurrenceCount: number | null
    recurrenceParentId: string | null
    createdBy: string | null
  }
}

export async function spawnNextRecurringTask({ task }: SpawnArgs): Promise<{ id: string } | null> {
  if (!task.recurrenceRule) return null

  // recurrenceCount=0 means "no more left"; 0 reaches the stop earlier
  // than the actual creation. Negative values are nonsense — same stop.
  if (typeof task.recurrenceCount === "number" && task.recurrenceCount <= 0) {
    return null
  }

  // Fall back to NOW if the source task has no dueDate (e.g. user set
  // recurrence on an undated task — first instance dated from completion).
  const base = task.dueDate ?? new Date()
  const next = nextDueDate(base, task.recurrenceRule)
  if (!next) return null

  if (task.recurrenceEndAt && next > task.recurrenceEndAt) {
    return null
  }

  const newCount = typeof task.recurrenceCount === "number" ? task.recurrenceCount - 1 : null

  try {
    const created = await prisma.task.create({
      data: {
        organizationId: task.organizationId,
        title: task.title,
        description: task.description,
        priority: task.priority,
        status: "pending",
        dueDate: next,
        assignedTo: task.assignedTo,
        relatedType: task.relatedType,
        relatedId: task.relatedId,
        projectId: task.projectId,
        customFields: (task.customFields ?? {}) as object,
        createdBy: task.createdBy,
        // Recurrence carry-over: rule + endAt stay; count decrements;
        // parent chains to the FIRST task in the series, not this one.
        recurrenceRule: task.recurrenceRule,
        recurrenceEndAt: task.recurrenceEndAt,
        recurrenceCount: newCount,
        recurrenceParentId: task.recurrenceParentId ?? task.id,
      },
      select: { id: true },
    })
    return created
  } catch (e) {
    // Architect P1 race protection: the DB-level unique
    // `(recurrenceParentId, dueDate)` constraint means a concurrent
    // PATCH that already spawned the same next instance triggers a
    // P2002 unique violation here. That's the GOOD outcome — the
    // other request already created the row, we just lost the race.
    // Silently no-op; the user still sees a single new task on the
    // next refetch.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return null
    }
    throw e
  }
}
