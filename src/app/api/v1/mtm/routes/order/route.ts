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
  type RouteOrderReading,
} from "@/lib/mtm/route-order"

/**
 * POST /api/v1/mtm/routes/order — the planner's day read along the roads, and
 * the order that drives less and keeps more visits on time (route-order.ts;
 * owner 2026-11-01, mockup «MTM: порядок объезда лучше»).
 *
 * It hears only what the planner already shows — each stop's place and time —
 * and answers with road numbers and lines; it reads and writes nothing in the
 * database, so it needs the route permission to read, nothing more.
 */
const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" }
/** Each drag re-reads the day; a person drags a few times a minute. */
const RATE_LIMIT = { maxRequests: 40, windowMs: 60_000 }
const MAX_STOPS = 25

const Body = z.object({
  stops: z.array(z.object({
    key: z.string().min(1).max(200),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    plannedTime: z.string().regex(/^\d{2}:\d{2}$/),
  }).strict()).min(2).max(MAX_STOPS),
}).strict()

function summary(reading: RouteOrderReading, keys: string[]) {
  return {
    order: reading.order.map((index) => keys[index]),
    driveSeconds: Math.round(reading.driveSeconds),
    metres: Math.round(reading.metres),
    onTime: reading.onTime,
    endMinutes: Math.round(reading.endMinutes),
    arrivals: reading.arrivals.map((minutes) => Math.round(minutes)),
    lateMinutes: reading.lateMinutes,
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

  const roads = await roadTable(stops)
  const identity = stops.map((_, index) => index)
  const current = roads ? readRouteOrder(identity, times as number[], roads) : null
  if (!roads || !current) {
    // No roads, no numbers: the planner keeps what it showed before.
    return NextResponse.json({ error: "Roads unavailable", code: "MTM_ROUTE_ORDER_ROADS_UNAVAILABLE" }, { status: 503, headers: NO_STORE })
  }
  // The planner keeps the times with the positions: another order runs on
  // the same times, earliest first.
  const slots = [...(times as number[])].sort((a, b) => a - b)
  const bestOrder = bestRouteOrder(slots, roads)
  const proposed = readRouteOrder(bestOrder, slots, roads)
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
      reason: reason?.kind === "LATE_FIXED" ? { ...reason, stop: keys[reason.stop] } : reason,
    },
  }, { headers: NO_STORE })
})
