import { prisma } from "@/lib/prisma"
import { haversineMeters } from "@/lib/mtm/photo-watermark/haversine"
import { reportDailySeries, type ReportRange } from "@/lib/mtm/report-period"
import { storedVisitEvaluation } from "@/lib/mtm/joint-visit"

/**
 * The reports a field-force manager asked for that the module did not have
 * (owner, 2026-11-01: «каких типов отчётностей… исследовать и предложить, что
 * может быть полезным менеджеру»; the mockup was approved with «Давай все пять»).
 * Each answers one question, from data the module already keeps:
 *
 * - coverage — of the doctors each agent is responsible for, how many were seen;
 * - not_visited — who nobody came to in the period, the most important first;
 * - suspicious — visits too short, far from the client, or without a position;
 * - presentations — what was really shown to clients, and for how long;
 * - field_day — when the day started, the first and the last visit, the hours;
 * - joint_evaluations — how the managers rated their agents on joint visits.
 */
export const FIELD_REPORT_TYPES = ["coverage", "not_visited", "suspicious", "presentations", "field_day", "joint_evaluations"] as const
export type FieldReportType = (typeof FIELD_REPORT_TYPES)[number]

export interface FieldReportInput {
  organizationId: string
  range: ReportRange
  timezone: string
  /** `null` — the whole organization. */
  agentIds: string[] | null
  page: number
  limit: number
  language: "az" | "ru" | "en"
  now: Date
}

export interface FieldReport {
  summary: Array<{ labelKey: string; value: number | string; kind: string }>
  series: Array<{ date: string; count: number }>
  rows: Array<Record<string, unknown>>
  total: number
}

/** Shorter than this, a finished visit is hardly a visit. */
export const SHORT_VISIT_MINUTES = 5
/** Checked in farther than this from the client, when the client has no zone of its own. */
export const FAR_CHECK_IN_METERS = 200

const CLASS_ORDER: Record<string, number> = { VIP: 0, A: 1, B: 2, C: 3, D: 4 }
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0)
const page = <T,>(items: T[], input: FieldReportInput) => items.slice((input.page - 1) * input.limit, input.page * input.limit)
const agentWhere = (input: FieldReportInput) => (input.agentIds === null ? {} : { agentId: { in: input.agentIds } })
const inPeriod = (input: FieldReportInput) => ({ gte: input.range.start, lt: input.range.end })

function clockTime(at: Date | null | undefined, timezone: string): string {
  if (!at) return ""
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone }).format(at)
}
function minutesOfDay(at: Date, timezone: string): number {
  const [hours, minutes] = clockTime(at, timezone).split(":").map(Number)
  return hours * 60 + minutes
}
const asClock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(Math.round(minutes % 60)).padStart(2, "0")}`

/** The field agents the report is about, by name. */
async function fieldAgents(input: FieldReportInput) {
  const agents: Array<{ id: string; name: string }> = await prisma.mtmAgent.findMany({
    where: { organizationId: input.organizationId, status: "ACTIVE", role: "AGENT", ...(input.agentIds === null ? {} : { id: { in: input.agentIds } }) },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  }) ?? []
  return agents
}

/** Who is responsible for which client during the period. */
async function assignedContacts(input: FieldReportInput, agentIds: string[]) {
  const assignments: Array<{ agentId: string; contactId: string; contact: { displayName: string; category: string } }> = await prisma.mtmContactAgentAssignment.findMany({
    where: {
      organizationId: input.organizationId,
      agentId: { in: agentIds },
      deletedAt: null,
      effectiveFrom: { lt: input.range.end },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: input.range.start } }],
      contact: { deletedAt: null, status: "ACTIVE" },
    },
    select: { agentId: true, contactId: true, contact: { select: { displayName: true, category: true } } },
  }) ?? []
  return assignments
}

/** The clients somebody came to in the period, with when. */
async function visitedContacts(input: FieldReportInput, contactIds: string[]) {
  if (contactIds.length === 0) return [] as Array<{ contactId: string | null; checkInAt: Date }>
  const visits: Array<{ contactId: string | null; checkInAt: Date }> = await prisma.mtmVisit.findMany({
    where: { organizationId: input.organizationId, contactId: { in: contactIds }, checkInAt: inPeriod(input), deletedAt: null, status: { not: "CANCELLED" } },
    select: { contactId: true, checkInAt: true },
  }) ?? []
  return visits
}

const classBand = (category: string) => (category === "VIP" || category === "A" ? "A" : category === "B" ? "B" : "C")

async function coverage(input: FieldReportInput): Promise<FieldReport> {
  const agents = await fieldAgents(input)
  const assignments = await assignedContacts(input, agents.map((agent) => agent.id))
  const visits = await visitedContacts(input, [...new Set(assignments.map((item) => item.contactId))])
  const seen = new Set(visits.map((visit) => visit.contactId))
  const share = (items: typeof assignments) => pct(items.filter((item) => seen.has(item.contactId)).length, items.length)
  const rows = agents.map((agent) => {
    const own = assignments.filter((item) => item.agentId === agent.id)
    const band = (name: string) => own.filter((item) => classBand(item.contact.category) === name)
    return {
      id: agent.id,
      agent: agent.name,
      contacts: own.length,
      visited: own.filter((item) => seen.has(item.contactId)).length,
      coverage: share(own),
      coverageA: band("A").length ? share(band("A")) : null,
      coverageB: band("B").length ? share(band("B")) : null,
      coverageC: band("C").length ? share(band("C")) : null,
    }
  }).filter((row) => row.contacts > 0)
  // A client of two agents is one client in the totals.
  const distinct = [...new Map(assignments.map((item) => [item.contactId, item])).values()]
  const band = (name: string) => distinct.filter((item) => classBand(item.contact.category) === name)
  return {
    summary: [
      { labelKey: "sum.contacts", value: distinct.length, kind: "number" },
      { labelKey: "sum.visitedContacts", value: distinct.filter((item) => seen.has(item.contactId)).length, kind: "number" },
      { labelKey: "sum.coverage", value: share(distinct), kind: "percent" },
      { labelKey: "sum.coverageA", value: share(band("A")), kind: "percent" },
      { labelKey: "sum.coverageB", value: share(band("B")), kind: "percent" },
    ],
    series: reportDailySeries(visits.map((visit) => ({ at: visit.checkInAt })), input.range, input.timezone),
    rows: page(rows, input),
    total: rows.length,
  }
}

async function notVisited(input: FieldReportInput): Promise<FieldReport> {
  const agents = await fieldAgents(input)
  const agentName = new Map(agents.map((agent) => [agent.id, agent.name]))
  const assignments = await assignedContacts(input, agents.map((agent) => agent.id))
  const contactIds = [...new Set(assignments.map((item) => item.contactId))]
  const visits = await visitedContacts(input, contactIds)
  const seen = new Set(visits.map((visit) => visit.contactId))
  const missed = [...new Map(assignments.filter((item) => !seen.has(item.contactId)).map((item) => [item.contactId, item])).values()]
  // When anyone was last there, whatever the period: «never» is its own answer.
  const last: Array<{ contactId: string | null; _max: { checkInAt: Date | null } }> = missed.length ? await prisma.mtmVisit.groupBy({
    by: ["contactId"],
    where: { organizationId: input.organizationId, contactId: { in: missed.map((item) => item.contactId) }, deletedAt: null, status: { not: "CANCELLED" } },
    _max: { checkInAt: true },
  }) as never : []
  const lastAt = new Map(last.map((item) => [item.contactId, item._max.checkInAt]))
  const owners = (contactId: string) => assignments.filter((item) => item.contactId === contactId).map((item) => agentName.get(item.agentId)).filter(Boolean).join(", ")
  const rows = missed
    .map((item) => {
      const at = lastAt.get(item.contactId) ?? null
      return {
        id: item.contactId,
        contact: item.contact.displayName,
        category: item.contact.category,
        agent: owners(item.contactId),
        lastVisit: at,
        daysSince: at ? Math.floor((input.now.getTime() - at.getTime()) / 86_400_000) : null,
      }
    })
    // The most important first; among equals, the longest forgotten.
    .sort((a, b) => (CLASS_ORDER[a.category] ?? 9) - (CLASS_ORDER[b.category] ?? 9)
      || (a.lastVisit ? a.lastVisit.getTime() : 0) - (b.lastVisit ? b.lastVisit.getTime() : 0)
      || a.contact.localeCompare(b.contact))
  return {
    summary: [
      { labelKey: "sum.notVisited", value: rows.length, kind: "number" },
      { labelKey: "sum.notVisitedA", value: rows.filter((row) => classBand(row.category) === "A").length, kind: "number" },
      { labelKey: "sum.neverVisited", value: rows.filter((row) => row.lastVisit === null).length, kind: "number" },
      { labelKey: "sum.notVisitedShare", value: pct(rows.length, contactIds.length), kind: "percent" },
    ],
    series: [],
    rows: page(rows, input),
    total: rows.length,
  }
}

async function suspicious(input: FieldReportInput): Promise<FieldReport> {
  const visits: Array<{
    id: string; checkInAt: Date; status: string; duration: number | null
    checkInLat: number | null; checkInLng: number | null; checkInCustomerLat: number | null; checkInCustomerLng: number | null; checkInGeofenceRadius: number | null
    agent: { name: string } | null; customer: { name: string } | null
  }> = await prisma.mtmVisit.findMany({
    where: { organizationId: input.organizationId, checkInAt: inPeriod(input), deletedAt: null, status: { not: "CANCELLED" }, ...agentWhere(input) },
    select: {
      id: true, checkInAt: true, status: true, duration: true,
      checkInLat: true, checkInLng: true, checkInCustomerLat: true, checkInCustomerLng: true, checkInGeofenceRadius: true,
      agent: { select: { name: true } }, customer: { select: { name: true } },
    },
    orderBy: { checkInAt: "desc" },
  }) ?? []
  const flagged = visits.flatMap((visit) => {
    const reasons: string[] = []
    if (visit.status === "CHECKED_OUT" && visit.duration !== null && visit.duration < SHORT_VISIT_MINUTES) reasons.push("SHORT")
    let distance: number | null = null
    if (visit.checkInLat === null || visit.checkInLng === null) reasons.push("NO_GPS")
    else if (visit.checkInCustomerLat !== null && visit.checkInCustomerLng !== null) {
      distance = Math.round(haversineMeters({ latitude: visit.checkInLat, longitude: visit.checkInLng }, { latitude: visit.checkInCustomerLat, longitude: visit.checkInCustomerLng }))
      if (distance > Math.max(visit.checkInGeofenceRadius ?? FAR_CHECK_IN_METERS, 50)) reasons.push("FAR")
    }
    return reasons.length ? [{ visit, reasons, distance }] : []
  })
  const rows = flagged.map(({ visit, reasons, distance }) => ({
    id: visit.id,
    date: visit.checkInAt,
    agent: visit.agent?.name ?? "—",
    customer: visit.customer?.name ?? "—",
    duration: visit.duration,
    distance,
    reasons: reasons.join(","),
  }))
  const count = (reason: string) => flagged.filter((item) => item.reasons.includes(reason)).length
  return {
    summary: [
      { labelKey: "sum.suspicious", value: flagged.length, kind: "number" },
      { labelKey: "sum.suspiciousShare", value: pct(flagged.length, visits.length), kind: "percent" },
      { labelKey: "sum.shortVisits", value: count("SHORT"), kind: "number" },
      { labelKey: "sum.farVisits", value: count("FAR"), kind: "number" },
      { labelKey: "sum.noGpsVisits", value: count("NO_GPS"), kind: "number" },
    ],
    series: reportDailySeries(flagged.map(({ visit }) => ({ at: visit.checkInAt })), input.range, input.timezone),
    rows: page(rows, input),
    total: rows.length,
  }
}

function pagesSeen(value: unknown, lastPage: number | null): number {
  if (Array.isArray(value)) return new Set(value.filter((item) => typeof item === "number")).size || value.length
  return lastPage ?? 0
}

async function presentations(input: FieldReportInput): Promise<FieldReport> {
  const sessions: Array<{ productId: string; customerId: string; openedAt: Date; activeDurationSeconds: number; pagesViewed: unknown; lastPage: number | null; product: { name: string } | null }> = await prisma.mtmPresentationSession.findMany({
    where: { organizationId: input.organizationId, openedAt: inPeriod(input), ...agentWhere(input) },
    select: { productId: true, customerId: true, openedAt: true, activeDurationSeconds: true, pagesViewed: true, lastPage: true, product: { select: { name: true } } },
  }) ?? []
  const groups = new Map<string, { name: string; shows: number; clients: Set<string>; seconds: number; pages: number }>()
  for (const session of sessions) {
    const group = groups.get(session.productId) ?? { name: session.product?.name ?? "—", shows: 0, clients: new Set<string>(), seconds: 0, pages: 0 }
    group.shows += 1
    group.clients.add(session.customerId)
    group.seconds += session.activeDurationSeconds
    group.pages += pagesSeen(session.pagesViewed, session.lastPage)
    groups.set(session.productId, group)
  }
  const rows = [...groups.entries()]
    .map(([id, group]) => ({ id, product: group.name, shows: group.shows, clients: group.clients.size, avgSeconds: Math.round(group.seconds / group.shows), avgPages: Math.round((group.pages / group.shows) * 10) / 10 }))
    .sort((a, b) => b.shows - a.shows || a.product.localeCompare(b.product))
  const seconds = sessions.reduce((sum, session) => sum + session.activeDurationSeconds, 0)
  return {
    summary: [
      { labelKey: "sum.shows", value: sessions.length, kind: "number" },
      { labelKey: "sum.productsShown", value: rows.length, kind: "number" },
      { labelKey: "sum.clientsShown", value: new Set(sessions.map((session) => session.customerId)).size, kind: "number" },
      { labelKey: "sum.avgShowSeconds", value: sessions.length ? Math.round(seconds / sessions.length) : 0, kind: "seconds" },
    ],
    series: reportDailySeries(sessions.map((session) => ({ at: session.openedAt })), input.range, input.timezone),
    rows: page(rows, input),
    total: rows.length,
  }
}

async function fieldDay(input: FieldReportInput): Promise<FieldReport> {
  const workdays: Array<{ id: string; agentId: string; workDate: Date; startedAt: Date; completedAt: Date | null; totalPausedSeconds: number; agent: { name: string } | null }> = await prisma.mtmAgentWorkday.findMany({
    where: { organizationId: input.organizationId, workDate: { gte: new Date(`${input.range.fromKey}T00:00:00Z`), lte: new Date(`${input.range.toKey}T00:00:00Z`) }, ...agentWhere(input) },
    select: { id: true, agentId: true, workDate: true, startedAt: true, completedAt: true, totalPausedSeconds: true, agent: { select: { name: true } } },
    orderBy: [{ workDate: "desc" }, { startedAt: "asc" }],
  }) ?? []
  const visits: Array<{ agentId: string; checkInAt: Date; duration: number | null }> = workdays.length ? await prisma.mtmVisit.findMany({
    where: { organizationId: input.organizationId, agentId: { in: [...new Set(workdays.map((day) => day.agentId))] }, checkInAt: inPeriod(input), deletedAt: null, status: { not: "CANCELLED" } },
    select: { agentId: true, checkInAt: true, duration: true },
  }) ?? [] : []
  const dayOf = (at: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: input.timezone }).format(at)
  const rows = workdays.map((day) => {
    const key = day.workDate.toISOString().slice(0, 10)
    const own = visits.filter((visit) => visit.agentId === day.agentId && dayOf(visit.checkInAt) === key).sort((a, b) => a.checkInAt.getTime() - b.checkInAt.getTime())
    const worked = day.completedAt ? Math.max(0, (day.completedAt.getTime() - day.startedAt.getTime()) / 1000 - day.totalPausedSeconds) : null
    return {
      id: day.id,
      agentId: day.agentId,
      date: day.workDate,
      agent: day.agent?.name ?? "—",
      start: clockTime(day.startedAt, input.timezone),
      firstVisit: clockTime(own[0]?.checkInAt, input.timezone),
      lastVisit: clockTime(own.at(-1)?.checkInAt, input.timezone),
      end: clockTime(day.completedAt, input.timezone),
      hours: worked === null ? null : Math.round((worked / 3600) * 10) / 10,
      visits: own.length,
      atClients: own.reduce((sum, visit) => sum + (visit.duration ?? 0), 0),
      firstDelay: own[0] ? Math.max(0, Math.round((own[0].checkInAt.getTime() - day.startedAt.getTime()) / 60000)) : null,
    }
  })
  const finished = rows.filter((row) => row.hours !== null)
  const delays = rows.filter((row) => row.firstDelay !== null)
  const average = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0)
  return {
    summary: [
      { labelKey: "sum.workdays", value: rows.length, kind: "number" },
      { labelKey: "sum.avgStart", value: rows.length ? asClock(average(workdays.map((day) => minutesOfDay(day.startedAt, input.timezone)))) : "—", kind: "text" },
      { labelKey: "sum.avgHours", value: Math.round(average(finished.map((row) => row.hours as number)) * 10) / 10, kind: "number" },
      { labelKey: "sum.avgVisitsPerDay", value: Math.round(average(rows.map((row) => row.visits)) * 10) / 10, kind: "number" },
      { labelKey: "sum.avgFirstVisitDelay", value: Math.round(average(delays.map((row) => row.firstDelay as number))), kind: "minutes" },
    ],
    series: reportDailySeries(workdays.map((day) => ({ at: day.workDate })), input.range, "UTC"),
    rows: page(rows, input),
    total: rows.length,
  }
}

async function jointEvaluations(input: FieldReportInput): Promise<FieldReport> {
  const evaluations: Array<{ agentId: string; createdAt: Date; scores: unknown; questions: unknown }> = await prisma.mtmVisitEvaluation.findMany({
    where: { organizationId: input.organizationId, createdAt: inPeriod(input), ...agentWhere(input) },
    select: { agentId: true, createdAt: true, scores: true, questions: true },
  }) ?? []
  const names: Array<{ id: string; name: string }> = evaluations.length ? await prisma.mtmAgent.findMany({
    where: { organizationId: input.organizationId, id: { in: [...new Set(evaluations.map((item) => item.agentId))] } },
    select: { id: true, name: true },
  }) ?? [] : []
  const nameOf = new Map(names.map((agent) => [agent.id, agent.name]))
  type Group = { averages: number[]; points: Map<string, { label: string; scores: number[] }>; last: Date }
  const groups = new Map<string, Group>()
  for (const item of evaluations) {
    const stored = storedVisitEvaluation(item)
    const group: Group = groups.get(item.agentId) ?? { averages: [] as number[], points: new Map(), last: item.createdAt }
    if (stored.average !== null) group.averages.push(stored.average)
    for (const question of stored.questions) {
      const score = stored.scores[question.id]
      if (typeof score !== "number") continue
      const point = group.points.get(question.id) ?? { label: question.labels[input.language], scores: [] as number[] }
      point.scores.push(score)
      group.points.set(question.id, point)
    }
    if (item.createdAt > group.last) group.last = item.createdAt
    groups.set(item.agentId, group)
  }
  const mean = (values: number[]) => (values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 : null)
  const rows = [...groups.entries()].map(([agentId, group]) => {
    // What to teach: the point rated lowest on average.
    const weakest = [...group.points.values()].map((point) => ({ label: point.label, score: mean(point.scores) ?? 0 })).sort((a, b) => a.score - b.score)[0]
    return {
      id: agentId,
      agent: nameOf.get(agentId) ?? "—",
      evaluations: group.averages.length,
      average: mean(group.averages),
      weakest: weakest ? `${weakest.label} · ${weakest.score}` : "",
      lastEvaluation: group.last,
    }
  }).sort((a, b) => (a.average ?? 9) - (b.average ?? 9) || a.agent.localeCompare(b.agent))
  return {
    summary: [
      { labelKey: "sum.evaluations", value: evaluations.length, kind: "number" },
      { labelKey: "sum.agentsEvaluated", value: rows.length, kind: "number" },
      { labelKey: "sum.avgScore", value: mean(rows.flatMap((row) => (row.average === null ? [] : [row.average]))) ?? 0, kind: "number" },
    ],
    series: reportDailySeries(evaluations.map((item) => ({ at: item.createdAt })), input.range, input.timezone),
    rows: page(rows, input),
    total: rows.length,
  }
}

export function computeFieldReport(type: FieldReportType, input: FieldReportInput): Promise<FieldReport> {
  switch (type) {
    case "coverage": return coverage(input)
    case "not_visited": return notVisited(input)
    case "suspicious": return suspicious(input)
    case "presentations": return presentations(input)
    case "field_day": return fieldDay(input)
    case "joint_evaluations": return jointEvaluations(input)
  }
}
