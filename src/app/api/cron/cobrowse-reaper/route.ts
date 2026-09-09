import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { runWithRlsBypass } from "@/lib/rls-context"

/**
 * POST /api/cron/cobrowse-reaper
 *
 * T8 Cobrowse — slice-3c stale-session reaper.
 *
 * Force-ends cobrowse sessions whose SSE heartbeat (`lastSeenAt`)
 * hasn't been poked in more than `STALE_THRESHOLD_MS` (default
 * 15 min). Falls back to `updatedAt` for sessions that never had an
 * SSE subscriber (e.g. pending sessions where the customer never
 * opened the join URL). Catches the "agent navigated away
 * mid-session" zombie case the slice-3b dashboard didn't handle:
 * the customer's `<video>` may still be streaming, but no agent
 * SSE is bumping `lastSeenAt` so the row gets reaped.
 *
 * Why a reaper instead of a beforeunload handler:
 *   - beforeunload doesn't fire on tab crash, browser kill, or
 *     network drop — only on graceful navigate-away
 *   - reaper is the canonical backstop; covers ALL terminal
 *     scenarios that the websocket-style channel can't detect
 *     (in-memory channel manager has no row visibility either)
 *
 * Auth: `x-cron-secret` / `Bearer` against CRON_SECRET env var —
 * mirrors adaptive-ai-refresh / proactive-refresh / content-perf-
 * refresh patterns. 503 when CRON_SECRET unset (closed-by-default).
 *
 * Cadence: external scheduler. Recommended every 5 min.
 */

/** Stale-after window. Sessions whose `lastSeenAt` (or `updatedAt`
 *  fallback for never-subscribed rows) drifts beyond this get
 *  force-ended on the next reaper tick. */
const STALE_THRESHOLD_MS = 15 * 60 * 1000

/** Cap on rows processed per tick — prevents a runaway burst when
 *  the cron hasn't run for hours. Excess rows wait for next tick. */
const MAX_PER_TICK = 500

export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  const startedAt = Date.now()
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS)
  const summary = {
    scanned: 0,
    reaped: 0,
    errors: [] as string[],
  }

  try {
    // Liveness predicate: prefer `lastSeenAt` (bumped on every SSE
    // heartbeat) and fall back to `updatedAt` for sessions that
    // never had an SSE subscriber (e.g. pending sessions where the
    // customer never opened the join URL). The `(status,
    // lastSeenAt)` index from migration `20260530100000` covers the
    // first OR clause; the second falls through to a partial index
    // scan but rows in that branch are bounded by how often
    // sessions are created without anyone subscribing.
    const stale: { id: string; status: string }[] = await prisma.cobrowseSession.findMany({
      where: {
        status: { in: ["pending", "awaiting_consent", "active", "paused"] },
        OR: [
          { lastSeenAt: { lt: cutoff } },
          { lastSeenAt: null, updatedAt: { lt: cutoff } },
        ],
      },
      select: { id: true, status: true },
      take: MAX_PER_TICK,
    })
    summary.scanned = stale.length

    if (stale.length > 0) {
      // Conditional-where on `id IN (...)` keeps the update atomic
      // even if another route (manual end) races us. updateMany on
      // a status-filtered IN-set means a session that flipped to
      // ended between the findMany and the updateMany is skipped
      // (count smaller than scanned).
      const result = await prisma.cobrowseSession.updateMany({
        where: {
          id: { in: stale.map((s) => s.id) },
          status: { in: ["pending", "awaiting_consent", "active", "paused"] },
        },
        data: {
          status: "ended",
          endedAt: new Date(),
          endReason: "timeout",
        },
      })
      summary.reaped = result.count
    }

    return NextResponse.json({
      success: true,
      durationMs: Date.now() - startedAt,
      summary,
    })
  } catch (e) {
    console.error("[cobrowse-reaper] cron error:", e)
    return NextResponse.json(
      { error: "Internal server error", message: (e as Error).message },
      { status: 500 },
    )
  }
  })
}
