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
