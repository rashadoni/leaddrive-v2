import { createHash } from "node:crypto"
import type { Prisma } from "@prisma/client"
import type { MtmRouteActor } from "@/lib/mtm/route-permissions"
import { activeFieldAssignmentWindow, customerScopeForActor } from "@/lib/mtm/field-scope"

export type OrganizationAssignmentIssue =
  | "ORGANIZATION_NOT_AVAILABLE"
  | "ORGANIZATION_INACTIVE"
  | "TARGET_AGENT_UNAVAILABLE"
  | "TARGET_ALREADY_ASSIGNED"
  | "NO_PRIMARY_ASSIGNMENT"
  | "MULTIPLE_PRIMARY_OWNERS"
  | "FUTURE_ASSIGNMENT_CONFLICT"
  | "OPEN_VISIT_CONFLICT"
  | "ROUTE_PLAN_CONFLICT"

export interface OrganizationAssignmentInput {
  organizationId: string
  organizationIds: string[]
  mode: "ASSIGN" | "UNASSIGN"
  targetAgentId?: string | null
  effectiveFrom: Date
  actor: MtmRouteActor
}

type AssignmentDb = Pick<Prisma.TransactionClient, "mtmAgent" | "mtmCustomer" | "mtmVisit" | "mtmRoutePoint">

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

export async function buildOrganizationAssignmentPreview(db: AssignmentDb, input: OrganizationAssignmentInput) {
  const organizationIds = [...new Set(input.organizationIds)].sort()
  const visibleScope = input.actor.role === "ADMIN"
    ? {}
    : input.actor.role === "AGENT"
      ? customerScopeForActor(input.actor, input.effectiveFrom)
      : {
          OR: [
            customerScopeForActor(input.actor, input.effectiveFrom),
            { agentAssignments: { none: activeFieldAssignmentWindow(input.effectiveFrom) } },
          ],
        }
  const [targetAgent, organizations, openVisits, routePoints] = await Promise.all([
    input.targetAgentId
      ? db.mtmAgent.findFirst({
          where: { id: input.targetAgentId, organizationId: input.organizationId },
          select: { id: true, name: true, role: true, status: true },
        })
      : Promise.resolve(null),
    db.mtmCustomer.findMany({
      where: {
        organizationId: input.organizationId,
        id: { in: organizationIds },
        deletedAt: null,
        objectType: { not: "DOCTOR" },
        AND: [visibleScope],
      },
      select: {
        id: true,
        name: true,
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
        customerId: { in: organizationIds },
        status: "CHECKED_IN",
        deletedAt: null,
      },
      select: { customerId: true },
    }),
    db.mtmRoutePoint.findMany({
      where: {
        customerId: { in: organizationIds },
        status: "PENDING",
        deletedAt: null,
        route: {
          organizationId: input.organizationId,
          date: { gte: input.effectiveFrom },
          status: { in: ["DRAFT", "PLANNED", "IN_PROGRESS"] },
          deletedAt: null,
        },
      },
      select: { customerId: true },
    }),
  ])

  const byId = new Map(organizations.map((organization) => [organization.id, organization]))
  const openCount = new Map<string, number>()
  const routeCount = new Map<string, number>()
  for (const visit of openVisits) openCount.set(visit.customerId, (openCount.get(visit.customerId) ?? 0) + 1)
  for (const point of routePoints) routeCount.set(point.customerId, (routeCount.get(point.customerId) ?? 0) + 1)

  const rows = organizationIds.map((organizationId) => {
    const organization = byId.get(organizationId)
    const issues: OrganizationAssignmentIssue[] = []
    if (!organization) issues.push("ORGANIZATION_NOT_AVAILABLE")
    if (organization && organization.status !== "ACTIVE") issues.push("ORGANIZATION_INACTIVE")
    if (input.mode === "ASSIGN" && (!targetAgent || targetAgent.status !== "ACTIVE" || targetAgent.role !== "AGENT")) {
      issues.push("TARGET_AGENT_UNAVAILABLE")
    }
    const assignments = organization?.agentAssignments ?? []
    const activePrimary = assignments.filter((assignment) =>
      assignment.role === "PRIMARY"
      && assignment.effectiveFrom <= input.effectiveFrom
      && (!assignment.effectiveTo || assignment.effectiveTo > input.effectiveFrom))
    const futurePrimary = assignments.find((assignment) => assignment.role === "PRIMARY" && assignment.effectiveFrom > input.effectiveFrom)
    if (activePrimary.length > 1) issues.push("MULTIPLE_PRIMARY_OWNERS")
    if (futurePrimary) issues.push("FUTURE_ASSIGNMENT_CONFLICT")
    if (input.mode === "UNASSIGN" && activePrimary.length === 0) issues.push("NO_PRIMARY_ASSIGNMENT")
    if (input.mode === "ASSIGN" && activePrimary.some((assignment) => assignment.agentId === input.targetAgentId)) {
      issues.push("TARGET_ALREADY_ASSIGNED")
    }
    const openVisitCount = openCount.get(organizationId) ?? 0
    const plannedRouteCount = routeCount.get(organizationId) ?? 0
    if (openVisitCount > 0) issues.push("OPEN_VISIT_CONFLICT")
    if (plannedRouteCount > 0) issues.push("ROUTE_PLAN_CONFLICT")
    return {
      organizationId,
      name: organization?.name ?? null,
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
    targetAgent: targetAgent && { id: targetAgent.id, status: targetAgent.status, role: targetAgent.role },
    rows: rows.map(({ organizationId, currentAssignmentIds, issues, openVisitCount, plannedRouteCount }) => ({
      organizationId, currentAssignmentIds, issues, openVisitCount, plannedRouteCount,
    })),
  })
  return { previewToken, effectiveFrom, targetAgent, summary, rows }
}

export function organizationAssignmentRequestHash(input: {
  organizationIds: string[]
  mode: "ASSIGN" | "UNASSIGN"
  targetAgentId?: string | null
  effectiveFrom: string
  reason: string
  previewToken: string
}) {
  return stableHash({ ...input, organizationIds: [...new Set(input.organizationIds)].sort(), targetAgentId: input.targetAgentId ?? null })
}
