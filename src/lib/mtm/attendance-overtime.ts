import type { MtmAttendanceReportRow } from "@/lib/mtm/attendance-report"
import { attendanceApprovedPeriodWindow, type AttendanceApprovedPeriod } from "@/lib/mtm/attendance-request-projection"

type Window = [number, number]
export type AttendanceOvertimeRow = {
  row: MtmAttendanceReportRow
  excessSeconds: number | null
  thresholdSeconds: number | null
  approvedSeconds: number | null
  state: "UNKNOWN" | "THRESHOLD_UNSET" | "EXCEEDED" | "WITHIN"
}

function unionSeconds(windows: Window[]) {
  let cursor = -Infinity, seconds = 0
  for (const [from, to] of [...windows].sort(([a], [b]) => a - b)) {
    seconds += Math.max(0, to - Math.max(cursor, from)) / 1000
    cursor = Math.max(cursor, to)
  }
  return seconds
}

/** Uses the shared report's final work/break facts. Approval is an allowance,
 * never proof of work or a payroll calculation. A night allowance goes to its
 * sole intersecting recorded shift; ambiguous matches stay unknown. */
export function attendanceOvertimeRows(rows: readonly MtmAttendanceReportRow[]): AttendanceOvertimeRow[] {
  const requests = new Map<string, AttendanceApprovedPeriod>()
  const windows = new Map<MtmAttendanceReportRow, Window[]>()
  const unknown = new Set<MtmAttendanceReportRow>()
  const byEmployee = new Map<string, MtmAttendanceReportRow[]>()
  for (const row of rows) {
    const employeeRows = byEmployee.get(row.employeeId) ?? []
    employeeRows.push(row); byEmployee.set(row.employeeId, employeeRows)
    for (const request of row.approvedRequests ?? []) {
      if (request.details.kind === "OVERTIME" && request.agentId === row.employeeId) requests.set(`${request.agentId}:${request.id}`, request)
    }
  }
  for (const request of requests.values()) {
    const interval = request.details.unit === "HOURS" ? attendanceApprovedPeriodWindow(request) : null
    const people = byEmployee.get(request.agentId) ?? []
    const matches = interval ? people.filter(row => row.workdayId && row.startedAt && row.completedAt
      && Date.parse(row.startedAt) < interval[1] && Date.parse(row.completedAt) > interval[0]) : []
    const targets = matches.length ? matches : people.filter(row => row.date === request.startDate)
    if (!interval || targets.length !== 1) {
      for (const target of targets) unknown.add(target)
      continue
    }
    windows.set(targets[0], [...(windows.get(targets[0]) ?? []), interval])
  }
  return rows.filter(row => row.workdayId || windows.has(row) || unknown.has(row)).map(row => {
    const complete = row.factsState === "VALID" && !!row.completedAt && row.kind !== "OPEN" && row.kind !== "MISSING_FINISH"
      && row.workedSeconds !== null && Number.isFinite(row.workedSeconds) && row.workedSeconds >= 0
      && Number.isFinite(row.expectedWorkSeconds) && row.expectedWorkSeconds >= 0
    const excessSeconds = complete ? Math.max(0, row.workedSeconds! - row.expectedWorkSeconds) : null
    const thresholdSeconds = row.overtimeThresholdMinutes != null && Number.isFinite(row.overtimeThresholdMinutes) && row.overtimeThresholdMinutes >= 0
      ? row.overtimeThresholdMinutes * 60 : null
    return { row, excessSeconds, thresholdSeconds, approvedSeconds: unknown.has(row) ? null : unionSeconds(windows.get(row) ?? []),
      state: excessSeconds === null ? "UNKNOWN" : thresholdSeconds === null ? "THRESHOLD_UNSET" : excessSeconds > thresholdSeconds ? "EXCEEDED" : "WITHIN" }
  })
}

/**
 * The overtime that counts in totals and on the timesheet. Owner's question,
 * 2026-10-16 → «начинай» 2026-10-17: the threshold exists only on shift plans,
 * so a company working by its plain rules never had one and its «Overtime»
 * column read 0:00 even for someone three hours over the schedule. Without a
 * threshold every hour over the schedule counts; with one, only past it.
 */
export function attendanceCountedOvertimeSeconds(item: AttendanceOvertimeRow): number {
  if (item.state === "EXCEEDED") return item.excessSeconds ?? 0
  if (item.state === "THRESHOLD_UNSET") return item.excessSeconds ?? 0
  return 0
}
