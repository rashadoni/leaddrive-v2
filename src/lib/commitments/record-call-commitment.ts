import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { createNotification } from "@/lib/notifications"
import { sendEmail } from "@/lib/email"
import { buildCommitmentTask } from "@/lib/commitments/call-commitment"
import { resolveSalesBoardSlot } from "@/lib/tasks/sales-board"
import { commitmentDueDays } from "@/lib/tasks/call-task-settings"
import {
  COMMITMENT_CALL_FIELD,
  callbackReminderId,
} from "@/lib/commitments/call-commitment-identity"
import type { ConversationInsight } from "@/lib/conversation-intel/types"

/**
 * Writing a promise down where it can be missed — and telling the person who
 * made it, wherever they are.
 *
 * Everything here is idempotent on the call: an analysis can be re-run, a
 * webhook can be delivered twice, and neither may produce a second copy of the
 * same obligation. New rows use the call-derived primary key; the JSON marker
 * keeps legacy rows discoverable and powers commitment-only queries.
 *
 * The email is not a nicety. The salesperson is not sitting in the CRM when the
 * call ends — that is the whole reason a promise gets forgotten — so the first
 * notification has to reach them where they already are.
 */

export { COMMITMENT_CALL_FIELD, callbackReminderId }

export type RecordCommitmentResult =
  | { created: false; reason: "no-commitment" | "already-recorded" | "no-assignee" | "superseded" | "failed" }
  | { created: true; taskId: string; dueDate: Date; statedByCustomer: boolean }

type LockedCallRow = {
  id: string
  callMode: string
  disposition: string | null
}

type PersistCommitmentResult =
  | { kind: "created"; taskId: string; assigneeId: string }
  | { kind: "already-recorded" | "no-assignee" | "superseded" }

async function organizationTimeZone(organizationId: string): Promise<string> {
  const hours = await prisma.businessHours.findFirst({
    where: { organizationId },
    select: { timezone: true },
    orderBy: { channelType: "asc" },
  })
  return hours?.timezone || "UTC"
}

export async function recordCallCommitment(input: {
  organizationId: string
  callId: string
  leadId: string | null
  insight: ConversationInsight | null
  callAt: Date
  /** Who owns the lead. Falls back to whoever the call belonged to. */
  assigneeId: string | null
}): Promise<RecordCommitmentResult> {
  try {
    const timeZone = await organizationTimeZone(input.organizationId)
    // One read for both tenant settings: how long an undated promise gets, and
    // which board it lands on. The pipeline of the lead can name a board of its
    // own; the organization's choice is the fallback.
    const [org, lead] = await Promise.all([
      prisma.organization.findFirst({
        where: { id: input.organizationId },
        select: { features: true },
      }),
      input.leadId
        ? prisma.lead.findFirst({
            where: { id: input.leadId, organizationId: input.organizationId },
            select: { pipelineId: true },
          })
        : Promise.resolve(null),
    ])
    const draft = buildCommitmentTask({
      insight: input.insight,
      callAt: input.callAt,
      timeZone,
      dueDays: commitmentDueDays(org?.features),
    })
    if (!draft) return { created: false, reason: "no-commitment" }

    const board = await resolveSalesBoardSlot(input.organizationId, {
      features: org?.features,
      pipelineId: lead?.pipelineId ?? null,
    }).catch(() => null)

    const persist = async (tx: Prisma.TransactionClient): Promise<PersistCommitmentResult> => {
      // This row is the shared mutex for the two writers: transcript analysis
      // and the human outcome form. The form's update already takes the same
      // PostgreSQL row lock. Whichever commits second therefore sees the first
      // writer's authoritative disposition before it can touch the task.
      const [call] = await tx.$queryRaw<LockedCallRow[]>`
        SELECT "id", "callMode", "disposition"
        FROM "call_logs"
        WHERE "organizationId" = ${input.organizationId}
          AND "id" = ${input.callId}
        FOR UPDATE
      `
      if (!call) return { kind: "superseded" }
      if (
        call.callMode === "human"
        && call.disposition !== null
        && call.disposition !== "callback"
      ) {
        return { kind: "superseded" }
      }

      const canonicalId = callbackReminderId(input.callId)
      // Prisma query extensions also run on interactive transaction clients.
      // Keep `deletedAt` explicit so the active read cannot silently change,
      // then do a separate include-deleted escape-hatch read below.
      const matches = await tx.task.findMany({
        where: {
          organizationId: input.organizationId,
          deletedAt: null,
          OR: [
            { id: canonicalId },
            {
              customFields: {
                path: [COMMITMENT_CALL_FIELD],
                equals: input.callId,
              },
            },
          ],
        },
        select: {
          id: true,
          title: true,
          description: true,
          priority: true,
          dueDate: true,
          assignedTo: true,
          relatedType: true,
          relatedId: true,
          divisionId: true,
          boardColumnKey: true,
          boardPosition: true,
          customFields: true,
          deletedAt: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      })
      const existing = matches.find((task) => task.id === canonicalId) ?? matches[0]

      if (existing) {
        const customFields = jsonObject(existing.customFields)
        const isManualCallback = customFields.callbackSource === "manual-disposition"
        const alreadyEnriched = Object.prototype.hasOwnProperty.call(
          customFields,
          "commitmentStatedByCustomer",
        )
        if (!isManualCallback || alreadyEnriched) {
          return { kind: "already-recorded" }
        }

        // Manual-first and analysis-first must leave the same useful task.
        // Enrich the placeholder, but preserve the explicit time, owner and
        // relation the person just chose. A custom title/description also wins
        // over the analyser; literal "Callback" and an empty description are
        // the untouched placeholder values.
        customFields[COMMITMENT_CALL_FIELD] = input.callId
        customFields.commitmentStatedByCustomer = draft.statedByCustomer
        const enrichment: Prisma.TaskUpdateManyMutationInput = {
          ...(existing.title === "Callback" ? { title: draft.title } : {}),
          ...(existing.description === null ? { description: draft.description } : {}),
          priority: draft.priority,
          ...(
            board && existing.divisionId === null
              ? {
                  divisionId: board.divisionId,
                  boardColumnKey: board.columnKey,
                  boardPosition: board.position,
                }
              : {}
          ),
          customFields: customFields as Prisma.InputJsonValue,
        }
        const enriched = await tx.task.updateMany({
          where: {
            id: existing.id,
            organizationId: input.organizationId,
            updatedAt: existing.updatedAt,
            deletedAt: null,
          },
          data: enrichment,
        })
        if (enriched.count !== 1) throw new Error("commitment_task_changed")
        return { kind: "already-recorded" }
      }

      // A deleted task is a durable tombstone: analysis retries must never
      // resurrect work a person explicitly cancelled or deleted. Naming the
      // non-null predicate is the soft-delete extension's escape hatch.
      const deleted = await tx.task.findMany({
        where: {
          organizationId: input.organizationId,
          deletedAt: { not: null },
          OR: [
            { id: canonicalId },
            {
              customFields: {
                path: [COMMITMENT_CALL_FIELD],
                equals: input.callId,
              },
            },
          ],
        },
        select: { id: true },
        take: 1,
      })
      if (deleted.length > 0) return { kind: "already-recorded" }

      // A task nobody owns is a task nobody does. An existing manual task can
      // still be enriched above, but a new orphan must not be filed.
      if (!input.assigneeId) return { kind: "no-assignee" }

      const task = await tx.task.create({
        data: {
          id: canonicalId,
          organizationId: input.organizationId,
          ...(board
            ? { divisionId: board.divisionId, boardColumnKey: board.columnKey, boardPosition: board.position }
            : {}),
          title: draft.title,
          description: draft.description,
          dueDate: draft.dueDate,
          priority: draft.priority,
          assignedTo: input.assigneeId,
          relatedType: input.leadId ? "lead" : "call",
          relatedId: input.leadId ?? input.callId,
          customFields: {
            [COMMITMENT_CALL_FIELD]: input.callId,
            commitmentStatedByCustomer: draft.statedByCustomer,
          },
        },
        select: { id: true },
      })
      return { kind: "created", taskId: task.id, assigneeId: input.assigneeId }
    }

    let persisted: PersistCommitmentResult
    try {
      persisted = await prisma.$transaction(persist)
    } catch (e) {
      // A PostgreSQL unique violation aborts its transaction even when caught
      // in JavaScript, so handle an overlap with an older, lock-free process
      // only after Prisma has rolled the failed transaction back.
      if (isUniqueConflict(e)) return { created: false, reason: "already-recorded" }
      throw e
    }

    if (persisted.kind !== "created") {
      return { created: false, reason: persisted.kind }
    }

    await createNotification({
      organizationId: input.organizationId,
      userId: persisted.assigneeId,
      type: draft.statedByCustomer ? "warning" : "info",
      title: "Müştəriyə verilən söz",
      message: draft.title,
      entityType: "task",
      entityId: persisted.taskId,
      push: true,
    }).catch(() => {})

    const assignee = await prisma.user.findFirst({
      where: { id: persisted.assigneeId, organizationId: input.organizationId },
      select: { email: true, name: true },
    })
    if (assignee?.email) {
      const when = draft.statedByCustomer
        ? `Müştərinin dediyi vaxt: ${draft.dueDate.toISOString()}`
        : `Son tarix (standart): ${draft.dueDate.toISOString()}`
      await sendEmail({
        to: assignee.email,
        organizationId: input.organizationId,
        transactional: true,
        subject: `Zəngdən sonra öhdəlik: ${draft.title}`.slice(0, 180),
        html: `<p>${escapeHtml(draft.title)}</p><p>${escapeHtml(when)}</p><pre>${escapeHtml(draft.description)}</pre>`,
        text: `${draft.title}\n\n${when}\n\n${draft.description}`,
      }).catch(() => {})
    }

    return {
      created: true,
      taskId: persisted.taskId,
      dueDate: draft.dueDate,
      statedByCustomer: draft.statedByCustomer,
    }
  } catch (e) {
    // Recording a promise must never be the thing that fails an analysis the
    // rest of the product depends on.
    console.error("[commitments] recordCallCommitment failed", {
      callId: input.callId,
      error: e instanceof Error ? e.message : String(e),
    })
    return { created: false, reason: "failed" }
  }
}

function jsonObject(value: Prisma.JsonValue | null): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return { ...(value as Record<string, unknown>) }
}

function isUniqueConflict(value: unknown): boolean {
  // Tests and some Prisma adapters surface a plain Error carrying `code`, so
  // an instanceof-only check would turn a successful race into "failed".
  return !!value
    && typeof value === "object"
    && "code" in value
    && (value as { code?: unknown }).code === "P2002"
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
