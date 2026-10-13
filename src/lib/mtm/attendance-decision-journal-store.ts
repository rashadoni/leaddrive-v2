import { createHash } from "node:crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import type { MtmRouteActor } from "@/lib/mtm/route-permissions"
import { AttendanceRequestDetailsSchema, AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { AttendanceDecisionJournalQuerySchema, ATTENDANCE_DECISION_JOURNAL_LIMIT, type AttendanceDecisionJournal, type AttendanceDecisionJournalItem } from "@/lib/mtm/attendance-decision-journal-contract"

/** The same read scope as attendance forms, including the explicit HR read
 * grant. Reasons, document IDs, storage keys and hashes never enter this DTO. */
export async function readAttendanceDecisionJournal(input: { organizationId: string; actor: MtmRouteActor; allEmployeesGrant?: boolean; query: unknown; now?: Date }): Promise<AttendanceDecisionJournal> {
  const parsed = AttendanceDecisionJournalQuerySchema.safeParse(input.query)
  if (!parsed.success) throw new AttendanceRequestError("MTM_ATTENDANCE_JOURNAL_QUERY_INVALID", 400)
  const { organizationId, actor } = input, query = parsed.data
  if (actor.role === "AGENT" || (actor.role !== "ADMIN" && actor.scopedAgentIds === null && input.allEmployeesGrant !== true)) throw new AttendanceRequestError("MTM_ATTENDANCE_FORBIDDEN", 403)
  const asOf = (input.now ?? new Date()).toISOString()
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const rows = await tx.mtmHrmRequest.findMany({ where: { organizationId, attendanceDetails: { not: Prisma.DbNull },
      ...(actor.scopedAgentIds === null ? {} : { agentId: { in: [...actor.scopedAgentIds] } }),
      startDate: { lte: new Date(`${query.to}T00:00:00Z`) }, endDate: { gte: new Date(`${query.from}T00:00:00Z`) },
      ...(query.status === "ALL" ? {} : { status: query.status }),
      agent: { is: { organizationId } },
    }, select: { id: true, agentId: true, status: true, startDate: true, endDate: true, submittedAt: true, decidedAt: true, decidedByUserId: true, cancelledAt: true,
      attendanceDetails: true, agent: { select: { name: true, team: { select: { name: true } } } } },
    orderBy: [{ submittedAt: "desc" }, { id: "desc" }], take: ATTENDANCE_DECISION_JOURNAL_LIMIT + 1 })
    if (rows.length > ATTENDANCE_DECISION_JOURNAL_LIMIT) throw new AttendanceRequestError("MTM_ATTENDANCE_JOURNAL_TOO_LARGE", 422)
    const cancellations = rows.filter(row => row.status === "CANCELLED")
    const audits = cancellations.length ? await tx.mtmAuditLog.findMany({ where: { organizationId, entity: "hrm_request", action: "MTM_ATTENDANCE_APPROVAL_REVOKED", entityId: { in: cancellations.map(row => row.id) } },
      select: { entityId: true, actorUserId: true, createdAt: true }, take: cancellations.length + 1 }) : []
    const auditById = new Map(audits.map(row => [row.entityId, row]))
    if (audits.length > cancellations.length || auditById.size !== audits.length) throw new AttendanceRequestError("MTM_ATTENDANCE_JOURNAL_HISTORY_INVALID")
    const details = new Map(rows.map(row => [row.id, AttendanceRequestDetailsSchema.parse(row.attendanceDetails)]))
    const userIds = [...new Set([...rows.flatMap(row => [row.decidedByUserId, details.get(row.id)!.recording?.userId].filter((id): id is string => Boolean(id))),
      ...audits.flatMap(row => row.actorUserId ? [row.actorUserId] : [])])]
    const users = userIds.length ? await tx.user.findMany({ where: { organizationId, id: { in: userIds } }, select: { id: true, name: true } }) : []
    const names = new Map(users.map(user => [user.id, user.name]))
    const items = rows.map((row): AttendanceDecisionJournalItem => {
      const detail = details.get(row.id)!, audit = auditById.get(row.id)
      const isHr = detail.kind === "HR_RECORD"
      if (row.status === "CANCELLED" && (!row.cancelledAt || (row.decidedAt && !audit)
        || (audit && audit.createdAt.getTime() !== row.cancelledAt.getTime()))) throw new AttendanceRequestError("MTM_ATTENDANCE_JOURNAL_HISTORY_INVALID")
      const cancellation = row.cancelledAt ? { at: row.cancelledAt.toISOString(), byName: audit
        ? audit.actorUserId ? names.get(audit.actorUserId) ?? null : null : row.agent.name } : null
      return { id: row.id, employeeId: row.agentId, employeeName: row.agent.name, teamName: row.agent.team?.name ?? null,
        kind: { key: detail.dayKind.key, code: detail.dayKind.code, names: detail.dayKind.names }, requestKind: detail.kind,
        unit: detail.unit, startDate: row.startDate.toISOString().slice(0, 10), endDate: row.endDate.toISOString().slice(0, 10), startTime: detail.startTime, endTime: detail.endTime, timezone: detail.timezone,
        status: row.status, source: isHr ? "HR" : "EMPLOYEE", submittedAt: row.submittedAt.toISOString(),
        submittedByName: isHr ? names.get(detail.recording!.userId) ?? null : row.agent.name,
        decision: row.decidedAt ? { at: row.decidedAt.toISOString(), byName: row.decidedByUserId ? names.get(row.decidedByUserId) ?? null : null } : null, cancellation }
    })
    const id = createHash("sha256").update(JSON.stringify({ query, items })).digest("hex")
    return { items, snapshot: { id, asOf, query } }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15_000 })
}
