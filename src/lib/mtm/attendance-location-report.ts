import { ATTENDANCE_QR_STATES, type AttendanceQrState } from "@/lib/mtm/attendance-qr-contract"
import type { AttendanceLocationFinding } from "@/lib/mtm/attendance-location-contract"
import type { MtmAttendanceReportRow } from "@/lib/mtm/attendance-report"

/** Coordinates, accuracy, consent and installation identifiers cannot enter this DTO. */
export type AttendanceReportMark = {
  eventId: string; action: "START" | "FINISH"; claimedAt: string; serverReceivedAt: string | null
  state: Exclude<AttendanceLocationFinding, "BREAK_PRIVACY"> | "NOT_RECORDED"
  branch: { id: string; revisionId: string; name: string } | null
  distanceMeters: number | null
  qr?: { state: AttendanceQrState; branch: { id: string; revisionId: string; name: string } | null }
}
export type AttendanceLocationReportEvidence = {
  eventId: string; action: string; claimedAt: Date; serverReceivedAt: Date; locationState: string
  branchId: string | null; branchRevisionId: string | null; branchName: string | null; distanceMeters: number | null
  qrState?: string | null; qrBranchId?: string | null; qrBranchRevisionId?: string | null; qrBranchName?: string | null
}
const STATES: readonly string[] = ["INSIDE", "OUTSIDE", "UNCERTAIN", "UNCONFIGURED", "UNAVAILABLE", "NO_CONSENT"]
/** Only canonical endpoint events may acquire evidence; PAUSE/RESUME never do. */
export function attendanceReportMarks(row: MtmAttendanceReportRow, evidence: ReadonlyMap<string, AttendanceLocationReportEvidence>): AttendanceReportMark[] {
  return row.events.flatMap(event => {
    if (!event.id || (event.type !== "START" && event.type !== "FINISH")) return []
    const item = evidence.get(event.id)
    const valid = item && item.action === event.type && item.claimedAt.toISOString() === (event.claimedAt ?? event.occurredAt)
    const state = valid && STATES.includes(item.locationState) ? item.locationState as AttendanceReportMark["state"] : "NOT_RECORDED"
    const positioned = valid && ["INSIDE", "OUTSIDE", "UNCERTAIN"].includes(state)
    const branch = positioned && item.branchId && item.branchRevisionId && item.branchName
      ? { id: item.branchId, revisionId: item.branchRevisionId, name: item.branchName } : null
    const distance = item?.distanceMeters
    return [{ eventId: event.id, action: event.type, claimedAt: event.claimedAt ?? event.occurredAt,
      serverReceivedAt: event.serverReceivedAt, state, branch,
      distanceMeters: branch && distance != null && Number.isSafeInteger(distance) && distance >= 0 ? distance : null,
      ...(valid && item.locationState !== "BREAK_PRIVACY" && item.qrState && (ATTENDANCE_QR_STATES as readonly string[]).includes(item.qrState) ? { qr: { state: item.qrState as AttendanceQrState,
        branch: item.qrState === "VERIFIED" && item.qrBranchId && item.qrBranchRevisionId && item.qrBranchName
          ? { id: item.qrBranchId, revisionId: item.qrBranchRevisionId, name: item.qrBranchName } : null } } : {}) }]
  })
}
export const ATTENDANCE_LOCATION_STATE_MESSAGES: Record<AttendanceReportMark["state"] | "QR_UNCONFIRMED", string> = {
  QR_UNCONFIRMED: "qrReportUnconfirmed", INSIDE: "locationReportInside", OUTSIDE: "locationReportOutside", UNCERTAIN: "locationReportUncertain",
  UNCONFIGURED: "locationReportUnconfigured", UNAVAILABLE: "locationReportUnavailable", NO_CONSENT: "locationReportNoConsent", NOT_RECORDED: "locationReportNotRecorded",
}
type Text = (key: string, values?: Record<string, string | number>) => string
export function attendanceMarkText(mark: AttendanceReportMark, t: Text): string {
  if (mark.state === "NOT_RECORDED" && !mark.qr) return "—"
  const qr = mark.qr ? [mark.qr.branch?.name, t(`qrState${mark.qr.state}`)].filter(Boolean).join(" · ") : null
  const location = mark.state === "NOT_RECORDED" ? null : [mark.branch?.name, t(ATTENDANCE_LOCATION_STATE_MESSAGES[mark.state]),
    mark.distanceMeters === null ? null : t("locationReportDistance", { meters: mark.distanceMeters })].filter(Boolean).join(" · ")
  return [qr, qr && location ? t("qrGpsObservation", { value: location }) : location].filter(Boolean).join("; ")
}
export function attendanceEndpointBranch(row: MtmAttendanceReportRow, action: "START" | "FINISH") {
  // A corrected clock is not proof of a new location: preserve original marks
  // in the journal column, never attach their place to a correction's time.
  const instant = action === "START" ? row.startedAt : row.completedAt
  const matches = (row.locationMarks ?? []).filter(mark => mark.action === action && mark.claimedAt === instant)
  if (matches.length !== 1) return "—"
  const mark = matches[0]
  if (mark.qr) return mark.qr.state === "VERIFIED" ? mark.qr.branch?.name ?? "—" : "—"
  return mark.state === "INSIDE" ? mark.branch?.name ?? "—" : "—"
}
export function attendanceDayLocationText(row: MtmAttendanceReportRow, t: Text) {
  return (row.locationMarks ?? []).filter(mark => mark.state !== "NOT_RECORDED" || mark.qr)
    .map(mark => `${t(mark.action === "START" ? "reportStarted" : "reportFinished")}: ${attendanceMarkText(mark, t)}`).join("; ") || "—"
}
export type AttendanceBranchSummaryRow = {
  key: string; branch: AttendanceReportMark["branch"]; state: AttendanceReportMark["state"] | "QR_UNCONFIRMED" | null
  arrivals: number | null; departures: number | null; employees: number | null
  outside: number | null; uncertain: number | null; noLocation: number | null; noConsent: number | null
}
export function summarizeAttendanceBranches(rows: readonly MtmAttendanceReportRow[]) {
  const groups = new Map<string, { row: AttendanceBranchSummaryRow; employees: Set<string> }>()
  const employees = new Set<string>()
  let arrivals = 0, departures = 0, outside = 0, uncertain = 0, noLocation = 0, noConsent = 0, unknown = 0
  for (const day of rows) for (const mark of day.locationMarks ?? []) {
    const branch = mark.qr ? mark.qr.state === "VERIFIED" ? mark.qr.branch : null : mark.branch
    const state = mark.qr && !branch ? "QR_UNCONFIRMED" : mark.state
    const key = branch ? `branch:${branch.revisionId}` : `state:${state}`
    const known = Boolean(mark.qr) || mark.state !== "NOT_RECORDED", positioned = ["INSIDE", "OUTSIDE", "UNCERTAIN"].includes(mark.state)
    if (!groups.has(key)) groups.set(key, { row: { key, branch, state: branch ? null : state,
      arrivals: known ? 0 : null, departures: known ? 0 : null, employees: known ? 0 : null,
      outside: positioned ? 0 : null, uncertain: positioned ? 0 : null,
      noLocation: mark.state === "UNAVAILABLE" ? 0 : null, noConsent: mark.state === "NO_CONSENT" ? 0 : null }, employees: new Set() })
    const group = groups.get(key)!
    if (!known) { unknown++; continue }
    group.employees.add(day.employeeId); employees.add(day.employeeId); group.row.employees = group.employees.size
    if (mark.action === "START") { group.row.arrivals!++; arrivals++ } else { group.row.departures!++; departures++ }
    if (mark.state === "OUTSIDE") { group.row.outside!++; outside++ }
    if (mark.state === "UNCERTAIN") { group.row.uncertain!++; uncertain++ }
    if (mark.state === "UNAVAILABLE") { group.row.noLocation!++; noLocation++ }
    if (mark.state === "NO_CONSENT") { group.row.noConsent!++; noConsent++ }
  }
  return { rows: [...groups.values()].map(group => group.row).sort((a, b) => {
    if (Boolean(a.branch) !== Boolean(b.branch)) return a.branch ? -1 : 1
    return (a.branch?.name ?? a.state ?? "").localeCompare(b.branch?.name ?? b.state ?? "") || a.key.localeCompare(b.key)
  }), totals: { arrivals, departures, employees: employees.size, outside, uncertain, noLocation, noConsent, unknown } }
}
