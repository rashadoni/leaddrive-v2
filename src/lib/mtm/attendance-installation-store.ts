import { isValidTimezone } from "@/lib/timezone"
import { createHash, randomUUID } from "node:crypto"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { lockAttendanceRequests, requireAttendanceSelf, type AttendanceSelf } from "@/lib/mtm/attendance-self-access"
import { requireAttendanceReviewer, resolveAttendanceReviewerScope, type AttendanceReviewer } from "@/lib/mtm/attendance-request-decision"
import { currentAttendanceReadActor } from "@/lib/mtm/attendance-read-access"
import { canReviewMtmRouteRequest, type MtmRouteActor } from "@/lib/mtm/route-permissions"
import { readAttendanceInstallationRule, lockAttendanceInstallationPolicy } from "@/lib/mtm/attendance-installation-policy"
import { notifyAttendanceInstallationReviewers, notifyAttendanceInstallationOwner } from "@/lib/mtm/attendance-installation-notify"
import { AttendanceInstallationRequestSchema, AttendanceInstallationDecisionSchema, AttendanceInstallationQuerySchema,
  attendanceInstallationFailure as fail, parseAttendanceInstallationId, attendanceInstallationState,
  type AttendanceInstallationOwn, type AttendanceInstallationQueue } from "@/lib/mtm/attendance-installation-contract"

type InstallationRow = {
  id: string; agentId: string; installationId: string; requestId: string; requestHash: string; submittedAt: Date;
  employeeName: string; userId: string | null; teamId: string | null; teamName: string | null;
  decisionId: string | null; action: "APPROVE" | "REJECT" | null; decidedAt: Date | null; decisionReason: string | null;
  revokedAt: Date | null; revocationReason: string | null;
}
const rowsSql = Prisma.sql`SELECT r.*,a.name AS "employeeName",a."userId",a."teamId",t.name AS "teamName",
  d.id AS "decisionId",d.action,d."createdAt" AS "decidedAt",d.reason AS "decisionReason",v."createdAt" AS "revokedAt",v.reason AS "revocationReason"
  FROM mtm_attendance_installation_requests r JOIN mtm_agents a ON a."organizationId"=r."organizationId" AND a.id=r."agentId"
  LEFT JOIN mtm_teams t ON t."organizationId"=a."organizationId" AND t.id=a."teamId"
  LEFT JOIN mtm_attendance_installation_decisions d ON d."organizationId"=r."organizationId" AND d."installationRequestId"=r.id
  LEFT JOIN mtm_attendance_installation_revocations v ON v."organizationId"=d."organizationId" AND v."decisionId"=d.id`
function ownDto(row: InstallationRow | null, installationId: string, required: boolean): AttendanceInstallationOwn {
  const state = attendanceInstallationState(row)
  return { required, installationLabel: `…${installationId.slice(-4)}`, state, requestId: row?.requestId ?? null, submittedAt: row?.submittedAt.toISOString() ?? null,
    decision: row?.decidedAt && row.action ? { action: row.action, at: row.decidedAt.toISOString(), reason: row.decisionReason! } : null,
    revocation: row?.revokedAt ? { at: row.revokedAt.toISOString(), reason: row.revocationReason! } : null,
    canRequest: ["NOT_REQUESTED", "REJECTED", "REVOKED"].includes(state) }
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")
async function requestLock(tx: Prisma.TransactionClient, organizationId: string, requestId: string) {
  await tx.$executeRaw`SELECT set_config('lock_timeout','3s',true)`
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-attendance-installation-request:${organizationId}:${requestId}`},0))`
}
export async function readOwnAttendanceInstallation(self: AttendanceSelf, rawInstallation: unknown): Promise<AttendanceInstallationOwn> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await lockAttendanceRequests(tx, self)
    await requireAttendanceSelf(tx, self)
    const installationId = parseAttendanceInstallationId(rawInstallation)
    await lockAttendanceInstallationPolicy(tx, self.organizationId)
    const [row] = await tx.$queryRaw<InstallationRow[]>(Prisma.sql`${rowsSql} WHERE r."organizationId"=${self.organizationId}
      AND r."agentId"=${self.agentId} AND r."installationId"=${installationId} ORDER BY r."submittedAt" DESC,r.id DESC LIMIT 1`)
    return ownDto(row ?? null, installationId, await readAttendanceInstallationRule(tx, self.organizationId))
  }, { timeout: 15000 })
}
export async function submitAttendanceInstallationInTransaction(tx: Prisma.TransactionClient, self: AttendanceSelf, rawInstallation: unknown, raw: unknown): Promise<AttendanceInstallationOwn> {
  const parsed = AttendanceInstallationRequestSchema.safeParse(raw)
  if (!parsed.success) return fail("REQUEST_INVALID", 400)
  const { requestId } = parsed.data, { organizationId, agentId } = self
  await requestLock(tx, organizationId, requestId)
  await lockAttendanceRequests(tx, self)
  await requireAttendanceSelf(tx, self)
  const installationId = parseAttendanceInstallationId(rawInstallation)
  await lockAttendanceInstallationPolicy(tx, organizationId)
  const required = await readAttendanceInstallationRule(tx, organizationId)
  const requestHash = hash({ agentId, installationId })
  const [prior] = await tx.$queryRaw<InstallationRow[]>(Prisma.sql`${rowsSql} WHERE r."organizationId"=${organizationId} AND r."requestId"=${requestId}`)
  if (prior) {
    if (prior.agentId !== agentId || prior.installationId !== installationId || prior.requestHash !== requestHash) return fail("IDEMPOTENCY_MISMATCH")
    return ownDto(prior, installationId, required)
  }
  const [latest] = await tx.$queryRaw<InstallationRow[]>(Prisma.sql`${rowsSql} WHERE r."organizationId"=${organizationId}
    AND r."agentId"=${agentId} AND r."installationId"=${installationId} ORDER BY r."submittedAt" DESC,r.id DESC LIMIT 1`)
  if (["PENDING", "APPROVED"].includes(attendanceInstallationState(latest ?? null))) return fail("ALREADY_REQUESTED")
  const id = randomUUID()
  await tx.$executeRaw`INSERT INTO mtm_attendance_installation_requests (id,"organizationId","agentId","installationId","requestId","requestHash")
    VALUES (${id},${organizationId},${agentId},${installationId},${requestId},${requestHash})`
  await tx.mtmAuditLog.create({ data: { organizationId, agentId, action: "MTM_ATTENDANCE_INSTALLATION_REQUESTED", entity: "mtm_attendance_installation", entityId: id,
    metadataKind: "mtm_attendance_installation", newData: { status: "PENDING" } } })
  await notifyAttendanceInstallationReviewers(tx, { organizationId, agentId, requestId: id })
  const [created] = await tx.$queryRaw<InstallationRow[]>(Prisma.sql`${rowsSql} WHERE r."organizationId"=${organizationId} AND r.id=${id}`)
  if (!created) return fail("REQUEST_FAILED", 500)
  return ownDto(created, installationId, required)
}
export async function submitAttendanceInstallation(self: AttendanceSelf, rawInstallation: unknown, raw: unknown) {
  return prisma.$transaction((tx: Prisma.TransactionClient) => submitAttendanceInstallationInTransaction(tx, self, rawInstallation, raw), { timeout: 15000 })
}

export async function readAttendanceInstallationQueue(reviewer: AttendanceReviewer, raw: unknown): Promise<AttendanceInstallationQueue> {
  const parsed = AttendanceInstallationQuerySchema.safeParse(raw)
  if (!parsed.success) return fail("QUERY_INVALID", 400)
  const query = parsed.data, { organizationId } = reviewer
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const actor = await currentAttendanceReadActor(tx, reviewer)
    const scope = actor.scopedAgentIds
    if (query.employeeId && scope !== null && !scope.includes(query.employeeId)) return fail("FORBIDDEN", 403)
    let writer: MtmRouteActor | null = null
    try { writer = await resolveAttendanceReviewerScope(tx, reviewer) }
    catch (e) { if (!(e instanceof AttendanceRequestError) || e.status !== 403) throw e }
    const [settingsActor] = await tx.$queryRaw<{ role: string }[]>`SELECT role FROM users WHERE "organizationId"=${organizationId} AND id=${reviewer.userId}`
    const [cursor] = query.cursor ? await tx.$queryRaw<{ submittedAt: Date; id: string }[]>`SELECT "submittedAt",id FROM mtm_attendance_installation_requests
      WHERE "organizationId"=${organizationId} AND id=${query.cursor} AND (${scope}::text[] IS NULL OR "agentId"=ANY(${scope}::text[]))` : []
    if (query.cursor && !cursor) return fail("QUERY_INVALID", 400)
    // Prisma binds a Date as timestamptz; a plain ::timestamp cast would use the
    // session zone (Europe/Berlin in production) and shift the naive cursor.
    const cursorAt = cursor ? cursor.submittedAt.toISOString() : null
    const rows = await tx.$queryRaw<InstallationRow[]>(Prisma.sql`${rowsSql} WHERE r."organizationId"=${organizationId}
      AND (${scope}::text[] IS NULL OR r."agentId"=ANY(${scope}::text[]))
      AND (${query.employeeId}='' OR r."agentId"=${query.employeeId}) AND (${query.teamId}='' OR a."teamId"=${query.teamId})
      AND (${cursorAt}::timestamptz IS NULL OR (r."submittedAt",r.id)<((${cursorAt}::timestamptz AT TIME ZONE 'UTC'),${cursor?.id ?? null}::text))
      AND (${query.status}='ALL' OR (${query.status}='PENDING' AND d.id IS NULL)
        OR (${query.status}='APPROVED' AND d.action='APPROVE' AND v.id IS NULL)
        OR (${query.status}='REJECTED' AND d.action='REJECT') OR (${query.status}='REVOKED' AND v.id IS NOT NULL))
      ORDER BY r."submittedAt" DESC,r.id DESC LIMIT 51`)
    const required = await readAttendanceInstallationRule(tx, organizationId)
    const clock = await tx.mtmSetting.findUnique({ where: { organizationId_key: { organizationId, key: "timezone" } }, select: { value: true } })
    const timezone = typeof clock?.value === "string" && isValidTimezone(clock.value) ? clock.value : "Asia/Baku"
    return { timezone, required, canConfigure: ["admin", "superadmin"].includes(settingsActor?.role ?? ""), nextCursor: rows.length > 50 ? rows[49].id : null,
      items: rows.slice(0, 50).map(row => {
        const dto = ownDto(row, row.installationId, required)
        const canWrite = writer !== null && row.userId !== reviewer.userId && canReviewMtmRouteRequest(writer, row.agentId)
        return { installationLabel: dto.installationLabel, state: dto.state, requestId: dto.requestId, submittedAt: dto.submittedAt, decision: dto.decision, revocation: dto.revocation, id: row.id, employeeId: row.agentId, employeeName: row.employeeName, teamId: row.teamId, teamName: row.teamName,
          canDecide: canWrite && dto.state === "PENDING", canRevoke: canWrite && dto.state === "APPROVED" }
      }) }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 })
}

export async function decideAttendanceInstallationInTransaction(tx: Prisma.TransactionClient, reviewer: AttendanceReviewer, id: string, raw: unknown) {
  const parsed = AttendanceInstallationDecisionSchema.safeParse(raw)
  if (!parsed.success || !z.string().uuid().safeParse(id).success) return fail("DECISION_INVALID", 400)
  const { organizationId, userId } = reviewer, { action, requestId, reason } = parsed.data
  if (reviewer.principalType !== "session") return fail("FORBIDDEN", 403)
  await requestLock(tx, organizationId, requestId)
  const [candidate] = await tx.$queryRaw<{ agentId: string }[]>`SELECT "agentId" FROM mtm_attendance_installation_requests WHERE "organizationId"=${organizationId} AND id=${id}`
  if (!candidate) return fail("NOT_FOUND", 404)
  await lockAttendanceRequests(tx, { organizationId, agentId: candidate.agentId })
  const access = await requireAttendanceReviewer(tx, reviewer, candidate.agentId, { allowInactive: action !== "APPROVE" })
  const requestHash = hash({ installationRequestId: id, action, reason, userId })
  // One namespace across approval and revocation: a UUID cannot change meaning.
  const previous = await tx.$queryRaw<{ id: string; requestHash: string }[]>`SELECT id,"requestHash" FROM mtm_attendance_installation_decisions
    WHERE "organizationId"=${organizationId} AND "requestId"=${requestId} UNION ALL SELECT id,"requestHash" FROM mtm_attendance_installation_revocations
    WHERE "organizationId"=${organizationId} AND "requestId"=${requestId}`
  if (previous.length) {
    if (previous.length !== 1 || previous[0].requestHash !== requestHash) return fail("IDEMPOTENCY_MISMATCH")
    return { id: previous[0].id, idempotent: true }
  }
  const [row] = await tx.$queryRaw<InstallationRow[]>(Prisma.sql`${rowsSql} WHERE r."organizationId"=${organizationId} AND r.id=${id}`)
  if (!row) return fail("NOT_FOUND", 404)
  const state = attendanceInstallationState(row)
  if (action === "REVOKE" ? state !== "APPROVED" : state !== "PENDING") return fail("ALREADY_DECIDED")
  const decisionId = randomUUID()
  if (action === "REVOKE") await tx.$executeRaw`INSERT INTO mtm_attendance_installation_revocations (id,"organizationId","decisionId","requestId","requestHash","actorUserId",reason)
    VALUES (${decisionId},${organizationId},${row.decisionId},${requestId},${requestHash},${userId},${reason})`
  else await tx.$executeRaw`INSERT INTO mtm_attendance_installation_decisions (id,"organizationId","installationRequestId",action,"requestId","requestHash","actorUserId",reason)
    VALUES (${decisionId},${organizationId},${id},${action},${requestId},${requestHash},${userId},${reason})`
  await tx.mtmAuditLog.create({ data: { organizationId, actorUserId: userId, agentId: candidate.agentId, action: `MTM_ATTENDANCE_INSTALLATION_${action}`,
    entity: "mtm_attendance_installation", entityId: id, metadataKind: "mtm_attendance_installation", newData: { decisionId, action } } })
  await notifyAttendanceInstallationOwner(tx, { organizationId, agentId: candidate.agentId, requestId: id, locale: access.locale, action })
  return { id: decisionId, idempotent: false }
}
export async function decideAttendanceInstallation(reviewer: AttendanceReviewer, id: string, raw: unknown) {
  return prisma.$transaction((tx: Prisma.TransactionClient) => decideAttendanceInstallationInTransaction(tx, reviewer, id, raw), { timeout: 15000 })
}

/** Panel counts are read under fresh review authority, including current team. */
export async function readAttendanceInstallationAttention(reviewer: AttendanceReviewer, filterIds: readonly string[] | null) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const actor = await resolveAttendanceReviewerScope(tx, reviewer)
    const scope = actor.scopedAgentIds === null ? filterIds : actor.scopedAgentIds.filter(id => filterIds === null || filterIds.includes(id))
    const rows = await tx.$queryRaw<{ agentId: string; count: bigint; date: Date }[]>`SELECT r."agentId",count(*) AS count,min(r."submittedAt") AS date
      FROM mtm_attendance_installation_requests r JOIN mtm_agents a ON a."organizationId"=r."organizationId" AND a.id=r."agentId"
      WHERE r."organizationId"=${reviewer.organizationId} AND a."userId" IS DISTINCT FROM ${reviewer.userId}
      AND (${scope}::text[] IS NULL OR r."agentId"=ANY(${scope}::text[]))
      AND NOT EXISTS(SELECT 1 FROM mtm_attendance_installation_decisions d WHERE d."organizationId"=r."organizationId" AND d."installationRequestId"=r.id)
      GROUP BY r."agentId"`
    return rows.map(row => ({ agentId: row.agentId, count: Number(row.count), date: row.date }))
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 })
}
