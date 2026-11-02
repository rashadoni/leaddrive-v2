/** Personnel → Timesheet filter buttons: each keeps the people with at least
 * one such day. A plain module: the server page reads it too, and a value
 * exported from a "use client" file reaches a server component as a stub. */
export const TIMESHEET_ISSUES = ["late", "absent", "missing-finish", "overtime"] as const
export type TimesheetIssue = (typeof TIMESHEET_ISSUES)[number]
