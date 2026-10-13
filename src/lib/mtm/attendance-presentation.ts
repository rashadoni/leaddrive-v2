/** Exact, locale-neutral duration shared by screens and exported attendance forms. */
export function formatAttendanceDuration(seconds: number | null): string {
  if (seconds === null || !Number.isSafeInteger(seconds) || seconds < 0) return "—"
  const hours = Math.floor(seconds / 3600)
  const minutes = String(Math.floor(seconds % 3600 / 60)).padStart(2, "0")
  const remainder = seconds % 60
  return `${hours}:${minutes}${remainder ? `:${String(remainder).padStart(2, "0")}` : ""}`
}

export const DEFAULT_ATTENDANCE_DAY_COLUMNS = ["employee", "team", "date", "status", "startedAt", "completedAt", "worked", "paused", "late", "early", "notes"] as const
export const DEFAULT_ATTENDANCE_JOURNAL_COLUMNS = ["employee", "team", "date", "event", "phoneAt", "serverAt"] as const
