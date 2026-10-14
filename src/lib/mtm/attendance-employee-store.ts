import { createHash, randomUUID } from "node:crypto"
import { ATTENDANCE_TRACKED_CARD_WHERE, attendanceTrackedCardSql, isAttendanceTrackedCard } from "@/lib/mtm/attendance-tracking"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { isValidTimezone, localDateTimeToUnambiguousUtc } from "@/lib/timezone"
import { addDateKeyDays, currentDateKey, isDateKey } from "@/lib/mtm/mobile-week"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { AttendanceEmployeeEnrollmentSchema, AttendanceEmploymentInputSchema, AttendanceParticipationInputSchema, type AttendanceEmployeeDirectory } from "@/lib/mtm/attendance-employee-contract"
import { readAttendanceParticipationHistory } from "@/lib/mtm/attendance-participation-store"
import { lockAttendanceRequests } from "@/lib/mtm/attendance-self-access"
import { lockMtmWorkdayTransitions } from "@/lib/mtm/workday"
import { recordWorkforceEmploymentEventInTransaction, WorkforceEmploymentHistoryError } from "@/lib/workforce/employment-history"
import type { AttendanceReviewer } from "@/lib/mtm/attendance-request-decision"
import { resolveAttendanceReviewerScope } from "@/lib/mtm/attendance-request-decision"
import { ATTENDANCE_FEATURE_SETTING_KEY } from "@/lib/mtm/attendance-feature"

type EmploymentRow = { id: string; agentId: string; kind: "HIRE" | "TERMINATION" | "REHIRE"; effectiveAt: Date; recordedByUserId: string; recordedDate: string | null }
function employmentDate(event: EmploymentRow, timezone: string) {
  if (event.recordedDate && isDateKey(event.recordedDate)) return event.recordedDate
  return event.kind === "TERMINATION" ? addDateKeyDays(currentDateKey(event.effectiveAt, timezone), -1) : currentDateKey(event.effectiveAt, timezone)
}
export async function requireAttendanceEmployeeAdmin(tx: Prisma.TransactionClient, actor: AttendanceReviewer) {
  await tx.$executeRaw`SELECT set_config('lock_timeout', '3s', true)`
  await tx.$queryRaw`SELECT "id" FROM mtm_settings WHERE "organizationId" = ${actor.organizationId} AND "key" IN (${ATTENDANCE_FEATURE_SETTING_KEY}, 'timezone') ORDER BY "key" FOR SHARE`
  await resolveAttendanceReviewerScope(tx, actor)
  // Managing participation is tenant administration, not a team-manager grant.
  const [user] = await tx.$queryRaw<Array<{ role: string }>>`SELECT "role" FROM "users" WHERE "organizationId" = ${actor.organizationId} AND "id" = ${actor.userId} AND "isActive" AND "anonymizedAt" IS NULL FOR SHARE`
  if (!user || !["admin", "superadmin"].includes(user.role)) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_ADMIN_REQUIRED", 403)
  const setting = await tx.mtmSetting.findUnique({ where: { organizationId_key: { organizationId: actor.organizationId, key: "timezone" } }, select: { value: true } })
  const timezone = setting?.value ?? "Asia/Baku"
  if (typeof timezone !== "string" || !isValidTimezone(timezone)) throw new AttendanceRequestError("MTM_ATTENDANCE_TIMEZONE_INVALID")
  return timezone
}
async function history(tx: Prisma.TransactionClient, organizationId: string, agentIds: string[]): Promise<EmploymentRow[]> {
  if (!agentIds.length) return []
  const rows = await tx.$queryRaw<EmploymentRow[]>`SELECT event."id", event."agentId", event."kind", event."effectiveAt", event."recordedByUserId",
    (SELECT audit."newData"->>'date' FROM mtm_audit_logs AS audit
      WHERE audit."organizationId" = event."organizationId" AND audit."metadataKind" = 'mtm_attendance_employment'
        AND audit."newData"->>'eventId' = event."id" ORDER BY audit."createdAt", audit."id" LIMIT 1) AS "recordedDate"
    FROM workforce_employment_events AS event
    WHERE event."organizationId" = ${organizationId} AND event."agentId" IN (${Prisma.join(agentIds)}) ORDER BY event."effectiveAt", CASE WHEN event."kind" = 'REHIRE' THEN 1 ELSE 0 END, event."id" LIMIT 10001`
  if (rows.length > 10000) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_TOO_LARGE", 422)
  return rows
}
export async function readAttendanceEmployees(actor: AttendanceReviewer): Promise<AttendanceEmployeeDirectory> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const timezone = await requireAttendanceEmployeeAdmin(tx, actor), organizationId = actor.organizationId
    const users = await tx.user.findMany({ where: { organizationId, isActive: true, anonymizedAt: null }, select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 1001 })
    const cards = await tx.mtmAgent.findMany({ where: { organizationId }, select: { id: true, name: true, userId: true, role: true, status: true, attendanceParticipant: true, attendanceExcluded: true, attendanceIncludedFrom: true, teamId: true, team: { select: { name: true } } }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 1001 })
    const teams = await tx.mtmTeam.findMany({ where: { organizationId }, select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 1001 })
    if (users.length > 1000 || cards.length > 1000 || teams.length > 1000) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_TOO_LARGE", 422)
    const tracked = cards.filter(isAttendanceTrackedCard)
    const events = await history(tx, organizationId, tracked.map(card => card.id))
    const participation = await readAttendanceParticipationHistory(tx, organizationId, tracked.map(card => card.id))
    const latestParticipation = new Map(participation.map(event => [event.agentId, event.id]))
    const names = new Map(users.map(user => [user.id, user.name]))
    return { timezone, teams, users: users.map(user => {
      const linked = cards.filter(card => card.userId === user.id), card = linked[0]
      return { id: user.id, name: user.name, existingRole: card?.role ?? null, existingTeamId: card?.teamId ?? null,
        eligible: false }
    }), employees: tracked.map(card => ({ id: card.id, name: card.name, role: card.role, status: card.status, teamName: card.team?.name ?? null,
      included: !card.attendanceExcluded, participationVersion: latestParticipation.get(card.id) ?? null, includedFrom: card.attendanceIncludedFrom?.toISOString() ?? null,
      history: events.filter(event => event.agentId === card.id).map(event => ({ id: event.id, kind: event.kind,
        // A termination instant is the start of the day after the last work day.
        date: employmentDate(event, timezone),
        at: event.effectiveAt.toISOString(), byName: names.get(event.recordedByUserId) ?? null })) })) }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15_000 })
}
export async function setAttendanceParticipation(actor: AttendanceReviewer, raw: unknown) {
  const parsed = AttendanceParticipationInputSchema.safeParse(raw)
  if (!parsed.success) throw new AttendanceRequestError("MTM_ATTENDANCE_PARTICIPATION_INVALID", 400)
  const input = parsed.data, organizationId = actor.organizationId
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await requireAttendanceEmployeeAdmin(tx, actor)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-attendance-participation-request:${organizationId}:${input.clientRequestId}`}, 0))`
    // Match workday writers and month close: canonical employee locks precede
    // the source fence, so a close cannot hold our row while waiting on us.
    await lockMtmWorkdayTransitions(tx, { organizationId, agentId: input.agentId })
    await lockAttendanceRequests(tx, { organizationId, agentId: input.agentId })
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${`mtm-attendance-month-snapshot:${organizationId}`}, 0))`
    const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex")
    const [receipt] = await tx.$queryRaw<Array<{ id: string; createdBy: string; requestHash: string }>>`
      SELECT id, "createdBy", "requestHash" FROM mtm_attendance_participation_events
      WHERE "organizationId" = ${organizationId} AND "requestId" = ${input.clientRequestId}`
    if (receipt) {
      if (receipt.createdBy !== actor.userId || receipt.requestHash !== hash) throw new AttendanceRequestError("MTM_ATTENDANCE_PARTICIPATION_REPLAY_MISMATCH")
      return { eventId: receipt.id, idempotent: true }
    }
    const [card] = await tx.$queryRaw<Array<{ attendanceExcluded: boolean }>>`
      SELECT "attendanceExcluded" FROM mtm_agents WHERE "organizationId" = ${organizationId} AND id = ${input.agentId}
        AND ${attendanceTrackedCardSql()} FOR UPDATE`
    if (!card) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_NOT_FOUND", 404)
    const [previous] = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM mtm_attendance_participation_events
      WHERE "organizationId" = ${organizationId} AND "agentId" = ${input.agentId} ORDER BY "effectiveAt" DESC, id DESC LIMIT 1`
    if ((previous?.id ?? null) !== input.previousEventId || input.included === !card.attendanceExcluded) throw new AttendanceRequestError("MTM_ATTENDANCE_PARTICIPATION_CHANGED")
    const eventId = randomUUID()
    // The insert trigger updates only attendanceExcluded. Its deferred guard
    // refuses an exclusion write without a matching immutable history event.
    await tx.$executeRaw`INSERT INTO mtm_attendance_participation_events
      (id, "organizationId", "agentId", included, "previousEventId", "requestId", "requestHash", "createdBy")
      VALUES (${eventId}, ${organizationId}, ${input.agentId}, ${input.included}, ${input.previousEventId}, ${input.clientRequestId}, ${hash}, ${actor.userId})`
    await tx.mtmAuditLog.create({ data: { organizationId, actorUserId: actor.userId, agentId: input.agentId,
      action: "MTM_ATTENDANCE_PARTICIPATION_CHANGED", entity: "attendance_participation_event", entityId: eventId,
      metadataKind: "mtm_attendance_participation", oldData: { included: !card.attendanceExcluded },
      newData: { clientRequestId: input.clientRequestId, eventId, included: input.included } } })
    return { eventId, idempotent: false }
  }, { timeout: 15_000 })
}
async function lockOperation(tx: Prisma.TransactionClient, actor: AttendanceReviewer, operationId: string, input: unknown) {
  await tx.$executeRaw`SELECT set_config('lock_timeout', '3s', true)`
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-attendance-employee:${actor.organizationId}:${operationId}`}, 0))`
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex")
  const receipts = await tx.mtmAuditLog.findMany({ where: { organizationId: actor.organizationId, metadataKind: "mtm_attendance_employment", newData: { path: ["clientRequestId"], equals: operationId } }, select: { actorUserId: true, entityId: true, newData: true }, take: 2 })
  if (receipts.length > 1) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_CHANGED")
  const receipt = receipts[0]
  if (receipt && (receipt.actorUserId !== actor.userId || (receipt.newData as Record<string, unknown>)?.hash !== hash)) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_REPLAY_MISMATCH")
  return { hash, receipt }
}
async function appendEvent(tx: Prisma.TransactionClient, actor: AttendanceReviewer, agentId: string, kind: EmploymentRow["kind"], date: string, timezone: string) {
  let effectiveAt: Date
  try { effectiveAt = localDateTimeToUnambiguousUtc(`${kind === "TERMINATION" ? addDateKeyDays(date, 1) : date}T00:00`, timezone) }
  catch { throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_DATE_INVALID", 400) }
  try { return await recordWorkforceEmploymentEventInTransaction(tx, { organizationId: actor.organizationId, recordedByUserId: actor.userId, event: { agentId, kind, effectiveAt }, audit: { actorUserId: actor.userId } }) }
  catch (error) { if (error instanceof WorkforceEmploymentHistoryError) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_HISTORY_CHANGED"); throw error }
}
export async function enrollAttendanceEmployee(actor: AttendanceReviewer, raw: unknown) {
  const parsed = AttendanceEmployeeEnrollmentSchema.safeParse(raw)
  if (!parsed.success) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_INVALID", 400)
  const input = parsed.data, organizationId = actor.organizationId
  return prisma.$transaction(async tx => {
    const timezone = await requireAttendanceEmployeeAdmin(tx, actor)
    const { hash, receipt } = await lockOperation(tx, actor, input.clientRequestId, { type: "ENROLL", ...input })
    if (receipt) {
      if (!receipt.entityId) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_CHANGED")
      return { agentId: receipt.entityId, idempotent: true }
    }
    await tx.$queryRaw`SELECT "id" FROM users WHERE "organizationId" = ${organizationId} AND "id" = ${input.userId} FOR UPDATE`
    const user = await tx.user.findFirst({ where: { organizationId, id: input.userId, isActive: true, anonymizedAt: null }, select: { name: true, email: true, passwordHash: true } })
    if (!user?.email || !user.passwordHash) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_USER_UNAVAILABLE", 409)
    await tx.$queryRaw`SELECT "id" FROM mtm_agents WHERE "organizationId" = ${organizationId} AND "userId" = ${input.userId} FOR UPDATE`
    const cards = await tx.mtmAgent.findMany({ where: { organizationId, userId: input.userId }, select: { id: true, role: true, status: true, teamId: true, attendanceParticipant: true }, take: 2 })
    if (cards.length > 1 || (cards[0] && (cards[0].status !== "ACTIVE" || cards[0].attendanceParticipant || cards[0].role === "AGENT"))) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_ALREADY_TRACKED")
    if (cards[0] && cards[0].teamId !== input.teamId) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_TEAM_CHANGED")
    if (input.teamId && !await tx.mtmTeam.findFirst({ where: { organizationId, id: input.teamId }, select: { id: true } })) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_TEAM_CHANGED")
    let agentId = cards[0]?.id
    if (!agentId) {
      if (await tx.mtmAgent.findFirst({ where: { organizationId, email: user.email }, select: { id: true } })) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_IDENTITY_CONFLICT")
      agentId = randomUUID()
      await tx.mtmAgent.create({ data: { id: agentId, organizationId, userId: input.userId, name: user.name, email: user.email, teamId: input.teamId,
        role: "EMPLOYEE", status: "ACTIVE", attendanceParticipant: true, canPlanOwnRoutes: false, canSelfPublishRoutes: false } })
    } else {
      await tx.mtmAgent.update({ where: { organizationId, id: agentId }, data: { attendanceParticipant: true } })
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`workforce-employment:${organizationId}:${agentId}`}))`
    const previous = await history(tx, organizationId, [agentId])
    const event = !previous.length ? await appendEvent(tx, actor, agentId, "HIRE", input.hireDate, timezone) : null
    if (previous.length && (previous[0].kind !== "HIRE" || employmentDate(previous[0], timezone) !== input.hireDate)) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_HISTORY_CHANGED")
    await tx.mtmAuditLog.create({ data: { organizationId, actorUserId: actor.userId, agentId, entity: "agent", entityId: agentId,
      action: "MTM_ATTENDANCE_EMPLOYEE_ENROLLED", metadataKind: "mtm_attendance_employment", newData: { clientRequestId: input.clientRequestId, hash, reason: input.reason, userId: input.userId, hireDate: input.hireDate, ...(event ? { eventId: event.id, date: input.hireDate, timezone } : {}) } } })
    return { agentId, idempotent: false }
  }, { timeout: 15_000 })
}
export async function recordAttendanceEmployment(actor: AttendanceReviewer, raw: unknown) {
  const parsed = AttendanceEmploymentInputSchema.safeParse(raw)
  if (!parsed.success) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_INVALID", 400)
  const input = parsed.data, organizationId = actor.organizationId
  return prisma.$transaction(async tx => {
    const timezone = await requireAttendanceEmployeeAdmin(tx, actor)
    const { hash, receipt } = await lockOperation(tx, actor, input.clientRequestId, { type: "EMPLOYMENT", ...input })
    if (receipt) {
      if (!receipt.entityId) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_CHANGED")
      return { eventId: receipt.entityId, idempotent: true }
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`workforce-employment:${organizationId}:${input.agentId}`}))`
    const card = await tx.mtmAgent.findFirst({ where: { organizationId, id: input.agentId, ...ATTENDANCE_TRACKED_CARD_WHERE }, select: { id: true } })
    if (!card) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_NOT_FOUND", 404)
    const previous = await history(tx, organizationId, [input.agentId])
    if ((previous.at(-1)?.id ?? null) !== input.previousEventId) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_HISTORY_CHANGED")
    const event = await appendEvent(tx, actor, input.agentId, input.kind, input.date, timezone)
    await tx.mtmAuditLog.create({ data: { organizationId, actorUserId: actor.userId, agentId: input.agentId, entity: "workforce_employment_event", entityId: event.id,
      action: "MTM_ATTENDANCE_EMPLOYMENT_RECORDED", metadataKind: "mtm_attendance_employment", newData: { clientRequestId: input.clientRequestId, hash, reason: input.reason, date: input.date, kind: input.kind, eventId: event.id, timezone } } })
    return { eventId: event.id, idempotent: false }
  }, { timeout: 15_000 })
}
