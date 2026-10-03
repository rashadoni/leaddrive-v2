import { createHash } from "node:crypto"
import type { Prisma } from "@prisma/client"
import type { MtmRouteActor } from "@/lib/mtm/route-permissions"
import { activeFieldAssignmentWindow, contactScopeForActor } from "@/lib/mtm/field-scope"

export type ContactAssignmentIssue =
  | "CONTACT_NOT_AVAILABLE"
  | "CONTACT_INACTIVE"
  | "TARGET_AGENT_UNAVAILABLE"
  | "TARGET_ALREADY_ASSIGNED"
  | "NO_PRIMARY_ASSIGNMENT"
  | "MULTIPLE_PRIMARY_OWNERS"
  | "FUTURE_ASSIGNMENT_CONFLICT"
  | "OPEN_VISIT_CONFLICT"
  | "ROUTE_PLAN_CONFLICT"

export interface ContactAssignmentInput {
  organizationId: string
  contactIds: string[]
  mode: "ASSIGN" | "UNASSIGN"
  targetAgentId?: string | null
  effectiveFrom: Date
  actor: MtmRouteActor
}

type AssignmentDb = Pick<
  Prisma.TransactionClient,
  "mtmAgent" | "mtmContact" | "mtmVisit" | "mtmRoutePoint"
>

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

export async function buildContactAssignmentPreview(
  db: AssignmentDb,
  input: ContactAssignmentInput,
) {
  const contactIds = [...new Set(input.contactIds)].sort()
  const visibleScope = input.actor.role === "ADMIN"
    ? {}
    : input.actor.role === "AGENT"
      ? contactScopeForActor(input.actor, input.effectiveFrom)
      : {
          OR: [
            contactScopeForActor(input.actor, input.effectiveFrom),
            {
              agentAssignments: {
                none: {
                  role: "PRIMARY",
                  ...activeFieldAssignmentWindow(input.effectiveFrom),
                },
              },
            },
          ],
        }
  const [targetAgent, contacts, openVisits, routePoints] = await Promise.all([
    input.targetAgentId
      ? db.mtmAgent.findFirst({
          where: { id: input.targetAgentId, organizationId: input.organizationId },
          select: { id: true, name: true, role: true, status: true },
        })
      : Promise.resolve(null),
    db.mtmContact.findMany({
      where: {
        organizationId: input.organizationId,
        id: { in: contactIds },
        deletedAt: null,
        AND: [visibleScope],
      },
      select: {
        id: true,
        displayName: true,
        status: true,
        agentAssignments: {
          where: {
            deletedAt: null,
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: input.effectiveFrom } }],
          },
          select: { id: true, agentId: true, role: true, effectiveFrom: true, effectiveTo: true },
          orderBy: { effectiveFrom: "asc" },
        },
      },
    }),
    db.mtmVisit.findMany({
      where: {
        organizationId: input.organizationId,
        contactId: { in: contactIds },
        status: "CHECKED_IN",
        deletedAt: null,
      },
      select: { contactId: true },
    }),
    db.mtmRoutePoint.findMany({
      where: {
        contactId: { in: contactIds },
        status: "PENDING",
        deletedAt: null,
        route: {
          organizationId: input.organizationId,
          date: { gte: input.effectiveFrom },
          status: { in: ["DRAFT", "PLANNED", "IN_PROGRESS"] },
          deletedAt: null,
        },
      },
      select: { contactId: true },
    }),
  ])

  const byId = new Map(contacts.map((contact) => [contact.id, contact]))
  const openCount = new Map<string, number>()
  const routeCount = new Map<string, number>()
  for (const visit of openVisits) {
    if (visit.contactId) openCount.set(visit.contactId, (openCount.get(visit.contactId) ?? 0) + 1)
  }
  for (const point of routePoints) {
    if (point.contactId) routeCount.set(point.contactId, (routeCount.get(point.contactId) ?? 0) + 1)
  }

  const rows = contactIds.map((contactId) => {
    const contact = byId.get(contactId)
    const issues: ContactAssignmentIssue[] = []
    if (!contact) issues.push("CONTACT_NOT_AVAILABLE")
    if (contact && contact.status !== "ACTIVE") issues.push("CONTACT_INACTIVE")
    if (input.mode === "ASSIGN" && (!targetAgent || targetAgent.status !== "ACTIVE" || targetAgent.role !== "AGENT")) {
      issues.push("TARGET_AGENT_UNAVAILABLE")
    }
    const assignments = contact?.agentAssignments ?? []
    const activePrimary = assignments.filter((assignment) =>
      assignment.role === "PRIMARY"
      && assignment.effectiveFrom <= input.effectiveFrom
      && (!assignment.effectiveTo || assignment.effectiveTo > input.effectiveFrom))
    const futurePrimary = assignments.find(
      (assignment) => assignment.role === "PRIMARY" && assignment.effectiveFrom > input.effectiveFrom,
    )
    if (activePrimary.length > 1) issues.push("MULTIPLE_PRIMARY_OWNERS")
    if (futurePrimary) issues.push("FUTURE_ASSIGNMENT_CONFLICT")
    if (input.mode === "UNASSIGN" && activePrimary.length === 0) issues.push("NO_PRIMARY_ASSIGNMENT")
    if (input.mode === "ASSIGN" && activePrimary.some((assignment) => assignment.agentId === input.targetAgentId)) {
      issues.push("TARGET_ALREADY_ASSIGNED")
    }
    const openVisitCount = openCount.get(contactId) ?? 0
    const plannedRouteCount = routeCount.get(contactId) ?? 0
    if (openVisitCount > 0) issues.push("OPEN_VISIT_CONFLICT")
    if (plannedRouteCount > 0) issues.push("ROUTE_PLAN_CONFLICT")
    return {
      contactId,
      displayName: contact?.displayName ?? null,
      currentAssignmentIds: activePrimary.map((assignment) => assignment.id),
      issues,
      assignable: issues.length === 0,
      openVisitCount,
      plannedRouteCount,
    }
  })
  const summary = {
    selected: rows.length,
    assignable: rows.filter((row) => row.assignable).length,
    excluded: rows.filter((row) => !row.assignable).length,
    unassigned: rows.filter((row) => row.currentAssignmentIds.length === 0).length,
    openVisitConflicts: rows.filter((row) => row.openVisitCount > 0).length,
    routePlanConflicts: rows.filter((row) => row.plannedRouteCount > 0).length,
  }
  const effectiveFrom = input.effectiveFrom.toISOString().slice(0, 10)
  const previewToken = stableHash({
    organizationId: input.organizationId,
    mode: input.mode,
    targetAgentId: input.targetAgentId ?? null,
    effectiveFrom,
    targetAgent: targetAgent && {
      id: targetAgent.id,
      status: targetAgent.status,
      role: targetAgent.role,
    },
    rows: rows.map(({
      contactId,
      currentAssignmentIds,
      issues,
      openVisitCount,
      plannedRouteCount,
    }) => ({
      contactId,
      currentAssignmentIds,
      issues,
      openVisitCount,
      plannedRouteCount,
    })),
  })
  return { previewToken, effectiveFrom, targetAgent, summary, rows }
}

export function contactAssignmentRequestHash(input: {
  contactIds: string[]
  mode: "ASSIGN" | "UNASSIGN"
  targetAgentId?: string | null
  effectiveFrom: string
  reason: string
  previewToken: string
}) {
  return stableHash({
    ...input,
    contactIds: [...new Set(input.contactIds)].sort(),
    targetAgentId: input.targetAgentId ?? null,
  })
}

export interface ContactAssignmentExecuteRequest {
  contactIds: string[]
  mode: "ASSIGN" | "UNASSIGN"
  targetAgentId?: string | null
  /** Calendar day (YYYY-MM-DD) from which the new ownership counts. */
  effectiveFrom: string
  reason: string
  previewToken: string
  idempotencyKey: string
}

type AssignmentWriteDb = AssignmentDb & Pick<
  Prisma.TransactionClient,
  "mtmContactAgentAssignment" | "mtmContactAssignmentOperation" | "mtmAuditLog"
>

/** The reviewed preview no longer describes the data; nothing was written. */
export const CONTACT_ASSIGNMENT_STALE_PREVIEW = "STALE_PREVIEW"
/** No selected contact can be changed; nothing was written. */
export const CONTACT_ASSIGNMENT_NOTHING_TO_ASSIGN = "NOTHING_TO_ASSIGN"

/**
 * Applies one reviewed assignment batch inside the caller's transaction: the
 * durable operation row, the effective-dated assignment rows and the audit
 * entry. This is the only writer of PRIMARY contact ownership in bulk — the
 * assignment endpoint and the Excel client import both go through it, so the
 * field app sees an imported client exactly as it sees one assigned by hand.
 *
 * Throws CONTACT_ASSIGNMENT_STALE_PREVIEW / CONTACT_ASSIGNMENT_NOTHING_TO_ASSIGN
 * as the error message; the transaction must roll back on either.
 */
export async function executeContactAssignment(
  tx: AssignmentWriteDb,
  input: {
    organizationId: string
    actor: MtmRouteActor
    actorUserId: string | null
    request: ContactAssignmentExecuteRequest
    requestHash: string
    /** Stored on each new assignment row; says where the ownership came from. */
    source?: string
    ipAddress?: string | null
    userAgent?: string | null
  },
) {
  const { organizationId, actor, request } = input
  const effectiveFrom = new Date(`${request.effectiveFrom}T00:00:00.000Z`)
  await tx.mtmContactAssignmentOperation.create({
    data: {
      organizationId,
      idempotencyKey: request.idempotencyKey,
      requestHash: input.requestHash,
      actorUserId: input.actorUserId,
      actorAgentId: actor.agentId,
      targetAgentId: request.targetAgentId ?? null,
      effectiveFrom,
      reason: request.reason,
      mode: request.mode,
      request: request as unknown as Prisma.InputJsonValue,
    },
  })
  const preview = await buildContactAssignmentPreview(tx, {
    organizationId,
    contactIds: request.contactIds,
    mode: request.mode,
    targetAgentId: request.targetAgentId,
    effectiveFrom,
    actor,
  })
  if (preview.previewToken !== request.previewToken) throw new Error(CONTACT_ASSIGNMENT_STALE_PREVIEW)
  const eligible = preview.rows.filter((row) => row.assignable)
  if (eligible.length === 0) throw new Error(CONTACT_ASSIGNMENT_NOTHING_TO_ASSIGN)

  const changed: Array<{
    contactId: string
    endedAssignmentIds: string[]
    assignmentId: string | null
  }> = []
  for (const row of eligible) {
    const endedAssignmentIds: string[] = []
    for (const currentAssignmentId of row.currentAssignmentIds) {
      const ended = await tx.mtmContactAgentAssignment.updateMany({
        where: {
          id: currentAssignmentId,
          organizationId,
          contactId: row.contactId,
          role: "PRIMARY",
          deletedAt: null,
          effectiveFrom: { lte: effectiveFrom },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveFrom } }],
        },
        data: { effectiveTo: effectiveFrom, reason: request.reason },
      })
      if (ended.count !== 1) throw new Error(CONTACT_ASSIGNMENT_STALE_PREVIEW)
      endedAssignmentIds.push(currentAssignmentId)
    }
    let assignmentId: string | null = null
    if (request.mode === "ASSIGN" && request.targetAgentId) {
      const assignment = await tx.mtmContactAgentAssignment.create({
        data: {
          organizationId,
          contactId: row.contactId,
          agentId: request.targetAgentId,
          role: "PRIMARY",
          effectiveFrom,
          source: input.source ?? "BULK_ASSIGNMENT",
          assignedBy: input.actorUserId,
          reason: request.reason,
        },
        select: { id: true },
      })
      assignmentId = assignment.id
    }
    changed.push({ contactId: row.contactId, endedAssignmentIds, assignmentId })
  }

  const response = {
    operationId: request.idempotencyKey,
    mode: request.mode,
    effectiveFrom: request.effectiveFrom,
    targetAgent: preview.targetAgent,
    summary: { ...preview.summary, changed: changed.length },
    changed,
    excluded: preview.rows.filter((row) => !row.assignable),
  }
  await tx.mtmContactAssignmentOperation.update({
    where: {
      organizationId_idempotencyKey: {
        organizationId,
        idempotencyKey: request.idempotencyKey,
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
      organizationId,
      agentId: actor.agentId,
      action: request.mode === "ASSIGN" ? "CONTACT_BULK_ASSIGN" : "CONTACT_BULK_UNASSIGN",
      entity: "contact_assignment_batch",
      entityId: request.idempotencyKey,
      metadataKind: "contact_bulk_assignment",
      oldData: { selected: preview.summary.selected } as Prisma.InputJsonValue,
      newData: {
        mode: request.mode,
        targetAgentId: request.targetAgentId ?? null,
        effectiveFrom: request.effectiveFrom,
        reason: request.reason,
        changed: changed.length,
        excluded: preview.summary.excluded,
        contactIds: changed.map((item) => item.contactId),
      } as Prisma.InputJsonValue,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
  })
  return response
}
