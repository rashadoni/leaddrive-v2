/**
 * KPI Arena — hourly standings snapshot cron (Phase D).
 *
 * POST /api/cron/leaderboard-snapshot
 *
 * Writes one LeaderboardSnapshot row per active org × group × hour-bucket,
 * capturing each agent's {attainmentPct, volume, rank} via the SAME aggregators
 * the live boards use (with the org's LeaderboardConfig), so the agent-detail
 * trend (1h/1d/1m/1y) matches the live numbers. Each group is snapshotted at its
 * arena-default period. No backfill — the trend fills in as ticks accumulate.
 *
 * Idempotent per hour via a deterministic id `${orgId}:${group}:${YYYY-MM-DDTHH}`:
 * the PK + upsert dedupe a concurrent double-run; a re-run within the hour refreshes
 * the bucket to the latest standings. Per-org failures are isolated.
 *
 * Recommended schedule: hourly (Postgres-cron / crontab, no Redis — same as the
 * MTM backstop drainer):
 *   0 * * * * curl -X POST http://localhost:3001/api/cron/leaderboard-snapshot -H "x-cron-secret: $CRON_SECRET"
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { runWithRlsBypass } from "@/lib/rls-context"
import {
  ALL_GROUPS,
  periodStart,
  type LeaderboardGroup,
  type LeaderboardPeriod,
  type NormalizedAgent,
} from "@/lib/leaderboard/types"
import { loadLeaderboardConfig, type LeaderboardConfigResolved } from "@/lib/leaderboard/config-loader"
import { computeSalesLeaderboard } from "@/lib/leaderboard/sales"
import { computeMtmLeaderboard } from "@/lib/leaderboard/mtm"
import { computeTicketsLeaderboard } from "@/lib/leaderboard/tickets"
import { computeProjectsLeaderboard } from "@/lib/leaderboard/projects"
import { computeTasksLeaderboard } from "@/lib/leaderboard/tasks"
import { snapshotBucket, snapshotId, type Standing } from "@/lib/leaderboard/snapshots"

// Snapshot each group at its arena-default period so the trend matches the board.
const SNAPSHOT_PERIOD: Record<LeaderboardGroup, LeaderboardPeriod> = {
  sales: "quarter",
  mtm: "month",
  tickets: "month",
  projects: "month",
  tasks: "month",
}

function computeGroup(
  orgId: string,
  group: LeaderboardGroup,
  cfg: LeaderboardConfigResolved,
  now: Date,
): Promise<NormalizedAgent[]> {
  const period = SNAPSHOT_PERIOD[group]
  switch (group) {
    case "sales":
      return computeSalesLeaderboard(orgId, period, now)
    case "mtm":
      return computeMtmLeaderboard(orgId, periodStart(period, now), now, cfg.mtmWeights, cfg.statusThresholds)
    case "tickets":
      return computeTicketsLeaderboard(orgId, period, now, cfg.statusThresholds)
    case "projects":
      return computeProjectsLeaderboard(orgId, period, now, cfg.statusThresholds)
    case "tasks":
      return computeTasksLeaderboard(orgId, period, now, cfg.statusThresholds)
  }
}

export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
    const cronError = requireCronAuth(req)
    if (cronError) return cronError

    const startedAt = Date.now()
    const now = new Date()
    const bucket = snapshotBucket(now)

    try {
      const orgs = await prisma.organization.findMany({ where: { isActive: true }, select: { id: true } })
      let written = 0
      const errors: Array<{ organizationId: string; error: string }> = []

      for (const org of orgs) {
        try {
          const cfg = await loadLeaderboardConfig(org.id)
          for (const group of ALL_GROUPS) {
            const agents = await computeGroup(org.id, group, cfg, now)
            if (agents.length === 0) continue // empty board → nothing to snapshot
            const standings: Standing[] = agents.map((a) => ({
              id: a.id,
              attainmentPct: a.attainmentPct,
              volume: a.volume,
              rank: a.rank,
            }))
            const id = snapshotId(org.id, group, bucket)
            await prisma.leaderboardSnapshot.upsert({
              where: { id },
              update: { standings, capturedAt: now }, // refresh to latest within the hour
              create: { id, organizationId: org.id, group, standings, capturedAt: now },
            })
            written++
          }
        } catch (err) {
          errors.push({ organizationId: org.id, error: err instanceof Error ? err.message : String(err) })
        }
      }

      return NextResponse.json({ ok: true, orgs: orgs.length, bucket, written, errors, durationMs: Date.now() - startedAt })
    } catch (err) {
      console.error("[leaderboard-snapshot] cron error:", err)
      return NextResponse.json({ error: "Failed to snapshot leaderboard" }, { status: 500 })
    }
  })
}
