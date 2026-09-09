/**
 * The exact projection captured before and after a Workforce time correction.
 * Timestamps are canonical UTC strings because the legacy workday table uses
 * PostgreSQL timestamp-without-time-zone columns under the application UTC
 * contract.
 */
export type WorkforceWorkdayCorrectionFacts = {
  id: string
  workDate: string
  status: "STARTED" | "PAUSED" | "COMPLETED"
  startedAt: string
  pausedAt: string | null
  completedAt: string | null
  totalPausedSeconds: number
}

export function workforceWorkdayCorrectionFacts(workday: {
  id: string
  workDate: Date
  status: string
  startedAt: Date
  pausedAt: Date | null
  completedAt: Date | null
  totalPausedSeconds: number
}): WorkforceWorkdayCorrectionFacts {
  return {
    id: workday.id,
    workDate: workday.workDate.toISOString().slice(0, 10),
    status: workday.status as WorkforceWorkdayCorrectionFacts["status"],
    startedAt: workday.startedAt.toISOString(),
    pausedAt: workday.pausedAt?.toISOString() ?? null,
    completedAt: workday.completedAt?.toISOString() ?? null,
    totalPausedSeconds: workday.totalPausedSeconds,
  }
}
