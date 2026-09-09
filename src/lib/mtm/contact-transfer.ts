import { createHash } from "node:crypto"
import type { Prisma } from "@prisma/client"
import type { MtmRouteActor } from "@/lib/mtm/route-permissions"
import { contactScopeForActor } from "@/lib/mtm/field-scope"

export type ContactTransferIssue =
  | "CONTACT_NOT_AVAILABLE"
  | "CONTACT_INACTIVE"
  | "SOURCE_AGENT_UNAVAILABLE"
  | "TARGET_AGENT_UNAVAILABLE"
  | "SAME_AGENT"
  | "OWNER_CHANGED"
  | "MULTIPLE_PRIMARY_OWNERS"
  | "TARGET_ALREADY_ASSIGNED"
  | "FUTURE_ASSIGNMENT_CONFLICT"
  | "OPEN_VISIT_CONFLICT"
  | "ROUTE_PLAN_CONFLICT"

export interface ContactTransferInput {
  organizationId: string
  contactIds: string[]
  sourceAgentId: string
  targetAgentId: string
  effectiveFrom: Date
  actor: MtmRouteActor
}

type ContactTransferDb = Pick<
  Prisma.TransactionClient,
  "mtmAgent" | "mtmContact" | "mtmVisit" | "mtmRoutePoint" | "mtmTask"
>

export interface ContactTransferPreviewRow {
  contactId: string
  displayName: string | null
  currentAssignmentId: string | null
  issues: ContactTransferIssue[]
  transferable: boolean
  openVisitCount: number
  plannedRouteCount: number
  openTaskCount: number
}

export interface ContactTransferPreview {
  previewToken: string
  effectiveFrom: string
  sourceAgent: { id: string; name: string; status: string; role: string } | null
  targetAgent: { id: string; name: string; status: string; role: string } | null
  warnings: string[]
  summary: {
    selected: number
    transferable: number
    excluded: number
    openVisitConflicts: number
    routePlanConflicts: number
  }
  rows: ContactTransferPreviewRow[]
}

function isActiveAt(assignment: { effectiveFrom: Date; effectiveTo: Date | null }, date: Date): boolean {
  return assignment.effectiveFrom <= date && (!assignment.effectiveTo || assignment.effectiveTo > date)
}

function stableToken(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

/**
 * Builds the authoritative transfer preview. The same function is called from
 * the preview request and again inside the serializable execute transaction,
 * so stale ownership or planning conflicts cannot be silently ignored.
 */
export async function buildContactTransferPreview(
  db: ContactTransferDb,
  input: ContactTransferInput,
): Promise<ContactTransferPreview> {
  const contactIds = [...new Set(input.contactIds)].sort()
  const agentIds = [...new Set([input.sourceAgentId, input.targetAgentId])]
  const [agents, contacts, openVisits, plannedPoints, openTasks] = await Promise.all([
    db.mtmAgent.findMany({
      where: { organizationId: input.organizationId, id: { in: agentIds } },
      select: { id: true, name: true, status: true, role: true },
    }),
    db.mtmContact.findMany({
      where: {
        organizationId: input.organizationId,
        id: { in: contactIds },
        deletedAt: null,
        ...(input.actor.role === "ADMIN" ? {} : { AND: [contactScopeForActor(input.actor, input.effectiveFrom)] }),
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
        agentId: input.sourceAgentId,
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
          OR: [
            { agentId: input.sourceAgentId },
            { assignments: { some: { agentId: input.sourceAgentId, removedAt: null } } },
          ],
        },
      },
      select: { contactId: true },
    }),
    db.mtmTask.findMany({
      where: {
        organizationId: input.organizationId,
        agentId: input.sourceAgentId,
        status: { in: ["PENDING", "IN_PROGRESS", "OVERDUE"] },
        deletedAt: null,
        visit: {
          contactId: { in: contactIds },
          deletedAt: null,
        },
      },
      select: {
        visit: { select: { contactId: true } },
      },
    }),
  ])

  const sourceAgent = agents.find((agent) => agent.id === input.sourceAgentId) ?? null
  const targetAgent = agents.find((agent) => agent.id === input.targetAgentId) ?? null
  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]))
  const openVisitCounts = new Map<string, number>()
  const plannedRouteCounts = new Map<string, number>()
  const openTaskCounts = new Map<string, number>()
  for (const visit of openVisits) {
    if (visit.contactId) openVisitCounts.set(visit.contactId, (openVisitCounts.get(visit.contactId) ?? 0) + 1)
  }
  for (const point of plannedPoints) {
    if (point.contactId) plannedRouteCounts.set(point.contactId, (plannedRouteCounts.get(point.contactId) ?? 0) + 1)
  }
  for (const task of openTasks) {
    const contactId = task.visit?.contactId
    if (contactId) openTaskCounts.set(contactId, (openTaskCounts.get(contactId) ?? 0) + 1)
  }

  const targetAvailable = targetAgent?.status === "ACTIVE" && targetAgent.role === "AGENT"
  const sourceAvailable = sourceAgent?.role === "AGENT"
  const rows: ContactTransferPreviewRow[] = contactIds.map((contactId) => {
    const contact = contactsById.get(contactId)
    const issues: ContactTransferIssue[] = []
    const openVisitCount = openVisitCounts.get(contactId) ?? 0
    const plannedRouteCount = plannedRouteCounts.get(contactId) ?? 0
    const openTaskCount = openTaskCounts.get(contactId) ?? 0
    if (!contact) issues.push("CONTACT_NOT_AVAILABLE")
    if (contact && contact.status !== "ACTIVE") issues.push("CONTACT_INACTIVE")
    if (!sourceAvailable) issues.push("SOURCE_AGENT_UNAVAILABLE")
    if (!targetAvailable) issues.push("TARGET_AGENT_UNAVAILABLE")
    if (input.sourceAgentId === input.targetAgentId) issues.push("SAME_AGENT")

    const assignments = contact?.agentAssignments ?? []
    const activeAssignments = assignments.filter((assignment) => isActiveAt(assignment, input.effectiveFrom))
    const activePrimary = activeAssignments.filter((assignment) => assignment.role === "PRIMARY")
    const current = activePrimary[0] ?? null
    const future = assignments.find((assignment) => assignment.role === "PRIMARY" && assignment.effectiveFrom > input.effectiveFrom) ?? null
    const targetExisting = activeAssignments.find((assignment) => assignment.agentId === input.targetAgentId) ?? null
    if (contact && current?.agentId !== input.sourceAgentId) issues.push("OWNER_CHANGED")
    if (activePrimary.length > 1) issues.push("MULTIPLE_PRIMARY_OWNERS")
    if (contact && targetExisting && targetExisting.id !== current?.id) issues.push("TARGET_ALREADY_ASSIGNED")
    if (contact && future) issues.push("FUTURE_ASSIGNMENT_CONFLICT")
    if (openVisitCount > 0) issues.push("OPEN_VISIT_CONFLICT")
    if (plannedRouteCount > 0) issues.push("ROUTE_PLAN_CONFLICT")

    return {
      contactId,
      displayName: contact?.displayName ?? null,
      currentAssignmentId: current?.agentId === input.sourceAgentId ? current.id : null,
      issues,
      transferable: issues.length === 0,
      openVisitCount,
      plannedRouteCount,
      openTaskCount,
    }
  })

  const warnings: string[] = []
  if (sourceAgent && sourceAgent.status !== "ACTIVE") warnings.push("SOURCE_AGENT_INACTIVE")
  const summary = {
    selected: rows.length,
    transferable: rows.filter((row) => row.transferable).length,
    excluded: rows.filter((row) => !row.transferable).length,
    openVisitConflicts: rows.filter((row) => row.openVisitCount > 0).length,
    routePlanConflicts: rows.filter((row) => row.plannedRouteCount > 0).length,
    openTasks: rows.reduce((total, row) => total + row.openTaskCount, 0),
    contactsWithOpenTasks: rows.filter((row) => row.openTaskCount > 0).length,
  }
  const effectiveFrom = input.effectiveFrom.toISOString().slice(0, 10)
  const previewToken = stableToken({
    organizationId: input.organizationId,
    sourceAgentId: input.sourceAgentId,
    targetAgentId: input.targetAgentId,
    effectiveFrom,
    sourceAgent: sourceAgent && { id: sourceAgent.id, status: sourceAgent.status, role: sourceAgent.role },
    targetAgent: targetAgent && { id: targetAgent.id, status: targetAgent.status, role: targetAgent.role },
    rows: rows.map(({ contactId, currentAssignmentId, issues, openVisitCount, plannedRouteCount, openTaskCount }) => ({
      contactId,
      currentAssignmentId,
      issues,
      openVisitCount,
      plannedRouteCount,
      openTaskCount,
    })),
  })

  return { previewToken, effectiveFrom, sourceAgent, targetAgent, warnings, summary, rows }
}

export function contactTransferRequestHash(input: {
  contactIds: string[]
  sourceAgentId: string
  targetAgentId: string
  effectiveFrom: string
  reason: string
  previewToken: string
}): string {
  return stableToken({ ...input, contactIds: [...new Set(input.contactIds)].sort() })
}

/**
 * Opaque browser-cache partition for a manager's transfer receipts. Keeping
 * the organization and principal behind a one-way hash prevents one signed-in
 * user from projecting another user's cached result after an account switch.
 */
export function contactTransferSyncScopeKey(input: {
  organizationId: string
  userId: string
  agentId: string | null
}): string {
  return stableToken({
    organizationId: input.organizationId,
    userId: input.userId,
    agentId: input.agentId,
    purpose: "contact-transfer-receipts-v1",
  })
}
