import type { PrismaClient } from "@prisma/client"
import { MTM_WORKDAY_PAUSE_EVENT_TYPES, mtmWorkdayPauses, type MtmWorkdayPause, type MtmWorkdayPauseEvent } from "@/lib/mtm/workday-pauses"

/**
 * Where an agent's day went, for the «ring of the day» on the manager's
 * «Komanda» card and the agent's own «Bu gün» (owner, 2026-11-02, variant
 * «C. Кольцо дня»): with clients, on a break, and the rest — on the way and
 * between visits, which the phone cannot tell apart.
 *
 * From the start of the workday to its end, or to now while it runs. Visits
 * count from check-in to check-out (an open one to now); breaks come from the
 * workday's own journal through the one reader of breaks (workday-pauses.ts).
 * A visit's minutes that fall in a break are the break's.
 */
export type DayTime = {
  startedAt: string
  totalMinutes: number
  visitMinutes: number
  breakMinutes: number
  travelMinutes: number
}

type Interval = { from: number; to: number }

function clip(interval: Interval, window: Interval): Interval | null {
  const from = Math.max(interval.from, window.from)
  const to = Math.min(interval.to, window.to)
  return to > from ? { from, to } : null
}

/** Overlapping intervals as one: two visits open at once are one stretch of time. */
function merge(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.from - b.from)
  const out: Interval[] = []
  for (const interval of sorted) {
    const last = out[out.length - 1]
    if (last && interval.from <= last.to) last.to = Math.max(last.to, interval.to)
    else out.push({ ...interval })
  }
  return out
}

function length(intervals: Interval[]): number {
  return intervals.reduce((sum, interval) => sum + (interval.to - interval.from), 0)
}

/** `a` without the parts that lie in `b` (both merged). */
function subtract(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = []
  for (const interval of a) {
    let pieces = [interval]
    for (const cut of b) {
      pieces = pieces.flatMap((piece) => {
        if (cut.to <= piece.from || cut.from >= piece.to) return [piece]
        const left = cut.from > piece.from ? [{ from: piece.from, to: cut.from }] : []
        const right = cut.to < piece.to ? [{ from: cut.to, to: piece.to }] : []
        return [...left, ...right]
      })
    }
    out.push(...pieces)
  }
  return out
}

const minutes = (ms: number) => Math.round(ms / 60_000)

export function dayTimeOf(input: {
  startedAt: Date
  /** The workday's end; null while it runs. */
  completedAt: Date | null
  pauses: readonly MtmWorkdayPause[]
  visits: ReadonlyArray<{ checkInAt: Date; checkOutAt: Date | null }>
  now: Date
}): DayTime {
  const window: Interval = { from: input.startedAt.getTime(), to: Math.max(input.startedAt.getTime(), (input.completedAt ?? input.now).getTime()) }
  const end = window.to
  const breaks = merge(input.pauses.flatMap((pause) => clip({ from: pause.from.getTime(), to: (pause.to ?? input.now).getTime() }, window) ?? []))
  const visits = subtract(
    merge(input.visits.flatMap((visit) => clip({ from: visit.checkInAt.getTime(), to: (visit.checkOutAt ?? new Date(end)).getTime() }, window) ?? [])),
    breaks,
  )
  const total = minutes(window.to - window.from)
  const breakMinutes = Math.min(total, minutes(length(breaks)))
  const visitMinutes = Math.min(total - breakMinutes, minutes(length(visits)))
  return {
    startedAt: input.startedAt.toISOString(),
    totalMinutes: total,
    visitMinutes,
    breakMinutes,
    travelMinutes: Math.max(0, total - visitMinutes - breakMinutes),
  }
}

/**
 * The day of each given workday, in two queries for all of them: the
 * journal's break events and the agents' visits since the earliest start.
 */
export async function loadDayTimes(
  db: Pick<PrismaClient, "mtmAgentWorkdayEvent" | "mtmVisit">,
  organizationId: string,
  workdays: ReadonlyArray<{ id: string; agentId: string; startedAt: Date; completedAt: Date | null }>,
  now: Date,
): Promise<Map<string, DayTime>> {
  const out = new Map<string, DayTime>()
  if (workdays.length === 0) return out
  const events = await db.mtmAgentWorkdayEvent.findMany({
    where: {
      organizationId,
      workdayId: { in: workdays.map((day) => day.id) },
      type: { in: [...MTM_WORKDAY_PAUSE_EVENT_TYPES] },
    },
    orderBy: { occurredAt: "asc" },
    select: { workdayId: true, type: true, occurredAt: true, appliedAt: true },
  })
  const earliest = new Date(Math.min(...workdays.map((day) => day.startedAt.getTime())))
  const visits = await db.mtmVisit.findMany({
    where: {
      organizationId,
      agentId: { in: workdays.map((day) => day.agentId) },
      deletedAt: null,
      status: { not: "CANCELLED" },
      checkInAt: { lte: now },
      OR: [{ checkOutAt: null }, { checkOutAt: { gte: earliest } }],
    },
    select: { agentId: true, checkInAt: true, checkOutAt: true },
  })
  const eventsByWorkday = new Map<string, MtmWorkdayPauseEvent[]>()
  for (const event of events) {
    const list = eventsByWorkday.get(event.workdayId) ?? []
    list.push(event)
    eventsByWorkday.set(event.workdayId, list)
  }
  for (const day of workdays) {
    out.set(day.agentId, dayTimeOf({
      startedAt: day.startedAt,
      completedAt: day.completedAt,
      pauses: mtmWorkdayPauses(eventsByWorkday.get(day.id) ?? []),
      visits: visits.filter((visit) => visit.agentId === day.agentId),
      now,
    }))
  }
  return out
}
