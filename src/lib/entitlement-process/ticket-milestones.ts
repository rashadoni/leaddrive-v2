import { Prisma } from "@prisma/client"

import {
  calculateMilestoneDue,
  pickMostSpecificDefinition,
} from "@/lib/entitlement-process/milestone-due-calculator"
import {
  MILESTONE_TYPES,
  type MilestoneType,
  type SeverityTier,
} from "@/lib/entitlement-process/types"

type EntitlementDb = Prisma.TransactionClient

export type TicketPriorityForMilestones = "low" | "medium" | "high" | "critical" | "urgent" | string | null | undefined

export type RuntimeMilestoneDefinition = {
  id: string
  type: string
  name?: string | null
  severityTier?: string | null
  dueWithinSeconds: number
  isRequired: boolean
}

export type CreateTicketEntitlementMilestonesResult =
  | {
      applied: true
      reason: "applied"
      entitlementId: string
      supportLevel: string
      createdMilestoneIds: string[]
    }
  | {
      applied: false
      reason: "no_company" | "no_active_entitlement" | "no_matching_definitions"
      entitlementId?: string
    }

export function ticketPriorityToSeverity(priority: TicketPriorityForMilestones): SeverityTier {
  if (priority === "critical" || priority === "urgent") return "critical"
  if (priority === "high") return "high"
  if (priority === "low") return "low"
  return "normal"
}

export function selectRuntimeMilestoneDefinitions(
  definitions: readonly RuntimeMilestoneDefinition[],
  ticketSeverity: SeverityTier,
): RuntimeMilestoneDefinition[] {
  const byType = new Map<MilestoneType, RuntimeMilestoneDefinition[]>()
  for (const definition of definitions) {
    if (!MILESTONE_TYPES.includes(definition.type as MilestoneType)) continue
    const type = definition.type as MilestoneType
    const group = byType.get(type) ?? []
    group.push(definition)
    byType.set(type, group)
  }

  const selected: RuntimeMilestoneDefinition[] = []
  for (const type of MILESTONE_TYPES) {
    const match = pickMostSpecificDefinition(byType.get(type) ?? [], ticketSeverity)
    if (match) selected.push(match)
  }
  return selected
}

export async function createTicketEntitlementMilestones(
  db: EntitlementDb,
  input: {
    organizationId: string
    ticketId: string
    companyId?: string | null
    ticketCreatedAt: Date
    priority?: TicketPriorityForMilestones
  },
): Promise<CreateTicketEntitlementMilestonesResult> {
  if (!input.companyId) {
    return { applied: false, reason: "no_company" }
  }

  const ticketCreatedAt = input.ticketCreatedAt
  const entitlement = await db.entitlement.findFirst({
    where: {
      organizationId: input.organizationId,
      companyId: input.companyId,
      status: "active",
      validFrom: { lte: ticketCreatedAt },
      OR: [{ validTo: null }, { validTo: { gt: ticketCreatedAt } }],
    },
    orderBy: [{ validFrom: "desc" }, { createdAt: "desc" }],
    include: {
      milestoneDefinitions: {
        orderBy: [{ type: "asc" }, { severityTier: "asc" }, { createdAt: "asc" }],
      },
    },
  })

  if (!entitlement) {
    return { applied: false, reason: "no_active_entitlement" }
  }

  const ticketSeverity = ticketPriorityToSeverity(input.priority)
  const definitions = selectRuntimeMilestoneDefinitions(entitlement.milestoneDefinitions, ticketSeverity)
  if (definitions.length === 0) {
    return { applied: false, reason: "no_matching_definitions", entitlementId: entitlement.id }
  }

  const createdMilestoneIds: string[] = []
  for (const definition of definitions) {
    const due = calculateMilestoneDue({
      definition: {
        type: definition.type as MilestoneType,
        severityTier: definition.severityTier as SeverityTier | null | undefined,
        dueWithinSeconds: definition.dueWithinSeconds,
        isRequired: definition.isRequired,
      },
      ticketCreatedAt,
      ticketSeverity,
      // Severity-specific rules are explicit contract terms. Catch-all rules
      // still inherit the ticket-priority multiplier.
      multiplierOverride: definition.severityTier ? 1 : undefined,
    })
    if (!due.appliesTo) continue

    const milestone = await db.entitlementTicketMilestone.create({
      data: {
        organizationId: input.organizationId,
        ticketId: input.ticketId,
        definitionId: definition.id,
        type: definition.type,
        status: "in_progress",
        dueAt: due.dueAt,
        metadata: {
          entitlementId: entitlement.id,
          supportLevel: entitlement.supportLevel,
          ticketSeverity,
          effectiveDueWithinSeconds: due.effectiveDueWithinSeconds,
          definitionName: definition.name || null,
          isRequired: definition.isRequired,
        },
      },
    })
    createdMilestoneIds.push(milestone.id)

    await db.entitlementAuditEvent.create({
      data: {
        organizationId: input.organizationId,
        milestoneId: milestone.id,
        eventType: "milestone_started",
        payload: {
          ticketId: input.ticketId,
          entitlementId: entitlement.id,
          definitionId: definition.id,
          type: definition.type,
          dueAt: due.dueAt.toISOString(),
        },
      },
    })
  }

  if (createdMilestoneIds.length === 0) {
    return { applied: false, reason: "no_matching_definitions", entitlementId: entitlement.id }
  }

  return {
    applied: true,
    reason: "applied",
    entitlementId: entitlement.id,
    supportLevel: entitlement.supportLevel,
    createdMilestoneIds,
  }
}

export async function markTicketMilestonesMet(
  db: EntitlementDb,
  input: {
    organizationId: string
    ticketId: string
    types: readonly MilestoneType[]
    completedAt?: Date
    eventName: string
    actorUserId?: string | null
  },
): Promise<{ updated: number }> {
  if (input.types.length === 0) return { updated: 0 }

  const completedAt = input.completedAt ?? new Date()
  const milestones = await db.entitlementTicketMilestone.findMany({
    where: {
      organizationId: input.organizationId,
      ticketId: input.ticketId,
      type: { in: [...new Set(input.types)] },
      status: { in: ["in_progress", "missed"] },
    },
    select: {
      id: true,
      type: true,
      status: true,
      dueAt: true,
      metadata: true,
    },
  })

  let updated = 0
  for (const milestone of milestones) {
    const result = await db.entitlementTicketMilestone.updateMany({
      where: {
        id: milestone.id,
        organizationId: input.organizationId,
        status: { in: ["in_progress", "missed"] },
      },
      data: {
        status: "met",
        completedAt,
        metadata: {
          ...jsonObject(milestone.metadata),
          metByEvent: input.eventName,
          metFromStatus: milestone.status,
        },
      },
    })
    if (result.count === 0) continue
    updated += result.count

    await db.entitlementAuditEvent.create({
      data: {
        organizationId: input.organizationId,
        milestoneId: milestone.id,
        eventType: "milestone_met",
        actorUserId: input.actorUserId || undefined,
        payload: {
          ticketId: input.ticketId,
          type: milestone.type,
          eventName: input.eventName,
          completedAt: completedAt.toISOString(),
          dueAt: milestone.dueAt.toISOString(),
        },
      },
    })
  }

  return { updated }
}

function jsonObject(value: Prisma.JsonValue): Prisma.InputJsonObject {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Prisma.InputJsonObject
  }
  return {}
}
