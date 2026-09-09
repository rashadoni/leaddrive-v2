import { prisma } from "@/lib/prisma"
import { orgStageVocabulary } from "@/lib/deal-stage-vocabulary"
import { applyRecordFilter } from "@/lib/sharing-rules"

export interface NextAction {
  type: "call" | "email" | "meeting" | "task" | "update_stage" | "send_offer"
  titleKey: string
  titleParams: Record<string, string | number>
  reasonKey: string
  reasonParams: Record<string, string | number>
  priority: "high" | "medium" | "low"
  entityType: "deal" | "contact" | "lead" | "company"
  entityId: string
  entityName: string
  suggestedDate?: string
}

export interface NextActionAccess {
  role: string
  deals: boolean
  leads: boolean
  tasks: boolean
  tickets: boolean
}

function daysSince(date: Date | null | undefined): number {
  if (!date) return 999
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000)
}

export async function generateNextBestActions(
  orgId: string,
  userId: string,
  limit: number = 10,
  access: NextActionAccess,
): Promise<NextAction[]> {
  const actions: NextAction[] = []
  const now = new Date()
  // Закрытая сделка — это любое написание закрытой, а не два литерала.
  const { closedStages } = await orgStageVocabulary(orgId)

  // 1. Stale deals — no activity in 7+ days
  const userDeals = access.deals ? await prisma.deal.findMany({
    where: {
      organizationId: orgId,
      stage: { notIn: closedStages },
      assignedTo: userId,
    },
    select: {
      id: true,
      name: true,
      stage: true,
      expectedClose: true,
      stageChangedAt: true,
      valueAmount: true,
    },
  }) : []

  for (const deal of userDeals) {
    // Get last activity for this deal
    const lastActivity = await prisma.activity.findFirst({
      where: { organizationId: orgId, relatedType: "deal", relatedId: deal.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    })
    const days = daysSince(lastActivity?.createdAt)

    if (days > 14) {
      actions.push({
        type: "call",
        titleKey: "nbaCallDeal",
        titleParams: { name: deal.name },
        reasonKey: "nbaNoActivityDays",
        reasonParams: { days },
        priority: "high",
        entityType: "deal",
        entityId: deal.id,
        entityName: deal.name,
      })
    } else if (days > 7) {
      actions.push({
        type: "email",
        titleKey: "nbaFollowUp",
        titleParams: { name: deal.name },
        reasonKey: "nbaFollowUpReason",
        reasonParams: { days },
        priority: "medium",
        entityType: "deal",
        entityId: deal.id,
        entityName: deal.name,
      })
    }

    // Deals with close date this week without recent activity
    if (deal.expectedClose) {
      const daysToClose = Math.floor((new Date(deal.expectedClose).getTime() - now.getTime()) / 86400000)
      if (daysToClose >= 0 && daysToClose <= 7 && days > 3) {
        actions.push({
          type: "call",
          titleKey: "nbaDealClosingSoon",
          titleParams: { name: deal.name, days: daysToClose },
          reasonKey: "nbaDealClosingSoonReason",
          reasonParams: { date: new Date(deal.expectedClose).toISOString().slice(0, 10) },
          priority: "high",
          entityType: "deal",
          entityId: deal.id,
          entityName: deal.name,
        })
      }
    }
  }

  // 2. Hot leads without follow-up
  const hotLeadWhere = access.leads
    ? await applyRecordFilter(orgId, userId, access.role, "lead", {
      organizationId: orgId,
      status: { notIn: ["converted", "lost"] },
      score: { gte: 70 },
    })
    : null
  const hotLeads = hotLeadWhere ? await prisma.lead.findMany({
    where: hotLeadWhere,
    select: { id: true, contactName: true, email: true, score: true },
  }) : []

  for (const lead of hotLeads) {
    const lastActivity = await prisma.activity.findFirst({
      where: { organizationId: orgId, relatedType: "lead", relatedId: lead.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    })
    const days = daysSince(lastActivity?.createdAt)

    if (days > 3) {
      actions.push({
        type: "call",
        titleKey: "nbaHotLead",
        titleParams: { name: lead.contactName || lead.email || "Unknown" },
        reasonKey: "nbaHotLeadReason",
        reasonParams: { score: lead.score || 0, days },
        priority: "high",
        entityType: "lead",
        entityId: lead.id,
        entityName: lead.contactName || lead.email || "Unknown",
      })
    }
  }

  // 2b. Deals ready for next stage (>3 activities in current stage)
  for (const deal of userDeals) {
    const stageActivities = await prisma.activity.count({
      where: {
        organizationId: orgId,
        relatedType: "deal",
        relatedId: deal.id,
        createdAt: deal.stageChangedAt ? { gte: deal.stageChangedAt } : undefined,
      },
    })
    if (stageActivities >= 3 && deal.stageChangedAt) {
      const daysInStage = daysSince(deal.stageChangedAt)
      if (daysInStage > 5) {
        actions.push({
          type: "update_stage",
          titleKey: "nbaAdvanceStage",
          titleParams: { name: deal.name },
          reasonKey: "nbaAdvanceStageReason",
          reasonParams: { activities: stageActivities, stage: deal.stage, days: daysInStage },
          priority: "medium",
          entityType: "deal",
          entityId: deal.id,
          entityName: deal.name,
        })
      }
    }
  }

  // 3. Overdue tasks
  const overdueTasks = access.tasks ? await prisma.task.findMany({
    where: {
      organizationId: orgId,
      assignedTo: userId,
      status: { in: ["pending", "in_progress"] },
      dueDate: { lt: now },
    },
    select: { id: true, title: true, dueDate: true, relatedType: true, relatedId: true },
    take: 5,
  }) : []

  for (const task of overdueTasks) {
    const overdueDays = task.dueDate ? daysSince(task.dueDate) : 0
    actions.push({
      type: "task",
      titleKey: "nbaOverdueTask",
      titleParams: { title: task.title },
      reasonKey: "nbaOverdueTaskReason",
      reasonParams: { days: overdueDays },
      priority: overdueDays > 3 ? "high" : "medium",
      entityType: (task.relatedType as any) || "deal",
      entityId: task.relatedId || task.id,
      entityName: task.title,
    })
  }

  // 4. Tickets approaching SLA
  const urgentTicketWhere = access.tickets
    ? await applyRecordFilter(orgId, userId, access.role, "ticket", {
      organizationId: orgId,
      status: { in: ["new", "in_progress", "waiting"] },
    })
    : null
  const urgentTickets = urgentTicketWhere ? await prisma.ticket.findMany({
    where: urgentTicketWhere,
    select: {
      id: true, subject: true, priority: true, ticketNumber: true,
      createdAt: true, slaFirstResponseDueAt: true, slaPolicyName: true,
    },
    take: 10,
    orderBy: { createdAt: "asc" },
  }) : []

  for (const ticket of urgentTickets) {
    const age = daysSince(ticket.createdAt)

    // SLA-based: check if approaching first response deadline
    if (ticket.slaFirstResponseDueAt) {
      const hoursToSla = (new Date(ticket.slaFirstResponseDueAt).getTime() - now.getTime()) / 3600000
      if (hoursToSla > 0 && hoursToSla <= 2) {
        actions.push({
          type: "task",
          titleKey: "nbaSlaApproaching",
          titleParams: { number: ticket.ticketNumber || "", subject: ticket.subject },
          reasonKey: "nbaSlaApproachingReason",
          reasonParams: { minutes: Math.round(hoursToSla * 60), policy: ticket.slaPolicyName || "standard" },
          priority: "high",
          entityType: "deal",
          entityId: ticket.id,
          entityName: ticket.subject,
        })
        continue
      }
      if (hoursToSla <= 0) {
        actions.push({
          type: "task",
          titleKey: "nbaSlaBreached",
          titleParams: { number: ticket.ticketNumber || "" },
          reasonKey: "nbaSlaBreachedReason",
          reasonParams: { hours: Math.abs(Math.round(hoursToSla)) },
          priority: "high",
          entityType: "deal",
          entityId: ticket.id,
          entityName: ticket.subject,
        })
        continue
      }
    }

    // Fallback: priority-based urgency
    if ((ticket.priority === "critical" && age >= 1) || (ticket.priority === "high" && age >= 2)) {
      actions.push({
        type: "task",
        titleKey: "nbaTicketAttention",
        titleParams: { number: ticket.ticketNumber || "", subject: ticket.subject },
        reasonKey: "nbaTicketAttentionReason",
        reasonParams: { priority: ticket.priority, days: age },
        priority: ticket.priority === "critical" ? "high" : "medium",
        entityType: "deal",
        entityId: ticket.id,
        entityName: ticket.subject,
      })
    }
  }

  // Sort by priority and return top N
  const priorityOrder = { high: 0, medium: 1, low: 2 }
  return actions
    .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
    .slice(0, limit)
}
