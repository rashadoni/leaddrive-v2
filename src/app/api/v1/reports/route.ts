import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { PAGE_SIZE } from "@/lib/constants"
import {
  ENTITLEMENT_STATUSES,
  MILESTONE_STATUSES,
  MILESTONE_TYPES,
  SUPPORT_LEVELS,
} from "@/lib/entitlement-process/types"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { withRls } from "@/lib/with-rls"
import { canonicalDealStage } from "@/lib/deal-stage-normalization"
import { lostStageNames, wonStageNames } from "@/lib/marketing-attribution/won-stages"

const ACTIVE_TICKET_STATUSES = ["new", "open", "in_progress", "waiting", "escalated"]
const TERMINAL_TICKET_STATUSES = ["resolved", "closed"]
const FILTERABLE_TICKET_STATUSES = [...ACTIVE_TICKET_STATUSES, ...TERMINAL_TICKET_STATUSES]
const DEFAULT_TICKET_SOURCES = ["portal", "whatsapp", "email", "web_chat", "facebook", "instagram", "telegram", "agent", "manual"]
const DEFAULT_TICKET_PRIORITIES = ["critical", "high", "medium", "low"]
const SERVICE_DESK_SLA_STATES = ["breached", "at_risk", "first_response_breached", "pending_closure", "reopened", "compliant"]
const OPEN_MILESTONE_STATUSES = ["pending", "in_progress"]
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

type TicketCategoryCountGroup = { categoryId: string | null; _count: number }
type TicketLegacyCategoryGroup = { category: string | null; _count: number }
type TicketSourceGroup = { source: string | null; _count: number }
type TicketPriorityGroup = { priority: string | null; _count: number }
type TicketAssigneeGroup = { assignedTo: string | null; _count: number }
type ServiceDeskCompanyOption = { id: string; name: string }
type ServiceDeskAssignee = { id: string; name: string; email: string }
type ServiceDeskCategory = {
  id: string
  name: string
  slug: string
  parentId: string | null
  scope: string
  isActive: boolean
  isPortalVisible: boolean
  parent: { id: string; name: string; slug: string } | null
  _count: { children: number; tickets: number }
}
type BacklogTicketRow = { createdAt: Date }
type ResolvedTicketRow = { assignedTo: string | null; createdAt: Date; resolvedAt: Date | null; closedAt: Date | null }
type FirstResponseTicketRow = { createdAt: Date; firstResponseAt: Date | null }
type SlaPolicyOptionRow = { id: string; name: string }
type RequesterTicketRow = {
  status: string
  source: string | null
  requesterName: string | null
  requesterEmail: string | null
  requesterPhone: string | null
  contact: { fullName: string | null; email: string | null; phone: string | null } | null
}
type LatestBreachTicketRow = {
  id: string
  ticketNumber: string
  subject: string
  status: string
  priority: string
  source: string | null
  requesterName: string | null
  requesterEmail: string | null
  requesterPhone: string | null
  slaDueAt: Date | null
  slaFirstResponseDueAt: Date | null
  assignedTo: string | null
}
type ThroughputTicketRow = { createdAt: Date; resolvedAt: Date | null; closedAt: Date | null }
type ServiceDeskCategoryRow = {
  id: string | null
  name: string
  slug: string | null
  parentId: string | null
  parentName: string | null
  depth: number
  scope: string | null
  isActive: boolean
  isPortalVisible: boolean
  childrenCount: number
  count: number
}
type EntitlementReportRow = {
  id: string
  companyId: string
  supportLevel: string
  status: string
  validTo: Date | null
  company: { name: string }
  slaPolicy: { id: string; name: string }
}
type EntitlementMilestoneReportRow = {
  id: string
  type: string
  status: string
  dueAt: Date
  missedAt: Date | null
  ticketId: string
  ticket: {
    id: string
    ticketNumber: string
    subject: string
    status: string
    priority: string
    companyId: string | null
  }
  definition: {
    entitlementId: string
    entitlement: {
      id: string
      companyId: string
      supportLevel: string
      status: string
      company: { name: string }
      slaPolicy: { id: string; name: string }
    }
  }
}
type ReportFilters = {
  q?: string
  period?: string
  from?: Date
  to?: Date
  companyId?: string
  categoryId?: string
  assigneeId?: string
  source?: string
  status?: string
  priority?: string
  sla?: string
  supportLevel?: string
  slaPolicyId?: string
  entitlementStatus?: string
  milestoneType?: string
  milestoneState?: string
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10
}

function average(values: number[]) {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10)
}

function cleanParam(value: string | null) {
  const trimmed = value?.trim()
  if (!trimmed || trimmed === "all") return undefined
  return trimmed
}

function cleanEnumParam(value: string | undefined, allowed: readonly string[]) {
  return value && allowed.includes(value) ? value : undefined
}

function parseDateParam(value: string | null, endOfDay = false) {
  if (!value) return undefined
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function periodRange(period: string | undefined, now: Date) {
  if (!period || period === "all" || period === "custom") return {}
  if (period === "this_month") {
    return {
      from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      to: now,
    }
  }

  const days = Number(period.replace("d", ""))
  if (!Number.isFinite(days) || days <= 0) return {}
  return {
    from: new Date(now.getTime() - (days - 1) * DAY_MS),
    to: now,
  }
}

function parseReportFilters(req: Request, now: Date): ReportFilters {
  const searchParams = new URL(req.url).searchParams
  const period = cleanParam(searchParams.get("period"))
  const explicitFrom = parseDateParam(searchParams.get("from"))
  const explicitTo = parseDateParam(searchParams.get("to"), true)
  const inferredRange = periodRange(period, now)
  const status = cleanParam(searchParams.get("status"))
  const priority = cleanParam(searchParams.get("priority"))
  const source = cleanParam(searchParams.get("source"))
  const sla = cleanParam(searchParams.get("sla"))
  const supportLevel = cleanParam(searchParams.get("supportLevel"))
  const slaPolicyId = cleanParam(searchParams.get("slaPolicyId"))
  const entitlementStatus = cleanParam(searchParams.get("entitlementStatus"))
  const milestoneType = cleanParam(searchParams.get("milestoneType"))
  const milestoneState = cleanParam(searchParams.get("milestoneState"))

  return {
    q: cleanParam(searchParams.get("q")),
    period,
    from: explicitFrom || inferredRange.from,
    to: explicitTo || inferredRange.to,
    companyId: cleanParam(searchParams.get("companyId")),
    categoryId: cleanParam(searchParams.get("categoryId")),
    assigneeId: cleanParam(searchParams.get("assigneeId")),
    source: source && source !== "unknown" ? source : source,
    status: status && FILTERABLE_TICKET_STATUSES.includes(status) ? status : undefined,
    priority: priority && DEFAULT_TICKET_PRIORITIES.includes(priority) ? priority : undefined,
    sla: sla && SERVICE_DESK_SLA_STATES.includes(sla) ? sla : undefined,
    supportLevel: cleanEnumParam(supportLevel, SUPPORT_LEVELS),
    slaPolicyId,
    entitlementStatus: cleanEnumParam(entitlementStatus, ENTITLEMENT_STATUSES),
    milestoneType: cleanEnumParam(milestoneType, MILESTONE_TYPES),
    milestoneState: cleanEnumParam(milestoneState, MILESTONE_STATUSES),
  }
}

function dateFilter(filters: ReportFilters): Prisma.DateTimeFilter | undefined {
  if (!filters.from && !filters.to) return undefined
  return {
    ...(filters.from ? { gte: filters.from } : {}),
    ...(filters.to ? { lte: filters.to } : {}),
  }
}

function slaTicketWhere(sla: string, now: Date, atRiskCutoff: Date): Prisma.TicketWhereInput {
  if (sla === "breached") {
    return {
      status: { in: ACTIVE_TICKET_STATUSES },
      OR: [
        { slaDueAt: { lt: now } },
        { firstResponseAt: null, slaFirstResponseDueAt: { lt: now } },
      ],
    }
  }
  if (sla === "at_risk") {
    return {
      status: { in: ACTIVE_TICKET_STATUSES },
      slaDueAt: { gte: now, lte: atRiskCutoff },
    }
  }
  if (sla === "first_response_breached") {
    return {
      status: { in: ACTIVE_TICKET_STATUSES },
      firstResponseAt: null,
      slaFirstResponseDueAt: { lt: now },
    }
  }
  if (sla === "pending_closure") {
    return { closureRequests: { some: { status: "pending" } } }
  }
  if (sla === "reopened") {
    return { reopenCount: { gt: 0 } }
  }
  return {
    status: { in: ACTIVE_TICKET_STATUSES },
    AND: [
      {
        OR: [
          { slaDueAt: null },
          { slaDueAt: { gt: atRiskCutoff } },
        ],
      },
      {
        OR: [
          { firstResponseAt: { not: null } },
          { slaFirstResponseDueAt: null },
          { slaFirstResponseDueAt: { gte: now } },
        ],
      },
    ],
  }
}

function entitlementReportWhere(
  orgId: string,
  filters: ReportFilters,
  extra?: Prisma.EntitlementWhereInput | Prisma.EntitlementWhereInput[],
): Prisma.EntitlementWhereInput {
  const and: Prisma.EntitlementWhereInput[] = []

  if (filters.companyId) and.push({ companyId: filters.companyId })
  if (filters.supportLevel) and.push({ supportLevel: filters.supportLevel })
  if (filters.slaPolicyId) and.push({ slaPolicyId: filters.slaPolicyId })
  if (filters.entitlementStatus) and.push({ status: filters.entitlementStatus })
  if (filters.q) {
    and.push({
      OR: [
        { company: { is: { name: { contains: filters.q, mode: "insensitive" } } } },
        { company: { is: { email: { contains: filters.q, mode: "insensitive" } } } },
        { slaPolicy: { is: { name: { contains: filters.q, mode: "insensitive" } } } },
        { notes: { contains: filters.q, mode: "insensitive" } },
      ],
    })
  }
  if (extra) and.push(...(Array.isArray(extra) ? extra : [extra]))

  return {
    organizationId: orgId,
    ...(and.length > 0 ? { AND: and } : {}),
  }
}

function ticketEntitlementMilestoneWhere(filters: ReportFilters): Prisma.EntitlementTicketMilestoneWhereInput | undefined {
  const and: Prisma.EntitlementTicketMilestoneWhereInput[] = []
  const entitlementAnd: Prisma.EntitlementWhereInput[] = []

  if (filters.supportLevel) entitlementAnd.push({ supportLevel: filters.supportLevel })
  if (filters.slaPolicyId) entitlementAnd.push({ slaPolicyId: filters.slaPolicyId })
  if (filters.entitlementStatus) entitlementAnd.push({ status: filters.entitlementStatus })
  if (filters.milestoneType) and.push({ type: filters.milestoneType })
  if (filters.milestoneState) and.push({ status: filters.milestoneState })
  if (entitlementAnd.length > 0) {
    and.push({
      definition: {
        is: {
          entitlement: {
            is: {
              AND: entitlementAnd,
            },
          },
        },
      },
    })
  }

  return and.length > 0 ? { AND: and } : undefined
}

function withoutEntitlementFilters(filters: ReportFilters): ReportFilters {
  return {
    q: filters.q,
    period: filters.period,
    from: filters.from,
    to: filters.to,
    companyId: filters.companyId,
    categoryId: filters.categoryId,
    assigneeId: filters.assigneeId,
    source: filters.source,
    status: filters.status,
    priority: filters.priority,
    sla: filters.sla,
  }
}

function ticketReportWhere(
  orgId: string,
  filters: ReportFilters,
  now: Date,
  atRiskCutoff: Date,
  extra?: Prisma.TicketWhereInput | Prisma.TicketWhereInput[],
  options: { includeEntitlementFilters?: boolean } = {},
): Prisma.TicketWhereInput {
  const and: Prisma.TicketWhereInput[] = []
  const createdAt = dateFilter(filters)

  if (createdAt) and.push({ createdAt })
  if (filters.companyId) and.push({ companyId: filters.companyId })
  if (filters.categoryId) and.push({ categoryId: filters.categoryId })
  if (filters.assigneeId) and.push({ assignedTo: filters.assigneeId })
  if (filters.source) and.push(filters.source === "unknown" ? { source: null } : { source: filters.source })
  if (filters.status) and.push({ status: filters.status })
  if (filters.priority) and.push({ priority: filters.priority })
  if (filters.sla) and.push(slaTicketWhere(filters.sla, now, atRiskCutoff))
  if (filters.q) {
    and.push({
      OR: [
        { ticketNumber: { contains: filters.q, mode: "insensitive" } },
        { subject: { contains: filters.q, mode: "insensitive" } },
        { requesterName: { contains: filters.q, mode: "insensitive" } },
        { requesterEmail: { contains: filters.q, mode: "insensitive" } },
        { requesterPhone: { contains: filters.q, mode: "insensitive" } },
        { company: { is: { name: { contains: filters.q, mode: "insensitive" } } } },
        { company: { is: { email: { contains: filters.q, mode: "insensitive" } } } },
        { contact: { is: { fullName: { contains: filters.q, mode: "insensitive" } } } },
        { contact: { is: { email: { contains: filters.q, mode: "insensitive" } } } },
        { contact: { is: { phone: { contains: filters.q, mode: "insensitive" } } } },
      ],
    })
  }
  if (extra) and.push(...(Array.isArray(extra) ? extra : [extra]))
  if (options.includeEntitlementFilters !== false) {
    const entitlementMilestoneWhere = ticketEntitlementMilestoneWhere(filters)
    if (entitlementMilestoneWhere) {
      and.push({ entitlementMilestones: { some: entitlementMilestoneWhere } })
    }
  }

  return {
    organizationId: orgId,
    ...(and.length > 0 ? { AND: and } : {}),
  }
}

function entitlementMilestoneReportWhere(
  orgId: string,
  filters: ReportFilters,
  now: Date,
  atRiskCutoff: Date,
  extra?: Prisma.EntitlementTicketMilestoneWhereInput | Prisma.EntitlementTicketMilestoneWhereInput[],
): Prisma.EntitlementTicketMilestoneWhereInput {
  const and: Prisma.EntitlementTicketMilestoneWhereInput[] = [
    {
      ticket: {
        is: ticketReportWhere(
          orgId,
          withoutEntitlementFilters(filters),
          now,
          atRiskCutoff,
          undefined,
          { includeEntitlementFilters: false },
        ),
      },
    },
    {
      definition: {
        is: {
          entitlement: {
            is: entitlementReportWhere(orgId, filters),
          },
        },
      },
    },
  ]

  if (filters.milestoneType) and.push({ type: filters.milestoneType })
  if (filters.milestoneState) and.push({ status: filters.milestoneState })
  if (extra) and.push(...(Array.isArray(extra) ? extra : [extra]))

  return {
    organizationId: orgId,
    AND: and,
  }
}

function ageBucket(createdAt: Date, now: Date) {
  const ageMs = now.getTime() - createdAt.getTime()
  if (ageMs < DAY_MS) return "lt1d"
  if (ageMs < 3 * DAY_MS) return "1to3d"
  if (ageMs < 7 * DAY_MS) return "3to7d"
  return "gt7d"
}

function categoryDepth(categoryId: string, parentById: Map<string, string | null>) {
  let depth = 0
  let cursor = parentById.get(categoryId) || null
  const seen = new Set<string>([categoryId])
  while (cursor && !seen.has(cursor)) {
    depth += 1
    seen.add(cursor)
    cursor = parentById.get(cursor) || null
  }
  return depth
}

export const GET = withRls(async (req, { orgId }) => {

  try {
    const now = new Date()
    const atRiskCutoff = new Date(now.getTime() + 4 * HOUR_MS)
    const last30Days = new Date(now.getTime() - 30 * DAY_MS)
    const next24Hours = new Date(now.getTime() + DAY_MS)
    const next30Days = new Date(now.getTime() + 30 * DAY_MS)
    const throughputStart = startOfUtcDay(new Date(now.getTime() - 13 * DAY_MS))
    const filters = parseReportFilters(req, now)
    const entitlementBaseWhere = entitlementReportWhere(orgId, filters)

    const [configuredWonStages, configuredLostStages] = await Promise.all([
      wonStageNames(orgId),
      lostStageNames(orgId),
    ])

    const [
      companies,
      contacts,
      deals,
      leads,
      tasks,
      tickets,
      openTickets,
      overdueTasks,
    ] = await Promise.all([
      prisma.company.count({ where: { organizationId: orgId } }),
      prisma.contact.count({ where: { organizationId: orgId } }),
      prisma.deal.count({ where: { organizationId: orgId } }),
      prisma.lead.count({ where: { organizationId: orgId } }),
      prisma.task.count({ where: { organizationId: orgId } }),
      prisma.ticket.count({ where: { organizationId: orgId } }),
      prisma.ticket.count({
        where: { organizationId: orgId, status: { in: ACTIVE_TICKET_STATUSES } },
      }),
      prisma.task.count({
        where: {
          organizationId: orgId,
          status: { not: "completed" },
          dueDate: { lt: now },
        },
      }),
    ])

    // Pipeline by stage
    const dealsByStage = await prisma.deal.groupBy({
      by: ["stage"],
      where: { organizationId: orgId },
      _count: true,
      _sum: { valueAmount: true },
    })
    const stageSummary = new Map<string, { stage: string; count: number; value: number }>()
    for (const row of dealsByStage) {
      const stage = canonicalDealStage(row.stage, configuredWonStages, configuredLostStages)
      const existing = stageSummary.get(stage) ?? { stage, count: 0, value: 0 }
      existing.count += row._count
      existing.value += decimalToNumber(row._sum.valueAmount)
      stageSummary.set(stage, existing)
    }
    const normalizedDealStages = Array.from(stageSummary.values())
    const wonDealStage = stageSummary.get("WON")
    const totalRevenue = wonDealStage?.value ?? 0
    const wonDealsCount = wonDealStage?.count ?? 0
    const totalPipelineValue = normalizedDealStages
      .filter(stage => stage.stage !== "WON" && stage.stage !== "LOST")
      .reduce((sum, stage) => sum + stage.value, 0)

    // Tasks by status
    const tasksByStatus = await prisma.task.groupBy({
      by: ["status"],
      where: { organizationId: orgId },
      _count: true,
    })

    // Tickets by status
    const ticketsByStatus = await prisma.ticket.groupBy({
      by: ["status"],
      where: { organizationId: orgId },
      _count: true,
    })

    // Leads by status
    const leadsByStatus = await prisma.lead.groupBy({
      by: ["status"],
      where: { organizationId: orgId },
      _count: true,
    })

    const completedTasks = tasksByStatus.find((t: { status: string; _count: number }) => t.status === "completed")?._count || 0
    const totalTasks = tasks
    const taskCompletionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0

    const resolvedTickets = ticketsByStatus.find((t: { status: string; _count: number }) => t.status === "resolved")?._count || 0
    const closedTickets = ticketsByStatus.find((t: { status: string; _count: number }) => t.status === "closed")?._count || 0
    const ticketResolutionRate = tickets > 0 ? Math.round(((resolvedTickets + closedTickets) / tickets) * 100) : 0

    const [
      filteredActiveTickets,
      slaBreached,
      slaAtRisk,
      firstResponseBreached,
      pendingClosure,
      autoClosedLast30,
      reopenedTickets,
      backlogTickets,
      ticketsByCategoryId,
      legacyTicketsByCategory,
      ticketsBySource,
      ticketsByPriority,
      recentResolvedTickets,
      firstResponseTickets,
      activeByAgent,
      latestBreaches,
      closureQueue,
      throughputTickets,
      requesterTickets,
      activeSupportTerms,
      expiringSupportTerms30d,
      overdueEntitlementMilestones,
      atRiskEntitlementMilestones,
      missedEntitlementMilestones30d,
      entitlementReportRows,
      entitlementMilestoneReportRows,
      slaPolicyOptionsRaw,
    ] = await Promise.all([
      prisma.ticket.count({
        where: ticketReportWhere(orgId, filters, now, atRiskCutoff, { status: { in: ACTIVE_TICKET_STATUSES } }),
      }),
      prisma.ticket.count({
        where: ticketReportWhere(orgId, filters, now, atRiskCutoff, {
          status: { in: ACTIVE_TICKET_STATUSES },
          OR: [
            { slaDueAt: { lt: now } },
            { firstResponseAt: null, slaFirstResponseDueAt: { lt: now } },
          ],
        }),
      }),
      prisma.ticket.count({
        where: ticketReportWhere(orgId, filters, now, atRiskCutoff, {
          status: { in: ACTIVE_TICKET_STATUSES },
          slaDueAt: { gte: now, lte: atRiskCutoff },
        }),
      }),
      prisma.ticket.count({
        where: ticketReportWhere(orgId, filters, now, atRiskCutoff, {
          status: { in: ACTIVE_TICKET_STATUSES },
          firstResponseAt: null,
          slaFirstResponseDueAt: { lt: now },
        }),
      }),
      prisma.ticketClosureRequest.count({
        where: { organizationId: orgId, status: "pending", ticket: ticketReportWhere(orgId, filters, now, atRiskCutoff) },
      }),
      prisma.ticketClosureRequest.count({
        where: { organizationId: orgId, status: "expired", expiredAt: { gte: last30Days }, ticket: ticketReportWhere(orgId, filters, now, atRiskCutoff) },
      }),
      prisma.ticket.count({
        where: ticketReportWhere(orgId, filters, now, atRiskCutoff, { reopenCount: { gt: 0 } }),
      }),
      prisma.ticket.findMany({
        where: ticketReportWhere(orgId, filters, now, atRiskCutoff, { status: { in: ACTIVE_TICKET_STATUSES } }),
        select: { createdAt: true },
        take: PAGE_SIZE.EXPORT,
      }),
      prisma.ticket.groupBy({
        by: ["categoryId"],
        where: ticketReportWhere(orgId, filters, now, atRiskCutoff, { categoryId: { not: null } }),
        _count: true,
      }),
      prisma.ticket.groupBy({
        by: ["category"],
        where: ticketReportWhere(orgId, filters, now, atRiskCutoff, { categoryId: null }),
        _count: true,
      }),
      prisma.ticket.groupBy({
        by: ["source"],
        where: ticketReportWhere(orgId, filters, now, atRiskCutoff),
        _count: true,
      }),
      prisma.ticket.groupBy({
        by: ["priority"],
        where: ticketReportWhere(orgId, filters, now, atRiskCutoff),
        _count: true,
      }),
      prisma.ticket.findMany({
        where: ticketReportWhere(orgId, filters, now, atRiskCutoff, {
          status: { in: TERMINAL_TICKET_STATUSES },
          OR: [
            { resolvedAt: { gte: last30Days } },
            { closedAt: { gte: last30Days } },
          ],
        }),
        select: { assignedTo: true, createdAt: true, resolvedAt: true, closedAt: true },
        take: PAGE_SIZE.EXPORT,
      }),
      prisma.ticket.findMany({
        where: ticketReportWhere(orgId, filters, now, atRiskCutoff, {
          firstResponseAt: { not: null },
          createdAt: { gte: last30Days },
        }),
        select: { createdAt: true, firstResponseAt: true },
        take: PAGE_SIZE.EXPORT,
      }),
      prisma.ticket.groupBy({
        by: ["assignedTo"],
        where: ticketReportWhere(orgId, filters, now, atRiskCutoff, { status: { in: ACTIVE_TICKET_STATUSES } }),
        _count: true,
      }),
      prisma.ticket.findMany({
        where: ticketReportWhere(orgId, filters, now, atRiskCutoff, {
          status: { in: ACTIVE_TICKET_STATUSES },
          OR: [
            { slaDueAt: { lt: now } },
            { firstResponseAt: null, slaFirstResponseDueAt: { lt: now } },
          ],
        }),
        select: {
          id: true,
          ticketNumber: true,
          subject: true,
          status: true,
          priority: true,
          source: true,
          requesterName: true,
          requesterEmail: true,
          requesterPhone: true,
          slaDueAt: true,
          slaFirstResponseDueAt: true,
          assignedTo: true,
        },
        orderBy: [{ slaDueAt: "asc" }, { slaFirstResponseDueAt: "asc" }],
        take: 5,
      }),
      prisma.ticketClosureRequest.findMany({
        where: { organizationId: orgId, status: "pending", ticket: ticketReportWhere(orgId, filters, now, atRiskCutoff) },
        select: {
          id: true,
          channel: true,
          recipient: true,
          dueAt: true,
          ticket: {
            select: {
              id: true,
              ticketNumber: true,
              subject: true,
              priority: true,
              requesterName: true,
              requesterEmail: true,
              requesterPhone: true,
            },
          },
        },
        orderBy: { dueAt: "asc" },
        take: 5,
      }),
      prisma.ticket.findMany({
        where: ticketReportWhere(orgId, filters, now, atRiskCutoff, {
          OR: [
            { createdAt: { gte: throughputStart } },
            { resolvedAt: { gte: throughputStart } },
            { closedAt: { gte: throughputStart } },
          ],
        }),
        select: {
          createdAt: true,
          resolvedAt: true,
          closedAt: true,
        },
        take: PAGE_SIZE.EXPORT,
      }),
      prisma.ticket.findMany({
        where: ticketReportWhere(orgId, filters, now, atRiskCutoff),
        select: {
          status: true,
          source: true,
          requesterName: true,
          requesterEmail: true,
          requesterPhone: true,
          contact: { select: { fullName: true, email: true, phone: true } },
        },
        orderBy: { createdAt: "desc" },
        take: PAGE_SIZE.EXPORT,
      }),
      prisma.entitlement.count({
        where: entitlementReportWhere(orgId, filters, { status: "active" }),
      }),
      prisma.entitlement.count({
        where: entitlementReportWhere(orgId, filters, {
          status: "active",
          validTo: { gte: now, lte: next30Days },
        }),
      }),
      prisma.entitlementTicketMilestone.count({
        where: entitlementMilestoneReportWhere(orgId, filters, now, atRiskCutoff, {
          status: { in: OPEN_MILESTONE_STATUSES },
          dueAt: { lt: now },
        }),
      }),
      prisma.entitlementTicketMilestone.count({
        where: entitlementMilestoneReportWhere(orgId, filters, now, atRiskCutoff, {
          status: { in: OPEN_MILESTONE_STATUSES },
          dueAt: { gte: now, lte: next24Hours },
        }),
      }),
      prisma.entitlementTicketMilestone.count({
        where: entitlementMilestoneReportWhere(orgId, filters, now, atRiskCutoff, {
          status: "missed",
          missedAt: { gte: last30Days },
        }),
      }),
      prisma.entitlement.findMany({
        where: entitlementBaseWhere,
        select: {
          id: true,
          companyId: true,
          supportLevel: true,
          status: true,
          validTo: true,
          company: { select: { name: true } },
          slaPolicy: { select: { id: true, name: true } },
        },
        orderBy: [{ status: "asc" }, { validTo: "asc" }, { createdAt: "desc" }],
        take: 200,
      }),
      prisma.entitlementTicketMilestone.findMany({
        where: entitlementMilestoneReportWhere(orgId, filters, now, atRiskCutoff),
        select: {
          id: true,
          type: true,
          status: true,
          dueAt: true,
          missedAt: true,
          ticketId: true,
          ticket: {
            select: {
              id: true,
              ticketNumber: true,
              subject: true,
              status: true,
              priority: true,
              companyId: true,
            },
          },
          definition: {
            select: {
              entitlementId: true,
              entitlement: {
                select: {
                  id: true,
                  companyId: true,
                  supportLevel: true,
                  status: true,
                  company: { select: { name: true } },
                  slaPolicy: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
        orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
        take: PAGE_SIZE.EXPORT,
      }),
      prisma.slaPolicy.findMany({
        where: { organizationId: orgId, isActive: true },
        select: { id: true, name: true },
        orderBy: [{ isDefault: "desc" }, { name: "asc" }],
        take: 200,
      }),
    ])

    const categoryIdGroups = ticketsByCategoryId as TicketCategoryCountGroup[]
    const legacyCategoryGroups = legacyTicketsByCategory as TicketLegacyCategoryGroup[]
    const sourceGroups = ticketsBySource as TicketSourceGroup[]
    const priorityGroups = ticketsByPriority as TicketPriorityGroup[]
    const resolvedTicketRows = recentResolvedTickets as ResolvedTicketRow[]
    const firstResponseTicketRows = firstResponseTickets as FirstResponseTicketRow[]
    const activeAgentGroups = activeByAgent as TicketAssigneeGroup[]
    const latestBreachRows = latestBreaches as LatestBreachTicketRow[]
    const backlogRows = backlogTickets as BacklogTicketRow[]
    const throughputRows = throughputTickets as ThroughputTicketRow[]
    const requesterRows = requesterTickets as RequesterTicketRow[]
    const entitlementRows = entitlementReportRows as EntitlementReportRow[]
    const entitlementMilestoneRows = entitlementMilestoneReportRows as EntitlementMilestoneReportRow[]
    const slaPolicyOptions = slaPolicyOptionsRaw as SlaPolicyOptionRow[]

    const categoryIds = categoryIdGroups.map(group => group.categoryId).filter(Boolean) as string[]
    const categories = (await prisma.ticketCategory.findMany({
      where: categoryIds.length > 0
        ? { organizationId: orgId, OR: [{ isActive: true }, { id: { in: categoryIds } }] }
        : { organizationId: orgId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        slug: true,
        parentId: true,
        scope: true,
        isActive: true,
        isPortalVisible: true,
        parent: { select: { id: true, name: true, slug: true } },
        _count: { select: { children: true, tickets: true } },
      },
    })) as ServiceDeskCategory[]
    const categoryParentById = new Map(categories.map(category => [category.id, category.parentId]))
    const categoryCountById = new Map<string, number>()
    categoryIdGroups.forEach(group => {
      if (group.categoryId) categoryCountById.set(group.categoryId, group._count)
    })

    const assigneeIds = Array.from(new Set([
      ...resolvedTicketRows.map(ticket => ticket.assignedTo),
      ...activeAgentGroups.map(group => group.assignedTo),
      ...latestBreachRows.map(ticket => ticket.assignedTo),
    ].filter(Boolean))) as string[]
    const [assigneesRaw, serviceDeskCompaniesRaw] = await Promise.all([
      prisma.user.findMany({
        where: assigneeIds.length > 0
          ? { organizationId: orgId, OR: [{ isActive: true }, { id: { in: assigneeIds } }] }
          : { organizationId: orgId, isActive: true },
        select: { id: true, name: true, email: true },
        orderBy: { name: "asc" },
        take: 200,
      }),
      prisma.company.findMany({
        where: { organizationId: orgId },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
        take: 200,
      }),
    ])
    const assignees = assigneesRaw as ServiceDeskAssignee[]
    const serviceDeskCompanies = serviceDeskCompaniesRaw as ServiceDeskCompanyOption[]
    const assigneeById = new Map<string, ServiceDeskAssignee>(assignees.map(user => [user.id, user]))

    const backlogByAge = new Map([
      ["lt1d", 0],
      ["1to3d", 0],
      ["3to7d", 0],
      ["gt7d", 0],
    ])
    backlogRows.forEach(ticket => {
      const bucket = ageBucket(ticket.createdAt, now)
      backlogByAge.set(bucket, (backlogByAge.get(bucket) || 0) + 1)
    })

    const resolutionHours = resolvedTicketRows
      .map(ticket => {
        const finishedAt = ticket.closedAt || ticket.resolvedAt
        return finishedAt ? (finishedAt.getTime() - ticket.createdAt.getTime()) / HOUR_MS : null
      })
      .filter((value): value is number => value !== null && value >= 0)

    const firstResponseMinutes = firstResponseTicketRows
      .map(ticket => ticket.firstResponseAt ? (ticket.firstResponseAt.getTime() - ticket.createdAt.getTime()) / (60 * 1000) : null)
      .filter((value): value is number => value !== null && value >= 0)

    const activeByAgentMap = new Map<string, number>(activeAgentGroups.map(group => [group.assignedTo || "unassigned", group._count]))
    const resolvedByAgent = new Map<string, { count: number; hours: number[] }>()
    resolvedTicketRows.forEach(ticket => {
      const key = ticket.assignedTo || "unassigned"
      const finishedAt = ticket.closedAt || ticket.resolvedAt
      const hours = finishedAt ? (finishedAt.getTime() - ticket.createdAt.getTime()) / HOUR_MS : null
      const current = resolvedByAgent.get(key) || { count: 0, hours: [] }
      current.count += 1
      if (hours !== null && hours >= 0) current.hours.push(hours)
      resolvedByAgent.set(key, current)
    })

    const agentKeys = Array.from(new Set([...activeByAgentMap.keys(), ...resolvedByAgent.keys()]))
    const agentPerformance = agentKeys
      .map(key => {
        const user = key === "unassigned" ? null : assigneeById.get(key)
        const resolved = resolvedByAgent.get(key)
        return {
          agentId: key === "unassigned" ? null : key,
          agentName: user?.name || user?.email || "Unassigned",
          active: activeByAgentMap.get(key) || 0,
          resolved: resolved?.count || 0,
          avgResolutionHours: roundOne(average(resolved?.hours || [])),
        }
      })
      .sort((a, b) => (b.active + b.resolved) - (a.active + a.resolved))
      .slice(0, 8)

    const requesterStats = new Map<string, {
      key: string
      label: string
      email: string | null
      phone: string | null
      sourceCounts: Map<string, number>
      count: number
      active: number
    }>()
    requesterRows.forEach(ticket => {
      const email = ticket.requesterEmail || ticket.contact?.email || null
      const phone = ticket.requesterPhone || ticket.contact?.phone || null
      const name = ticket.requesterName || ticket.contact?.fullName || null
      const source = ticket.source || "unknown"
      const key = email || phone || name || `unknown:${source}`
      const current = requesterStats.get(key) || {
        key,
        label: name || email || phone || "Unknown",
        email,
        phone,
        sourceCounts: new Map<string, number>(),
        count: 0,
        active: 0,
      }
      current.count += 1
      if (ACTIVE_TICKET_STATUSES.includes(ticket.status)) current.active += 1
      current.sourceCounts.set(source, (current.sourceCounts.get(source) || 0) + 1)
      requesterStats.set(key, current)
    })
    const requesterBreakdown = Array.from(requesterStats.values())
      .map(row => ({
        key: row.key,
        label: row.label,
        email: row.email,
        phone: row.phone,
        source: Array.from(row.sourceCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "unknown",
        count: row.count,
        active: row.active,
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, 8)

    const serviceDeskByCategory: ServiceDeskCategoryRow[] = [
      ...categories.map(category => ({
        id: category.id,
        name: category.name,
        slug: category.slug,
        parentId: category.parentId,
        parentName: category.parent?.name || null,
        depth: categoryDepth(category.id, categoryParentById),
        scope: category.scope,
        isActive: category.isActive,
        isPortalVisible: category.isPortalVisible,
        childrenCount: category._count.children,
        count: categoryCountById.get(category.id) || 0,
      })),
      ...legacyCategoryGroups.map(group => ({
        id: null,
        name: group.category || "Uncategorized",
        slug: group.category || null,
        parentId: null,
        parentName: null,
        depth: 0,
        scope: "ticket",
        isActive: true,
        isPortalVisible: false,
        childrenCount: 0,
        count: group._count,
      })),
    ]
      .sort((a, b) => b.count - a.count || a.depth - b.depth || a.name.localeCompare(b.name))
      .slice(0, 12)

    const throughputMap = new Map<string, { date: string; created: number; resolved: number; closed: number }>()
    for (let dayIndex = 0; dayIndex < 14; dayIndex += 1) {
      const date = new Date(throughputStart.getTime() + dayIndex * DAY_MS)
      const key = dayKey(date)
      throughputMap.set(key, { date: key, created: 0, resolved: 0, closed: 0 })
    }
    throughputRows.forEach(ticket => {
      const createdKey = dayKey(ticket.createdAt)
      const createdBucket = throughputMap.get(createdKey)
      if (createdBucket) createdBucket.created += 1

      if (ticket.resolvedAt) {
        const resolvedBucket = throughputMap.get(dayKey(ticket.resolvedAt))
        if (resolvedBucket) resolvedBucket.resolved += 1
      }

      if (ticket.closedAt) {
        const closedBucket = throughputMap.get(dayKey(ticket.closedAt))
        if (closedBucket) closedBucket.closed += 1
      }
    })

    const isOpenMilestone = (status: string) => OPEN_MILESTONE_STATUSES.includes(status)
    const isMilestoneOverdue = (milestone: EntitlementMilestoneReportRow) =>
      isOpenMilestone(milestone.status) && milestone.dueAt < now
    const isMilestoneAtRisk = (milestone: EntitlementMilestoneReportRow) =>
      isOpenMilestone(milestone.status) && milestone.dueAt >= now && milestone.dueAt <= next24Hours
    const isMilestoneMissed30d = (milestone: EntitlementMilestoneReportRow) =>
      milestone.status === "missed" && Boolean(milestone.missedAt && milestone.missedAt >= last30Days)

    const companyRiskByEntitlement = new Map<string, {
      entitlementId: string
      companyId: string
      companyName: string
      supportLevel: string
      slaPolicyName: string
      status: string
      activeTicketIds: Set<string>
      overdue: number
      atRisk: number
      missed30d: number
      nextDueAt: Date | null
      sampleTicketId: string | null
    }>()
    entitlementRows.forEach(entitlement => {
      companyRiskByEntitlement.set(entitlement.id, {
        entitlementId: entitlement.id,
        companyId: entitlement.companyId,
        companyName: entitlement.company.name,
        supportLevel: entitlement.supportLevel,
        slaPolicyName: entitlement.slaPolicy.name,
        status: entitlement.status,
        activeTicketIds: new Set<string>(),
        overdue: 0,
        atRisk: 0,
        missed30d: 0,
        nextDueAt: null,
        sampleTicketId: null,
      })
    })

    const supportLevelStats = new Map(SUPPORT_LEVELS.map(level => [level, {
      supportLevel: level,
      terms: 0,
      activeTerms: 0,
      ticketIds: new Set<string>(),
      overdue: 0,
      atRisk: 0,
      missed30d: 0,
    }]))
    entitlementRows.forEach(entitlement => {
      const levelStats = supportLevelStats.get(entitlement.supportLevel as typeof SUPPORT_LEVELS[number])
      if (!levelStats) return
      levelStats.terms += 1
      if (entitlement.status === "active") levelStats.activeTerms += 1
    })

    entitlementMilestoneRows.forEach(milestone => {
      const entitlement = milestone.definition.entitlement
      const companyRisk = companyRiskByEntitlement.get(entitlement.id) || {
        entitlementId: entitlement.id,
        companyId: entitlement.companyId,
        companyName: entitlement.company.name,
        supportLevel: entitlement.supportLevel,
        slaPolicyName: entitlement.slaPolicy.name,
        status: entitlement.status,
        activeTicketIds: new Set<string>(),
        overdue: 0,
        atRisk: 0,
        missed30d: 0,
        nextDueAt: null,
        sampleTicketId: null,
      }
      const levelStats = supportLevelStats.get(entitlement.supportLevel as typeof SUPPORT_LEVELS[number])
      if (ACTIVE_TICKET_STATUSES.includes(milestone.ticket.status)) {
        companyRisk.activeTicketIds.add(milestone.ticketId)
        levelStats?.ticketIds.add(milestone.ticketId)
      }

      if (isMilestoneOverdue(milestone)) {
        companyRisk.overdue += 1
        if (!companyRisk.sampleTicketId) companyRisk.sampleTicketId = milestone.ticket.id
        if (levelStats) levelStats.overdue += 1
      }
      if (isMilestoneAtRisk(milestone)) {
        companyRisk.atRisk += 1
        if (!companyRisk.sampleTicketId) companyRisk.sampleTicketId = milestone.ticket.id
        if (levelStats) levelStats.atRisk += 1
      }
      if (isMilestoneMissed30d(milestone)) {
        companyRisk.missed30d += 1
        if (!companyRisk.sampleTicketId) companyRisk.sampleTicketId = milestone.ticket.id
        if (levelStats) levelStats.missed30d += 1
      }
      if (
        isOpenMilestone(milestone.status) &&
        (!companyRisk.nextDueAt || milestone.dueAt < companyRisk.nextDueAt)
      ) {
        companyRisk.nextDueAt = milestone.dueAt
      }
      companyRiskByEntitlement.set(entitlement.id, companyRisk)
    })

    const companyRiskRows = Array.from(companyRiskByEntitlement.values())
      .map(row => ({
        entitlementId: row.entitlementId,
        companyId: row.companyId,
        companyName: row.companyName,
        supportLevel: row.supportLevel,
        slaPolicyName: row.slaPolicyName,
        status: row.status,
        activeTickets: row.activeTicketIds.size,
        overdue: row.overdue,
        atRisk: row.atRisk,
        missed30d: row.missed30d,
        nextDueAt: row.nextDueAt,
        sampleTicketId: row.sampleTicketId,
        riskScore: row.overdue * 3 + row.missed30d * 2 + row.atRisk,
      }))
      .sort((a, b) => b.riskScore - a.riskScore || a.companyName.localeCompare(b.companyName))
      .slice(0, 10)

    const supportLevelComparison = Array.from(supportLevelStats.values()).map(row => ({
      supportLevel: row.supportLevel,
      terms: row.terms,
      activeTerms: row.activeTerms,
      tickets: row.ticketIds.size,
      overdue: row.overdue,
      atRisk: row.atRisk,
      missed30d: row.missed30d,
    }))

    const milestoneDrilldown = entitlementMilestoneRows
      .filter(milestone => isMilestoneOverdue(milestone) || isMilestoneAtRisk(milestone) || isMilestoneMissed30d(milestone))
      .slice(0, 50)
      .map(milestone => ({
        id: milestone.id,
        ticketId: milestone.ticket.id,
        ticketNumber: milestone.ticket.ticketNumber,
        subject: milestone.ticket.subject,
        priority: milestone.ticket.priority,
        companyId: milestone.definition.entitlement.companyId,
        companyName: milestone.definition.entitlement.company.name,
        supportLevel: milestone.definition.entitlement.supportLevel,
        slaPolicyName: milestone.definition.entitlement.slaPolicy.name,
        milestoneType: milestone.type,
        milestoneStatus: milestone.status,
        dueAt: milestone.dueAt,
        missedAt: milestone.missedAt,
      }))

    // Top 10 companies by revenue (from contracts)
    const topCompanies = await prisma.company.findMany({
      where: { organizationId: orgId },
      select: {
        id: true,
        name: true,
        contracts: {
          where: { organizationId: orgId },
          select: { valueAmount: true },
        },
      },
      take: 100,
    })

    const topCompaniesByRevenue = topCompanies
      .map((c: { name: string; contracts: { valueAmount: unknown }[] }) => ({
        name: c.name,
        revenue: c.contracts.reduce((s: number, ct: { valueAmount: unknown }) => s + decimalToNumber(ct.valueAmount), 0),
      }))
      .filter((c: { name: string; revenue: number }) => c.revenue > 0)
      .sort((a: { revenue: number }, b: { revenue: number }) => b.revenue - a.revenue)
      .slice(0, 10)

    // CSAT (Customer Satisfaction) from ticket ratings
    const csatData = await prisma.ticket.aggregate({
      where: { organizationId: orgId, satisfactionRating: { not: null } },
      _avg: { satisfactionRating: true },
      _count: { satisfactionRating: true },
    })
    const csatByRating = await prisma.ticket.groupBy({
      by: ["satisfactionRating"],
      where: { organizationId: orgId, satisfactionRating: { not: null } },
      _count: true,
    })

    // Financial overview from contracts
    const contractsData = await prisma.contract.findMany({
      where: { organizationId: orgId },
      select: { valueAmount: true, status: true },
      take: PAGE_SIZE.EXPORT,
    })
    const totalContractRevenue = contractsData
      .filter((c: { status: string; valueAmount: unknown }) => c.status === "active")
      .reduce((s: number, c: { status: string; valueAmount: unknown }) => s + decimalToNumber(c.valueAmount), 0)

    return NextResponse.json({
      success: true,
      data: {
        overview: {
          companies,
          contacts,
          deals,
          leads,
          tasks,
          tickets,
          totalRevenue,
          openTickets,
          overdueTasks,
        },
        revenue: {
          totalRevenue,
          wonDealsCount,
          avgDealSize: wonDealsCount > 0 ? Math.round(totalRevenue / wonDealsCount) : 0,
        },
        pipeline: {
          stages: normalizedDealStages,
          totalPipelineValue,
        },
        tasks: {
          total: tasks,
          byStatus: tasksByStatus.map((t: { status: string; _count: number }) => ({ status: t.status, count: t._count })),
          completionRate: taskCompletionRate,
          overdue: overdueTasks,
        },
        tickets: {
          total: tickets,
          byStatus: ticketsByStatus.map((t: { status: string; _count: number }) => ({ status: t.status, count: t._count })),
          resolutionRate: ticketResolutionRate,
          open: openTickets,
        },
        serviceDesk: {
          totals: {
            active: filteredActiveTickets,
            slaBreached,
            slaAtRisk,
            firstResponseBreached,
            pendingClosure,
            reopened: reopenedTickets,
            autoClosedLast30,
            slaComplianceRate: filteredActiveTickets > 0 ? Math.max(0, Math.round(((filteredActiveTickets - slaBreached) / filteredActiveTickets) * 100)) : 100,
            avgResolutionHours: roundOne(average(resolutionHours)),
            avgFirstResponseMinutes: roundOne(average(firstResponseMinutes)),
          },
          backlogAging: Array.from(backlogByAge.entries()).map(([bucket, count]) => ({ bucket, count })),
          byCategory: serviceDeskByCategory,
          bySource: sourceGroups
            .map(source => ({ source: source.source || "unknown", count: source._count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 8),
          byPriority: priorityGroups
            .map(priority => ({ priority: priority.priority || "medium", count: priority._count }))
            .sort((a, b) => b.count - a.count),
          requesterBreakdown,
          throughput: Array.from(throughputMap.values()),
          agentPerformance,
          entitlements: {
            totals: {
              activeSupportTerms,
              expiringSupportTerms30d,
              overdueMilestones: overdueEntitlementMilestones,
              atRiskMilestones: atRiskEntitlementMilestones,
              missedMilestones30d: missedEntitlementMilestones30d,
            },
            companyRisk: companyRiskRows.map(row => ({
              entitlementId: row.entitlementId,
              companyId: row.companyId,
              companyName: row.companyName,
              supportLevel: row.supportLevel,
              slaPolicyName: row.slaPolicyName,
              status: row.status,
              activeTickets: row.activeTickets,
              overdue: row.overdue,
              atRisk: row.atRisk,
              missed30d: row.missed30d,
              nextDueAt: row.nextDueAt,
              sampleTicketId: row.sampleTicketId,
            })),
            supportLevelComparison,
            milestoneDrilldown,
          },
          filterOptions: {
            companies: serviceDeskCompanies.map(company => ({ id: company.id, name: company.name })),
            categories: categories.map(category => ({
              id: category.id,
              name: category.name,
              slug: category.slug,
              parentId: category.parentId,
              parentName: category.parent?.name || null,
              depth: categoryDepth(category.id, categoryParentById),
              scope: category.scope,
              isActive: category.isActive,
              isPortalVisible: category.isPortalVisible,
              childrenCount: category._count.children,
              count: categoryCountById.get(category.id) || 0,
            })),
            agents: assignees.map(user => ({ id: user.id, name: user.name, email: user.email })),
            sources: Array.from(new Set([
              ...DEFAULT_TICKET_SOURCES,
              ...sourceGroups.map(source => source.source || "unknown"),
            ])),
            statuses: FILTERABLE_TICKET_STATUSES,
            priorities: DEFAULT_TICKET_PRIORITIES,
            slaStates: SERVICE_DESK_SLA_STATES,
            slaPolicies: slaPolicyOptions.map(policy => ({ id: policy.id, name: policy.name })),
            supportLevels: [...SUPPORT_LEVELS],
            entitlementStatuses: [...ENTITLEMENT_STATUSES],
            milestoneTypes: [...MILESTONE_TYPES],
            milestoneStates: [...MILESTONE_STATUSES],
          },
          latestBreaches: latestBreachRows.map(ticket => {
            const assignee = ticket.assignedTo ? assigneeById.get(ticket.assignedTo) : null
            return {
              id: ticket.id,
              ticketNumber: ticket.ticketNumber,
              subject: ticket.subject,
              status: ticket.status,
              priority: ticket.priority,
              source: ticket.source || null,
              requesterName: ticket.requesterName || null,
              requesterEmail: ticket.requesterEmail || null,
              requesterPhone: ticket.requesterPhone || null,
              dueAt: ticket.slaDueAt || ticket.slaFirstResponseDueAt,
              assigneeName: assignee?.name || assignee?.email || null,
            }
          }),
          closureQueue,
        },
        leads: {
          total: leads,
          byStatus: leadsByStatus.map((l: { status: string; _count: number }) => ({ status: l.status, count: l._count })),
          conversionRate: leads > 0 ? Math.round((leadsByStatus.find((l: { status: string; _count: number }) => l.status === "converted")?._count || 0) / leads * 100) : 0,
        },
        topCompanies: topCompaniesByRevenue,
        leadFunnel: leadsByStatus.map((lead: { status: string; _count: number }) => ({
          status: lead.status,
          count: lead._count,
        })),
        financial: {
          monthlyRevenue: totalContractRevenue,
          wonDealsRevenue: totalRevenue,
          totalContracts: contractsData.length,
          activeContracts: contractsData.filter((c: { status: string; valueAmount: unknown }) => c.status === "active" || c.status === "Active").length,
        },
        csat: {
          average: csatData._avg.satisfactionRating ? Math.round(csatData._avg.satisfactionRating * 10) / 10 : 0,
          totalRatings: csatData._count.satisfactionRating,
          byRating: csatByRating.map((r: { satisfactionRating: number | null; _count: number }) => ({ rating: r.satisfactionRating, count: r._count })),
        },
      },
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
