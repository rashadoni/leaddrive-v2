import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { withJobLease } from "@/lib/cron/job-lease"
import { runWithRlsBypass } from "@/lib/rls-context"
import { createNotification, deliverNotificationPush } from "@/lib/notifications"
import { COMMITMENT_CALL_FIELD } from "@/lib/commitments/record-call-commitment"
import { nextEscalationStep } from "@/lib/commitments/escalation"

/**
 * Missed-promise escalation.
 *
 * Every few minutes, look at the commitments captured from calls and tell
 * somebody when one has come and gone. In-app and push only: the emails this
 * used to send landed in spam folders naming nobody, and the owner replaced
 * them with the late-callback analytics panel — then asked for the emails to
 * stop. Do not add email back here without that decision being revisited. The ladder — assignee first, management
 * after a grace period, marketing never — is explained in
 * `src/lib/commitments/escalation.ts`; it exists so that recording a promise
 * stays safe to do.
 *
 * The notification stamps live on the task itself rather than in a side table,
 * so re-running this endpoint cannot notify the same person twice about the
 * same slip, whatever the cron schedule does.
 */

const MANAGER_ROLES = ["admin", "manager", "superadmin"]
const BATCH = 200
const LOOKBACK_HOURS = 72

export async function POST(req: NextRequest) {
  // Authentication must happen outside the bypass. An unauthenticated request
  // must never enter a context that can see every tenant, even if later code
  // happens to return before issuing a query.
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  if (new URL(req.url).searchParams.get("smoke") === "1") {
    return NextResponse.json({
      success: true,
      data: { notified: 0, escalated: 0, scanned: 0, smoke: true },
    })
  }

  return runWithRlsBypass(async () => {
    try {
      const run = await withJobLease(
        { name: "commitment-escalation", ttlMs: 180_000 },
        () => runEscalationTick(new Date()),
      )
      if (run.status === "skipped") {
        return NextResponse.json({ success: true, data: { skipped: run.reason } })
      }
      return NextResponse.json({ success: true, data: run.value })
    } catch (e) {
      console.error("[commitment-escalation] failed", e)
      return NextResponse.json({ error: "Escalation run failed" }, { status: 500 })
    }
  })
}

async function runEscalationTick(now: Date) {
  let notified = 0
  let escalated = 0

  // Only commitments, and only recent ones. Scanning every overdue task in the
  // database would let an old backlog fill the batch and starve the promises
  // this exists for — and a first run that shouted about last month's leftovers
  // is how a new alert channel gets muted on day one.
  const floor = new Date(now.getTime() - LOOKBACK_HOURS * 3600_000)
  const due = await prisma.task.findMany({
    where: {
      deletedAt: null,
      dueDate: { gte: floor, lte: now },
      status: { notIn: ["done", "completed", "cancelled"] },
      customFields: { path: [COMMITMENT_CALL_FIELD], not: Prisma.DbNull },
    },
    select: {
      id: true,
      organizationId: true,
      title: true,
      dueDate: true,
      assignedTo: true,
      relatedType: true,
      relatedId: true,
      completedAt: true,
      customFields: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { dueDate: "asc" },
    take: BATCH,
  })

  for (const task of due) {
    const fields = (task.customFields ?? {}) as Record<string, unknown>
    // Only commitments made to a customer on a call. An ordinary overdue task
    // is somebody's own planning and is not escalated to their boss.
    if (typeof fields[COMMITMENT_CALL_FIELD] !== "string") continue
    if (!task.dueDate) continue

    const step = nextEscalationStep({
      dueDate: task.dueDate,
      overdueNotifiedAt: parseStamp(fields.overdueNotifiedAt),
      escalatedAt: parseStamp(fields.escalatedAt),
      completedAt: task.completedAt,
    }, now)
    if (step === "none") continue

    if (step === "notify-assignee") {
      const reminders: CommitmentReminder[] = task.assignedTo
        ? [{
          organizationId: task.organizationId,
          userId: task.assignedTo,
          type: "warning",
          title: "Müştəriyə verilən söz gecikir",
          message: task.title,
          entityType: "task",
          entityId: task.id,
          idempotencyKey: commitmentNotificationKey(task, "assignee", task.assignedTo),
        }]
        : []
      const committed = await commitReminder(
        task,
        fields,
        { overdueNotifiedAt: now.toISOString() },
        reminders,
      )
      if (committed && task.assignedTo) notified += 1
      continue
    }

    const managers = await prisma.user.findMany({
      where: {
        organizationId: task.organizationId,
        isActive: true,
        role: { in: MANAGER_ROLES },
        ...(task.assignedTo ? { id: { not: task.assignedTo } } : {}),
      },
      select: { id: true },
      take: 10,
    })
    // No recipient means there is nothing durable to prove. Leave the stamp
    // empty so adding a manager later makes the next tick deliver the alert.
    if (managers.length === 0) continue
    const reminders: CommitmentReminder[] = managers.map((manager) => ({
      organizationId: task.organizationId,
      userId: manager.id,
      type: "error",
      title: "Öhdəlik icra olunmayıb",
      message: task.title,
      entityType: "task",
      entityId: task.id,
      idempotencyKey: commitmentNotificationKey(task, "manager", manager.id),
    }))
    const committed = await commitReminder(
      task,
      fields,
      { escalatedAt: now.toISOString() },
      reminders,
    )
    if (committed) escalated += 1
  }

  return { notified, escalated, scanned: due.length }
}

function commitmentNotificationKey(
  task: {
    id: string
    createdAt: Date
    dueDate: Date | null
  },
  phase: "assignee" | "manager",
  recipientId: string,
): string {
  return [
    "commitment-escalation:v1",
    task.id,
    task.createdAt.toISOString(),
    task.dueDate?.toISOString() ?? "no-due-date",
    phase,
    recipientId,
  ].join(":")
}

function parseStamp(value: unknown): Date | null {
  if (typeof value !== "string") return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

type CommitmentReminder = {
  organizationId: string
  userId: string
  type: "warning" | "error"
  title: string
  message: string
  entityType: "task"
  entityId: string
  idempotencyKey: string
}

async function commitReminder(
  task: {
    id: string
    organizationId: string
    updatedAt: Date
    dueDate: Date | null
  },
  fields: Record<string, unknown>,
  patch: Record<string, string>,
  reminders: CommitmentReminder[],
): Promise<boolean> {
  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const changed = await tx.task.updateMany({
        where: {
          id: task.id,
          organizationId: task.organizationId,
          // The CAS belongs in the same transaction as the durable rows. If a
          // browser reschedules/completes/cancels between the scan and here,
          // count=0 and no recipient is falsely told the old promise is late.
          updatedAt: task.updatedAt,
          dueDate: task.dueDate,
          deletedAt: null,
          completedAt: null,
          status: { notIn: ["done", "completed", "cancelled"] },
        },
        data: { customFields: { ...fields, ...patch } as Prisma.InputJsonValue },
      })
      if (changed.count !== 1) return { committed: false, pushes: [] as CommitmentReminder[] }

      const pushes: CommitmentReminder[] = []
      for (const reminder of reminders) {
        const notification = await createNotification({
          ...reminder,
          push: false,
          client: tx,
        })
        // Throwing rolls back both the stamp and every earlier notification in
        // this batch. The next tick can retry without losing or duplicating it.
        if (!notification) throw new Error("commitment_notification_not_persisted")
        // Transactional persistence reports whether this tick inserted the
        // deterministic row. Test doubles and older overlapping code have no
        // marker and are conservatively treated as a new delivery.
        if (!("createdNow" in notification) || notification.createdNow === true) {
          pushes.push(reminder)
        }
      }
      return { committed: true, pushes }
    })
    if (!outcome.committed) return false

    // Browser push is external and cannot participate in the database commit.
    // The in-app row is durable; this courtesy delivery is best-effort after it.
    for (const reminder of outcome.pushes) {
      await deliverNotificationPush(reminder)
    }
    return true
  } catch {
    return false
  }
}
