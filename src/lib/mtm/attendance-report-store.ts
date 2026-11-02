import { readAttendanceParticipationHistory } from "@/lib/mtm/attendance-participation-store"
import { ATTENDANCE_TRACKED_CARD_WHERE } from "@/lib/mtm/attendance-tracking"
import { attendanceAccountingRows } from "@/lib/mtm/attendance-shift-plan"
import { readAttendanceShiftAssignments } from "@/lib/mtm/attendance-shift-store"
import { addDateKeyDays } from "@/lib/mtm/mobile-week"
import type { AttendanceEmploymentEvent } from "@/lib/mtm/attendance-employment"
import { attendanceReportMarks } from "@/lib/mtm/attendance-location-report"
import { readAttendanceLocationReportEvidence } from "@/lib/mtm/attendance-location-report-store"
import { AttendanceRequestDetailsSchema } from "@/lib/mtm/attendance-request-contract"
import type { AttendanceApprovedPeriod } from "@/lib/mtm/attendance-request-projection"
import { readAttendanceDayKinds } from "@/lib/mtm/attendance-day-kind-store"
import { createHash } from "node:crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { readAttendanceRules } from "@/lib/mtm/attendance-rule-store"
import { projectAttendanceCorrectionFacts } from "@/lib/mtm/attendance-correction-facts"
import { buildMtmAttendanceReport, filterMtmAttendanceRows, summarizeMtmAttendanceRows, MTM_ATTENDANCE_REPORT_MAX_ROWS, type MtmAttendanceReportRow } from "@/lib/mtm/attendance-report"
import type { MtmRouteActor } from "@/lib/mtm/route-permissions"

export { AttendanceReportQuerySchema } from "@/lib/mtm/attendance-query"
import { AttendanceReportQuerySchema, type AttendanceReportQuery } from "@/lib/mtm/attendance-query"

export class AttendanceReportAccessError extends Error {
  readonly code = "MTM_ATTENDANCE_SCOPE_DENIED"
}

/**
 * One database snapshot for the row projection and its journal. The explicit
 * selects are a privacy boundary: break coordinates are never even read.
 */
export type AttendanceReportReadInput = { organizationId: string; actor: MtmRouteActor; query: AttendanceReportQuery; now?: Date }
export async function readMtmAttendanceReport(input: AttendanceReportReadInput) {
  return prisma.$transaction(tx => readMtmAttendanceReportInTransaction(tx, input), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15_000 })
}
export async function readMtmAttendanceReportInTransaction(tx: Prisma.TransactionClient, input: AttendanceReportReadInput) {
  const { actor } = input
  const query = AttendanceReportQuerySchema.parse(input.query)
  if (actor.role === "AGENT" || (query.employeeId && actor.scopedAgentIds !== null && !actor.scopedAgentIds.includes(query.employeeId))) throw new AttendanceReportAccessError()
  return readAttendanceProjectionInTransaction(tx, { organizationId: input.organizationId, authorizedEmployeeIds: actor.scopedAgentIds, query, now: input.now })
}
/** Internal projection only, never an auth boundary. Callers must establish the
 * current tenant and explicit authorized employee set in this transaction.
 * Workers can use a bounded verified set without inventing a human actor. */
export async function readAttendanceProjectionInTransaction(tx: Prisma.TransactionClient, input: {
  organizationId: string; authorizedEmployeeIds: readonly string[] | null; query: AttendanceReportQuery; now?: Date
}) {
  const { organizationId, authorizedEmployeeIds } = input
  const query = AttendanceReportQuerySchema.parse(input.query)
  if (query.employeeId && authorizedEmployeeIds !== null && !authorizedEmployeeIds.includes(query.employeeId)) throw new AttendanceReportAccessError()
  const from = new Date(`${query.from}T00:00:00.000Z`)
  const precedingDate = addDateKeyDays(query.from, -1)
  const readFrom = new Date(`${precedingDate}T00:00:00.000Z`)
  const calendarTo = new Date(`${addDateKeyDays(query.to, 1)}T00:00:00.000Z`)
  const to = new Date(`${query.to}T00:00:00.000Z`)
  const now = input.now ?? new Date()
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1
    const employees = await tx.mtmAgent.findMany({
      where: {
        organizationId, ...ATTENDANCE_TRACKED_CARD_WHERE,
        ...(authorizedEmployeeIds === null ? {} : { id: { in: [...authorizedEmployeeIds] } }),
        ...(query.employeeId ? { AND: { id: query.employeeId } } : {}),
        ...(query.teamId ? { teamId: query.teamId } : {}),
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      },
      select: { id: true, name: true, position: true, teamId: true, departmentId: true, attendanceIncludedFrom: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: Math.floor(MTM_ATTENDANCE_REPORT_MAX_ROWS / days) + 1,
    })
    // Fail visibly if the report would exceed the documented limit; never
    // silently omit people from an absence report or its exported totals.
    if (employees.length * days > MTM_ATTENDANCE_REPORT_MAX_ROWS) throw new Error("MTM_ATTENDANCE_REPORT_TOO_LARGE")
    const agentIds = employees.map((employee) => employee.id)
    const teamIds = [...new Set(employees.flatMap((employee) => employee.teamId ? [employee.teamId] : []))]
    const departmentIds = [...new Set(employees.flatMap((employee) => employee.departmentId ? [employee.departmentId] : []))]
    // Department above the team (2026-10-22), shown under the name in reports (owner, 2026-11-01).
    const departmentNames = new Map((departmentIds.length ? await tx.mtmDepartment.findMany({ where: { organizationId, id: { in: departmentIds } }, select: { id: true, name: true } }) : [])
      .map((department) => [department.id, department.name]))
    const [teams, workdays, calendar, rules, catalogue] = await Promise.all([
      tx.mtmTeam.findMany({ where: { organizationId, id: { in: teamIds } }, select: { id: true, name: true } }),
      tx.mtmAgentWorkday.findMany({
        where: { organizationId, agentId: { in: agentIds }, workDate: { gte: readFrom, lte: to } },
        select: {
          id: true, agentId: true, workDate: true, status: true, startedAt: true, pausedAt: true, completedAt: true, totalPausedSeconds: true,
          events: {
            where: { organizationId, agentId: { in: agentIds } },
            orderBy: [{ occurredAt: "asc" }, { appliedAt: "asc" }, { id: "asc" }],
            select: { id: true, type: true, occurredAt: true, appliedAt: true, claimedAt: true, serverReceivedAt: true, clientEventId: true },
          },
        },
      }),
      tx.mtmWorkCalendarDay.findMany({
        where: {
          organizationId, deletedAt: null, date: { gte: readFrom, lte: calendarTo },
          OR: [{ teamId: null, agentId: null }, { teamId: { in: teamIds }, agentId: null }, { agentId: { in: agentIds }, teamId: null }],
        },
        select: { id: true, date: true, kind: true, name: true, teamId: true, agentId: true, movedToDate: true, routePlanningAllowed: true },
        orderBy: [{ date: "asc" }, { id: "asc" }],
      }),
      readAttendanceRules(organizationId, tx),
      readAttendanceDayKinds(organizationId, tx),
    ])
    const approved = await tx.mtmHrmRequest.findMany({ where: { organizationId, agentId: { in: agentIds }, status: "APPROVED", attendanceDetails: { not: Prisma.DbNull }, startDate: { lte: calendarTo }, endDate: { gte: readFrom } },
      select: { id: true, agentId: true, startDate: true, endDate: true, decidedAt: true, attendanceDetails: true }, take: 10_001 })
    if (approved.length > 10_000) throw new Error("MTM_ATTENDANCE_APPROVED_REQUESTS_TOO_LARGE")
    const approvedRequests: AttendanceApprovedPeriod[] = approved.map((entry) => {
      const details = AttendanceRequestDetailsSchema.parse(entry.attendanceDetails)
      if (!entry.decidedAt) throw new Error("MTM_ATTENDANCE_APPROVED_REQUEST_INVALID")
      return { id: entry.id, agentId: entry.agentId, startDate: entry.startDate.toISOString().slice(0, 10), endDate: entry.endDate.toISOString().slice(0, 10), decidedAt: entry.decidedAt.toISOString(),
        details: { kind: details.kind, unit: details.unit, startTime: details.startTime, endTime: details.endTime, timezone: details.timezone, dayKind: details.dayKind } }
    })
    const corrections = await tx.workforceTimeCorrection.findMany({ where: { organizationId, agentId: { in: agentIds }, workdayId: { in: workdays.map((day) => day.id) } },
      select: { id: true, workdayId: true, requestId: true, source: true, occurredAt: true, beforeFacts: true, afterFacts: true, actorUser: { select: { id: true, name: true } } } })
    const correctionsByWorkday = new Map<string, typeof corrections>()
    for (const correction of corrections) correctionsByWorkday.set(correction.workdayId, [...(correctionsByWorkday.get(correction.workdayId) ?? []), correction])
    const employment = agentIds.length ? await tx.$queryRaw<Array<{ agentId: string; kind: AttendanceEmploymentEvent["kind"]; effectiveAt: Date }>>`
      SELECT "agentId", "kind", "effectiveAt" FROM "workforce_employment_events"
      WHERE "organizationId" = ${organizationId} AND "agentId" IN (${Prisma.join(agentIds)})
      ORDER BY "agentId", "effectiveAt", "id" LIMIT 100001` : []
    if (employment.length > 100_000) throw new Error("MTM_ATTENDANCE_EMPLOYMENT_HISTORY_TOO_LARGE")
    const employmentByEmployee = new Map<string, AttendanceEmploymentEvent[]>()
    for (const event of employment) employmentByEmployee.set(event.agentId, [...(employmentByEmployee.get(event.agentId) ?? []), { kind: event.kind, effectiveAt: event.effectiveAt.toISOString() }])
    const teamNames = new Map(teams.map((team) => [team.id, team.name]))
    const shiftAssignments = await readAttendanceShiftAssignments(tx, organizationId, agentIds, precedingDate, query.to)
    const participation = await readAttendanceParticipationHistory(tx, organizationId, agentIds)
    const calculationInput = {
      employees: employees.map((employee) => ({ ...employee, attendanceIncludedFrom: employee.attendanceIncludedFrom?.toISOString() ?? null, participationEvents: participation.filter(event => event.agentId === employee.id), employmentEvents: employmentByEmployee.get(employee.id), teamName: employee.teamId ? teamNames.get(employee.teamId) ?? null : null, departmentName: employee.departmentId ? departmentNames.get(employee.departmentId) ?? null : null })),
      approvedRequests, dayKinds: catalogue.items, workdays: workdays.map((day) => ({ ...day, correctionProjection: projectAttendanceCorrectionFacts(day, correctionsByWorkday.get(day.id) ?? [], now) })),
      calendar, rules, shiftAssignments, from: query.from, to: query.to, now,
    }
    const report = buildMtmAttendanceReport(calculationInput)
    const locationEvidence = await readAttendanceLocationReportEvidence(tx, organizationId, workdays.map(day => day.id))
    // Explanations sit beside the day as a note; they never change its hours.
    const explanationRows = agentIds.length ? await tx.mtmAttendanceExplanation.findMany({ where: { organizationId, agentId: { in: agentIds }, workDate: { gte: readFrom, lte: to } },
      select: { agentId: true, workDate: true, kind: true, status: true, answer: true }, orderBy: [{ kind: "asc" }] }) : []
    const explanations = new Map<string, NonNullable<MtmAttendanceReportRow["explanations"]>>()
    for (const item of explanationRows) {
      const dayKey = `${item.agentId}|${item.workDate.toISOString().slice(0, 10)}`
      explanations.set(dayKey, [...(explanations.get(dayKey) ?? []), { kind: item.kind as "LATE" | "ABSENT", status: item.status as "REQUESTED" | "ANSWERED" | "ACCEPTED" | "REJECTED", answer: item.answer }])
    }
    const explained = <T extends MtmAttendanceReportRow>(row: T): T => { const found = explanations.get(`${row.employeeId}|${row.date}`); return found ? { ...row, explanations: found } : row }
    const rows = filterMtmAttendanceRows(report.rows, { form: query.form }).map(row => explained({ ...row, locationMarks: attendanceReportMarks(row, locationEvidence) }))
    const supplemental = shiftAssignments.length ? buildMtmAttendanceReport({ ...calculationInput, from: precedingDate, to: precedingDate }).rows : []
    const accountingRows = shiftAssignments.length ? attendanceAccountingRows([...supplemental, ...report.rows], query.from, query.to)
      .map(row => explained({ ...row, locationMarks: attendanceReportMarks(row, locationEvidence) })) : undefined
    if (accountingRows && accountingRows.length > MTM_ATTENDANCE_REPORT_MAX_ROWS) throw new Error("MTM_ATTENDANCE_REPORT_TOO_LARGE")
    const result = { ...report, rows, ...(accountingRows ? { accountingRows: filterMtmAttendanceRows(accountingRows, { form: query.form }) } : {}), totals: summarizeMtmAttendanceRows(rows), form: query.form }
    const id = createHash("sha256").update(JSON.stringify({ query, report: result })).digest("hex")
    return { ...result, snapshot: { id, asOf: result.asOf, query } }
}
