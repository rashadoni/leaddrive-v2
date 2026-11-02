import { Prisma } from "@prisma/client"

/**
 * Who HR's work-time attendance tracks: office staff enrolled in attendance.
 *
 * A field agent (role AGENT) presses "Start day" for their field manager only;
 * that day is not part of the HR timesheet, its reports, reminders or mark
 * checks (owner, 2026-10-14: "агент значит он полевой… его отчёт не ведётся").
 * Every reader of the attendance roster uses this one rule; a copy of the old
 * "AGENT or participant" rule is refused by attendance-tracking.test.ts.
 */
export const ATTENDANCE_TRACKED_CARD_WHERE = { attendanceParticipant: true, role: { not: "AGENT" } } satisfies Prisma.MtmAgentWhereInput

export function isAttendanceTrackedCard(card: { role: string; attendanceParticipant: boolean | null }): boolean {
  return card.role !== "AGENT" && card.attendanceParticipant === true
}

/** The same rule for raw SQL over mtm_agents, optionally through a table alias. */
export function attendanceTrackedCardSql(alias?: string): Prisma.Sql {
  if (alias !== undefined && !/^[a-z]+$/.test(alias)) throw new Error("Invalid SQL alias")
  const column = (name: string) => alias ? `${alias}."${name}"` : `"${name}"`
  return Prisma.raw(`(${column("attendanceParticipant")} AND ${column("role")} <> 'AGENT')`)
}
