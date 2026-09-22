/**
 * Owner 2026-09-22 on the history map: «why a straight line — he does not
 * move like that». The blue track joined every consecutive pair of points,
 * so a phone that sent nothing for hours drew a ruler across the city, and
 * the red «no data» dash was painted on top of that same blue line. The
 * track now breaks where the data does; only the red dash marks the unknown
 * stretch between the last point before a gap and the first one after it.
 */
export type HistoryPathPoint = { latitude: number; longitude: number; recordedAt: string }
export type HistoryPathGap = { startedAt: string; endedAt: string }

/** The accepted points as runs of the actual track, split at every gap. */
export function splitHistoryPathAtGaps(
  points: readonly HistoryPathPoint[],
  gaps: readonly HistoryPathGap[],
): Array<Array<[number, number]>> {
  const gapStarts = gaps.map((gap) => Date.parse(gap.startedAt)).filter(Number.isFinite)
  const runs: Array<Array<[number, number]>> = []
  let run: Array<[number, number]> = []
  let previous: number | null = null
  for (const point of points) {
    const at = Date.parse(point.recordedAt)
    // A gap starts at the last point before the silence (to the second).
    if (previous !== null && gapStarts.some((start) => Math.abs(start - previous!) < 1_000 && at > start)) {
      if (run.length > 1) runs.push(run)
      run = []
    }
    run.push([point.latitude, point.longitude])
    previous = at
  }
  if (run.length > 1) runs.push(run)
  return runs
}

/** One palette for the map and its legend, so the two cannot disagree. */
export const HISTORY_MAP_COLORS = {
  track: "#2563eb",
  gap: "#dc2626",
  plan: "#7c3aed",
  stop: "#f59e0b",
  visit: "#10b981",
  current: "#fb923c",
} as const
