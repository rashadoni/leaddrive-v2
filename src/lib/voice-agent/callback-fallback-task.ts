import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { createNotification } from "@/lib/notifications"
import { resolveSalesBoardSlot } from "@/lib/tasks/sales-board"

/**
 * When the one automatic callback goes unanswered, the machine is done and a
 * person takes over.
 *
 * "Once" means one dial: an unanswered callback spends the retry, and the
 * conversation that broke still deserves finishing. This files that handover as
 * a task on the sales board, assigned to whoever owns the callback, so the
 * broken conversation ends up in front of a human instead of evaporating.
 *
 * Deduplication is the same pattern the commitment tasks use: the callback's
 * call id in customFields, checked before insert. The webhook that reports the
 * unanswered callback can arrive more than once; the salesperson must not get
 * two tasks for one broken conversation.
 */

const FALLBACK_CALL_FIELD = "callbackFallbackCallId"

export type FallbackTaskResult =
  | { created: true; taskId: string }
  | { created: false; reason: "not-a-callback" | "was-answered" | "already-recorded" | "no-assignee" | "error" }

export async function recordUnansweredCallback(params: {
  organizationId: string
  /** The callback call that just ended. */
  callLogId: string
  now?: Date
}): Promise<FallbackTaskResult> {
  const { organizationId, callLogId } = params
  const now = params.now ?? new Date()

  try {
    return await runWithTenant(organizationId, async (): Promise<FallbackTaskResult> => {
      const call = await prisma.callLog.findFirst({
        where: { id: callLogId, organizationId },
        select: {
          continuesCallId: true,
          wasAnswered: true,
          leadId: true,
          userId: true,
        },
      })
      // Only a callback that rang out. An ordinary unanswered call is handled
      // by the queue machinery it belongs to.
      if (!call?.continuesCallId) return { created: false, reason: "not-a-callback" }
      if (call.wasAnswered) return { created: false, reason: "was-answered" }

      const existing = await prisma.task.findFirst({
        where: {
          organizationId,
          deletedAt: null,
          customFields: { path: [FALLBACK_CALL_FIELD], equals: callLogId },
        },
        select: { id: true },
      })
      if (existing) return { created: false, reason: "already-recorded" }

      const lead = call.leadId
        ? await prisma.lead.findFirst({
            where: { id: call.leadId, organizationId },
            select: { assignedTo: true, pipelineId: true },
          })
        : null
      const assigneeId = lead?.assignedTo ?? call.userId ?? null
      // Same rule as commitments: a task nobody owns is a task nobody does.
      if (!assigneeId) return { created: false, reason: "no-assignee" }

      // Same board as the promise task from the same lead: a handover and the
      // promise it follows belong on one wall, so the pipeline's choice counts
      // here too.
      const board = await resolveSalesBoardSlot(organizationId, {
        pipelineId: lead?.pipelineId ?? null,
      }).catch(() => null)
      const task = await prisma.task.create({
        data: {
          organizationId,
          ...(board
            ? { divisionId: board.divisionId, boardColumnKey: board.columnKey, boardPosition: board.position }
            : {}),
          title: "Yarımçıq söhbət: müştəriyə zəng edin",
          description:
            "Müştəri ilə söhbət texniki səbəbdən yarımçıq qaldı. Avtomatik geri zəng "
            + "cavabsız qaldı, ona görə söhbəti siz davam etdirməlisiniz. Nə danışıldığını "
            + "zəngin xülasəsindən görə bilərsiniz.",
          // Soon rather than someday: the customer was mid-conversation less
          // than an hour ago, and the value of the handover decays with it.
          dueDate: new Date(now.getTime() + 60 * 60 * 1000),
          priority: "high",
          assignedTo: assigneeId,
          relatedType: call.leadId ? "lead" : "call",
          relatedId: call.leadId ?? callLogId,
          customFields: { [FALLBACK_CALL_FIELD]: callLogId },
        },
        select: { id: true },
      })

      await createNotification({
        organizationId,
        userId: assigneeId,
        type: "warning",
        title: "Yarımçıq söhbət",
        message: "Avtomatik geri zəng cavabsız qaldı — müştəriyə zəng edin.",
        entityType: "task",
        entityId: task.id,
        push: true,
      }).catch(() => {})

      return { created: true, taskId: task.id }
    })
  } catch (error) {
    // Same posture as the trigger: this runs inside the PBX result webhook,
    // and failing it would re-process a result that was already stored.
    console.error("[voice-callback] fallback task failed", {
      callLogId,
      errorType: error instanceof Error ? error.name : "unknown",
    })
    return { created: false, reason: "error" }
  }
}
