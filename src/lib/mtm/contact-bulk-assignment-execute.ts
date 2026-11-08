import type { Prisma } from "@prisma/client"
import type { z } from "zod"
import type { MtmRouteActor } from "@/lib/mtm/route-permissions"
import type { ContactBulkAssignmentExecuteSchema } from "@/lib/mtm-validators"
import { buildContactAssignmentPreview } from "@/lib/mtm/contact-bulk-assignment"

/**
 * Привязать (или отвязать) клиентов к полевому сотруднику — запись, общая для
 * экрана (`POST /api/v1/mtm/contact-assignments`) и голоса («назначь доктора
 * Алиева Эльвире», этап 2б, владелец 2026-11-08).
 *
 * Вызывающий отвечает за транзакцию, и она обязана быть Serializable: именно
 * она не даёт двум одновременным назначениям одного клиента сделать двух
 * «главных» сотрудников. Здесь: строка операции (идемпотентность по ключу),
 * предпросмотр заново под транзакцией и сверка его отпечатка с тем, что видел
 * человек (`STALE_PREVIEW`), закрытие и открытие назначений, итог операции и
 * журнал MTM. Ошибки — `Error("STALE_PREVIEW")` и `Error("NOTHING_TO_ASSIGN")`,
 * как было у экрана.
 */
export type ContactAssignmentExecuteBody = z.infer<typeof ContactBulkAssignmentExecuteSchema>

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

export async function executeContactAssignmentInTransaction(
  tx: Prisma.TransactionClient,
  params: {
    organizationId: string
    userId: string | null
    actor: MtmRouteActor
    body: ContactAssignmentExecuteBody
    requestHash: string
    ipAddress?: string | null
    userAgent?: string | null
  },
) {
  const { actor, body, requestHash } = params
  const effectiveFrom = utcDate(body.effectiveFrom)
  await tx.mtmContactAssignmentOperation.create({
    data: {
      organizationId: params.organizationId,
      idempotencyKey: body.idempotencyKey,
      requestHash,
      actorUserId: params.userId || null,
      actorAgentId: actor.agentId,
      targetAgentId: body.targetAgentId ?? null,
      effectiveFrom,
      reason: body.reason,
      mode: body.mode,
      request: body as unknown as Prisma.InputJsonValue,
    },
  })
  const preview = await buildContactAssignmentPreview(tx, {
    organizationId: params.organizationId,
    contactIds: body.contactIds,
    mode: body.mode,
    targetAgentId: body.targetAgentId,
    sourceAgentId: body.sourceAgentId,
    effectiveFrom,
    actor,
  })
  if (preview.previewToken !== body.previewToken) throw new Error("STALE_PREVIEW")
  const eligible = preview.rows.filter((row) => row.assignable)
  if (eligible.length === 0) throw new Error("NOTHING_TO_ASSIGN")

  const changed: Array<{
    contactId: string
    endedAssignmentIds: string[]
    assignmentId: string | null
  }> = []
  // Ends one assignment that the preview saw active; a row somebody
  // changed in between makes the whole batch stale, not half-applied.
  const endAssignment = async (contactId: string, assignmentId: string) => {
    const ended = await tx.mtmContactAgentAssignment.updateMany({
      where: {
        id: assignmentId,
        organizationId: params.organizationId,
        contactId,
        deletedAt: null,
        effectiveFrom: { lte: effectiveFrom },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveFrom } }],
      },
      data: { effectiveTo: effectiveFrom, reason: body.reason },
    })
    if (ended.count !== 1) throw new Error("STALE_PREVIEW")
  }
  for (const row of eligible) {
    const endedAssignmentIds: string[] = []
    // Attaching ends nobody's assignment; detaching ends those the
    // preview listed — one employee's, or everyone's.
    for (const endAssignmentId of row.endAssignmentIds) {
      await endAssignment(row.contactId, endAssignmentId)
      endedAssignmentIds.push(endAssignmentId)
    }
    if (row.promote) {
      // The responsible employee left and others stay: the one attached
      // longest takes over, as a new dated row — the history keeps both.
      await endAssignment(row.contactId, row.promote.assignmentId)
      endedAssignmentIds.push(row.promote.assignmentId)
      await tx.mtmContactAgentAssignment.create({
        data: {
          organizationId: params.organizationId,
          contactId: row.contactId,
          agentId: row.promote.agentId,
          role: "PRIMARY",
          effectiveFrom,
          source: "BULK_ASSIGNMENT_PROMOTION",
          assignedBy: params.userId || null,
          reason: body.reason,
        },
        select: { id: true },
      })
    }
    let assignmentId: string | null = null
    if (body.mode === "ASSIGN" && body.targetAgentId && row.newRole) {
      const assignment = await tx.mtmContactAgentAssignment.create({
        data: {
          organizationId: params.organizationId,
          contactId: row.contactId,
          agentId: body.targetAgentId,
          role: row.newRole,
          effectiveFrom,
          source: "BULK_ASSIGNMENT",
          assignedBy: params.userId || null,
          reason: body.reason,
        },
        select: { id: true },
      })
      assignmentId = assignment.id
    }
    changed.push({ contactId: row.contactId, endedAssignmentIds, assignmentId })
  }

  const response = {
    operationId: body.idempotencyKey,
    mode: body.mode,
    effectiveFrom: body.effectiveFrom,
    targetAgent: preview.targetAgent,
    summary: { ...preview.summary, changed: changed.length },
    changed,
    excluded: preview.rows.filter((row) => !row.assignable),
  }
  await tx.mtmContactAssignmentOperation.update({
    where: {
      organizationId_idempotencyKey: {
        organizationId: params.organizationId,
        idempotencyKey: body.idempotencyKey,
      },
    },
    data: {
      status: "COMPLETED",
      result: response as unknown as Prisma.InputJsonValue,
      completedAt: new Date(),
    },
  })
  await tx.mtmAuditLog.create({
    data: {
      organizationId: params.organizationId,
      agentId: actor.agentId,
      action: body.mode === "ASSIGN" ? "CONTACT_BULK_ASSIGN" : "CONTACT_BULK_UNASSIGN",
      entity: "contact_assignment_batch",
      entityId: body.idempotencyKey,
      metadataKind: "contact_bulk_assignment",
      oldData: { selected: preview.summary.selected } as Prisma.InputJsonValue,
      newData: {
        mode: body.mode,
        targetAgentId: body.targetAgentId ?? null,
        sourceAgentId: body.sourceAgentId ?? null,
        effectiveFrom: body.effectiveFrom,
        reason: body.reason,
        changed: changed.length,
        excluded: preview.summary.excluded,
        contactIds: changed.map((item) => item.contactId),
      } as Prisma.InputJsonValue,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
    },
  })
  return response
}
