import { prisma } from "@/lib/prisma"
import { canRead, checkPermission, type Module, type Role } from "@/lib/permissions"
import { isManagerOrAbove } from "@/lib/constants"
import { hasModule, LEGACY_MODULE_MAP, type ModuleId } from "@/lib/modules"
import { resolveEffectiveTimezone } from "@/lib/timezone"
import { readSection } from "@/lib/ai/voice/section-reader"
import { SECTION_DESCRIPTORS } from "@/lib/ai/voice/section-registry"
import { SECTION_GUIDE } from "@/lib/ai/voice/section-guide"
import { VOICE_SECTIONS } from "@/lib/ai/voice/sections"
import { voiceScopedWhere } from "@/lib/ai/voice/scoped-where"
import { isNavItemEnabled, navItems, navItemPathname } from "@/lib/nav-items"
import { buildSalesPeriodSummary } from "@/lib/ai/voice/summaries"
import { computeSalesLeaderboard } from "@/lib/leaderboard/sales"
import { computeMtmLeaderboard } from "@/lib/leaderboard/mtm"
import { computeTicketsLeaderboard } from "@/lib/leaderboard/tickets"
import { computeProjectsLeaderboard } from "@/lib/leaderboard/projects"
import { computeTasksLeaderboard } from "@/lib/leaderboard/tasks"
import { loadLeaderboardConfig } from "@/lib/leaderboard/config-loader"
import {
  GROUP_TO_MODULE,
  periodStart,
  type LeaderboardGroup,
  type LeaderboardPeriod,
  type NormalizedAgent,
} from "@/lib/leaderboard/types"
import { canViewGroup, visibleGroups } from "@/lib/leaderboard/visibility"
import { resolveAnalyticsPeriod, type ResolvedAnalyticsPeriod } from "./analytics-period"
import {
  CHAT_ANALYTICS_TOOL_SCHEMAS,
  isChatAnalyticsToolName,
} from "./chat-analytics-tools"

export type ChatAnalyticsContext = {
  orgId: string
  userId: string
  role: Role
  timezone: string
  now: Date
  org: { plan: string; addons?: string[]; modules?: Record<string, boolean> }
}

export type ChatAnalyticsResult = {
  success: boolean
  data?: Record<string, unknown>
  error?: string
  requiresApproval?: false
  pendingActionId?: never
}

type MetricAccess = {
  permission: Module
  module: ModuleId
  definition: string
  basisField: string
}

const PERIOD_METRIC_ACCESS: Record<string, MetricAccess> = {
  leads_created: {
    permission: "leads", module: "sales", basisField: "Lead.createdAt",
    definition: "Lead records created during the reporting period",
  },
  deals_created: {
    permission: "deals", module: "sales", basisField: "Deal.createdAt",
    definition: "Deal records created during the reporting period (not deals won)",
  },
  sales_won: {
    permission: "deals", module: "sales", basisField: "PipelineStageTransition.transitionedAt (transitionType=won)",
    definition: "Deals with a recorded transition into a won stage during the reporting period",
  },
  quotes_created: {
    permission: "offers", module: "sales", basisField: "Quote.createdAt",
    definition: "Commercial proposals (CPQ quotes) created during the reporting period",
  },
  quotes_sent: {
    permission: "offers", module: "sales", basisField: "Quote.sentAt",
    definition: "Commercial proposals whose sent timestamp falls in the reporting period",
  },
  quotes_accepted: {
    permission: "offers", module: "sales", basisField: "Quote.acceptedAt",
    definition: "Commercial proposals whose accepted timestamp falls in the reporting period",
  },
  tasks_completed: {
    permission: "tasks", module: "crm", basisField: "Task.completedAt",
    definition: "CRM tasks completed during the reporting period",
  },
  tickets_resolved: {
    permission: "tickets", module: "support", basisField: "Ticket.resolvedAt",
    definition: "Support tickets resolved during the reporting period",
  },
}

const RANKING_METRIC_ACCESS: Record<string, MetricAccess> = {
  won_deals: {
    permission: "deals", module: "sales", basisField: "PipelineStageTransition.transitionedAt + actorUserId",
    definition: "Recorded won-deal transitions attributed to the user who performed the transition",
  },
  answered_leads_by_call: {
    permission: "leads", module: "sales", basisField: "CallLog.startedAt + userId + leadId (direction=outbound, callMode=human, wasAnswered=true)",
    definition: "Distinct leads reached through an answered outbound human call during the period, attributed to the call user",
  },
  created_leads: {
    permission: "leads", module: "sales", basisField: "Lead.createdAt + assignedTo",
    definition: "New leads created in the period, grouped by their current assignee (not by creator)",
  },
  completed_tasks: {
    permission: "tasks", module: "crm", basisField: "Task.completedAt + assignedTo",
    definition: "CRM tasks completed in the period, attributed to their assignee",
  },
  resolved_tickets: {
    permission: "tickets", module: "support", basisField: "Ticket.resolvedAt + assignedTo",
    definition: "Tickets resolved in the period, attributed to their assignee",
  },
  created_quotes: {
    permission: "offers", module: "sales", basisField: "Quote.createdAt + createdBy",
    definition: "Commercial proposals created in the period, attributed to their creator",
  },
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/** User timezone wins; then Organization.settings.timezone; finally UTC. */
export async function loadChatAnalyticsTimezone(orgId: string, userId: string): Promise<string> {
  const [user, organization] = await Promise.all([
    prisma.user.findFirst({
      where: { id: userId, organizationId: orgId },
      select: { timezone: true },
    }),
    prisma.organization.findUnique({
      where: { id: orgId },
      select: { settings: true },
    }),
  ])
  const settings = jsonObject(organization?.settings)
  return resolveEffectiveTimezone({
    userTimezone: user?.timezone,
    orgTimezone: typeof settings.timezone === "string" ? settings.timezone : null,
  })
}

function requireMetricAccess(ctx: ChatAnalyticsContext, access: MetricAccess): ChatAnalyticsResult | null {
  if (!canRead(ctx.role, access.permission)) {
    return { success: false, error: "This CRM metric is not permitted for your role." }
  }
  if (!hasModule(ctx.org, access.module)) {
    return { success: false, error: `The ${access.module} module is not enabled for this organization.` }
  }
  return null
}

function requireOrgWideAnalyticsAccess(ctx: ChatAnalyticsContext): ChatAnalyticsResult | null {
  if (isManagerOrAbove(ctx.role)) return null
  // Period totals and cross-employee rankings aggregate records beyond the
  // normal own/shared record filters used by list APIs. Until every aggregate
  // can apply those entity-specific filters exactly, fail closed instead of
  // leaking tenant-wide totals or colleague performance to a lower role.
  return { success: false, error: "Organization-wide CRM analytics require a manager role." }
}

function periodPayload(period: ResolvedAnalyticsPeriod) {
  return {
    preset: period.period,
    label: period.label,
    timezone: period.timezone,
    fromInclusive: period.from.toISOString(),
    toExclusive: period.toExclusive.toISOString(),
    dateFrom: period.dateFrom,
    dateToInclusive: period.dateTo,
  }
}

function timestampRange(period: ResolvedAnalyticsPeriod) {
  return { gte: period.from, lt: period.toExclusive }
}

async function periodReport(
  input: Record<string, unknown>,
  ctx: ChatAnalyticsContext,
): Promise<ChatAnalyticsResult> {
  const orgWideDenied = requireOrgWideAnalyticsAccess(ctx)
  if (orgWideDenied) return orgWideDenied
  const metric = String(input.metric)
  const access = PERIOD_METRIC_ACCESS[metric]
  const denied = requireMetricAccess(ctx, access)
  if (denied) return denied

  const period = resolveAnalyticsPeriod(input as never, ctx.now, ctx.timezone)
  const common = {
    kind: "crm_period_report",
    metric,
    metricDefinition: access.definition,
    basisField: access.basisField,
    period: periodPayload(period),
  }

  if (metric === "leads_created" || metric === "deals_created" || metric === "quotes_created") {
    const section = metric === "leads_created" ? "leads" : metric === "deals_created" ? "deals" : "quotes"
    const report = await readSection(
      ctx.orgId,
      section,
      ctx.now,
      "status",
      { from: period.from, toExclusive: period.toExclusive },
    )
    if (!report) return { success: false, error: "This CRM report is not available." }
    return {
      success: true,
      data: {
        ...common,
        value: report.total,
        byStatus: report.byStatus,
      },
    }
  }

  if (metric === "sales_won") {
    const report = await buildSalesPeriodSummary(ctx.orgId, period.from, period.toExclusive, period.label)
    const caveats = report.wonDealsWithoutHistory > 0
      ? [`${report.wonDealsWithoutHistory} currently-won deals have no recorded won transition and cannot be assigned to this period.`]
      : []
    return {
      success: true,
      data: {
        ...common,
        value: report.wonCount,
        lostCount: report.lostCount,
        money: report.money,
        coverage: { wonDealsWithoutHistory: report.wonDealsWithoutHistory },
        caveats,
      },
    }
  }

  const range = timestampRange(period)
  let value = 0
  if (metric === "quotes_sent") {
    value = await prisma.quote.count({ where: voiceScopedWhere(ctx.orgId, { sentAt: range }) })
  } else if (metric === "quotes_accepted") {
    value = await prisma.quote.count({ where: voiceScopedWhere(ctx.orgId, { acceptedAt: range }) })
  } else if (metric === "tasks_completed") {
    value = await prisma.task.count({ where: voiceScopedWhere(ctx.orgId, { deletedAt: null, completedAt: range }) })
  } else if (metric === "tickets_resolved") {
    value = await prisma.ticket.count({ where: voiceScopedWhere(ctx.orgId, { resolvedAt: range }) })
  }

  return { success: true, data: { ...common, value } }
}

type GroupRow = { personId: string | null; count: number }

function groupCount(row: Record<string, unknown>): number {
  const count = row._count
  if (typeof count === "number") return count
  if (count && typeof count === "object" && "_all" in count) return Number((count as { _all: unknown })._all ?? 0)
  return 0
}

async function rankingGroups(
  metric: string,
  period: ResolvedAnalyticsPeriod,
  orgId: string,
): Promise<{ groups: GroupRow[]; caveats: string[]; coverage: Record<string, unknown> }> {
  const range = timestampRange(period)
  let raw: Array<Record<string, unknown>> = []
  let personField = "assignedTo"
  const caveats: string[] = []
  const coverage: Record<string, unknown> = {
    population: "employees with at least one recorded matching event in the period",
  }

  if (metric === "won_deals") {
    personField = "actorUserId"
    raw = await prisma.pipelineStageTransition.groupBy({
      by: ["actorUserId"],
      where: voiceScopedWhere(orgId, { transitionType: "won", transitionedAt: range }),
      _count: { _all: true },
    }) as unknown as Array<Record<string, unknown>>
    const summary = await buildSalesPeriodSummary(orgId, period.from, period.toExclusive, period.label)
    coverage.wonDealsWithoutHistory = summary.wonDealsWithoutHistory
    if (summary.wonDealsWithoutHistory > 0) {
      caveats.push(`${summary.wonDealsWithoutHistory} currently-won deals have no recorded won transition and are excluded from employee ranking.`)
    }
    caveats.push("A won transition is attributed to the user who moved the deal into the won stage; automated transitions remain unattributed.")
  } else if (metric === "answered_leads_by_call") {
    personField = "userId"
    const calls = await prisma.callLog.groupBy({
      by: ["userId", "leadId"],
      where: voiceScopedWhere(orgId, {
        direction: "outbound",
        callMode: "human",
        wasAnswered: true,
        startedAt: range,
        userId: { not: null },
        leadId: { not: null },
      }),
      _count: { _all: true },
    }) as unknown as Array<Record<string, unknown>>
    const distinctByUser = new Map<string, number>()
    for (const call of calls) {
      const id = typeof call.userId === "string" ? call.userId : null
      if (id) distinctByUser.set(id, (distinctByUser.get(id) ?? 0) + 1)
    }
    raw = [...distinctByUser.entries()].map(([userId, count]) => ({ userId, _count: { _all: count } }))
    caveats.push("This covers answered outbound human calls linked to leads. It does not claim complete contact coverage across inbox, email, meetings, AI calls, or unlinked calls.")
  } else if (metric === "created_leads") {
    raw = await prisma.lead.groupBy({
      by: ["assignedTo"],
      where: voiceScopedWhere(orgId, { createdAt: range }),
      _count: { _all: true },
    }) as unknown as Array<Record<string, unknown>>
    caveats.push("New leads are attributed to their current assignee, because historical assignment-at-creation is not stored here.")
  } else if (metric === "completed_tasks") {
    raw = await prisma.task.groupBy({
      by: ["assignedTo"],
      where: voiceScopedWhere(orgId, { deletedAt: null, completedAt: range }),
      _count: { _all: true },
    }) as unknown as Array<Record<string, unknown>>
  } else if (metric === "resolved_tickets") {
    raw = await prisma.ticket.groupBy({
      by: ["assignedTo"],
      where: voiceScopedWhere(orgId, { resolvedAt: range }),
      _count: { _all: true },
    }) as unknown as Array<Record<string, unknown>>
  } else if (metric === "created_quotes") {
    personField = "createdBy"
    raw = await prisma.quote.groupBy({
      by: ["createdBy"],
      where: voiceScopedWhere(orgId, { createdAt: range }),
      _count: { _all: true },
    }) as unknown as Array<Record<string, unknown>>
    caveats.push("This ranks quote creators. Quote.sentAt does not record which user sent the proposal.")
  }

  return {
    groups: raw.map((row) => ({
      personId: typeof row[personField] === "string" ? row[personField] as string : null,
      count: groupCount(row),
    })),
    caveats,
    coverage,
  }
}

async function crmRanking(
  input: Record<string, unknown>,
  ctx: ChatAnalyticsContext,
): Promise<ChatAnalyticsResult> {
  const orgWideDenied = requireOrgWideAnalyticsAccess(ctx)
  if (orgWideDenied) return orgWideDenied
  const metric = String(input.metric)
  const access = RANKING_METRIC_ACCESS[metric]
  const denied = requireMetricAccess(ctx, access)
  if (denied) return denied

  const period = resolveAnalyticsPeriod(input as never, ctx.now, ctx.timezone)
  const { groups, caveats, coverage } = await rankingGroups(metric, period, ctx.orgId)
  const personIds = [...new Set(groups.map((row) => row.personId).filter((id): id is string => Boolean(id)))]
  const users = (personIds.length
    ? await prisma.user.findMany({
        where: voiceScopedWhere(ctx.orgId, { id: { in: personIds }, isActive: true }),
        select: { id: true, name: true },
      })
    : []) as Array<{ id: string; name: string }>
  const nameById = new Map<string, string>(users.map((user) => [user.id, user.name]))
  let unattributed = 0
  const rows: Array<{ name: string; count: number }> = []
  for (const group of groups) {
    const name = group.personId ? nameById.get(group.personId) : null
    if (!name) unattributed += group.count
    else rows.push({ name, count: group.count })
  }

  const direction = input.direction === "bottom" ? "bottom" : "top"
  if (direction === "bottom") {
    caveats.push("Bottom means the lowest non-zero recorded participant. Active employees with zero matching events are not in this event-derived population, so this is not an absolute least-performer claim.")
  }
  rows.sort((a, b) => direction === "top"
    ? b.count - a.count || a.name.localeCompare(b.name)
    : a.count - b.count || a.name.localeCompare(b.name))
  const limit = typeof input.limit === "number" ? input.limit : 5

  return {
    success: true,
    data: {
      kind: "crm_ranking",
      metric,
      metricDefinition: access.definition,
      basisField: access.basisField,
      period: periodPayload(period),
      direction,
      absoluteLeast: direction === "bottom" ? false : undefined,
      rows: rows.slice(0, limit),
      unattributed,
      coverage,
      caveats,
    },
  }
}

async function kpiArena(
  input: Record<string, unknown>,
  ctx: ChatAnalyticsContext,
): Promise<ChatAnalyticsResult> {
  const group = input.group as LeaderboardGroup
  const period = input.period as LeaderboardPeriod
  if (!hasModule(ctx.org, "analytics")) {
    return { success: false, error: "The analytics module is not enabled for this organization." }
  }
  if (!canViewGroup(ctx.role, group)) {
    return { success: false, error: "This KPI Arena group is not permitted for your role." }
  }
  const moduleId = GROUP_TO_MODULE[group] as ModuleId
  if (!hasModule(ctx.org, moduleId)) {
    return { success: false, error: `The ${moduleId} module is not enabled for this organization.` }
  }

  const config = await loadLeaderboardConfig(ctx.orgId)
  let agents: NormalizedAgent[]
  if (group === "sales") agents = await computeSalesLeaderboard(ctx.orgId, period, ctx.now, ctx.timezone)
  else if (group === "mtm") agents = await computeMtmLeaderboard(ctx.orgId, periodStart(period, ctx.now, ctx.timezone), ctx.now, config.mtmWeights, config.statusThresholds)
  else if (group === "tickets") agents = await computeTicketsLeaderboard(ctx.orgId, period, ctx.now, config.statusThresholds, ctx.timezone)
  else if (group === "projects") agents = await computeProjectsLeaderboard(ctx.orgId, period, ctx.now, config.statusThresholds, ctx.timezone)
  else agents = await computeTasksLeaderboard(ctx.orgId, period, ctx.now, config.statusThresholds, ctx.timezone)

  const sortBy = input.sortBy === "volume" ? "volume" : "kpi"
  const direction = input.direction === "bottom" ? "bottom" : "top"
  const sorted = [...agents].sort((a, b) => {
    const aValue = sortBy === "volume" ? a.volume : a.attainmentPct
    const bValue = sortBy === "volume" ? b.volume : b.attainmentPct
    return direction === "top" ? bValue - aValue || a.rank - b.rank : aValue - bValue || b.rank - a.rank
  })
  const limit = typeof input.limit === "number" ? input.limit : 5
  const appliedPeriod = group === "sales" ? "current_quarter" : period

  return {
    success: true,
    data: {
      kind: "kpi_arena_ranking",
      source: "KPI Arena",
      group,
      requestedPeriod: period,
      appliedPeriod,
      timezone: ctx.timezone,
      periodSemantics: group === "sales"
        ? "Sales KPI is quota-based and always uses the current quarter."
        : "KPI Arena day/week are rolling windows; month/quarter/year are calendar-to-date in the Arena engine.",
      sortBy,
      direction,
      rows: sorted.slice(0, limit).map((agent) => ({
        name: agent.name,
        rank: agent.rank,
        volume: agent.volume,
        volumeFormat: agent.volumeFormat,
        currency: agent.currency,
        attainmentPct: agent.attainmentPct,
        status: agent.status,
        metrics: agent.metrics,
      })),
    },
  }
}

function normalizedSectionKey(value: string): string {
  const normalized = value.toLocaleLowerCase("ru-RU").trim().replace(/[‐‑‒–—]/g, "-")
  const aliases: Record<string, string> = {
    "kpi arena": "leaderboard",
    "kpi-arena": "leaderboard",
    "kpi арена": "leaderboard",
    "kpi-арена": "leaderboard",
    "kpi arenası": "leaderboard",
    "арена kpi": "leaderboard",
    "отчёты": "reports",
    "отчеты": "reports",
    "hesabatlar": "reports",
    "reports": "reports",
    "конструктор отчётов": "reports_builder",
    "конструктор отчетов": "reports_builder",
    "hesabat qurucusu": "reports_builder",
    "report builder": "reports_builder",
    "журнал активности mtm": "mtm_activity",
    "mtm fəaliyyət jurnalı": "mtm_activity",
    "mtm activity": "mtm_activity",
    "центр команд ии": "ai-command-center",
    "ai komanda mərkəzi": "ai-command-center",
    "ai command center": "ai-command-center",
    "лиды": "leads",
    "leads": "leads",
    "lidlər": "leads",
    "сделки": "deals",
    "deals": "deals",
    "sövdələşmələr": "deals",
    "коммерческие предложения": "quotes",
    "предложения": "quotes",
    "quotes": "quotes",
    "commercial proposals": "quotes",
    "kommersiya təklifləri": "quotes",
    "задачи": "boards",
    "tasks": "boards",
    "tapşırıqlar": "boards",
  }
  return aliases[normalized] ?? normalized.replace(/^\/+/, "").replace(/[\s/]+/g, "_")
}

function explainSection(input: Record<string, unknown>, ctx: ChatAnalyticsContext): ChatAnalyticsResult {
  const key = normalizedSectionKey(String(input.section ?? ""))
  const guide = SECTION_GUIDE[key]
  if (!guide) return { success: false, error: "No verified product guide exists for that CRM section." }

  const sectionPath = VOICE_SECTIONS[key]
  const visible = sectionPath && navItems
    .filter((item) => navItemPathname(item.href) === navItemPathname(sectionPath))
    .some((item) => (
      isNavItemEnabled(ctx.org, item)
      && (!item.permissionScope || checkPermission(ctx.role, item.permissionScope, "read"))
    ))
  if (!visible) {
    return { success: false, error: "This CRM section is not enabled or permitted for this user." }
  }

  const descriptor = SECTION_DESCRIPTORS[key]
  if (descriptor) {
    if (!canRead(ctx.role, descriptor.permission)) {
      return { success: false, error: "This CRM section is not permitted for your role." }
    }
    const sectionModule = (LEGACY_MODULE_MAP[descriptor.permission] as ModuleId | undefined) ?? descriptor.module
    if (!hasModule(ctx.org, sectionModule)) {
      return { success: false, error: `The ${sectionModule} module is not enabled for this organization.` }
    }
  }

  let availableGroups: LeaderboardGroup[] | undefined
  if (key === "leaderboard") {
    availableGroups = visibleGroups(ctx.role).filter((group) => hasModule(ctx.org, GROUP_TO_MODULE[group] as ModuleId))
    if (availableGroups.length === 0) {
      return { success: false, error: "KPI Arena is not available for this role or organization modules." }
    }
  }

  return {
    success: true,
    data: {
      kind: "crm_section_guide",
      section: key,
      whatItIs: guide.whatItIs,
      howItWorks: guide.howItWorks,
      keyFeatures: guide.keyFeatures,
      availableGroups,
      source: "LeadDrive server section guide",
    },
  }
}

export async function executeChatAnalyticsTool(
  toolName: string,
  input: Record<string, unknown>,
  ctx: ChatAnalyticsContext,
): Promise<ChatAnalyticsResult> {
  if (!isChatAnalyticsToolName(toolName)) return { success: false, error: "Unknown analytics tool." }
  const parsed = CHAT_ANALYTICS_TOOL_SCHEMAS[toolName].safeParse(input)
  if (!parsed.success) return { success: false, error: `Invalid analytics filter for ${toolName}.` }

  try {
    const value = parsed.data as Record<string, unknown>
    if (toolName === "get_crm_period_report") return await periodReport(value, ctx)
    if (toolName === "get_crm_ranking") return await crmRanking(value, ctx)
    if (toolName === "get_kpi_arena") return await kpiArena(value, ctx)
    return explainSection(value, ctx)
  } catch (error) {
    console.error(`[chat-analytics] ${toolName} failed`, error instanceof Error ? error.message : "unknown error")
    return { success: false, error: "Verified CRM analytics are temporarily unavailable." }
  }
}
