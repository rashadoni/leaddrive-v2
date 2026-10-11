/**
 * The numbers of the MTM home screen («Bu gün»).
 *
 * Owner 2026-10-11 accepted this screen as a picture before a line of it was
 * written: four figures on top, «ждёт решения», and the team with a strip of
 * the week per agent. Everything here is arithmetic over three answers the
 * product already gives:
 *
 * - today's rows of `/api/v1/mtm/week/team` (who is where);
 * - the facts of `/api/v1/mtm/kpi` — the same plan points and visits the
 *   «Результаты» tab counts, so a week on this screen cannot disagree with it;
 * - the organization's working days from `/api/v1/mtm/week/attention`.
 *
 * Pure: no clock, no locale, no text. The components only format.
 */
import { addDateKeyDays } from "@/lib/mtm/mobile-week"
import {
  isOfficeCardWithoutFieldWork,
  teamRowWhereabouts,
  type TeamTodayRowInput,
} from "@/lib/mtm/team-today-summary"

export interface HomePlanPoint {
  agentId: string
  date: string
  completed: boolean
}

export interface HomeVisit {
  agentId: string
  date: string
  gpsConfirmed: boolean
}

export interface HomeWeekFacts {
  planPoints: readonly HomePlanPoint[]
  visits: readonly HomeVisit[]
}

export interface HomeWeekDay {
  date: string
  isWorkingDay: boolean
}

/**
 * What a day of an agent's week says:
 * - `full` / `partial` / `missed` — a published plan, all, some or none of it visited;
 * - `pending` — today's plan with nothing visited yet: the morning, not a verdict;
 * - `upcoming` — a plan on a day still ahead;
 * - `visited` — visits on a day without a plan;
 * - `off` — the organization does not work that day; `none` — a working day without a plan.
 */
export type HomeCellTone = "full" | "partial" | "missed" | "pending" | "upcoming" | "visited" | "off" | "none"

export interface HomeDayCell {
  date: string
  planned: number
  done: number
  /** Visits recorded that day, planned or not. */
  visits: number
  tone: HomeCellTone
  isToday: boolean
}

export interface HomeAgentWeek {
  cells: HomeDayCell[]
  /** Up to and including today: what «the week so far» means on this screen. */
  planned: number
  done: number
}

export interface HomeWeekTotals {
  planned: number
  done: number
  visits: number
  gpsConfirmed: number
}

/** Monday to Sunday of the week `today` falls in, when the server did not name them. */
export function defaultWeek(today: string): HomeWeekDay[] {
  const weekday = (new Date(`${today}T00:00:00.000Z`).getUTCDay() + 6) % 7
  const monday = addDateKeyDays(today, -weekday)
  return Array.from({ length: 7 }, (_unused, offset) => {
    const date = addDateKeyDays(monday, offset)
    const day = new Date(`${date}T00:00:00.000Z`).getUTCDay()
    return { date, isWorkingDay: day !== 0 && day !== 6 }
  })
}

function cellTone(input: { date: string; today: string; planned: number; done: number; visits: number; isWorkingDay: boolean }): HomeCellTone {
  const { date, today, planned, done, visits, isWorkingDay } = input
  if (date > today) return planned > 0 ? "upcoming" : isWorkingDay ? "none" : "off"
  if (planned > 0) {
    if (done >= planned) return "full"
    if (done > 0) return "partial"
    return date === today ? "pending" : "missed"
  }
  if (visits > 0) return "visited"
  return isWorkingDay ? "none" : "off"
}

/** One agent's strip of the week. Facts of other agents are ignored. */
export function buildAgentWeek(agentId: string, today: string, week: readonly HomeWeekDay[], facts: HomeWeekFacts): HomeAgentWeek {
  const cells = week.map((day): HomeDayCell => {
    const points = facts.planPoints.filter((point) => point.agentId === agentId && point.date === day.date)
    const planned = points.length
    const done = points.filter((point) => point.completed).length
    const visits = facts.visits.filter((visit) => visit.agentId === agentId && visit.date === day.date).length
    return {
      date: day.date,
      planned,
      done,
      visits,
      tone: cellTone({ date: day.date, today, planned, done, visits, isWorkingDay: day.isWorkingDay }),
      isToday: day.date === today,
    }
  })
  const soFar = cells.filter((cell) => cell.date <= today)
  return {
    cells,
    planned: soFar.reduce((sum, cell) => sum + cell.planned, 0),
    done: soFar.reduce((sum, cell) => sum + cell.done, 0),
  }
}

/**
 * The week so far. `agentIds` narrows it to the people on screen when the
 * Panel is filtered by something «Результаты» cannot filter by (a region).
 */
export function weekTotals(facts: HomeWeekFacts, range: { from: string; to: string }, agentIds?: ReadonlySet<string>): HomeWeekTotals {
  const inRange = (entry: { agentId: string; date: string }) =>
    entry.date >= range.from && entry.date <= range.to && (!agentIds || agentIds.has(entry.agentId))
  const points = facts.planPoints.filter(inRange)
  const visits = facts.visits.filter(inRange)
  return {
    planned: points.length,
    done: points.filter((point) => point.completed).length,
    visits: visits.length,
    gpsConfirmed: visits.filter((visit) => visit.gpsConfirmed).length,
  }
}

/**
 * How the week is going, judged by the days already over. The figure itself
 * counts today too (it is the number «Результаты» shows), but today's stops
 * are not late at noon: colouring the week by them would paint every working
 * morning red. Null when no finished day of the week had a plan.
 */
export function finishedDaysPercent(facts: HomeWeekFacts, range: { from: string; today: string }, agentIds?: ReadonlySet<string>): number | null {
  const points = facts.planPoints.filter((point) =>
    point.date >= range.from && point.date < range.today && (!agentIds || agentIds.has(point.agentId)))
  return percentOf(points.filter((point) => point.completed).length, points.length)
}

export function percentOf(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null
}

/**
 * This week against the same days of the last one. `unknown` when last week
 * could not be read; `no-plan` when it had no plan to compare with.
 */
export type HomeWeekComparison =
  | { kind: "unknown" }
  | { kind: "no-plan" }
  | { kind: "delta"; previousPercent: number; delta: number }

export function weekComparison(current: { planned: number; done: number }, previous: { planned: number; done: number } | null): HomeWeekComparison {
  if (!previous) return { kind: "unknown" }
  const previousPercent = percentOf(previous.done, previous.planned)
  const currentPercent = percentOf(current.done, current.planned)
  if (previousPercent === null) return { kind: "no-plan" }
  if (currentPercent === null) return { kind: "unknown" }
  return { kind: "delta", previousPercent, delta: currentPercent - previousPercent }
}

/** A row of the team list: `TeamTodayRowInput` plus what the «where» line reads. */
export type HomeTeamRow = TeamTodayRowInput & {
  visits: ReadonlyArray<{ customerName: string | null; status: string; checkInAt: string | null; checkOutAt: string | null }>
  nextStop?: { customerName: string | null; plannedAt: string | null } | null
}

/**
 * Where an agent stands right now, in one word for the chip:
 * at a customer; on the way to the next stop; today's plan closed; a plan not
 * started yet; visits made without a plan; last seen at a customer; nothing.
 * A plan with nothing visited is «not started», never a fault: at 09:00 that
 * is the normal morning.
 */
export type HomeAgentState =
  | { kind: "at-customer"; customerName: string | null; since: string }
  | { kind: "heading"; customerName: string | null; plannedAt: string | null }
  | { kind: "plan-done" }
  | { kind: "not-started" }
  | { kind: "unplanned" }
  | { kind: "last-visit"; customerName: string | null; until: string }
  | { kind: "no-activity" }

export function homeAgentState(row: HomeTeamRow): HomeAgentState {
  const where = teamRowWhereabouts({ visits: row.visits, nextStop: row.nextStop, route: row.route })
  if (where?.kind === "at-customer") return { kind: "at-customer", customerName: where.customerName, since: where.since }
  if (row.route && row.route.total > 0 && row.route.visited >= row.route.total) return { kind: "plan-done" }
  const visitedToday = row.visitCount > 0 || row.visits.length > 0
  // The phone reporting today is what tells «on the way to the first stop»
  // from «has not left yet».
  const outToday = visitedToday || row.lastGpsAt !== null
  if (where?.kind === "heading") {
    return outToday ? { kind: "heading", customerName: where.customerName, plannedAt: where.plannedAt } : { kind: "not-started" }
  }
  if (row.route === null && visitedToday) return { kind: "unplanned" }
  if (where?.kind === "last-visit") return { kind: "last-visit", customerName: where.customerName, until: where.until }
  return row.route !== null ? { kind: "not-started" } : { kind: "no-activity" }
}

const STATE_RANK: Record<HomeAgentState["kind"], number> = {
  "at-customer": 0,
  heading: 1,
  unplanned: 2,
  "last-visit": 3,
  "plan-done": 4,
  "not-started": 5,
  "no-activity": 6,
}

export interface HomeTeamEntry<Row extends HomeTeamRow = HomeTeamRow> {
  row: Row
  state: HomeAgentState
}

/**
 * The people expected in the field today, those busy now first. An office
 * card is left out on a day it did no field work (see
 * `isOfficeCardWithoutFieldWork`).
 */
export function homeTeam<Row extends HomeTeamRow>(rows: readonly Row[], workdayEnabled: boolean): HomeTeamEntry<Row>[] {
  return rows
    .filter((row) => !isOfficeCardWithoutFieldWork(row, workdayEnabled))
    .map((row, index) => ({ row, state: homeAgentState(row), index }))
    .sort((left, right) =>
      STATE_RANK[left.state.kind] - STATE_RANK[right.state.kind]
      || left.row.name.localeCompare(right.row.name)
      || left.index - right.index)
    .map(({ row, state }) => ({ row, state }))
}

export interface HomeFieldNow {
  total: number
  /** At a customer or on the way between stops. */
  inField: number
  atCustomer: number
  heading: number
  planDone: number
  notStarted: number
  /** Nothing today and no plan. */
  idle: number
}

export function fieldNow(team: readonly HomeTeamEntry[]): HomeFieldNow {
  const count = (kind: HomeAgentState["kind"]) => team.filter((entry) => entry.state.kind === kind).length
  const atCustomer = count("at-customer")
  const heading = count("heading")
  return {
    total: team.length,
    inField: atCustomer + heading,
    atCustomer,
    heading,
    planDone: count("plan-done"),
    notStarted: count("not-started"),
    idle: count("no-activity") + count("last-visit") + count("unplanned"),
  }
}

export interface HomeTodayPlan {
  planned: number
  done: number
  visits: number
}

/** Today's published stops across the team, and how many are visited. */
export function todayPlan(team: readonly HomeTeamEntry[]): HomeTodayPlan {
  let planned = 0
  let done = 0
  let visits = 0
  for (const { row } of team) {
    if (row.route) {
      planned += row.route.total
      done += Math.min(row.route.visited, row.route.total)
    }
    visits += row.visitCount
  }
  return { planned, done, visits }
}

/**
 * What the second figure shows. With a plan today it is today's plan. Without
 * one — a day off, or a working day nobody planned — it is whether the next
 * working day is ready, which is the thing left to do about it.
 */
export type HomePlanCard =
  | { kind: "today"; planned: number; done: number; visits: number }
  | { kind: "next"; date: string; isTomorrow: boolean; agents: number; withRoute: number }
  | { kind: "none" }

export function planCard(input: {
  today: string
  plan: HomeTodayPlan
  nextWorkday: { date: string; agents: number; withoutRoute: number } | null
}): HomePlanCard {
  if (input.plan.planned > 0) return { kind: "today", ...input.plan }
  const next = input.nextWorkday
  if (next && next.agents > 0) {
    return {
      kind: "next",
      date: next.date,
      isTomorrow: next.date === addDateKeyDays(input.today, 1),
      agents: next.agents,
      withRoute: Math.max(0, next.agents - next.withoutRoute),
    }
  }
  return { kind: "none" }
}
