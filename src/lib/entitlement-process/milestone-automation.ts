import type { Prisma } from "@prisma/client"

import { autoAssignTicket } from "@/lib/auto-assign"
import { createNotification } from "@/lib/notifications"
import { PRIORITY_TIERS } from "@/lib/sla-resolver"
import { planEscalation } from "@/lib/entitlement-process/escalation-planner"
import { evaluateMilestoneStatus } from "@/lib/entitlement-process/milestone-status-evaluator"

type AutomationDb = Prisma.TransactionClient

type TicketRow = {
  id: string
  organizationId: string
  ticketNumber: string
  subject: string
  priority: string
  status: string
  assignedTo: string | null
  category: string
}

type MilestoneAutomationRow = {
  id: string
  organizationId: string
  ticketId: string
  type: string
  status: string
  dueAt: Date
  missedAt: Date | null
  escalationLevel: number
  lastEscalatedAt: Date | null
  metadata: Prisma.JsonValue
  ticket: TicketRow
  definition: {
    id: string
    name: string | null
    isRequired: boolean
    entitlement: {
      id: string
      supportLevel: string
      company: { name: string } | null
      slaPolicy: { name: string } | null
    }
  }
}

export type EntitlementMilestoneAutomationResult = {
  inspected: number
  atRisk: number
  missed: number
  escalated: number
  notified: number
  internalNotes: number
  priorityRaised: number
  reassigned: number
  skipped: number
  errors: number
}

type MutableResult = EntitlementMilestoneAutomationResult

const DEFAULT_WARNING_WINDOW_SECONDS = 24 * 60 * 60
const AT_RISK_ESCALATION_LEVEL = 1

export async function evaluateEntitlementMilestones(
  db: AutomationDb,
  input: {
    now?: Date
    warningWindowSeconds?: number
    limit?: number
  } = {},
): Promise<EntitlementMilestoneAutomationResult> {
  const now = input.now ?? new Date()
  const warningWindowSeconds = input.warningWindowSeconds ?? DEFAULT_WARNING_WINDOW_SECONDS
  const warningCutoff = new Date(now.getTime() + warningWindowSeconds * 1000)
  const result: MutableResult = {
    inspected: 0,
    atRisk: 0,
    missed: 0,
    escalated: 0,
    notified: 0,
    internalNotes: 0,
    priorityRaised: 0,
    reassigned: 0,
    skipped: 0,
    errors: 0,
  }

  const milestones = await db.entitlementTicketMilestone.findMany({
    where: {
      status: { in: ["in_progress", "missed"] },
      ticket: { status: { notIn: ["resolved", "closed"] } },
      OR: [
        { status: "in_progress", dueAt: { lte: warningCutoff } },
        { status: "missed" },
      ],
    },
    orderBy: [{ dueAt: "asc" }, { id: "asc" }],
    take: input.limit ?? 500,
    include: {
      ticket: {
        select: {
          id: true,
          organizationId: true,
          ticketNumber: true,
          subject: true,
          priority: true,
          status: true,
          assignedTo: true,
          category: true,
        },
      },
      definition: {
        select: {
          id: true,
          name: true,
          isRequired: true,
          entitlement: {
            select: {
              id: true,
              supportLevel: true,
              company: { select: { name: true } },
              slaPolicy: { select: { name: true } },
            },
          },
        },
      },
    },
  }) as unknown as MilestoneAutomationRow[]

  for (const milestone of milestones) {
    result.inspected += 1
    try {
      if (milestone.status === "in_progress") {
        const evaluation = evaluateMilestoneStatus({
          milestone: {
            status: "in_progress",
            dueAt: milestone.dueAt,
            missedAt: milestone.missedAt,
          },
          asOf: now,
        })
        if (evaluation.needsTransition) {
          await markMilestoneMissed(db, milestone, now, result)
          continue
        }
        if (milestone.dueAt <= warningCutoff) {
          await markMilestoneAtRisk(db, milestone, now, warningWindowSeconds, result)
        }
      } else if (milestone.status === "missed") {
        await applyMissedEscalations(db, milestone, now, result)
      }
    } catch (error) {
      result.errors += 1
      console.error("[entitlement-milestones] automation error:", error)
    }
  }

  return result
}

async function markMilestoneAtRisk(
  db: AutomationDb,
  milestone: MilestoneAutomationRow,
  now: Date,
  warningWindowSeconds: number,
  result: MutableResult,
) {
  const updated = await db.entitlementTicketMilestone.updateMany({
    where: {
      id: milestone.id,
      organizationId: milestone.organizationId,
      status: "in_progress",
      dueAt: { gt: now, lte: new Date(now.getTime() + warningWindowSeconds * 1000) },
      escalationLevel: { lt: AT_RISK_ESCALATION_LEVEL },
    },
    data: {
      escalationLevel: AT_RISK_ESCALATION_LEVEL,
      lastEscalatedAt: now,
      metadata: {
        ...jsonObject(milestone.metadata),
        riskState: "at_risk",
        atRiskAt: now.toISOString(),
        atRiskWarningWindowSeconds: warningWindowSeconds,
      },
    },
  })
  if (updated.count === 0) {
    result.skipped += 1
    return
  }

  result.atRisk += 1
  await db.entitlementAuditEvent.create({
    data: {
      organizationId: milestone.organizationId,
      milestoneId: milestone.id,
      eventType: "milestone_escalated",
      payload: {
        ticketId: milestone.ticketId,
        type: milestone.type,
        level: AT_RISK_ESCALATION_LEVEL,
        trigger: "at_risk",
        dueAt: milestone.dueAt.toISOString(),
        warningWindowSeconds,
      },
    },
  })
  result.notified += await notifyAssignee(milestone, {
    type: "warning",
    title: `Support milestone at risk: ${milestone.ticket.ticketNumber}`,
    message: `${milestoneLabel(milestone)} is due ${formatDate(milestone.dueAt)}.`,
    kind: "ticket.entitlement_at_risk",
  })
  result.internalNotes += await createInternalNote(
    db,
    milestone,
    `Support milestone at risk: ${milestoneLabel(milestone)} is due ${formatDate(milestone.dueAt)}.`,
  )
}

async function markMilestoneMissed(
  db: AutomationDb,
  milestone: MilestoneAutomationRow,
  now: Date,
  result: MutableResult,
) {
  const updated = await db.entitlementTicketMilestone.updateMany({
    where: {
      id: milestone.id,
      organizationId: milestone.organizationId,
      status: "in_progress",
      dueAt: { lte: now },
    },
    data: {
      status: "missed",
      missedAt: now,
      metadata: {
        ...jsonObject(milestone.metadata),
        riskState: "missed",
        missedAt: now.toISOString(),
      },
    },
  })
  if (updated.count === 0) {
    result.skipped += 1
    return
  }

  result.missed += 1
  await db.entitlementAuditEvent.create({
    data: {
      organizationId: milestone.organizationId,
      milestoneId: milestone.id,
      eventType: "milestone_missed",
      payload: {
        ticketId: milestone.ticketId,
        type: milestone.type,
        dueAt: milestone.dueAt.toISOString(),
        missedAt: now.toISOString(),
      },
    },
  })
  result.internalNotes += await createInternalNote(
    db,
    milestone,
    `Support milestone missed: ${milestoneLabel(milestone)} was due ${formatDate(milestone.dueAt)}.`,
  )
  result.notified += await notifyAssignee(milestone, {
    type: "error",
    title: `Support milestone missed: ${milestone.ticket.ticketNumber}`,
    message: `${milestoneLabel(milestone)} was due ${formatDate(milestone.dueAt)}.`,
    kind: "ticket.entitlement_missed",
  })
  if (isPremiumOrEnterprise(milestone)) {
    result.notified += await notifyManagers(db, milestone, {
      type: "error",
      title: `Premium support milestone missed: ${milestone.ticket.ticketNumber}`,
      message: `${milestoneLabel(milestone)} was missed for ${companyLabel(milestone)}.`,
      kind: "ticket.entitlement_missed_manager",
    })
  }

  await applyMissedEscalations(
    db,
    {
      ...milestone,
      status: "missed",
      missedAt: now,
    },
    now,
    result,
  )
}

async function applyMissedEscalations(
  db: AutomationDb,
  milestone: MilestoneAutomationRow,
  now: Date,
  result: MutableResult,
) {
  const plan = planEscalation({
    overdueAt: milestone.dueAt,
    currentLevel: milestone.escalationLevel,
    asOf: now,
  })

  let currentLevel = milestone.escalationLevel
  for (const step of plan.toFireNow) {
    const updated = await db.entitlementTicketMilestone.updateMany({
      where: {
        id: milestone.id,
        organizationId: milestone.organizationId,
        status: "missed",
        escalationLevel: currentLevel,
      },
      data: {
        escalationLevel: step.level,
        lastEscalatedAt: now,
        metadata: {
          ...jsonObject(milestone.metadata),
          riskState: "missed",
          lastEscalationAction: step.action,
          lastEscalationLevel: step.level,
          lastEscalatedAt: now.toISOString(),
        },
      },
    })
    if (updated.count === 0) {
      result.skipped += 1
      break
    }

    currentLevel = step.level
    result.escalated += 1
    const actionResult = await applyEscalationActions(db, milestone, step.level, now)
    mergeResult(result, actionResult)
    await db.entitlementAuditEvent.create({
      data: {
        organizationId: milestone.organizationId,
        milestoneId: milestone.id,
        eventType: "milestone_escalated",
        payload: {
          ticketId: milestone.ticketId,
          type: milestone.type,
          level: step.level,
          action: step.action,
          fireAt: step.fireAt.toISOString(),
          escalatedAt: now.toISOString(),
        },
      },
    })
  }
}

async function applyEscalationActions(
  db: AutomationDb,
  milestone: MilestoneAutomationRow,
  level: number,
  now: Date,
): Promise<Pick<MutableResult, "notified" | "internalNotes" | "priorityRaised" | "reassigned">> {
  const result = { notified: 0, internalNotes: 0, priorityRaised: 0, reassigned: 0 }
  if (level <= 1) {
    result.notified += await notifyAssignee(milestone, {
      type: "warning",
      title: `Support milestone escalation L${level}: ${milestone.ticket.ticketNumber}`,
      message: `${milestoneLabel(milestone)} is overdue.`,
      kind: "ticket.entitlement_escalated",
    })
  } else {
    result.notified += await notifyManagers(db, milestone, {
      type: level >= 3 ? "error" : "warning",
      title: `Support milestone escalation L${level}: ${milestone.ticket.ticketNumber}`,
      message: `${milestoneLabel(milestone)} is overdue for ${companyLabel(milestone)}.`,
      kind: "ticket.entitlement_escalated_manager",
    })
    result.priorityRaised += await increaseTicketPriority(db, milestone)
  }

  if (level >= 3) {
    try {
      await autoAssignTicket(milestone.ticket.id, milestone.organizationId, milestone.ticket.category)
      result.reassigned += 1
    } catch (error) {
      console.error("[entitlement-milestones] auto-assign failed:", error)
    }
  }

  result.internalNotes += await createInternalNote(
    db,
    milestone,
    `Support milestone escalation L${level}: ${milestoneLabel(milestone)} remains overdue as of ${formatDate(now)}.`,
  )
  return result
}

async function notifyAssignee(
  milestone: MilestoneAutomationRow,
  input: {
    type: "info" | "warning" | "error"
    title: string
    message: string
    kind: string
  },
) {
  if (!milestone.ticket.assignedTo) return 0
  await createNotification({
    organizationId: milestone.organizationId,
    userId: milestone.ticket.assignedTo,
    type: input.type,
    title: input.title,
    message: input.message,
    entityType: "ticket",
    entityId: milestone.ticket.id,
    push: true,
    kind: input.kind,
  })
  return 1
}

async function notifyManagers(
  db: AutomationDb,
  milestone: MilestoneAutomationRow,
  input: {
    type: "info" | "warning" | "error"
    title: string
    message: string
    kind: string
  },
) {
  const managers = await db.user.findMany({
    where: {
      organizationId: milestone.organizationId,
      role: { in: ["admin", "manager"] },
      isActive: true,
    },
    select: { id: true },
  })
  const ids = [...new Set(managers.map((user) => user.id))]
  for (const userId of ids) {
    await createNotification({
      organizationId: milestone.organizationId,
      userId,
      type: input.type,
      title: input.title,
      message: input.message,
      entityType: "ticket",
      entityId: milestone.ticket.id,
      push: true,
      kind: input.kind,
    })
  }
  return ids.length
}

async function createInternalNote(
  db: AutomationDb,
  milestone: MilestoneAutomationRow,
  comment: string,
) {
  await db.ticketComment.create({
    data: {
      ticketId: milestone.ticketId,
      userId: null,
      isInternal: true,
      comment,
    },
  })
  return 1
}

async function increaseTicketPriority(db: AutomationDb, milestone: MilestoneAutomationRow) {
  let currentIdx = PRIORITY_TIERS.indexOf(milestone.ticket.priority as (typeof PRIORITY_TIERS)[number])
  if (currentIdx === -1) currentIdx = PRIORITY_TIERS.indexOf("medium")
  if (currentIdx >= PRIORITY_TIERS.length - 1) return 0
  const nextPriority = PRIORITY_TIERS[currentIdx + 1]
  const updated = await db.ticket.updateMany({
    where: { id: milestone.ticket.id, organizationId: milestone.organizationId },
    data: { priority: nextPriority },
  })
  return updated.count > 0 ? 1 : 0
}

function milestoneLabel(milestone: MilestoneAutomationRow) {
  return milestone.definition.name || milestone.type.replace(/_/g, " ")
}

function companyLabel(milestone: MilestoneAutomationRow) {
  return milestone.definition.entitlement.company?.name || "the customer"
}

function isPremiumOrEnterprise(milestone: MilestoneAutomationRow) {
  return ["premium", "enterprise"].includes(milestone.definition.entitlement.supportLevel)
}

function formatDate(date: Date) {
  return date.toISOString()
}

function jsonObject(value: Prisma.JsonValue): Prisma.InputJsonObject {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Prisma.InputJsonObject
  }
  return {}
}

function mergeResult(
  target: MutableResult,
  source: Pick<MutableResult, "notified" | "internalNotes" | "priorityRaised" | "reassigned">,
) {
  target.notified += source.notified
  target.internalNotes += source.internalNotes
  target.priorityRaised += source.priorityRaised
  target.reassigned += source.reassigned
}
