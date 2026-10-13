import { currentAttendanceReadActor } from "@/lib/mtm/attendance-read-access"
import { createHash, randomUUID } from "node:crypto"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { requireAttendanceReviewer, resolveAttendanceReviewerScope, type AttendanceReviewer } from "@/lib/mtm/attendance-request-decision"
import { canReviewMtmRouteRequest, type MtmRouteActor } from "@/lib/mtm/route-permissions"
import { AttendanceRiskQuerySchema, AttendanceRiskKindSchema, AttendanceRiskDetailsSchema, AttendanceRiskDismissSchema,
  ATTENDANCE_RISK_LIMIT, type AttendanceRiskReport, type AttendanceRiskItem } from "@/lib/mtm/attendance-risk-contract"

type ReadInput = { organizationId: string; actor: MtmRouteActor; allEmployeesGrant?: boolean; reviewer: AttendanceReviewer; query: unknown; now?: Date }
type CaseRow = { id: string; agentId: string; employeeName: string; teamId: string | null; teamName: string | null; userId: string | null;
  kind: string; workDate: Date; timezone: string; claimedAt: Date; serverReceivedAt: Date; action: string; createdAt: Date; details: unknown;
  dismissedAt: Date | null; dismissedBy: string | null; reason: string | null; branchName: string | null }
const fail = (code: string, status = 409): never => { throw new AttendanceRequestError(`MTM_ATTENDANCE_RISK_${code}`, status) }

/** Endpoint evidence is an explicit allowlist. Even related employee names are
 * resolved only through the reader's current scope, never the detector's scope. */
export async function readAttendanceRiskReport(input: ReadInput): Promise<AttendanceRiskReport> {
  const parsed = AttendanceRiskQuerySchema.safeParse(input.query)
  if (!parsed.success) return fail("QUERY_INVALID", 400)
  const { organizationId, reviewer } = input, query = parsed.data
  if (organizationId !== reviewer.organizationId) return fail("FORBIDDEN", 403)
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const actor = await currentAttendanceReadActor(tx, reviewer)
    if (query.employeeId && actor.scopedAgentIds !== null && !actor.scopedAgentIds.includes(query.employeeId)) return fail("FORBIDDEN", 403)
    const scope = actor.scopedAgentIds === null ? null : [...actor.scopedAgentIds]
    let writeActor: MtmRouteActor | null = null
    // A read-only HR grant must never become write access.
    try { writeActor = await resolveAttendanceReviewerScope(tx, reviewer) }
    catch (e) { if (!(e instanceof AttendanceRequestError) || e.status !== 403) throw e }
    const directoryRows = await tx.mtmAgent.findMany({ where: { organizationId, ...(scope === null ? {} : { id: { in: scope } }) },
      select: { id: true, name: true, teamId: true, team: { select: { name: true } } }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 2001 })
    if (directoryRows.length > 2000) return fail("TOO_LARGE", 422)
    const directory = directoryRows.map(row => ({ id: row.id, name: row.name, teamId: row.teamId, teamName: row.team?.name ?? null }))
    const rows = await tx.$queryRaw<CaseRow[]>`SELECT c.id,c."agentId",a.name AS "employeeName",a."userId",a."teamId",t.name AS "teamName",
      c.kind,c."workDate",c.timezone,m."claimedAt",m."serverReceivedAt",m.action,c."createdAt",c.details,
      d."createdAt" AS "dismissedAt",u.name AS "dismissedBy",d.reason,b.name AS "branchName"
      FROM mtm_attendance_risk_cases c
      JOIN mtm_agents a ON a."organizationId"=c."organizationId" AND a.id=c."agentId"
      JOIN mtm_attendance_mark_evidence m ON m."organizationId"=c."organizationId" AND m."eventId"=c."eventId" AND m."agentId"=c."agentId"
      LEFT JOIN mtm_teams t ON t."organizationId"=a."organizationId" AND t.id=a."teamId"
      LEFT JOIN mtm_attendance_risk_decisions d ON d."organizationId"=c."organizationId" AND d."caseId"=c.id
      LEFT JOIN users u ON u."organizationId"=d."organizationId" AND u.id=d."actorUserId"
      LEFT JOIN mtm_attendance_branch_revisions b ON b."organizationId"=c."organizationId" AND b.id=m."branchRevisionId"
      WHERE c."organizationId"=${organizationId} AND (${scope}::text[] IS NULL OR c."agentId"=ANY(${scope}::text[]))
      AND c."workDate">=${new Date(query.from)}::date AND c."workDate"<=${new Date(query.to)}::date
      AND (${query.employeeId}='' OR c."agentId"=${query.employeeId}) AND (${query.teamId}='' OR a."teamId"=${query.teamId})
      AND (${query.kind}='ALL' OR c.kind=${query.kind})
      AND (${query.status}='ALL' OR (${query.status}='OPEN' AND d.id IS NULL) OR (${query.status}='DISMISSED' AND d.id IS NOT NULL))
      ORDER BY c."workDate" DESC,c."createdAt" DESC,c.id DESC LIMIT ${ATTENDANCE_RISK_LIMIT + 1}`
    if (rows.length > ATTENDANCE_RISK_LIMIT) return fail("TOO_LARGE", 422)
    const details = rows.map(row => AttendanceRiskDetailsSchema.parse(row.details))
    const relatedIds = [...new Set(details.flatMap(d => [...d.relatedAgentIds ?? [], ...d.usualAgentId ? [d.usualAgentId] : []]))]
      .filter(id => scope === null || scope.includes(id))
    const related = relatedIds.length ? await tx.mtmAgent.findMany({ where: { organizationId, id: { in: relatedIds } }, select: { id: true, name: true } }) : []
    const names = new Map<string, string>(related.map(row => [row.id, row.name]))
    const items = rows.map((row, i): AttendanceRiskItem => {
      const d = details[i], kind = AttendanceRiskKindSchema.parse(row.kind)
      if (row.action !== "START" && row.action !== "FINISH") return fail("HISTORY_INVALID")
      return { id: row.id, employeeId: row.agentId, employeeName: row.employeeName, teamId: row.teamId, teamName: row.teamName,
        kind, workDate: row.workDate.toISOString().slice(0, 10), timezone: row.timezone, claimedAt: row.claimedAt.toISOString(), serverReceivedAt: row.serverReceivedAt.toISOString(), action: row.action, createdAt: row.createdAt.toISOString(),
        canDismiss: !row.dismissedAt && row.userId !== reviewer.userId && writeActor !== null && canReviewMtmRouteRequest(writeActor, row.agentId),
        relatedNames: (d.relatedAgentIds ?? []).flatMap(id => names.has(id) ? [names.get(id)!] : []),
        relatedNamesRestricted: (d.relatedAgentIds ?? []).some(id => !names.has(id)), usualName: d.usualAgentId ? names.get(d.usualAgentId) ?? null : null,
        usualDays: d.usualAgentId && names.has(d.usualAgentId) ? d.usualDays ?? null : null, observedDays: d.observedDays ?? null,
        deltaSeconds: d.deltaSeconds ?? null, thresholdSeconds: d.thresholdSeconds ?? null, branchName: kind === "OUTSIDE_BRANCH" ? row.branchName : null, distanceMeters: kind === "OUTSIDE_BRANCH" ? d.distanceMeters ?? null : null,
        dismissal: row.dismissedAt ? { at: row.dismissedAt.toISOString(), byName: row.dismissedBy, reason: row.reason! } : null }
    })
    return { directory, items, snapshot: { id: createHash("sha256").update(JSON.stringify({ query, items })).digest("hex"), asOf: (input.now ?? new Date()).toISOString(), query } }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 })
}

export async function dismissAttendanceRiskInTransaction(tx: Prisma.TransactionClient, reviewer: AttendanceReviewer, caseId: string, raw: unknown) {
  const parsed = AttendanceRiskDismissSchema.safeParse(raw)
  if (!parsed.success || !z.string().uuid().safeParse(caseId).success) return fail("DECISION_INVALID", 400)
  const { organizationId, userId } = reviewer, { requestId, reason } = parsed.data
  if (reviewer.principalType !== "session") return fail("FORBIDDEN", 403)
  await tx.$executeRaw`SELECT set_config('lock_timeout','3s',true)`
  // Stable request lock first, then case. Every writer follows this order.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-attendance-risk-request:${organizationId}:${requestId}`},0))`
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-attendance-risk-case:${organizationId}:${caseId}`},0))`
  const [candidate] = await tx.$queryRaw<{ agentId: string }[]>`SELECT "agentId" FROM mtm_attendance_risk_cases WHERE "organizationId"=${organizationId} AND id=${caseId}`
  if (!candidate) return fail("NOT_FOUND", 404)
  await requireAttendanceReviewer(tx, reviewer, candidate.agentId, { allowInactive: true })
  const requestHash = createHash("sha256").update(JSON.stringify({ caseId, userId, reason })).digest("hex")
  const existing = await tx.$queryRaw<{ id: string; requestId: string; requestHash: string; caseId: string }[]>`
    SELECT id,"requestId","requestHash","caseId" FROM mtm_attendance_risk_decisions
    WHERE "organizationId"=${organizationId} AND ("caseId"=${caseId} OR "requestId"=${requestId})`
  if (existing.length) {
    if (existing.length !== 1 || existing[0].requestId !== requestId || existing[0].requestHash !== requestHash || existing[0].caseId !== caseId) return fail("ALREADY_DECIDED")
    return { id: existing[0].id, idempotent: true }
  }
  const id = randomUUID()
  await tx.$executeRaw`INSERT INTO mtm_attendance_risk_decisions (id,"organizationId","caseId","requestId","requestHash","actorUserId",reason)
    VALUES (${id},${organizationId},${caseId},${requestId},${requestHash},${userId},${reason})`
  await tx.mtmAuditLog.create({ data: { organizationId, actorUserId: userId, agentId: candidate.agentId, action: "MTM_ATTENDANCE_RISK_DISMISSED", entity: "mtm_attendance_risk", entityId: caseId, metadataKind: "mtm_attendance_risk", newData: { decisionId: id } } })
  return { id, idempotent: false }
}
export async function dismissAttendanceRisk(reviewer: AttendanceReviewer, caseId: string, raw: unknown) {
  return prisma.$transaction((tx: Prisma.TransactionClient) => dismissAttendanceRiskInTransaction(tx, reviewer, caseId, raw), { timeout: 15000 })
}
