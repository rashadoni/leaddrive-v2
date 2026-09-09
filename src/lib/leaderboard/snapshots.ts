/**
 * KPI Arena history (Phase D) — pure helpers shared by the snapshot cron and the
 * history read API. Prisma-free so they unit-test in isolation.
 */
import type { LeaderboardGroup } from "./types"

/** One agent's standing captured in a snapshot's `standings` JSON array. */
export interface Standing {
  id: string
  attainmentPct: number
  volume: number
  rank: number
}

export type HistoryWindow = "1h" | "1d" | "1m" | "1y"

/** Window → lookback in ms (1m≈30d, 1y≈365d — calendar-agnostic, good enough for a trend). */
export const HISTORY_WINDOW_MS: Record<HistoryWindow, number> = {
  "1h": 3_600_000,
  "1d": 86_400_000,
  "1m": 30 * 86_400_000,
  "1y": 365 * 86_400_000,
}

export function isHistoryWindow(v: unknown): v is HistoryWindow {
  return v === "1h" || v === "1d" || v === "1m" || v === "1y"
}

/** Hour bucket (UTC) — one snapshot per org×group×hour. `YYYY-MM-DDTHH`. */
export function snapshotBucket(now: Date): string {
  return now.toISOString().slice(0, 13)
}

/** Deterministic PK so a double-run within the same hour upserts (no dup). */
export function snapshotId(orgId: string, group: LeaderboardGroup, bucket: string): string {
  return `${orgId}:${group}:${bucket}`
}

export interface SeriesPoint {
  t: string // ISO timestamp
  attainmentPct: number
  rank: number
}

/**
 * Pull one agent's attainment/rank out of each snapshot's standings, in order.
 * Snapshots where the agent is absent (joined later / left) are skipped.
 */
export function extractAgentSeries(
  snapshots: { capturedAt: Date; standings: unknown }[],
  agentId: string,
): SeriesPoint[] {
  const out: SeriesPoint[] = []
  for (const s of snapshots) {
    const arr = Array.isArray(s.standings) ? (s.standings as Standing[]) : []
    const e = arr.find((x) => x && x.id === agentId)
    if (e && Number.isFinite(e.attainmentPct)) {
      out.push({ t: s.capturedAt.toISOString(), attainmentPct: e.attainmentPct, rank: e.rank })
    }
  }
  return out
}

/** Cap a series to ~max evenly-spaced points (always keeps the first + last). */
export function downsample<T>(points: T[], max: number): T[] {
  if (max < 2 || points.length <= max) return points
  const step = (points.length - 1) / (max - 1)
  const out: T[] = []
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)])
  return out
}
