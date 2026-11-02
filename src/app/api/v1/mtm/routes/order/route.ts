import { NextResponse } from "next/server"
import { z } from "zod"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { checkRateLimit, hashForRateLimit } from "@/lib/rate-limit"
import { guardInteractiveJsonMutation } from "@/lib/social/review-apply-request"
import { roadPath, roadTable } from "@/lib/mtm/road-router"
import {
  bestRouteOrder,
  readRouteOrder,
  routeOrderIsBetter,
  routeOrderMinutes,
  routeOrderReason,
  totalWait,
  type RouteOrderReading,
} from "@/lib/mtm/route-order"
import { hoursMinutes, type MtmDayHours } from "@/lib/mtm/customer-hours"

/**
 * POST /api/v1/mtm/routes/order — the planner's day read along the roads, and
 * the order that drives less and keeps more visits on time (route-order.ts;
 * owner 2026-11-01, mockup «MTM: порядок объезда лучше»).
 *
 * It hears only what the planner already shows — each stop's place, time and,
 * when the place has them, that day's «часы приёма» (null: does not work that
 * day; absent: nobody said) — and answers with road numbers and lines; it
 * reads and writes nothing in the database, so it needs the route permission
 * to read, nothing more.
 */
const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" }
/** Each drag re-reads the day; a person drags a few times a minute. */
const RATE_LIMIT = { maxRequests: 40, windowMs: 60_000 }
const MAX_STOPS = 25

const Clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const DayHours = z.object({
  open: Clock,
  close: Clock,
  breakFrom: Clock.nullable().optional(),
  breakTo: Clock.nullable().optional(),
}).strict()

const Body = z.object({
  stops: z.array(z.object({
    key: z.string().min(1).max(200),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    plannedTime: z.string().regex(/^\d{2}:\d{2}$/),
    hours: DayHours.nullable().optional(),
  }).strict()).min(2).max(MAX_STOPS),
}).strict()

/** A day the stop names, kept only when it reads as a day (open before close). */
function dayHours(hours: z.infer<typeof DayHours> | null | undefined): MtmDayHours | null | undefined {
  if (hours === undefined) return undefined
  if (hours === null) return null
  const open = hoursMinutes(hours.open)!
  const close = hoursMinutes(hours.close)!
  if (close <= open) return undefined
  const from = hoursMinutes(hours.breakFrom)
  const to = hoursMinutes(hours.breakTo)
  const lunch = from != null && to != null && open < from && from < to && to < close
  return lunch ? { open: hours.open, close: hours.close, breakFrom: hours.breakFrom!, breakTo: hours.breakTo! } : { open: hours.open, close: hours.close }
}

function summary(reading: RouteOrderReading, keys: string[]) {
  return {
    order: reading.order.map((index) => keys[index]),
    driveSeconds: Math.round(reading.driveSeconds),
    metres: Math.round(reading.metres),
    onTime: reading.onTime,
    endMinutes: Math.round(reading.endMinutes),
    arrivals: reading.arrivals.map((minutes) => Math.round(minutes)),
    lateMinutes: reading.lateMinutes,
    waitMinutes: reading.waitMinutes,
    closed: reading.closed,
    hoursKnown: reading.hoursKnown,
    inHours: reading.inHours,
    totalWaitMinutes: totalWait(reading),
  }
}

export const POST = withRouteFieldRlsAuth("read", async (req, auth) => {
  const guard = guardInteractiveJsonMutation(req)
  if (guard) {
    guard.headers.set("Cache-Control", NO_STORE["Cache-Control"])
    return guard
  }
  if (!checkRateLimit(await hashForRateLimit(`mtm-route-order:${auth.orgId}:${auth.userId}`), RATE_LIMIT)) {
    return NextResponse.json({ error: "Too many requests", code: "MTM_ROUTE_ORDER_RATE_LIMITED" }, { status: 429, headers: NO_STORE })
  }
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid stops", code: "MTM_ROUTE_ORDER_INVALID" }, { status: 400, headers: NO_STORE })
  }
  const stops = parsed.data.stops
  const keys = stops.map((stop) => stop.key)
  if (new Set(keys).size !== keys.length) {
    return NextResponse.json({ error: "Repeated stop", code: "MTM_ROUTE_ORDER_INVALID" }, { status: 400, headers: NO_STORE })
  }
  const times = stops.map((stop) => routeOrderMinutes(stop.plannedTime))
  if (times.some((time) => time == null)) {
    return NextResponse.json({ error: "Invalid time", code: "MTM_ROUTE_ORDER_INVALID" }, { status: 400, headers: NO_STORE })
  }

  const hours = stops.map((stop) => dayHours(stop.hours))
  const roads = await roadTable(stops)
  const identity = stops.map((_, index) => index)
  const current = roads ? readRouteOrder(identity, times as number[], roads, undefined, hours) : null
  if (!roads || !current) {
    // No roads, no numbers: the planner keeps what it showed before.
    return NextResponse.json({ error: "Roads unavailable", code: "MTM_ROUTE_ORDER_ROADS_UNAVAILABLE" }, { status: 503, headers: NO_STORE })
  }
  // The planner keeps the times with the positions: another order runs on
  // the same times, earliest first.
  const slots = [...(times as number[])].sort((a, b) => a - b)
  const bestOrder = bestRouteOrder(slots, roads, undefined, hours)
  const proposed = readRouteOrder(bestOrder, slots, roads, undefined, hours)
  const better = proposed != null && routeOrderIsBetter(current, proposed)

  const [currentLine, proposedLine] = await Promise.all([
    roadPath(stops),
    better && proposed ? roadPath(proposed.order.map((index) => stops[index])) : Promise.resolve(null),
  ])
  const reason = better && proposed ? routeOrderReason(current, proposed) : null

  return NextResponse.json({
    success: true,
    data: {
      current: { ...summary(current, keys), line: currentLine },
      proposed: better && proposed ? { ...summary(proposed, keys), line: proposedLine } : null,
      reason: reason && "stop" in reason ? { ...reason, stop: keys[reason.stop] } : reason,
    },
  }, { headers: NO_STORE })
})
