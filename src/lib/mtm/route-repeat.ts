/**
 * «Повторить маршрут» (Zeytun 2026-11-13: «клиент хочет повторяющийся
 * маршрут: например, каждую пятницу идёт по какому-то маршруту. Чтоб мог
 * пересоздавать»; owner's mockup approved with «Давай»).
 *
 * A repeat is ordinary routes on the chosen dates, made through the same two
 * requests the planner makes — create as a draft, then publish — so every
 * server rule applies to each date on its own: a closed calendar day, a doctor
 * who no longer works at that clinic, a clash with another published route.
 * Nothing here is a template the server keeps: each route can then be changed
 * alone.
 */

export const MTM_ROUTE_REPEAT_MAX_ROUTES = 26
const DAY_MS = 86_400_000

/** ISO weekday of a YYYY-MM-DD key: Monday 1 … Sunday 7. */
export function isoWeekday(dateKey: string): number {
  const day = new Date(`${dateKey}T00:00:00.000Z`).getUTCDay()
  return day === 0 ? 7 : day
}

function addDays(dateKey: string, days: number): string {
  return new Date(Date.parse(`${dateKey}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

function isDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
}

/**
 * The dates a repeat makes: the chosen weekday, every one or two weeks,
 * after the source route's own day and after today, up to `until` inclusive,
 * at most MTM_ROUTE_REPEAT_MAX_ROUTES of them.
 */
export function mtmRouteRepeatDates(input: {
  sourceDate: string
  today: string
  weekday: number
  everyWeeks: 1 | 2
  until: string
}): string[] {
  const { sourceDate, today, weekday, everyWeeks, until } = input
  if (![sourceDate, today, until].every(isDateKey) || weekday < 1 || weekday > 7) return []
  const after = sourceDate > today ? sourceDate : today
  // Counted from the source route's week, so «через неделю» keeps its rhythm.
  let cursor = addDays(sourceDate, (weekday - isoWeekday(sourceDate) + 7) % 7)
  const dates: string[] = []
  while (cursor <= until && dates.length < MTM_ROUTE_REPEAT_MAX_ROUTES) {
    if (cursor > after) dates.push(cursor)
    cursor = addDays(cursor, 7 * everyWeeks)
  }
  return dates
}

export type MtmRouteRepeatSource = {
  date: string
  name?: string | null
  agentId: string | null
  assignments?: Array<{ agentId: string; role: string; removedAt?: string | null }> | null
  points?: Array<{
    customerId: string
    contactId?: string | null
    orderIndex: number
    plannedTime?: string | null
    deletedAt?: string | null
  }> | null
}

/**
 * The create request for one date: the same people, the same stops in the
 * same order, each meeting at the same time of day. Times move by whole days,
 * which keeps the clock time in every zone without summer time (Baku has none).
 */
export function mtmRouteRepeatPayload(source: MtmRouteRepeatSource, date: string) {
  const sourceDay = source.date.slice(0, 10)
  const shift = Date.parse(`${date}T00:00:00.000Z`) - Date.parse(`${sourceDay}T00:00:00.000Z`)
  const assignments = (source.assignments ?? [])
    .filter((assignment) => !assignment.removedAt && assignment.role !== "OBSERVER")
    .map((assignment) => ({ agentId: assignment.agentId, role: assignment.role }))
  return {
    name: source.name || null,
    date,
    status: "DRAFT" as const,
    agentId: source.agentId,
    ...(assignments.length > 0 ? { assignments } : { assignments: [{ agentId: source.agentId, role: "PRIMARY" }] }),
    points: [...(source.points ?? [])]
      .filter((point) => !point.deletedAt)
      .sort((left, right) => left.orderIndex - right.orderIndex)
      .map((point) => ({
        customerId: point.customerId,
        contactId: point.contactId ?? null,
        plannedTime: point.plannedTime ? new Date(Date.parse(point.plannedTime) + shift).toISOString() : null,
      })),
  }
}

export type MtmRouteRepeatOutcome =
  | { date: string; result: "created"; routeId: string; published: boolean }
  | { date: string; result: "skipped"; reason: "busy" | "closedDay" | "stopsInvalid" | "conflict" | "duplicate" | "failed"; message?: string }

/** Why the server refused one date, in the words the screen shows. */
export function mtmRouteRepeatRefusal(code: unknown): Extract<MtmRouteRepeatOutcome, { result: "skipped" }>["reason"] {
  switch (code) {
    case "MTM_ROUTE_NON_WORKING_DAY": return "closedDay"
    case "MTM_ROUTE_REFERENCE_INVALID":
    case "MTM_ROUTE_TARGET_ASSIGNMENT_REQUIRED": return "stopsInvalid"
    case "ROUTE_CONFLICT":
    case "ROUTE_POINT_TIME_CONFLICT": return "conflict"
    case "ROUTE_DUPLICATE": return "duplicate"
    default: return "failed"
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

/**
 * Makes the routes one date at a time. A date the agent already has a route on
 * is skipped before asking; a date the server refuses is skipped with its
 * reason, and the rest go on.
 */
export async function runMtmRouteRepeat(input: {
  source: MtmRouteRepeatSource
  dates: string[]
  busyDates: ReadonlySet<string>
  publish: boolean
  fetch: Fetch
  headers?: Record<string, string>
}): Promise<MtmRouteRepeatOutcome[]> {
  const headers = { "content-type": "application/json", ...(input.headers ?? {}) }
  const outcomes: MtmRouteRepeatOutcome[] = []
  for (const date of input.dates) {
    if (input.busyDates.has(date)) {
      outcomes.push({ date, result: "skipped", reason: "busy" })
      continue
    }
    try {
      const response = await input.fetch("/api/v1/mtm/routes", {
        method: "POST",
        headers,
        body: JSON.stringify(mtmRouteRepeatPayload(input.source, date)),
      })
      const body = await response.json().catch(() => ({}))
      const routeId = body?.data?.id
      if (!response.ok || typeof routeId !== "string") {
        outcomes.push({ date, result: "skipped", reason: mtmRouteRepeatRefusal(body?.code), message: body?.error })
        continue
      }
      let published = false
      if (input.publish) {
        const publishResponse = await input.fetch(`/api/v1/mtm/routes/${routeId}/publish`, {
          method: "POST",
          headers,
          body: JSON.stringify({ expectedVersion: body?.data?.version }),
        })
        published = publishResponse.ok
      }
      outcomes.push({ date, result: "created", routeId, published })
    } catch (error) {
      outcomes.push({ date, result: "skipped", reason: "failed", message: error instanceof Error ? error.message : undefined })
    }
  }
  return outcomes
}
