import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { addDateKeyDays, isDateKey } from "@/lib/mtm/mobile-week"
import { readAttendanceRules } from "@/lib/mtm/attendance-rule-store"
import { buildMtmAttendanceReport, filterMtmAttendanceRows, summarizeMtmAttendanceRows, MTM_ATTENDANCE_REPORT_MAX_DAYS, MTM_ATTENDANCE_REPORT_MAX_ROWS } from "@/lib/mtm/attendance-report"
import type { MtmRouteActor } from "@/lib/mtm/route-permissions"

export const AttendanceReportQuerySchema = z.object({
  from: z.string().refine(isDateKey),
  to: z.string().refine(isDateKey),
  employeeId: z.string().trim().min(1).max(191).optional(),
  teamId: z.string().trim().min(1).max(191).optional(),
  form: z.enum(["ALL", "LATE_EARLY", "ABSENCES", "JOURNAL"]).default("ALL"),
}).strict().refine((query) => isDateKey(query.from) && isDateKey(query.to)
  && query.to >= query.from && query.to < addDateKeyDays(query.from, MTM_ATTENDANCE_REPORT_MAX_DAYS))
export type AttendanceReportQuery = z.infer<typeof AttendanceReportQuerySchema>

export class AttendanceReportAccessError extends Error {
  readonly code = "MTM_ATTENDANCE_SCOPE_DENIED"
}

/**
 * One database snapshot for the row projection and its journal. The explicit
 * selects are a privacy boundary: break coordinates are never even read.
 */
export async function readMtmAttendanceReport(input: {
  organizationId: string
  actor: MtmRouteActor
  query: AttendanceReportQuery
  now?: Date
}) {
  const { organizationId, actor } = input
  const query = AttendanceReportQuerySchema.parse(input.query)
  if (actor.role === "AGENT" || (query.employeeId && actor.scopedAgentIds !== null && !actor.scopedAgentIds.includes(query.employeeId))) {
    throw new AttendanceReportAccessError()
  }
  const from = new Date(`${query.from}T00:00:00.000Z`)
  const to = new Date(`${query.to}T00:00:00.000Z`)
  const now = input.now ?? new Date()
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1
  return prisma.$transaction(async (tx) => {
    const employees = await tx.mtmAgent.findMany({
      where: {
        organizationId, role: "AGENT",
        ...(actor.scopedAgentIds === null ? {} : { id: { in: [...actor.scopedAgentIds] } }),
        ...(query.employeeId ? { AND: { id: query.employeeId } } : {}),
        ...(query.teamId ? { teamId: query.teamId } : {}),
      },
      select: { id: true, name: true, teamId: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: Math.floor(MTM_ATTENDANCE_REPORT_MAX_ROWS / days) + 1,
    })
    // Fail visibly if the report would exceed the documented limit; never
    // silently omit people from an absence report or its exported totals.
    if (employees.length * days > MTM_ATTENDANCE_REPORT_MAX_ROWS) throw new Error("MTM_ATTENDANCE_REPORT_TOO_LARGE")
    const agentIds = employees.map((employee) => employee.id)
    const teamIds = [...new Set(employees.flatMap((employee) => employee.teamId ? [employee.teamId] : []))]
    const [teams, workdays, calendar, rules] = await Promise.all([
      tx.mtmTeam.findMany({ where: { organizationId, id: { in: teamIds } }, select: { id: true, name: true } }),
      tx.mtmAgentWorkday.findMany({
        where: { organizationId, agentId: { in: agentIds }, workDate: { gte: from, lte: to } },
        select: {
          id: true, agentId: true, workDate: true, status: true, startedAt: true, completedAt: true, totalPausedSeconds: true,
          events: {
            where: { organizationId, agentId: { in: agentIds } },
            orderBy: [{ occurredAt: "asc" }, { appliedAt: "asc" }, { id: "asc" }],
            select: { id: true, type: true, occurredAt: true, appliedAt: true, claimedAt: true, serverReceivedAt: true },
          },
        },
      }),
      tx.mtmWorkCalendarDay.findMany({
        where: {
          organizationId, deletedAt: null, date: { gte: from, lte: to },
          OR: [{ teamId: null, agentId: null }, { teamId: { in: teamIds }, agentId: null }, { agentId: { in: agentIds }, teamId: null }],
        },
        select: { id: true, date: true, kind: true, name: true, teamId: true, agentId: true, movedToDate: true, routePlanningAllowed: true },
        orderBy: [{ date: "asc" }, { id: "asc" }],
      }),
      readAttendanceRules(organizationId, tx),
    ])
    const teamNames = new Map(teams.map((team) => [team.id, team.name]))
    const report = buildMtmAttendanceReport({
      employees: employees.map((employee) => ({ ...employee, teamName: employee.teamId ? teamNames.get(employee.teamId) ?? null : null })),
      workdays, calendar, rules, from: query.from, to: query.to, now,
    })
    const rows = filterMtmAttendanceRows(report.rows, { form: query.form })
    return { ...report, rows, totals: summarizeMtmAttendanceRows(rows), form: query.form }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15_000 })
}
