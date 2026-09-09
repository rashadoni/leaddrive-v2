/**
 * Voice summaries — aggregates only, never rows.
 *
 * Every figure here survived a deliberate pass for "true but misleading". A
 * number said aloud carries more authority than the same number on a screen:
 * nobody re-reads it, and there is no column header next to it to qualify it.
 * So the rule is that a metric either has an unambiguous spoken meaning or it
 * is not in this file — the rejects, and why, are listed at each site.
 */
import { prisma } from "@/lib/prisma"
import { voiceScopedWhere } from "./scoped-where"
import { SPOKEN_ROW_LIMIT } from "./read-tools"
import { orgStageVocabulary } from "@/lib/deal-stage-vocabulary"
import type { AdvisorDomainKey } from "@/lib/ai/advisor/types"
import { buildTaskListWhere, type TaskListFilters } from "@/lib/tasks/list-query"
import { resolveLaneKey } from "@/lib/tasks/board-columns"
import type { Role } from "@/lib/permissions"
import type { VoiceRecordType } from "./record-types"
import type { ExplicitPeriodRange } from "./section-reader"
import {
  buildVoiceTaskWhere,
  getVoiceAccessibleDivisionIds,
  narrowVoiceTaskWhere,
  type VoiceTaskScopeContext,
} from "./task-scope"

/** Below this many observations a proportion is noise; speak absolutes instead. */
export const MIN_SAMPLE_FOR_RATIO = 20

export type InboxSummary = {
  openConversations: number
  awaitingHuman: number
  unassignedOpen: number
  oldestWaitingHours: number | null
  sampleTooSmallForRatios: boolean
}

/**
 * Inbox state, "right now" — not a period metric.
 *
 * Deliberately NOT included:
 *  - queue age from SocialConversation.lastMessageAt: that column is never
 *    written for inbound email/SMS/web-chat, so it would measure time since the
 *    row was created and quietly understate every non-social channel;
 *  - unassigned counts from summarizeAgentPerformance: it counts every status
 *    and reads at most the 1000 newest conversations;
 *  - any per-channel "AI resolved" split: the channels endpoint groups by the
 *    raw platform column, where email, SMS and web-chat collapse into a single
 *    literal — a split would be invented, not measured.
 */
export async function buildInboxSummary(orgId: string, now: Date): Promise<InboxSummary> {
  const [openConversations, awaitingHuman, unassignedOpen, oldestInbound] = await Promise.all([
    prisma.socialConversation.count({ where: voiceScopedWhere(orgId, { status: "open" }) }),
    prisma.socialConversation.count({
      where: voiceScopedWhere(orgId, {
        status: "open",
        // A snoozed thread is still "open" but is not waiting on anyone.
        OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
      }),
    }),
    prisma.socialConversation.count({
      where: voiceScopedWhere(orgId, { status: "open", assignedTo: null }),
    }),
    // Age from real inbound traffic rather than the unreliable column.
    prisma.channelMessage.findFirst({
      where: voiceScopedWhere(orgId, { direction: "inbound" }),
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
  ])

  let oldestWaitingHours: number | null = null
  if (openConversations > 0 && oldestInbound?.createdAt) {
    const hours = (now.getTime() - oldestInbound.createdAt.getTime()) / 3_600_000
    // Production carries epoch-1970 rows; anything absurd is data, not backlog.
    oldestWaitingHours = hours > 0 && hours < 24 * 365 ? Math.round(hours) : null
  }

  return {
    openConversations,
    awaitingHuman,
    unassignedOpen,
    oldestWaitingHours,
    sampleTooSmallForRatios: openConversations < MIN_SAMPLE_FOR_RATIO,
  }
}

export type FieldSummary = {
  visitsToday: number
  completedToday: number
  openCheckInsAllTime: number
  overdueTasks: number
  planUnavailable: boolean
  periodApplied: {
    field: "checkInAt"
    from: string
    to: string
    endExclusive: true
    timezone?: string
    label?: string
  }
}

/**
 * Field-force state.
 *
 * `openCheckInsAllTime` is named for what it is. The dashboard's equivalent
 * figure has no date bound and no auto-close exists, so it accumulates forever;
 * speaking it as "agents currently in a store" would be wrong on any tenant
 * more than a few weeks old. Plan-vs-fact is absent entirely: it needs route
 * points, and a tenant that never published routes would hear "0% выполнено"
 * rather than "маршруты не публиковались".
 */
export async function buildFieldSummary(
  orgId: string,
  now: Date,
  today: ExplicitPeriodRange,
): Promise<FieldSummary> {
  if (today.from.getTime() >= today.toExclusive.getTime()) {
    throw new Error("Invalid field reporting range")
  }
  const [visitsToday, completedToday, openCheckInsAllTime, overdueTasks] = await Promise.all([
    prisma.mtmVisit.count({
      where: voiceScopedWhere(orgId, {
        deletedAt: null,
        checkInAt: { gte: today.from, lt: today.toExclusive },
      }),
    }),
    prisma.mtmVisit.count({
      where: voiceScopedWhere(orgId, {
        deletedAt: null,
        checkInAt: { gte: today.from, lt: today.toExclusive },
        checkOutAt: { not: null },
      }),
    }),
    prisma.mtmVisit.count({
      where: voiceScopedWhere(orgId, { deletedAt: null, status: "CHECKED_IN" }),
    }),
    prisma.mtmTask.count({
      where: voiceScopedWhere(orgId, {
        status: "PENDING",
        dueDate: { lt: now },
      }),
    }),
  ])

  return {
    visitsToday,
    completedToday,
    openCheckInsAllTime,
    overdueTasks,
    // Plan execution is intentionally not computed — see the note above.
    planUnavailable: true,
    periodApplied: {
      field: "checkInAt",
      from: today.from.toISOString(),
      to: today.toExclusive.toISOString(),
      endExclusive: true,
      ...(today.timezone ? { timezone: today.timezone } : {}),
      ...(today.label ? { label: today.label } : {}),
    },
  }
}

export type VoiceBriefing = {
  available: boolean
  scopeRestricted: boolean
  snapshotAt: string | null
  totalSignals: number
  criticalCount: number
  highCount: number
  moneyAtRisk: number
  staleHours: number | null
}

/**
 * Daily briefing — read from the stored snapshot, never recomputed.
 *
 * Rebuilding the advisor payload inside a voice turn runs every domain
 * collector; an agent that called this twice would take the app down by itself.
 *
 * Note the snapshot is fetched by newest-first rather than through
 * `getPreviousAdvisorSignalSnapshot`, which is hard-filtered to strictly
 * EARLIER days — it cannot see the snapshot written this morning, which is
 * exactly the one a morning briefing wants.
 */
export async function buildVoiceBriefing(
  orgId: string,
  now: Date,
  allowedDomains: readonly AdvisorDomainKey[],
  context: VoiceTaskScopeContext,
): Promise<VoiceBriefing> {
  const snap = await prisma.advisorSignalSnapshot.findFirst({
    where: voiceScopedWhere(orgId),
    orderBy: { snapshotAt: "desc" },
    select: {
      snapshotAt: true,
      totalSignals: true,
      criticalCount: true,
      highCount: true,
      moneyAtRisk: true,
      domainCounts: true,
    },
  })

  if (!snap) {
    return {
      available: false,
      scopeRestricted: false,
      snapshotAt: null,
      totalSignals: 0,
      criticalCount: 0,
      highCount: 0,
      moneyAtRisk: 0,
      staleHours: null,
    }
  }

  // Snapshots are built by an admin and aggregate every enabled Advisor
  // domain. A module can be disabled after the snapshot was written, so the
  // current route entitlement alone is not enough. Because severity and money
  // are not stored per-domain, partially subtracting a hidden domain would be
  // guesswork; fail closed instead of speaking a mixed total.
  const domainCounts = snap.domainCounts
  const countsAreUsable = !!domainCounts && typeof domainCounts === "object" && !Array.isArray(domainCounts)
  const allowed = new Set<string>(allowedDomains)
  const containsHiddenDomain = !countsAreUsable || Object.entries(domainCounts as Record<string, unknown>)
    .some(([domain, count]) => Number(count) > 0 && !allowed.has(domain))
  // Advisor snapshots are generated tenant-wide. Their task and KPI domains
  // can include boards hidden from a manager, and the aggregate stores no
  // per-board totals that could be subtracted safely. Admins see all boards;
  // everyone else must fail closed when either domain contributed.
  const containsUnscopedTaskData = context.role !== "admin"
    && context.role !== "superadmin"
    && ["tasks", "kpi"].some(
      (domain) => Number((domainCounts as Record<string, unknown> | null)?.[domain]) > 0,
    )
  if (containsHiddenDomain || containsUnscopedTaskData) {
    return {
      available: false,
      scopeRestricted: true,
      snapshotAt: null,
      totalSignals: 0,
      criticalCount: 0,
      highCount: 0,
      moneyAtRisk: 0,
      staleHours: null,
    }
  }

  const staleHours = Math.round((now.getTime() - snap.snapshotAt.getTime()) / 3_600_000)
  return {
    available: true,
    scopeRestricted: false,
    snapshotAt: snap.snapshotAt.toISOString(),
    totalSignals: snap.totalSignals,
    criticalCount: snap.criticalCount,
    highCount: snap.highCount,
    // Rounded: cents read aloud are noise, and the underlying figure is an estimate.
    moneyAtRisk: Math.round(snap.moneyAtRisk),
    // The age is returned so the console can say WHEN this was measured; a
    // briefing spoken without its timestamp invites acting on stale numbers.
    staleHours,
  }
}

export type PipelineStageRow = {
  stage: string
  label: string
  deals: number
  amount: number
  isWon: boolean
  isLost: boolean
}

export type PipelineSummary = {
  /**
   * Always "now". The funnel is a state, not a flow: asking "what was in the
   * funnel in July" needs stage-transition history this aggregate does not
   * read. Returned so the agent SAYS it rather than letting a period question
   * be answered about today in silence — the failure mode nobody can hear.
   */
  asOf: "current"
  currency: string
  openDeals: number
  openAmount: number
  stages: PipelineStageRow[]
  mixedCurrencies: boolean
}

/**
 * The funnel, stage by stage — the question the first version could not answer
 * at all ("what sales are at what stage" came back as "there are recent deals
 * and a total", because no tool aggregated by stage).
 *
 * Two things that would have been true but misleading:
 *
 *  - SUMMING ACROSS CURRENCIES. Deal.currency is per row. Adding 10 000 AZN to
 *    10 000 USD gives 20 000 of nothing. So the total is computed for the
 *    dominant currency only, and `mixedCurrencies` tells the caller to say so
 *    out loud rather than quietly speak a number that is not a sum of anything.
 *  - COUNTING WON AND LOST INTO "THE PIPELINE". Closed stages are returned —
 *    the director asks about them — but they are flagged and excluded from
 *    openDeals/openAmount, because "you have 400 000 in the funnel" must not
 *    include deals that were lost last quarter.
 *
 * Stage labels come from PipelineStage.displayName when the tenant has
 * configured one; Deal.stage is a free string and speaking the raw literal
 * ("NEGOTIATION") is worse than speaking what the board actually shows.
 */
type StageDef = {
  name: string
  displayName: string
  isWon: boolean
  isLost: boolean
  sortOrder: number
}

export async function buildPipelineSummary(orgId: string): Promise<PipelineSummary> {
  const [grouped, stageDefs] = await Promise.all([
    prisma.deal.groupBy({
      by: ["stage", "currency"],
      where: voiceScopedWhere(orgId),
      _count: { _all: true },
      _sum: { valueAmount: true },
    }),
    // Row type is asserted, not inferred: voiceScopedWhere is generic over an
    // open record, Prisma cannot narrow that to a model filter, and the select
    // collapses to `{}`. The assertion restates the select verbatim — the
    // tenant key is still added by the helper, not by this call.
    prisma.pipelineStage.findMany({
      where: voiceScopedWhere(orgId, { isActive: true }),
      select: { name: true, displayName: true, isWon: true, isLost: true, sortOrder: true },
      orderBy: { sortOrder: "asc" },
    }) as Promise<StageDef[]>,
  ])

  // Dominant currency = the one carrying the most deals, not the most money:
  // a single large foreign deal must not redenominate the whole report.
  const perCurrency = new Map<string, number>()
  for (const g of grouped) {
    perCurrency.set(g.currency, (perCurrency.get(g.currency) ?? 0) + g._count._all)
  }
  const currency =
    [...perCurrency.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "AZN"

  const defByName = new Map(stageDefs.map((s) => [s.name, s]))
  const order = new Map(stageDefs.map((s, i) => [s.name, i]))

  const rows = new Map<string, PipelineStageRow>()
  for (const g of grouped) {
    if (g.currency !== currency) continue
    const def = defByName.get(g.stage)
    const row = rows.get(g.stage) ?? {
      stage: g.stage,
      label: def?.displayName || g.stage,
      deals: 0,
      amount: 0,
      isWon: def?.isWon ?? false,
      isLost: def?.isLost ?? false,
    }
    row.deals += g._count._all
    row.amount += Math.round(Number(g._sum.valueAmount ?? 0))
    rows.set(g.stage, row)
  }

  const stages = [...rows.values()].sort(
    (a, b) => (order.get(a.stage) ?? 999) - (order.get(b.stage) ?? 999),
  )
  const open = stages.filter((s) => !s.isWon && !s.isLost)

  return {
    asOf: "current",
    currency,
    openDeals: open.reduce((n, s) => n + s.deals, 0),
    openAmount: open.reduce((n, s) => n + s.amount, 0),
    stages,
    mixedCurrencies: perCurrency.size > 1,
  }
}

export type ManagerRow = {
  name: string
  openDeals: number
  openAmount: number
  wonDeals: number
  wonAmount: number
}

export type SalesByManager = {
  /** Same reason as PipelineSummary.asOf — state, not a period. */
  asOf: "current"
  currency: string
  managers: ManagerRow[]
  unassignedOpen: number
  mixedCurrencies: boolean
}

/**
 * The funnel split by the person carrying it.
 *
 * Unassigned deals are reported as their own number rather than folded into a
 * pseudo-manager: "nobody owns eleven of your open deals" is the useful fact,
 * and inventing a row called "Unassigned" would let it be read aloud in a list
 * of people as though it were one.
 *
 * Same currency rule as buildPipelineSummary — one currency, flagged when
 * there are others. Names come from User; a missing user (deleted account still
 * referenced by assignedTo) is counted into unassigned rather than shown as a
 * blank row.
 */
export async function buildSalesByManager(orgId: string): Promise<SalesByManager> {
  // Same reason as the findMany assertions above: the generic where widens the
  // groupBy row type, so the shape is restated instead of inferred.
  type ManagerGroup = {
    assignedTo: string | null
    currency: string
    stage: string
    _count: { _all: number }
    _sum: { valueAmount: unknown }
  }
  const [grouped, stageDefs] = await Promise.all([
    prisma.deal.groupBy({
      by: ["assignedTo", "currency", "stage"],
      where: voiceScopedWhere(orgId),
      _count: { _all: true },
      _sum: { valueAmount: true },
    }) as unknown as Promise<ManagerGroup[]>,
    prisma.pipelineStage.findMany({
      where: voiceScopedWhere(orgId, { isActive: true }),
      select: { name: true, displayName: true, isWon: true, isLost: true, sortOrder: true },
    }) as Promise<StageDef[]>,
  ])

  const perCurrency = new Map<string, number>()
  for (const g of grouped) perCurrency.set(g.currency, (perCurrency.get(g.currency) ?? 0) + g._count._all)
  const currency = [...perCurrency.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "AZN"

  const defByName = new Map(stageDefs.map((s) => [s.name, s]))
  const ids = [...new Set(grouped.map((g) => g.assignedTo).filter((v): v is string => !!v))]
  const users = ids.length
    ? ((await prisma.user.findMany({
        where: voiceScopedWhere(orgId, { id: { in: ids } }),
        select: { id: true, name: true },
      })) as { id: string; name: string }[])
    : []
  const nameById = new Map(users.map((u) => [u.id, u.name]))

  const rows = new Map<string, ManagerRow>()
  let unassignedOpen = 0

  for (const g of grouped) {
    if (g.currency !== currency) continue
    const def = defByName.get(g.stage)
    const isWon = def?.isWon ?? false
    const isLost = def?.isLost ?? false
    const name = g.assignedTo ? nameById.get(g.assignedTo) : undefined

    if (!name) {
      if (!isWon && !isLost) unassignedOpen += g._count._all
      continue
    }

    const row = rows.get(name) ?? { name, openDeals: 0, openAmount: 0, wonDeals: 0, wonAmount: 0 }
    const amount = Math.round(Number(g._sum.valueAmount ?? 0))
    if (isWon) {
      row.wonDeals += g._count._all
      row.wonAmount += amount
    } else if (!isLost) {
      row.openDeals += g._count._all
      row.openAmount += amount
    }
    rows.set(name, row)
  }

  return {
    asOf: "current",
    currency,
    // Sorted by open money: the first name spoken should be the one carrying
    // the most at stake, since a spoken list is rarely heard past the third item.
    managers: [...rows.values()].sort((a, b) => b.openAmount - a.openAmount),
    unassignedOpen,
    mixedCurrencies: perCurrency.size > 1,
  }
}

export type OverdueSummary = {
  overdueTasks: number
  overdueInvoices: number
  overdueInvoiceAmount: number
  invoiceCurrency: string
  dealsPastExpectedClose: number
}

/**
 * What is late, right now.
 *
 * Each figure is counted against the column that actually records lateness,
 * and each excludes the states where "late" is meaningless:
 *
 *  - tasks: dueDate in the past AND not done/cancelled. The status column still
 *    mixes legacy and Kanban values (see schema note), so completion is matched
 *    against both spellings rather than one;
 *  - invoices: balanceDue > 0 and dueDate passed. Status is NOT used — "overdue"
 *    there is a stored label that nothing recomputes on a schedule, so a paid
 *    invoice can keep it and an unpaid one can lack it;
 *  - deals: expectedClose passed while still in an open stage. Not called
 *    "overdue" to the agent — a slipped forecast date is not a missed deadline.
 */
export async function buildOverdueSummary(
  orgId: string,
  now: Date,
  context: VoiceTaskScopeContext,
): Promise<OverdueSummary> {
  const stageDefs = (await prisma.pipelineStage.findMany({
    where: voiceScopedWhere(orgId, { isActive: true }),
    select: { name: true, displayName: true, isWon: true, isLost: true, sortOrder: true },
  })) as StageDef[]
  const closedStages = stageDefs.filter((s) => s.isWon || s.isLost).map((s) => s.name)
  const taskWhere = await buildVoiceTaskWhere(orgId, context)

  const [overdueTasks, invoices, dealsPastExpectedClose] = await Promise.all([
    prisma.task.count({
      where: narrowVoiceTaskWhere(taskWhere, {
        dueDate: { lt: now },
        status: { notIn: ["done", "completed", "cancelled"] },
      }),
    }),
    prisma.invoice.findMany({
      where: voiceScopedWhere(orgId, { dueDate: { lt: now }, balanceDue: { gt: 0 } }),
      select: { balanceDue: true, currency: true },
    }) as Promise<{ balanceDue: unknown; currency: string }[]>,
    prisma.deal.count({
      where: voiceScopedWhere(orgId, {
        expectedClose: { lt: now },
        ...(closedStages.length ? { stage: { notIn: closedStages } } : {}),
      }),
    }),
  ])

  const perCurrency = new Map<string, number>()
  for (const i of invoices) perCurrency.set(i.currency, (perCurrency.get(i.currency) ?? 0) + 1)
  const invoiceCurrency = [...perCurrency.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "AZN"

  return {
    overdueTasks,
    overdueInvoices: invoices.length,
    overdueInvoiceAmount: Math.round(
      invoices
        .filter((i) => i.currency === invoiceCurrency)
        .reduce((n, i) => n + Number(i.balanceDue ?? 0), 0),
    ),
    invoiceCurrency,
    dealsPastExpectedClose,
  }
}

export type FoundRecord = { id: string; name: string; hint: string }
export type RecordSearch = { type: VoiceRecordType; matches: FoundRecord[]; truncated: boolean }
export type VoiceRecordSearchContext = { userId: string; role: Role }

const RECORD_SEARCH_LIMIT = 6

/**
 * Find a named record so the assistant can put it on screen.
 *
 * Returns CANDIDATES, never a decision. With one match the caller opens it;
 * with several the agent has to ask which — silently opening the first hit for
 * "show me the Ahmedov deal" when three exist is exactly the behaviour that
 * makes people stop trusting a voice assistant, because the wrong record looks
 * identical to the right one until you read it.
 *
 * `hint` exists to make that question answerable out loud: two deals called
 * "Ahmedov" are indistinguishable by name, but "Ahmedov, proposal, 12 000" and
 * "Ahmedov, won, 3 000" are not. Ids are never spoken — they go back to the
 * browser, which navigates.
 */
export async function findVoiceRecords(
  orgId: string,
  type: VoiceRecordType,
  query: string,
  context: VoiceRecordSearchContext,
): Promise<RecordSearch> {
  const q = query.trim().slice(0, 80)
  if (q.length < 2) return { type, matches: [], truncated: false }
  const take = RECORD_SEARCH_LIMIT + 1

  let rows: FoundRecord[] = []

  if (type === "deal") {
    const deals = (await prisma.deal.findMany({
      where: voiceScopedWhere(orgId, { name: { contains: q, mode: "insensitive" } }),
      select: { id: true, name: true, stage: true, valueAmount: true, currency: true },
      orderBy: { updatedAt: "desc" },
      take,
    })) as { id: string; name: string; stage: string; valueAmount: unknown; currency: string }[]
    rows = deals.map((d) => ({
      id: d.id,
      name: d.name,
      hint: `${d.stage}, ${Math.round(Number(d.valueAmount ?? 0))} ${d.currency}`,
    }))
  } else if (type === "contact") {
    const contacts = (await prisma.contact.findMany({
      where: voiceScopedWhere(orgId, { fullName: { contains: q, mode: "insensitive" } }),
      select: { id: true, fullName: true, position: true },
      orderBy: { updatedAt: "desc" },
      take,
    })) as { id: string; fullName: string; position: string | null }[]
    rows = contacts.map((c) => ({
      id: c.id,
      name: c.fullName,
      hint: c.position ?? "",
    }))
  } else if (type === "lead") {
    const leads = (await prisma.lead.findMany({
      where: voiceScopedWhere(orgId, {
        OR: [
          { contactName: { contains: q, mode: "insensitive" } },
          { companyName: { contains: q, mode: "insensitive" } },
        ],
      }),
      select: { id: true, contactName: true, companyName: true, status: true },
      orderBy: { updatedAt: "desc" },
      take,
    })) as { id: string; contactName: string; companyName: string | null; status: string }[]
    rows = leads.map((l) => ({
      id: l.id,
      name: l.contactName,
      hint: [l.companyName, l.status].filter(Boolean).join(", "),
    }))
  } else if (type === "ticket") {
    const tickets = (await prisma.ticket.findMany({
      where: voiceScopedWhere(orgId, {
        OR: [
          { ticketNumber: { contains: q, mode: "insensitive" } },
          { subject: { contains: q, mode: "insensitive" } },
        ],
      }),
      select: { id: true, ticketNumber: true, subject: true, status: true, priority: true },
      orderBy: { updatedAt: "desc" },
      take,
    })) as { id: string; ticketNumber: string; subject: string; status: string; priority: string | null }[]
    rows = tickets.map((t) => ({
      id: t.id,
      name: `${t.ticketNumber}: ${t.subject}`,
      hint: [t.status, t.priority].filter(Boolean).join(", "),
    }))
  } else if (type === "invoice") {
    const invoices = (await prisma.invoice.findMany({
      where: voiceScopedWhere(orgId, { invoiceNumber: { contains: q, mode: "insensitive" } }),
      select: { id: true, invoiceNumber: true, status: true, totalAmount: true, currency: true },
      orderBy: { updatedAt: "desc" },
      take,
    })) as { id: string; invoiceNumber: string; status: string; totalAmount: unknown; currency: string }[]
    rows = invoices.map((i) => ({
      id: i.id,
      name: i.invoiceNumber,
      hint: `${i.status}, ${Math.round(Number(i.totalAmount ?? 0))} ${i.currency}`,
    }))
  } else if (type === "project") {
    const projects = (await prisma.project.findMany({
      where: voiceScopedWhere(orgId, { name: { contains: q, mode: "insensitive" } }),
      select: { id: true, name: true, status: true },
      orderBy: { updatedAt: "desc" },
      take,
    })) as { id: string; name: string; status: string | null }[]
    rows = projects.map((p) => ({ id: p.id, name: p.name, hint: p.status ?? "" }))
  } else if (type === "contract") {
    const contracts = (await prisma.contract.findMany({
      where: voiceScopedWhere(orgId, {
        OR: [
          { contractNumber: { contains: q, mode: "insensitive" } },
          { title: { contains: q, mode: "insensitive" } },
        ],
      }),
      select: { id: true, contractNumber: true, title: true, status: true },
      orderBy: { updatedAt: "desc" },
      take,
    })) as { id: string; contractNumber: string; title: string; status: string | null }[]
    rows = contracts.map((c) => ({
      id: c.id,
      name: `${c.contractNumber}: ${c.title}`,
      hint: c.status ?? "",
    }))
  } else if (type === "company") {
    const companies = (await prisma.company.findMany({
      where: voiceScopedWhere(orgId, { name: { contains: q, mode: "insensitive" } }),
      select: { id: true, name: true, industry: true },
      orderBy: { updatedAt: "desc" },
      take,
    })) as { id: string; name: string; industry: string | null }[]
    rows = companies.map((c) => ({ id: c.id, name: c.name, hint: c.industry ?? "" }))
  } else if (type === "board") {
    // Division visibility is stricter than role-level `tasks:read`: managers
    // may still have explicit per-board grants/denials. Reuse the same resolver
    // as the board picker so voice cannot find a board hidden from the screen.
    const accessible = await getVoiceAccessibleDivisionIds(orgId, context)
    const boards = (await prisma.division.findMany({
      where: voiceScopedWhere(orgId, {
        isActive: true,
        ...(accessible === "all" ? {} : { id: { in: accessible } }),
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { key: { contains: q, mode: "insensitive" } },
        ],
      }),
      select: { id: true, name: true, key: true, isDepartment: true },
      orderBy: { updatedAt: "desc" },
      take,
    })) as { id: string; name: string; key: string; isDepartment: boolean }[]
    rows = boards.map((b) => ({
      id: b.id,
      name: b.name,
      hint: [b.key, b.isDepartment ? "department" : "board"].join(", "),
    }))
  } else if (type === "product") {
    const products = (await prisma.product.findMany({
      where: voiceScopedWhere(orgId, {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { sku: { contains: q, mode: "insensitive" } },
        ],
      }),
      select: { id: true, name: true, sku: true, category: true, price: true, currency: true },
      orderBy: { updatedAt: "desc" },
      take,
    })) as {
      id: string
      name: string
      sku: string | null
      category: string
      price: number
      currency: string
    }[]
    rows = products.map((p) => ({
      id: p.id,
      name: p.name,
      hint: [p.sku, p.category, `${Math.round(Number(p.price ?? 0))} ${p.currency}`]
        .filter(Boolean)
        .join(", "),
    }))
  } else if (type === "quote") {
    const quotes = (await prisma.quote.findMany({
      where: voiceScopedWhere(orgId, {
        quoteNumber: { contains: q, mode: "insensitive" },
      }),
      select: { id: true, quoteNumber: true, version: true, status: true, totalAmount: true, currency: true },
      orderBy: { updatedAt: "desc" },
      take,
    })) as {
      id: string
      quoteNumber: string
      version: number
      status: string
      totalAmount: unknown
      currency: string
    }[]
    rows = quotes.map((quote) => ({
      id: quote.id,
      name: quote.version > 1 ? `${quote.quoteNumber} v${quote.version}` : quote.quoteNumber,
      hint: `${quote.status}, ${Math.round(Number(quote.totalAmount ?? 0))} ${quote.currency}`,
    }))
  } else if (type === "campaign") {
    const campaigns = (await prisma.campaign.findMany({
      where: voiceScopedWhere(orgId, { name: { contains: q, mode: "insensitive" } }),
      select: { id: true, name: true, type: true, status: true },
      orderBy: { updatedAt: "desc" },
      take,
    })) as { id: string; name: string; type: string; status: string }[]
    rows = campaigns.map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      hint: [campaign.type, campaign.status].filter(Boolean).join(", "),
    }))
  } else if (type === "complaint") {
    // Complaints are not their own model: the canonical list route reads
    // Ticket rows whose one-to-one ComplaintMeta relation exists.
    const complaints = (await prisma.ticket.findMany({
      where: voiceScopedWhere(orgId, {
        complaintMeta: { isNot: null },
        subject: { contains: q, mode: "insensitive" },
      }),
      select: {
        id: true,
        subject: true,
        status: true,
        priority: true,
        complaintMeta: { select: { riskLevel: true } },
      },
      orderBy: { updatedAt: "desc" },
      take,
    })) as {
      id: string
      subject: string
      status: string
      priority: string | null
      complaintMeta: { riskLevel: string | null } | null
    }[]
    rows = complaints.map((complaint) => ({
      id: complaint.id,
      name: complaint.subject,
      hint: [complaint.status, complaint.priority, complaint.complaintMeta?.riskLevel]
        .filter(Boolean)
        .join(", "),
    }))
  } else if (type === "event") {
    const events = (await prisma.event.findMany({
      where: voiceScopedWhere(orgId, { name: { contains: q, mode: "insensitive" } }),
      select: { id: true, name: true, status: true, startDate: true },
      orderBy: { updatedAt: "desc" },
      take,
    })) as { id: string; name: string; status: string; startDate: Date }[]
    rows = events.map((event) => ({
      id: event.id,
      name: event.name,
      hint: [event.status, event.startDate.toISOString().slice(0, 10)].join(", "),
    }))
  } else if (type === "task") {
    // Search with the exact list/export scope builder: CRM sharing rules,
    // board membership/denials, collaborator grants and soft-delete filtering.
    const filters: TaskListFilters = {
      assignedTo: "",
      createdBy: "",
      statusParts: [],
      priority: "",
      type: "",
      eventType: "",
      category: "",
      divisionId: "",
      divisionIds: [],
      projectId: "",
      search: q,
      cfKey: "",
      cfValue: "",
      createdRange: null,
      completedRange: null,
    }
    const { where, blocked } = await buildTaskListWhere(
      orgId,
      context.userId,
      context.role,
      filters,
    )
    if (!blocked) {
      const tasks = (await prisma.task.findMany({
        where,
        select: { id: true, title: true, taskKey: true, status: true, priority: true },
        orderBy: { updatedAt: "desc" },
        take,
      })) as {
        id: string
        title: string
        taskKey: string | null
        status: string
        priority: string | null
      }[]
      rows = tasks.map((task) => ({
        id: task.id,
        name: task.title,
        hint: [task.taskKey, task.status, task.priority].filter(Boolean).join(", "),
      }))
    }
  } else {
    // RECORD_TYPE_NAMES is canonical; a new tuple value must add a searchable
    // branch here before TypeScript accepts the build.
    const unhandled: never = type
    throw new Error(`[voice] unhandled record type: ${unhandled}`)
  }

  return {
    type,
    matches: rows.slice(0, RECORD_SEARCH_LIMIT),
    // Told to the agent so it says "there are more" instead of implying the
    // list it just read out is everything.
    truncated: rows.length > RECORD_SEARCH_LIMIT,
  }
}

export type LeadsSummary = {
  total: number
  byStatus: { status: string; count: number }[]
  averageScore: number | null
  hotLeads: number
  convertedThisMonth: number
  unassigned: number
}

/** A lead at or above this score is "hot" — the same cut the leads page uses. */
const HOT_LEAD_SCORE = 70

/**
 * Leads. Missing from the first version entirely: asked about them in
 * Azerbaijani, the agent had no tool to call and said nothing useful. That read
 * as a speech problem and was not one — there was simply no leads tool, and
 * "leads" was not even in the navigable section list.
 *
 * Deliberately NOT included:
 *  - a conversion RATE. Converted-over-total is only meaningful against leads
 *    that have had time to convert; dividing today's total by conversions all
 *    time flatters or damns the number depending on intake volume alone. The
 *    two counts are returned separately so the agent states facts, not a ratio;
 *  - an average score over ALL leads including lost ones — kept as-is here
 *    because the leads page shows exactly that, and a voice figure that
 *    disagrees with the screen is worse than an imperfect one that matches.
 */
export async function buildLeadsSummary(
  orgId: string,
  _now: Date,
  month: ExplicitPeriodRange,
): Promise<LeadsSummary> {
  type StatusGroup = { status: string; _count: { _all: number } }
  const [grouped, agg, hotLeads, convertedThisMonth, unassigned] = await Promise.all([
    prisma.lead.groupBy({
      by: ["status"],
      where: voiceScopedWhere(orgId),
      _count: { _all: true },
    }) as unknown as Promise<StatusGroup[]>,
    prisma.lead.aggregate({
      where: voiceScopedWhere(orgId),
      _avg: { score: true },
      _count: { _all: true },
    }) as unknown as Promise<{ _avg: { score: number | null }; _count: { _all: number } }>,
    prisma.lead.count({ where: voiceScopedWhere(orgId, { score: { gte: HOT_LEAD_SCORE } }) }),
    prisma.lead.count({
      where: voiceScopedWhere(orgId, {
        convertedAt: { gte: month.from, lt: month.toExclusive },
      }),
    }),
    prisma.lead.count({ where: voiceScopedWhere(orgId, { assignedTo: null }) }),
  ])

  return {
    total: agg._count._all,
    byStatus: grouped
      .map((g) => ({ status: g.status, count: g._count._all }))
      .sort((a, b) => b.count - a.count),
    averageScore: agg._avg.score === null ? null : Math.round(agg._avg.score),
    hotLeads,
    convertedThisMonth,
    unassigned,
  }
}

export type CampaignRow = {
  name: string
  status: string
  sent: number
  opened: number
  clicked: number
  cost: number
}

export type MarketingSummary = {
  campaignsTotal: number
  campaignsSent: number
  sentMessages: number
  openedMessages: number
  clickedMessages: number
  bounced: number
  unsubscribed: number
  spentThisMonth: number
  recent: CampaignRow[]
  sampleTooSmallForRatios: boolean
}

/**
 * Marketing: email campaigns and what they actually did.
 *
 * Counts, never rates. The temptation is to say "open rate 24%" — but the open
 * counter is driven by a tracking pixel, which Apple Mail Privacy Protection
 * and most corporate gateways fetch on the recipient's behalf whether or not
 * anyone read the mail. The count is still the best signal we have and worth
 * speaking; a PERCENTAGE built on it sounds like a measurement of human
 * behaviour and is not one. So both numbers go out and the agent says "opened
 * X of Y", letting the listener do the division knowing what it is made of.
 *
 * `spentThisMonth` uses actualCost, not budget: budget is what was planned and
 * frequently never revised, so speaking it as spend would overstate or
 * understate by whatever the plan was wrong by.
 *
 * Deliberately NOT included: campaign ROI. Attributing revenue to a campaign
 * depends on the attribution model chosen on the reports page — first touch and
 * last touch give different answers from the same data, and a spoken figure
 * cannot carry "under the last-touch model" without becoming a lecture.
 */
export async function buildMarketingSummary(
  orgId: string,
  _now: Date,
  month: ExplicitPeriodRange,
): Promise<MarketingSummary> {
  type CampAgg = {
    _count: { _all: number }
    _sum: {
      totalSent: number | null
      totalOpened: number | null
      totalClicked: number | null
      totalBounced: number | null
      totalUnsubscribed: number | null
    }
  }

  const [agg, sentCount, spend, recent] = await Promise.all([
    prisma.campaign.aggregate({
      where: voiceScopedWhere(orgId),
      _count: { _all: true },
      _sum: {
        totalSent: true,
        totalOpened: true,
        totalClicked: true,
        totalBounced: true,
        totalUnsubscribed: true,
      },
    }) as unknown as Promise<CampAgg>,
    prisma.campaign.count({ where: voiceScopedWhere(orgId, { status: "sent" }) }),
    prisma.campaign.aggregate({
      where: voiceScopedWhere(orgId, {
        sentAt: { gte: month.from, lt: month.toExclusive },
      }),
      _sum: { actualCost: true },
    }) as unknown as Promise<{ _sum: { actualCost: number | null } }>,
    prisma.campaign.findMany({
      where: voiceScopedWhere(orgId, { sentAt: { not: null } }),
      select: {
        name: true,
        status: true,
        totalSent: true,
        totalOpened: true,
        totalClicked: true,
        actualCost: true,
      },
      orderBy: { sentAt: "desc" },
      take: SPOKEN_ROW_LIMIT,
    }) as Promise<
      {
        name: string
        status: string
        totalSent: number
        totalOpened: number
        totalClicked: number
        actualCost: number
      }[]
    >,
  ])

  const sentMessages = agg._sum.totalSent ?? 0

  return {
    campaignsTotal: agg._count._all,
    campaignsSent: sentCount,
    sentMessages,
    openedMessages: agg._sum.totalOpened ?? 0,
    clickedMessages: agg._sum.totalClicked ?? 0,
    bounced: agg._sum.totalBounced ?? 0,
    unsubscribed: agg._sum.totalUnsubscribed ?? 0,
    spentThisMonth: Math.round(spend._sum.actualCost ?? 0),
    recent: recent.map((c) => ({
      name: c.name,
      status: c.status,
      sent: c.totalSent,
      opened: c.totalOpened,
      clicked: c.totalClicked,
      cost: Math.round(c.actualCost),
    })),
    sampleTooSmallForRatios: sentMessages < MIN_SAMPLE_FOR_RATIO,
  }
}

export type ForecastSummary = {
  year: number
  quarter: number
  currency: string
  quotaTotal: number
  wonThisQuarter: number
  openWeighted: number
  openTotal: number
  quotaSet: boolean
  mixedCurrencies: boolean
  /** Current won deals that cannot be placed in a quarter from event history. */
  wonDealsWithoutHistory: number | null
}

type DealValueTransition = {
  id: string
  dealId: string
  toAmount: unknown
  currency: string | null
  transitionedAt: Date
}

type TerminalDealTransition = DealValueTransition & {
  transitionType: string
}

/**
 * A deal may enter the same terminal state more than once after it is
 * reopened. Spoken "won deals" and "lost deals" are distinct deals, not raw
 * workflow events, so retain only the latest matching transition per deal.
 * The id tie-break keeps the chosen value deterministic if two imported
 * events share the same timestamp.
 */
function latestTransitionPerDeal<T extends DealValueTransition>(
  transitions: T[],
): T[] {
  const latest = new Map<string, T>()
  for (const transition of transitions) {
    const current = latest.get(transition.dealId)
    if (
      !current
      || transition.transitionedAt.getTime() > current.transitionedAt.getTime()
      || (
        transition.transitionedAt.getTime() === current.transitionedAt.getTime()
        && transition.id.localeCompare(current.id) > 0
      )
    ) {
      latest.set(transition.dealId, transition)
    }
  }
  return [...latest.values()]
}

/**
 * Forecast: the quarter's quota against what has actually closed, plus what is
 * still open weighted by each stage's probability.
 *
 * THREE separate numbers, never one blended "forecast". Won money is banked.
 * Open-weighted is an estimate built on stage probabilities the tenant
 * configured. Open-total is the ceiling if everything landed. Collapsing them
 * into a single figure would hide which part is fact — and spoken aloud,
 * nobody can see that the number was a mixture.
 *
 * `quotaSet` is returned so the agent says "no quota is set for this quarter"
 * instead of comparing against zero and reporting a catastrophic shortfall.
 *
 * Quotas are per user; the total is the org's. Same dominant-currency rule as
 * the pipeline, for the same reason.
 */
export async function buildForecastSummary(
  orgId: string,
  _now: Date,
  quarterRange: ExplicitPeriodRange,
  pipelineToExclusive: Date = quarterRange.toExclusive,
): Promise<ForecastSummary> {
  const localDate = quarterRange.label?.split("—")[0]?.trim()
  const year = Number(localDate?.slice(0, 4))
  const month = Number(localDate?.slice(5, 7))
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Invalid forecast reporting range")
  }
  const quarter = Math.floor((month - 1) / 3) + 1

  const stageDefs = (await prisma.pipelineStage.findMany({
    where: voiceScopedWhere(orgId, { isActive: true }),
    select: { name: true, displayName: true, isWon: true, isLost: true, sortOrder: true },
  })) as StageDef[]
  const wonStages = stageDefs.filter((s) => s.isWon).map((s) => s.name)
  const closedStages = stageDefs.filter((s) => s.isWon || s.isLost).map((s) => s.name)
  if (wonStages.length === 0) {
    throw new Error("Forecast unavailable: no active won stage")
  }

  type DealGroup = {
    stage: string
    currency: string
    _count: { _all: number }
    _sum: { valueAmount: unknown }
  }

  const [quotas, wonTransitions, wonDealsWithoutHistory, openGrouped] = await Promise.all([
    prisma.salesQuota.findMany({
      where: voiceScopedWhere(orgId, { year, quarter }),
      select: { amount: true, currency: true },
    }) as Promise<{ amount: number; currency: string }[]>,
    // A Deal's updatedAt is not a close date: editing a note on an old won
    // deal would otherwise move its value into the current quarter. The
    // append-only transition is the only event that can answer "won when?".
    prisma.pipelineStageTransition.findMany({
      where: voiceScopedWhere(orgId, {
        transitionType: "won",
        transitionedAt: { gte: quarterRange.from, lt: quarterRange.toExclusive },
        // A won event that was later reopened is no longer banked actual
        // revenue. Constrain events by the deal's current terminal state so a
        // reopened deal appears only in the open pipeline, never in both.
        deal: { is: { stage: { in: wonStages } } },
      }),
      select: {
        id: true,
        dealId: true,
        toAmount: true,
        currency: true,
        transitionedAt: true,
      },
    }) as Promise<DealValueTransition[]>,
    prisma.deal.count({
      where: voiceScopedWhere(orgId, {
        stage: { in: wonStages },
        stageTransitions: { none: { transitionType: "won" } },
      }),
    }),
    prisma.deal.groupBy({
      by: ["stage", "currency"],
      where: voiceScopedWhere(orgId, {
        ...(closedStages.length ? { stage: { notIn: closedStages } } : {}),
        // This is a CURRENT-QUARTER forecast, not the whole open pipeline.
        // A far-future deal may be open and valuable, but it cannot contribute
        // to this quarter's quota projection. Null expected-close dates are
        // deliberately excluded because no verified period attribution exists.
        expectedClose: { gte: quarterRange.from, lt: pipelineToExclusive },
      }),
      _count: { _all: true },
      _sum: { valueAmount: true },
    }) as unknown as Promise<DealGroup[]>,
  ])

  const uniqueWonTransitions = latestTransitionPerDeal(wonTransitions)
  const perCurrency = new Map<string, number>()
  for (const g of openGrouped) perCurrency.set(g.currency, (perCurrency.get(g.currency) ?? 0) + g._count._all)
  for (const transition of uniqueWonTransitions) {
    const transitionCurrency = transition.currency || "AZN"
    perCurrency.set(transitionCurrency, (perCurrency.get(transitionCurrency) ?? 0) + 1)
  }
  for (const q of quotas) perCurrency.set(q.currency, perCurrency.get(q.currency) ?? 0)
  const currency = [...perCurrency.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "AZN"

  const probByStage = new Map(
    stageDefs.map((s) => [s.name, 0]),
  )
  const stageProb = (await prisma.pipelineStage.findMany({
    where: voiceScopedWhere(orgId, { isActive: true }),
    select: { name: true, probability: true },
  })) as { name: string; probability: number }[]
  for (const s of stageProb) probByStage.set(s.name, s.probability)

  const relevantQuotas = quotas.filter((q) => q.currency === currency)
  const openRows = openGrouped.filter((g) => g.currency === currency)

  return {
    year,
    quarter,
    currency,
    quotaTotal: Math.round(relevantQuotas.reduce((n, q) => n + q.amount, 0)),
    wonThisQuarter: Math.round(
      uniqueWonTransitions
        .filter((transition) => (transition.currency || "AZN") === currency)
        .reduce((sum, transition) => sum + Number(transition.toAmount ?? 0), 0),
    ),
    openWeighted: Math.round(
      openRows.reduce(
        (n, g) => n + Number(g._sum.valueAmount ?? 0) * ((probByStage.get(g.stage) ?? 0) / 100),
        0,
      ),
    ),
    openTotal: Math.round(openRows.reduce((n, g) => n + Number(g._sum.valueAmount ?? 0), 0)),
    quotaSet: relevantQuotas.length > 0,
    mixedCurrencies: perCurrency.size > 1,
    wonDealsWithoutHistory,
  }
}

export type BoardColumnRow = { label: string; tasks: number }

/** One named board, resolved independently of every other board. */
export type BoardRow = {
  name: string
  totalOpen: number
  columns: BoardColumnRow[]
  overdue: number
  unassigned: number
  highPriority: number
}

export type BoardsSummary = {
  totalOpen: number
  columns: BoardColumnRow[]
  overdue: number
  unassigned: number
  highPriority: number
  uncolumned: number
  /** Named boards, busiest first. Absent boards are counted in `boardsOmitted`. */
  boards: BoardRow[]
  boardsOmitted: number
}

/** A spoken list of boards is not heard past the first handful. */
const NAMED_BOARDS_LIMIT = 12

/**
 * The Kanban boards — task management.
 *
 * A task belongs to a board through `divisionId`; its explicit
 * `boardColumnKey` wins, otherwise the canonical status is folded into a visible
 * lane. The summary uses the same resolution as the board UI, then merges equal
 * spoken labels across boards.
 *
 * Column labels come from the tenant's own configuration rather than the status
 * literal. `in_progress` said aloud is jargon; whatever the team wrote on the
 * column is what they will recognise.
 *
 * `uncolumned` is returned rather than hidden. The status column still mixes
 * legacy values (pending/completed/cancelled) with Kanban ones — the schema
 * says so outright — so tasks whose status matches no column DO exist. Folding
 * them into a total would make the columns silently fail to add up; naming them
 * lets the agent say the count is incomplete instead of implying it is not.
 */
export async function buildBoardsSummary(
  orgId: string,
  now: Date,
  context: VoiceTaskScopeContext,
): Promise<BoardsSummary> {
  const DONE = ["done", "completed", "cancelled"]
  const [taskWhere, accessibleDivisions] = await Promise.all([
    buildVoiceTaskWhere(orgId, context),
    getVoiceAccessibleDivisionIds(orgId, context),
  ])
  const openTaskWhere = narrowVoiceTaskWhere(taskWhere, { status: { notIn: DONE } })
  const visibleColumnWhere = voiceScopedWhere(orgId, {
    ...(accessibleDivisions === "all"
      ? {}
      : { divisionId: { in: accessibleDivisions } }),
  })

  type LaneGroup = {
    divisionId: string | null
    status: string
    boardColumnKey: string | null
    _count: { _all: number }
  }
  const byDivision = (predicate?: Record<string, unknown>) => prisma.task.groupBy({
    by: ["divisionId"],
    where: predicate ? narrowVoiceTaskWhere(openTaskWhere, predicate) : openTaskWhere,
    _count: { _all: true },
  }) as unknown as Promise<{ divisionId: string | null; _count: { _all: number } }[]>

  const [columns, grouped, overdue, unassigned, highPriority, boardRows, overdueByBoard, unassignedByBoard, highPriorityByBoard] = await Promise.all([
    prisma.boardColumn.findMany({
      where: visibleColumnWhere,
      select: { divisionId: true, key: true, label: true, mapsToStatus: true, sortOrder: true },
      orderBy: { sortOrder: "asc" },
    }) as Promise<{
      divisionId: string
      key: string
      label: string
      mapsToStatus: string
      sortOrder: number
    }[]>,
    prisma.task.groupBy({
      by: ["divisionId", "status", "boardColumnKey"],
      where: openTaskWhere,
      _count: { _all: true },
    }) as unknown as Promise<LaneGroup[]>,
    prisma.task.count({
      where: narrowVoiceTaskWhere(openTaskWhere, { dueDate: { lt: now } }),
    }),
    prisma.task.count({
      where: narrowVoiceTaskWhere(openTaskWhere, { assignedTo: null }),
    }),
    prisma.task.count({
      where: narrowVoiceTaskWhere(openTaskWhere, { priority: { in: ["high", "urgent"] } }),
    }),
    // The boards themselves. Without their names the agent can only report one
    // merged org-wide total, which is why it kept telling the owner it had no
    // tool for a report on a NAMED board. Departments are containers that hold
    // no tasks of their own, so listing them would report a misleading zero.
    prisma.division.findMany({
      where: voiceScopedWhere(orgId, {
        isActive: true,
        isDepartment: false,
        ...(accessibleDivisions === "all" ? {} : { id: { in: accessibleDivisions } }),
      }),
      select: { id: true, name: true },
      orderBy: { sortOrder: "asc" },
    }) as Promise<{ id: string; name: string }[]>,
    byDivision({ dueDate: { lt: now } }),
    byDivision({ assignedTo: null }),
    byDivision({ priority: { in: ["high", "urgent"] } }),
  ])

  const rows: BoardColumnRow[] = []
  const columnsByDivision = new Map<string, typeof columns>()
  for (const column of columns) {
    if (DONE.includes(column.mapsToStatus)) continue
    const boardColumns = columnsByDivision.get(column.divisionId)
    if (boardColumns) boardColumns.push(column)
    else columnsByDivision.set(column.divisionId, [column])
  }

  // Several boards can use the same spoken label. Merge their independently
  // resolved lane counts; never reuse one global status count for every board.
  const byLabel = new Map<string, number>()
  for (const boardColumns of columnsByDivision.values()) {
    for (const column of boardColumns) {
      if (!byLabel.has(column.label)) byLabel.set(column.label, 0)
    }
  }
  let uncolumned = 0
  for (const group of grouped) {
    const boardColumns = group.divisionId
      ? columnsByDivision.get(group.divisionId) ?? []
      : []
    const laneKey = resolveLaneKey(group, boardColumns)
    const column = boardColumns.find((candidate) => candidate.key === laneKey)
    if (!column) {
      uncolumned += group._count._all
      continue
    }
    byLabel.set(column.label, (byLabel.get(column.label) ?? 0) + group._count._all)
  }
  for (const [label, tasks] of byLabel) rows.push({ label, tasks })

  const totalOpen = grouped.reduce((n, g) => n + g._count._all, 0)

  // Per board, resolved with the same lane rules but never merged across
  // boards: two boards may both have a column called "TO DO" and they are not
  // the same lane. A board the caller cannot see was never queried, so it has
  // no row here and its tasks are simply absent from every figure.
  const countFor = (
    source: { divisionId: string | null; _count: { _all: number } }[],
    divisionId: string,
  ) => source.find((row) => row.divisionId === divisionId)?._count._all ?? 0

  const named: BoardRow[] = boardRows.map((board) => {
    const boardColumns = columnsByDivision.get(board.id) ?? []
    const lanes = new Map<string, number>()
    for (const column of boardColumns) lanes.set(column.label, 0)
    let open = 0
    for (const group of grouped) {
      if (group.divisionId !== board.id) continue
      open += group._count._all
      const laneKey = resolveLaneKey(group, boardColumns)
      const column = boardColumns.find((candidate) => candidate.key === laneKey)
      if (column) lanes.set(column.label, (lanes.get(column.label) ?? 0) + group._count._all)
    }
    return {
      name: board.name,
      totalOpen: open,
      columns: [...lanes].map(([label, tasks]) => ({ label, tasks })),
      overdue: countFor(overdueByBoard, board.id),
      unassigned: countFor(unassignedByBoard, board.id),
      highPriority: countFor(highPriorityByBoard, board.id),
    }
  }).sort((a, b) => b.totalOpen - a.totalOpen)

  return {
    totalOpen,
    columns: rows.sort((a, b) => b.tasks - a.tasks),
    overdue,
    unassigned,
    highPriority,
    uncolumned,
    boards: named.slice(0, NAMED_BOARDS_LIMIT),
    boardsOmitted: Math.max(0, named.length - NAMED_BOARDS_LIMIT),
  }
}

export type WorkloadRow = {
  name: string
  openTasks: number
  overdueTasks: number
  openLeads: number
  openDeals: number
  openDealAmount: number
  openTickets: number
}

export type WorkloadSummary = {
  currency: string
  people: WorkloadRow[]
  unassigned: {
    tasks: number
    leads: number
    deals: number
    tickets: number
  }
  quotesHaveNoOwner: true
}

/**
 * Who is carrying what, and who is behind — one answer, not five.
 *
 * The owner asked it as one question ("who are tasks late from, whose deals,
 * who sent the quote, who leads are assigned to"), because that is how it is
 * actually asked out loud. A tool per entity would have forced the agent to
 * make four calls and then do arithmetic across them in its head, which is
 * exactly where a spoken answer starts inventing numbers.
 *
 * Unassigned work is counted separately per entity rather than attributed to a
 * placeholder person: "nobody owns nine leads" is the actionable fact, and a
 * row called "Unassigned" read aloud in a list of names sounds like a colleague.
 *
 * QUOTES ARE ABSENT, deliberately and visibly. The Quote model carries no
 * owner column at all — no assignedTo, no createdBy. Attributing a quote via
 * its deal's owner would answer a question nobody asked ("whose DEAL is this
 * quote on") in words that sound like the one they did ("who SENT it"), and on
 * a phone call the difference is undetectable. The flag says so, so the agent
 * states the limit instead of quietly omitting quotes from a per-person answer.
 */
export type WorkloadFocus = "all" | "tasks" | "leads" | "deals" | "tickets"

export async function buildWorkloadSummary(
  orgId: string,
  now: Date,
  focus: WorkloadFocus,
  context: VoiceTaskScopeContext,
): Promise<WorkloadSummary> {
  // Narrowing exists to keep the SPOKEN answer short, and it works by not
  // fetching rather than by trimming afterwards: a field that never left the
  // server cannot be read out by mistake. Asked "who is late", the agent gets
  // tasks and nothing else, so there is no funnel to wander into.
  const want = (k: WorkloadFocus) => focus === "all" || focus === k
  const DONE_TASK = ["done", "completed", "cancelled"]
  const CLOSED_TICKET = ["closed", "resolved"]
  const OPEN_LEAD = ["new", "contacted", "qualified"]

  type G = { assignedTo: string | null; _count: { _all: number } }
  type DG = { assignedTo: string | null; currency: string; _count: { _all: number }; _sum: { valueAmount: unknown } }

  const stageDefs = (await prisma.pipelineStage.findMany({
    where: voiceScopedWhere(orgId, { isActive: true }),
    select: { name: true, displayName: true, isWon: true, isLost: true, sortOrder: true },
  })) as StageDef[]
  const closedStages = stageDefs.filter((s) => s.isWon || s.isLost).map((s) => s.name)
  const taskWhere = want("tasks") ? await buildVoiceTaskWhere(orgId, context) : null

  const none = Promise.resolve([] as G[])
  const [tasks, overdue, leads, tickets, deals] = await Promise.all([
    want("tasks")
      ? (prisma.task.groupBy({
          by: ["assignedTo"],
          where: narrowVoiceTaskWhere(taskWhere!, { status: { notIn: DONE_TASK } }),
          _count: { _all: true },
        }) as unknown as Promise<G[]>)
      : none,
    want("tasks")
      ? (prisma.task.groupBy({
          by: ["assignedTo"],
          where: narrowVoiceTaskWhere(taskWhere!, {
            status: { notIn: DONE_TASK },
            dueDate: { lt: now },
          }),
          _count: { _all: true },
        }) as unknown as Promise<G[]>)
      : none,
    want("leads")
      ? (prisma.lead.groupBy({
          by: ["assignedTo"],
          where: voiceScopedWhere(orgId, { status: { in: OPEN_LEAD } }),
          _count: { _all: true },
        }) as unknown as Promise<G[]>)
      : none,
    want("tickets")
      ? (prisma.ticket.groupBy({
          by: ["assignedTo"],
          where: voiceScopedWhere(orgId, { status: { notIn: CLOSED_TICKET } }),
          _count: { _all: true },
        }) as unknown as Promise<G[]>)
      : none,
    want("deals")
      ? (prisma.deal.groupBy({
          by: ["assignedTo", "currency"],
          where: voiceScopedWhere(orgId, {
            ...(closedStages.length ? { stage: { notIn: closedStages } } : {}),
          }),
          _count: { _all: true },
          _sum: { valueAmount: true },
        }) as unknown as Promise<DG[]>)
      : Promise.resolve([] as DG[]),
  ])

  const perCurrency = new Map<string, number>()
  for (const d of deals) perCurrency.set(d.currency, (perCurrency.get(d.currency) ?? 0) + d._count._all)
  const currency = [...perCurrency.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "AZN"

  const ids = [
    ...new Set(
      [...tasks, ...overdue, ...leads, ...tickets, ...deals]
        .map((r) => r.assignedTo)
        .filter((v): v is string => !!v),
    ),
  ]
  const users = ids.length
    ? ((await prisma.user.findMany({
        where: voiceScopedWhere(orgId, { id: { in: ids } }),
        select: { id: true, name: true },
      })) as { id: string; name: string }[])
    : []
  const nameById = new Map(users.map((u) => [u.id, u.name]))

  const rows = new Map<string, WorkloadRow>()
  const unassigned = { tasks: 0, leads: 0, deals: 0, tickets: 0 }

  const row = (id: string | null): WorkloadRow | null => {
    const name = id ? nameById.get(id) : undefined
    if (!name) return null
    const existing = rows.get(name) ?? {
      name,
      openTasks: 0,
      overdueTasks: 0,
      openLeads: 0,
      openDeals: 0,
      openDealAmount: 0,
      openTickets: 0,
    }
    rows.set(name, existing)
    return existing
  }

  for (const t of tasks) {
    const r = row(t.assignedTo)
    if (r) r.openTasks += t._count._all
    else unassigned.tasks += t._count._all
  }
  for (const t of overdue) {
    const r = row(t.assignedTo)
    if (r) r.overdueTasks += t._count._all
  }
  for (const l of leads) {
    const r = row(l.assignedTo)
    if (r) r.openLeads += l._count._all
    else unassigned.leads += l._count._all
  }
  for (const t of tickets) {
    const r = row(t.assignedTo)
    if (r) r.openTickets += t._count._all
    else unassigned.tickets += t._count._all
  }
  for (const d of deals) {
    if (d.currency !== currency) continue
    const r = row(d.assignedTo)
    if (r) {
      r.openDeals += d._count._all
      r.openDealAmount += Math.round(Number(d._sum.valueAmount ?? 0))
    } else {
      unassigned.deals += d._count._all
    }
  }

  return {
    currency,
    // Overdue first: "who is behind" is the question this gets asked for, and a
    // spoken list is rarely heard past the third name.
    people: [...rows.values()].sort(
      (a, b) => b.overdueTasks - a.overdueTasks || b.openDealAmount - a.openDealAmount,
    ),
    unassigned,
    quotesHaveNoOwner: true,
  }
}

export type QuotesSummary = {
  total: number
  byStatus: { status: string; count: number; amount: number }[]
  currency: string
  openAmount: number
  acceptedAmount: number
  expiringSoon: number
  expired: number
  mixedCurrencies: boolean
}

/** A quote whose validity ends within this many days is worth mentioning. */
const QUOTE_EXPIRY_SOON_DAYS = 7

/**
 * Quotes (CPQ) — the step between a deal and an invoice.
 *
 * Missing from the first pass, and the owner found it the same way he found
 * leads: by asking. Navigation covered the section, reading did not.
 *
 * Amounts come from `totalAmount`, which the CPQ layer persists deliberately
 * (see the schema note) so a historical quote keeps the total it was sent with
 * even if its line items were edited afterwards. Recomputing here would quietly
 * disagree with the number the customer actually received.
 *
 * `expired` and `expiringSoon` are counted from `validUntil` rather than from
 * status: nothing flips a stored status when a date passes, so a quote can read
 * "sent" long after it stopped being valid.
 *
 * Accepted is reported separately from open rather than summed into one
 * "pipeline of quotes" — an accepted quote is a commitment, an open one is a
 * hope, and spoken aloud the difference is invisible unless it is stated.
 */
export async function buildQuotesSummary(orgId: string, now: Date): Promise<QuotesSummary> {
  const soon = new Date(now.getTime() + QUOTE_EXPIRY_SOON_DAYS * 86_400_000)

  type QuoteGroup = {
    status: string
    currency: string
    _count: { _all: number }
    _sum: { totalAmount: unknown }
  }

  const [grouped, expiringSoon, expired] = await Promise.all([
    prisma.quote.groupBy({
      by: ["status", "currency"],
      where: voiceScopedWhere(orgId),
      _count: { _all: true },
      _sum: { totalAmount: true },
    }) as unknown as Promise<QuoteGroup[]>,
    prisma.quote.count({
      where: voiceScopedWhere(orgId, {
        validUntil: { gte: now, lte: soon },
        status: { notIn: ["accepted", "rejected", "expired"] },
      }),
    }),
    prisma.quote.count({
      where: voiceScopedWhere(orgId, {
        validUntil: { lt: now },
        status: { notIn: ["accepted", "rejected"] },
      }),
    }),
  ])

  const perCurrency = new Map<string, number>()
  for (const g of grouped) perCurrency.set(g.currency, (perCurrency.get(g.currency) ?? 0) + g._count._all)
  const currency = [...perCurrency.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "AZN"

  const rows = new Map<string, { status: string; count: number; amount: number }>()
  for (const g of grouped) {
    if (g.currency !== currency) continue
    const row = rows.get(g.status) ?? { status: g.status, count: 0, amount: 0 }
    row.count += g._count._all
    row.amount += Math.round(Number(g._sum.totalAmount ?? 0))
    rows.set(g.status, row)
  }
  const byStatus = [...rows.values()].sort((a, b) => b.count - a.count)

  const CLOSED = ["accepted", "rejected", "expired"]
  return {
    total: grouped.reduce((n, g) => n + g._count._all, 0),
    byStatus,
    currency,
    openAmount: byStatus.filter((r) => !CLOSED.includes(r.status)).reduce((n, r) => n + r.amount, 0),
    acceptedAmount: byStatus.find((r) => r.status === "accepted")?.amount ?? 0,
    expiringSoon,
    expired,
    mixedCurrencies: perCurrency.size > 1,
  }
}

export type SalesPeriodSummary = {
  /** Human-readable window, always spoken back so the answer names its period. */
  periodLabel: string
  from: string
  to: string
  wonCount: number
  lostCount: number
  money: { amount: number; currency: string; mixedCurrencies: boolean } | null
  /**
   * Won deals in the org that carry no recorded transition into won.
   *
   * The whole point of this field: the answer is computed from recorded stage
   * changes, and a deal that was created already-won never produced one. On
   * production that is 30 of 37 won deals — seeded, never moved through the
   * app. Reporting "sold in July: 100 000" without this number would be a true
   * sentence that leaves a false impression, which is the one failure mode this
   * whole file is written against.
   */
  wonDealsWithoutHistory: number
}

/**
 * What was actually won and lost inside a window.
 *
 * Reads `pipeline_stage_transitions` — an append-only log of stage changes —
 * rather than the deal's own columns. `Deal.stage` is a state, not an event:
 * it answers "is this deal won" and cannot answer "was it won in July".
 * `stageChangedAt` holds only the LAST change, so it silently reattributes a
 * deal every time it moves again, and `updatedAt` moves when anyone edits a
 * note.
 *
 * Deliberately NOT included:
 *  - a win rate for the period. The denominator would have to be "deals that
 *    could have closed", which no column expresses; count of won over count of
 *    transitions would rise whenever people simply moved fewer deals.
 *  - average deal size. With `wonDealsWithoutHistory` typically larger than
 *    `wonCount`, an average over the recorded few would be presented as the
 *    org's average and be wrong by an unknown factor.
 */
export async function buildSalesPeriodSummary(
  orgId: string,
  from: Date,
  toExclusive: Date,
  periodLabel: string,
): Promise<SalesPeriodSummary> {
  // Spellings, not literals — the org may call its winning stage anything, and
  // production already holds CLOSED_WON next to WON.
  const { wonStages } = await orgStageVocabulary(orgId)
  const [rows, wonDealsWithoutHistory] = await Promise.all([
    prisma.pipelineStageTransition.findMany({
      where: voiceScopedWhere(orgId, {
        transitionType: { in: ["won", "lost"] },
        transitionedAt: { gte: from, lt: toExclusive },
      }),
      select: {
        id: true,
        dealId: true,
        transitionType: true,
        toAmount: true,
        currency: true,
        transitionedAt: true,
      },
    }) as Promise<TerminalDealTransition[]>,
    prisma.deal.count({
      where: voiceScopedWhere(orgId, {
        stage: { in: wonStages },
        stageTransitions: { none: { transitionType: "won" } },
      }),
    }),
  ])

  const won = latestTransitionPerDeal(
    rows.filter((r) => r.transitionType === "won"),
  )
  const lost = latestTransitionPerDeal(
    rows.filter((r) => r.transitionType === "lost"),
  )

  /*
   * Money is never summed across currencies — 5 AZN + 5 USD is not 10 of
   * anything. The dominant currency is chosen by row count, and the flag says
   * out loud that something was left out.
   */
  const byCurrency = new Map<string, { amount: number; rows: number }>()
  for (const r of won) {
    const cur = r.currency || "AZN"
    const entry = byCurrency.get(cur) ?? { amount: 0, rows: 0 }
    entry.amount += Number(r.toAmount ?? 0)
    entry.rows += 1
    byCurrency.set(cur, entry)
  }
  let money: SalesPeriodSummary["money"] = null
  if (byCurrency.size > 0) {
    const [currency, top] = [...byCurrency.entries()].sort((a, b) => b[1].rows - a[1].rows)[0]
    money = {
      amount: Math.round(top.amount),
      currency,
      mixedCurrencies: byCurrency.size > 1,
    }
  }

  return {
    periodLabel,
    from: from.toISOString(),
    // Preserve the public inclusive display boundary while the database query
    // uses the exact half-open interval [from, toExclusive).
    to: new Date(toExclusive.getTime() - 1).toISOString(),
    wonCount: won.length,
    lostCount: lost.length,
    money,
    wonDealsWithoutHistory,
  }
}
