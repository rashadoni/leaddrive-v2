import { createHash } from "node:crypto"
import type { Prisma } from "@prisma/client"
import type { MtmRouteActor } from "@/lib/mtm/route-permissions"
import { activeFieldAssignmentWindow, contactScopeForActor } from "@/lib/mtm/field-scope"

/**
 * A client may be attached to several employees at once (owner, 2026-10-06:
 * «может быть, что клиент привязан к нескольким агентам» — and, asked what
 * «Привязать» does to a client who already has one: «добавлять агента»).
 *
 * Until then attaching ENDED the current employee's assignment, so attaching
 * two of one agent's clients to another took them away from the first.
 *
 * - ASSIGN adds the employee and ends nobody's assignment. The first employee
 *   of a client is its PRIMARY — the one coverage is counted for; every next
 *   one is SECONDARY. Routes, planning and the mobile app already read any
 *   role.
 * - UNASSIGN with `sourceAgentId` detaches that employee only. If they were
 *   the PRIMARY and others remain, the one attached longest becomes PRIMARY,
 *   so a client with employees never stands without a responsible one.
 * - UNASSIGN without it detaches everyone: the client is left with no employee.
 * - Moving a client from one employee to another is the transfer, not this.
 */
export type ContactAssignmentIssue =
  | "CONTACT_NOT_AVAILABLE"
  | "CONTACT_INACTIVE"
  | "TARGET_AGENT_UNAVAILABLE"
  | "TARGET_ALREADY_ASSIGNED"
  | "NO_PRIMARY_ASSIGNMENT"
  | "SOURCE_NOT_ASSIGNED"
  | "MULTIPLE_PRIMARY_OWNERS"
  | "FUTURE_ASSIGNMENT_CONFLICT"
  | "OPEN_VISIT_CONFLICT"
  | "ROUTE_PLAN_CONFLICT"

export interface ContactAssignmentInput {
  organizationId: string
  contactIds: string[]
  mode: "ASSIGN" | "UNASSIGN"
  targetAgentId?: string | null
  /** UNASSIGN: the one employee to detach. Absent — every employee of the client. */
  sourceAgentId?: string | null
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
                none: activeFieldAssignmentWindow(input.effectiveFrom),
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
          orderBy: [{ effectiveFrom: "asc" }, { id: "asc" }],
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
      select: { contactId: true, agentId: true },
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
      select: { contactId: true, route: { select: { agentId: true } } },
    }),
  ])

  const byId = new Map(contacts.map((contact) => [contact.id, contact]))
  // Unfinished work is a reason not to detach the employee who is doing it —
  // not a colleague attached to the same client.
  const busyWith = (rows: Array<{ contactId: string | null; agentId: string }>) => {
    const byContact = new Map<string, string[]>()
    for (const row of rows) {
      if (row.contactId) byContact.set(row.contactId, [...(byContact.get(row.contactId) ?? []), row.agentId])
    }
    return byContact
  }
  const visiting = busyWith(openVisits)
  const planned = busyWith(routePoints.map((point) => ({ contactId: point.contactId, agentId: point.route.agentId })))

  const rows = contactIds.map((contactId) => {
    const contact = byId.get(contactId)
    const issues: ContactAssignmentIssue[] = []
    if (!contact) issues.push("CONTACT_NOT_AVAILABLE")
    if (contact && contact.status !== "ACTIVE") issues.push("CONTACT_INACTIVE")
    if (input.mode === "ASSIGN" && (!targetAgent || targetAgent.status !== "ACTIVE" || targetAgent.role !== "AGENT")) {
      issues.push("TARGET_AGENT_UNAVAILABLE")
    }
    const assignments = contact?.agentAssignments ?? []
    const active = assignments.filter((assignment) =>
      assignment.effectiveFrom <= input.effectiveFrom
      && (!assignment.effectiveTo || assignment.effectiveTo > input.effectiveFrom))
    const activePrimary = active.filter((assignment) => assignment.role === "PRIMARY")
    const futurePrimary = assignments.find(
      (assignment) => assignment.role === "PRIMARY" && assignment.effectiveFrom > input.effectiveFrom,
    )
    if (activePrimary.length > 1) issues.push("MULTIPLE_PRIMARY_OWNERS")

    let newRole: "PRIMARY" | "SECONDARY" | null = null
    let leaving: typeof active = []
    let promote: (typeof active)[number] | null = null
    if (input.mode === "ASSIGN") {
      if (active.some((assignment) => assignment.agentId === input.targetAgentId)) issues.push("TARGET_ALREADY_ASSIGNED")
      newRole = activePrimary.length === 0 ? "PRIMARY" : "SECONDARY"
      // A responsible employee already booked for a later date is in the way
      // of a new responsible one, not of one more employee beside them.
      if (newRole === "PRIMARY" && futurePrimary) issues.push("FUTURE_ASSIGNMENT_CONFLICT")
    } else {
      leaving = input.sourceAgentId ? active.filter((assignment) => assignment.agentId === input.sourceAgentId) : active
      if (leaving.length === 0) issues.push(input.sourceAgentId ? "SOURCE_NOT_ASSIGNED" : "NO_PRIMARY_ASSIGNMENT")
      if (futurePrimary) issues.push("FUTURE_ASSIGNMENT_CONFLICT")
      const staying = active.filter((assignment) => !leaving.includes(assignment))
      if (leaving.some((assignment) => assignment.role === "PRIMARY") && !staying.some((assignment) => assignment.role === "PRIMARY")) {
        // `active` is ordered by effectiveFrom, then id: the longest-attached first.
        promote = staying[0] ?? null
      }
    }
    // Attaching takes the client from nobody, so nobody's open visit or
    // planned route stands in its way. Detaching does — for the one leaving.
    const leavingAgents = new Set(leaving.map((assignment) => assignment.agentId))
    const openVisitCount = (visiting.get(contactId) ?? []).filter((agentId) => leavingAgents.has(agentId)).length
    const plannedRouteCount = (planned.get(contactId) ?? []).filter((agentId) => leavingAgents.has(agentId)).length
    if (openVisitCount > 0) issues.push("OPEN_VISIT_CONFLICT")
    if (plannedRouteCount > 0) issues.push("ROUTE_PLAN_CONFLICT")
    return {
      contactId,
      displayName: contact?.displayName ?? null,
      // The client's responsible employee today; empty for a client with none.
      currentAssignmentIds: activePrimary.map((assignment) => assignment.id),
      // What the change does, decided here once and carried out as written.
      endAssignmentIds: leaving.map((assignment) => assignment.id),
      promote: promote ? { assignmentId: promote.id, agentId: promote.agentId } : null,
      newRole,
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
    // Of those that will change: clients who keep the employee they have and get one more.
    additional: rows.filter((row) => row.assignable && row.newRole === "SECONDARY").length,
    openVisitConflicts: rows.filter((row) => row.openVisitCount > 0).length,
    routePlanConflicts: rows.filter((row) => row.plannedRouteCount > 0).length,
  }
  const effectiveFrom = input.effectiveFrom.toISOString().slice(0, 10)
  const previewToken = stableHash({
    organizationId: input.organizationId,
    mode: input.mode,
    targetAgentId: input.targetAgentId ?? null,
    sourceAgentId: input.sourceAgentId ?? null,
    effectiveFrom,
    targetAgent: targetAgent && {
      id: targetAgent.id,
      status: targetAgent.status,
      role: targetAgent.role,
    },
    rows: rows.map(({
      contactId,
      currentAssignmentIds,
      endAssignmentIds,
      promote,
      newRole,
      issues,
      openVisitCount,
      plannedRouteCount,
    }) => ({
      contactId,
      currentAssignmentIds,
      endAssignmentIds,
      promote,
      newRole,
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
  sourceAgentId?: string | null
  effectiveFrom: string
  reason: string
  previewToken: string
}) {
  return stableHash({
    ...input,
    contactIds: [...new Set(input.contactIds)].sort(),
    targetAgentId: input.targetAgentId ?? null,
    sourceAgentId: input.sourceAgentId ?? null,
  })
}

export interface ContactAssignmentExecuteRequest {
  contactIds: string[]
  mode: "ASSIGN" | "UNASSIGN"
  targetAgentId?: string | null
  /** UNASSIGN: the one employee to detach. Absent — every employee of the client. */
  sourceAgentId?: string | null
  /** Calendar day (YYYY-MM-DD) from which the change counts. */
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
 * durable operation row, the effective-dated assignment rows the preview
 * decided on (attach, detach, promote) and the audit entry. This is the only
 * bulk writer of who a client is attached to — the assignment endpoint and
 * the Excel client import both go through it, so the field app sees an
 * imported client exactly as it sees one attached by hand, and a change to
 * the rules above reaches both.
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
    /** Stored on each newly attached row; says where the attachment came from. */
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
    sourceAgentId: request.sourceAgentId,
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
  // Ends one assignment that the preview saw active; a row somebody
  // changed in between makes the whole batch stale, not half-applied.
  const endAssignment = async (contactId: string, assignmentId: string) => {
    const ended = await tx.mtmContactAgentAssignment.updateMany({
      where: {
        id: assignmentId,
        organizationId,
        contactId,
        deletedAt: null,
        effectiveFrom: { lte: effectiveFrom },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveFrom } }],
      },
      data: { effectiveTo: effectiveFrom, reason: request.reason },
    })
    if (ended.count !== 1) throw new Error(CONTACT_ASSIGNMENT_STALE_PREVIEW)
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
          organizationId,
          contactId: row.contactId,
          agentId: row.promote.agentId,
          role: "PRIMARY",
          effectiveFrom,
          source: "BULK_ASSIGNMENT_PROMOTION",
          assignedBy: input.actorUserId,
          reason: request.reason,
        },
        select: { id: true },
      })
    }
    let assignmentId: string | null = null
    if (request.mode === "ASSIGN" && request.targetAgentId && row.newRole) {
      const assignment = await tx.mtmContactAgentAssignment.create({
        data: {
          organizationId,
          contactId: row.contactId,
          agentId: request.targetAgentId,
          role: row.newRole,
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
        sourceAgentId: request.sourceAgentId ?? null,
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
