import { identityDirectoryPhone } from "@/lib/identity/directory-contact"
import { createHash, randomUUID } from "node:crypto"
import { ATTENDANCE_TRACKED_CARD_WHERE, attendanceTrackedCardSql, isAttendanceTrackedCard } from "@/lib/mtm/attendance-tracking"
import { Prisma } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { withLegacyCredentialMaintenance } from "@/lib/identity/legacy-credential-write"
import { readLegacyPhoneAssignmentBoundaryInTransaction } from "@/lib/identity/legacy-credential-boundary"
import { findPhoneOwner } from "@/lib/mtm/mobile-login-phone"
import { readAttendanceProjectionInTransaction } from "@/lib/mtm/attendance-report-store"
import { summarizeMtmAttendanceRows } from "@/lib/mtm/attendance-report"
import { isValidTimezone, localDateTimeToUnambiguousUtc } from "@/lib/timezone"
import { addDateKeyDays, currentDateKey, isDateKey } from "@/lib/mtm/mobile-week"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { ATTENDANCE_MANAGER_ROLES, AttendanceEmployeeCardSchema, AttendanceEmployeeEnrollmentSchema, AttendanceEmploymentInputSchema, AttendanceParticipationInputSchema, type AttendanceEmployeeDirectory, type AttendanceEmployeeDetail, type AttendanceEmployeeToday, type AttendanceUnitInput, AttendanceEmployeeProfileSchema, AttendanceEmployeeRemoveSchema, OFFICE_EMPLOYEE_CRM_ROLE } from "@/lib/mtm/attendance-employee-contract"
import { readAttendanceParticipationHistory } from "@/lib/mtm/attendance-participation-store"
import { lockAttendanceRequests } from "@/lib/mtm/attendance-self-access"
import { lockMtmWorkdayTransitions } from "@/lib/mtm/workday"
import { recordWorkforceEmploymentEventInTransaction, WorkforceEmploymentHistoryError } from "@/lib/workforce/employment-history"
import type { AttendanceReviewer } from "@/lib/mtm/attendance-request-decision"
import { resolveAttendanceReviewerScope } from "@/lib/mtm/attendance-request-decision"
import { ATTENDANCE_FEATURE_SETTING_KEY } from "@/lib/mtm/attendance-feature"
import { managerAssignmentCreatesCycle } from "@/lib/mtm/agent-administration"
import { agentHistory } from "@/lib/mtm/agent-deletion"
import { readAttendanceEmployeePreparation } from "@/lib/mtm/attendance-employee-preparation"

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
/** Today's mark per employee for the list: on the job since, on a break, gone at. */
async function todayMarks(tx: Prisma.TransactionClient, organizationId: string, agentIds: string[], today: string) {
  if (!agentIds.length) return new Map<string, AttendanceEmployeeToday>()
  const days = await tx.mtmAgentWorkday.findMany({ where: { organizationId, agentId: { in: agentIds }, workDate: new Date(`${today}T00:00:00.000Z`) },
    select: { agentId: true, status: true, startedAt: true, completedAt: true }, take: 2001 })
  return new Map(days.map(day => [day.agentId, { status: day.status, startedAt: day.startedAt?.toISOString() ?? null, completedAt: day.completedAt?.toISOString() ?? null }]))
}
export async function readAttendanceEmployees(actor: AttendanceReviewer): Promise<AttendanceEmployeeDirectory> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const timezone = await requireAttendanceEmployeeAdmin(tx, actor), organizationId = actor.organizationId
    const users = await tx.user.findMany({ where: { organizationId, isActive: true, anonymizedAt: null }, select: { id: true, name: true, phone: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 1001 })
    const cards = await tx.mtmAgent.findMany({ where: { organizationId }, select: { id: true, name: true, phone: true, position: true, managerId: true, userId: true, role: true, status: true, attendanceParticipant: true, attendanceExcluded: true, attendanceIncludedFrom: true, teamId: true, team: { select: { name: true } }, departmentId: true, department: { select: { name: true } },
      user: { select: { identityAccount: { select: { cutoverAt: true, phoneClaim: { select: { normalizedPhone: true } } } } } },
      identityActorBinding: { select: { account: { select: { cutoverAt: true, phoneClaim: { select: { normalizedPhone: true } } } } } },
      auditLogs: { where: { organizationId, metadataKind: "mtm_attendance_employment", OR: [
        { action: { in: ["MTM_ATTENDANCE_EMPLOYEE_CREATED", "MTM_ATTENDANCE_EMPLOYEE_ENROLLED", "MTM_IDENTITY_TIME_ENROLLED"] } },
        { action: "MTM_ATTENDANCE_EMPLOYMENT_RECORDED", newData: { path: ["kind"], equals: "HIRE" } },
      ] }, select: { id: true }, take: 1 },
    }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 1001 })
    const teams = await tx.mtmTeam.findMany({ where: { organizationId }, select: { id: true, name: true, departmentId: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 1001 })
    const departments = await tx.mtmDepartment.findMany({ where: { organizationId }, select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 1001 })
    if (users.length > 1000 || cards.length > 1000 || teams.length > 1000 || departments.length > 1000) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_TOO_LARGE", 422)
    // A CRM login receives a technical attendance card automatically; it is
    // not an HR enrollment. Keep pre-automation manual staff and explicit HR
    // additions, including staff excluded from tracking or later dismissed.
    // Neither the user's CRM role nor a missing job title proves membership.
    const tracked = cards.filter(card => isAttendanceTrackedCard(card)
      && (card.attendanceIncludedFrom === null || card.auditLogs.length > 0))
    const events = await history(tx, organizationId, tracked.map(card => card.id))
    const participation = await readAttendanceParticipationHistory(tx, organizationId, tracked.map(card => card.id))
    const latestParticipation = new Map(participation.map(event => [event.agentId, event.id]))
    const names = new Map(users.map(user => [user.id, user.name])), phones = new Map(users.map(user => [user.id, user.phone]))
    const marks = await todayMarks(tx, organizationId, tracked.map(card => card.id), currentDateKey(new Date(), timezone))
    const managers = cards.filter(card => card.status === "ACTIVE" && (ATTENDANCE_MANAGER_ROLES as readonly string[]).includes(card.role))
      .map(card => ({ id: card.id, name: card.name, position: card.position ?? null }))
    return { timezone, teams, departments, managers, users: users.map(user => {
      const linked = cards.filter(card => card.userId === user.id), card = linked[0]
      return { id: user.id, name: user.name, existingRole: card?.role ?? null, existingTeamId: card?.teamId ?? null,
        eligible: false }
    }), employees: tracked.map(card => ({ id: card.id, name: card.name, role: card.role, status: card.status, teamName: card.team?.name ?? null,
      departmentId: card.departmentId, departmentName: card.department?.name ?? null, position: card.position ?? null, teamId: card.teamId, managerId: card.managerId,
      phone: identityDirectoryPhone({ userAccount: card.user?.identityAccount, boundAccount: card.identityActorBinding?.account, legacyPhone: card.phone ?? (card.userId ? phones.get(card.userId) ?? null : null) }), todayMark: marks.get(card.id) ?? null,
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

/**
 * Personnel → Employees → card (owner, 2026-10-15): job title, department and
 * manager — what «Forma N-1t» and every HR list need. The department is the
 * card's MTM team and the manager its `managerId`, the same links MTM reads:
 * the manager approves this person's requests. Tenant administration only.
 */
export async function updateAttendanceEmployeeCard(actor: AttendanceReviewer, raw: unknown) {
  const parsed = AttendanceEmployeeCardSchema.safeParse(raw)
  if (!parsed.success) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_INVALID", 400)
  const input = parsed.data, organizationId = actor.organizationId
  return prisma.$transaction(async tx => {
    await requireAttendanceEmployeeAdmin(tx, actor)
    const [card] = await tx.$queryRaw<Array<{ position: string | null; teamId: string | null; departmentId: string | null; managerId: string | null }>>`
      SELECT "position", "teamId", "departmentId", "managerId" FROM mtm_agents WHERE "organizationId" = ${organizationId} AND id = ${input.agentId}
        AND ${attendanceTrackedCardSql()} FOR UPDATE`
    if (!card) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_NOT_FOUND", 404)
    if (input.managerId) {
      const manager = await tx.mtmAgent.findFirst({ where: { organizationId, id: input.managerId, status: "ACTIVE", role: { in: [...ATTENDANCE_MANAGER_ROLES] } }, select: { id: true } })
      if (!manager || await managerAssignmentCreatesCycle(tx, { organizationId, agentId: input.agentId, managerId: input.managerId })) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_MANAGER_INVALID", 422)
    }
    const { teamId, departmentId } = await resolveAttendanceUnit(tx, organizationId, input, card.departmentId)
    const next = { position: input.position, teamId, departmentId, managerId: input.managerId }
    if (next.position === card.position && next.teamId === card.teamId && next.departmentId === card.departmentId && next.managerId === card.managerId) return { agentId: input.agentId, eventId: input.agentId, idempotent: true }
    await tx.mtmAgent.update({ where: { organizationId, id: input.agentId }, data: next })
    const audit = await tx.mtmAuditLog.create({ data: { organizationId, actorUserId: actor.userId, agentId: input.agentId, entity: "agent", entityId: input.agentId,
      action: "MTM_ATTENDANCE_EMPLOYEE_CARD_CHANGED", metadataKind: "mtm_attendance_employee_card", oldData: card, newData: next }, select: { id: true } })
    return { agentId: input.agentId, eventId: audit.id, idempotent: false }
  }, { timeout: 15_000 })
}

/**
 * Where a card sits (owner, 2026-10-22: «тут есть отдел, но нет департамента»):
 * a department and a section (şöbə, an MTM team) in it, each an existing one or
 * a new one typed by name. A section belongs to one department, so picking it
 * names the department too; a section outside any department joins the one it
 * was picked under. `current` is the card's department, kept when a tab opened
 * before departments sends none.
 */
export async function resolveAttendanceUnit(tx: Prisma.TransactionClient, organizationId: string, input: AttendanceUnitInput, current: string | null = null) {
  const named = input.newDepartmentName !== undefined || input.departmentId !== undefined
  let departmentId: string | null
  if (input.newDepartmentName) {
    // A department typed again by name is the same department.
    const existing = await tx.mtmDepartment.findFirst({ where: { organizationId, name: { equals: input.newDepartmentName, mode: "insensitive" } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } })
    departmentId = existing?.id ?? (await tx.mtmDepartment.create({ data: { organizationId, name: input.newDepartmentName }, select: { id: true } })).id
  } else if (input.departmentId) {
    if (!await tx.mtmDepartment.findFirst({ where: { organizationId, id: input.departmentId }, select: { id: true } })) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_TEAM_CHANGED")
    departmentId = input.departmentId
  } else departmentId = input.departmentId === null ? null : current
  let team: { id: string; departmentId: string | null } | null = null
  if (input.newTeamName) {
    // A section typed again by name is the same section — the one in this
    // department, else one outside any; a namesake in another department is not it.
    const namesakes = await tx.mtmTeam.findMany({ where: { organizationId, name: { equals: input.newTeamName, mode: "insensitive" } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, departmentId: true }, take: 50 })
    team = namesakes.find(section => section.departmentId === departmentId) ?? namesakes.find(section => !section.departmentId) ?? (named ? null : namesakes[0] ?? null)
      ?? await tx.mtmTeam.create({ data: { organizationId, name: input.newTeamName, departmentId }, select: { id: true, departmentId: true } })
  } else if (input.teamId) {
    team = await tx.mtmTeam.findFirst({ where: { organizationId, id: input.teamId }, select: { id: true, departmentId: true } })
    if (!team) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_TEAM_CHANGED")
  }
  if (team?.departmentId) {
    if (named && departmentId && departmentId !== team.departmentId) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_SECTION_ELSEWHERE", 409)
    departmentId = team.departmentId
  } else if (team && departmentId) await tx.mtmTeam.updateMany({ where: { organizationId, id: team.id, departmentId: null }, data: { departmentId } })
  return { teamId: team?.id ?? null, departmentId }
}
/** The first HIRE of a card created a moment ago, recorded the way the history form records it. */
export async function recordAttendanceInitialHire(tx: Prisma.TransactionClient, actor: AttendanceReviewer, agentId: string, date: string, timezone: string) {
  const organizationId = actor.organizationId
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`workforce-employment:${organizationId}:${agentId}`}))`
  if ((await history(tx, organizationId, [agentId])).length) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_HISTORY_CHANGED")
  const event = await appendEvent(tx, actor, agentId, "HIRE", date, timezone)
  await tx.mtmAuditLog.create({ data: { organizationId, actorUserId: actor.userId, agentId, entity: "workforce_employment_event", entityId: event.id,
    action: "MTM_ATTENDANCE_EMPLOYMENT_RECORDED", metadataKind: "mtm_attendance_employment", newData: { date, kind: "HIRE", eventId: event.id, timezone } } })
  return event
}

/** CRM roles whose login HR may change from Personnel. An administrator's
 * sign-in stays with Settings → Users, where it is protected by its own rules. */
const LOGIN_LOCKED_ROLES = new Set(["admin", "superadmin"])
/** The address a CRM user gets when HR gives no email (as Personnel → Add employee). */
const NO_EMAIL_DOMAIN = "invalid.local"
const realEmail = (email: string | null | undefined) => email && !email.endsWith(`@${NO_EMAIL_DOMAIN}`) ? email : null
const SICK_KINDS = new Set(["SICK_LEAVE", "UNPAID_SICK"])

/** Personnel → Employees → one employee's page (owner, 2026-10-16). */
export async function readAttendanceEmployee(actor: AttendanceReviewer, agentId: string, now = new Date()): Promise<AttendanceEmployeeDetail> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const timezone = await requireAttendanceEmployeeAdmin(tx, actor), organizationId = actor.organizationId
    const card = await tx.mtmAgent.findFirst({ where: { organizationId, id: agentId, ...ATTENDANCE_TRACKED_CARD_WHERE },
      select: { id: true, name: true, phone: true, email: true, role: true, status: true, position: true, teamId: true, managerId: true, attendanceExcluded: true, team: { select: { name: true } }, departmentId: true, department: { select: { name: true } },
        user: { select: { id: true, name: true, phone: true, email: true, role: true, isActive: true, identityAccount: { select: { cutoverAt: true, phoneClaim: { select: { normalizedPhone: true } } } } } },
        identityActorBinding: { select: { account: { select: { cutoverAt: true, phoneClaim: { select: { normalizedPhone: true } } } } } } } })
    if (!card) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_NOT_FOUND", 404)
    const [teams, departments, managerCards, events, participation] = await Promise.all([
      tx.mtmTeam.findMany({ where: { organizationId }, select: { id: true, name: true, departmentId: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 1000 }),
      tx.mtmDepartment.findMany({ where: { organizationId }, select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 1000 }),
      tx.mtmAgent.findMany({ where: { organizationId, status: "ACTIVE", role: { in: [...ATTENDANCE_MANAGER_ROLES] }, NOT: { id: agentId } }, select: { id: true, name: true, position: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 1000 }),
      history(tx, organizationId, [agentId]),
      readAttendanceParticipationHistory(tx, organizationId, [agentId]),
    ])
    const recorders = await tx.user.findMany({ where: { organizationId, id: { in: [...new Set(events.map(event => event.recordedByUserId))] } }, select: { id: true, name: true } })
    const names = new Map(recorders.map(user => [user.id, user.name]))
    const today = currentDateKey(now, timezone), from = `${today.slice(0, 7)}-01`
    // The month so far, from the same projection as the timesheet.
    let month: AttendanceEmployeeDetail["month"] = null
    try {
      const report = await readAttendanceProjectionInTransaction(tx, { organizationId, authorizedEmployeeIds: [agentId], query: { from, to: today, employeeId: agentId, form: "ALL" }, now })
      const rows = report.rows, summary = summarizeMtmAttendanceRows(rows)
      month = { from, to: today, workedDays: summary.arrivedCount, workedSeconds: summary.workedSeconds, lateCount: summary.lateCount, absentCount: summary.absentCount,
        leaveDays: rows.filter(row => row.dayKind && ["PAID_LEAVE", "UNPAID_LEAVE"].includes(row.dayKind.group) && !SICK_KINDS.has(row.dayKind.key)).length,
        sickDays: rows.filter(row => row.dayKind && SICK_KINDS.has(row.dayKind.key)).length, isComplete: summary.isComplete }
    } catch (error) {
      // A refused projection (too large, invalid facts) leaves the month blank; a database error ends the read.
      if (!(error instanceof Error) || !error.message.startsWith("MTM_ATTENDANCE_")) throw error
    }
    const marks = await todayMarks(tx, organizationId, [agentId], today)
    const phone = identityDirectoryPhone({ userAccount: card.user?.identityAccount, boundAccount: card.identityActorBinding?.account, legacyPhone: card.phone ?? card.user?.phone ?? null })
    const preparationCard = card.user?.identityAccount?.cutoverAt || card.identityActorBinding?.account.cutoverAt
      ? { ...card, phone, email: null, user: card.user ? { ...card.user, phone, email: null } : null } : card
    const preparation = await readAttendanceEmployeePreparation(tx, { organizationId, agentId, date: today }, preparationCard, now)
    return { timezone, today, teams, departments, preparation, managers: managerCards.map(manager => ({ id: manager.id, name: manager.name, position: manager.position ?? null })), month,
      employee: { id: card.id, name: card.user?.name ?? card.name, phone, email: realEmail(card.email) ?? realEmail(card.user?.email),
        role: card.role, status: card.status, crmRole: card.user?.role ?? null, loginEditable: !card.user?.identityAccount?.cutoverAt && !card.identityActorBinding?.account.cutoverAt
          && (!card.user || !LOGIN_LOCKED_ROLES.has(card.user.role)),
        position: card.position ?? null, teamId: card.teamId, teamName: card.team?.name ?? null, departmentId: card.departmentId, departmentName: card.department?.name ?? null, managerId: card.managerId,
        included: !card.attendanceExcluded, participationVersion: participation.at(-1)?.id ?? null, todayMark: marks.get(agentId) ?? null,
        history: events.map(event => ({ id: event.id, kind: event.kind, date: employmentDate(event, timezone), at: event.effectiveAt.toISOString(), byName: names.get(event.recordedByUserId) ?? null })) } }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15_000 })
}

/**
 * One save for the employee page: the name (on the CRM user and the card), the
 * sign-in phone and email when HR may change them, job title, department,
 * manager, and — while there is no history yet — the hire date.
 */
export async function updateAttendanceEmployee(actor: AttendanceReviewer, agentId: string, raw: unknown) {
  const parsed = AttendanceEmployeeProfileSchema.safeParse(raw)
  if (!parsed.success) throw new AttendanceRequestError(parsed.error.issues.some(issue => issue.path[0] === "phone") ? "MTM_ATTENDANCE_EMPLOYEE_PHONE_INVALID" : "MTM_ATTENDANCE_EMPLOYEE_INVALID", 400)
  const input = parsed.data, organizationId = actor.organizationId
  const editsLogin = input.phone !== undefined || input.email !== undefined
  const save = async (tx: Prisma.TransactionClient) => {
    // All profile writes share this lock: a metadata-only save must not take
    // actor→User locks while a phone writer holds User→actor locks.
    await tx.$executeRaw`SELECT set_config('lock_timeout', '3s', true)`
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'identity-registry:' + organizationId}, 0))`
    const timezone = await requireAttendanceEmployeeAdmin(tx, actor)
    const [card] = await tx.$queryRaw<Array<{ name: string; phone: string | null; email: string | null; userId: string | null; position: string | null; teamId: string | null; departmentId: string | null; managerId: string | null }>>`
      SELECT name, phone, email, "userId", "position", "teamId", "departmentId", "managerId" FROM mtm_agents WHERE "organizationId" = ${organizationId} AND id = ${agentId}
        AND ${attendanceTrackedCardSql()} FOR UPDATE`
    if (!card) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_NOT_FOUND", 404)
    if (card.userId) await tx.$queryRaw`SELECT id FROM users WHERE "organizationId" = ${organizationId} AND id = ${card.userId} FOR UPDATE`
    const user = card.userId ? await tx.user.findFirst({ where: { organizationId, id: card.userId }, select: { id: true, name: true, phone: true, email: true, role: true } }) : null
    const beforePhone = card.phone ?? user?.phone ?? null, beforeEmail = realEmail(card.email) ?? realEmail(user?.email) ?? null
    const phoneChange = input.phone !== undefined && input.phone !== beforePhone
    const emailChange = input.email !== undefined && input.email !== beforeEmail
    if ((phoneChange || emailChange) && user && LOGIN_LOCKED_ROLES.has(user.role)) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_LOGIN_LOCKED", 403)
    if (phoneChange) {
      if (await readLegacyPhoneAssignmentBoundaryInTransaction(tx, organizationId, input.phone!) !== "LEGACY") {
        throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_LOGIN_LOCKED", 409)
      }
      // The number signs a person in: two people with one number would both be refused the code.
      const owner = await findPhoneOwner(tx, organizationId, input.phone!)
      if (owner.kind === "ambiguous" || (owner.kind === "found" && owner.agentId !== agentId)) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_PHONE_TAKEN", 409)
    }
    if (emailChange && input.email) {
      // Another person's CRM login or field card with this email would sign in as them.
      if (await tx.user.findFirst({ where: { organizationId, email: input.email, ...(user ? { NOT: { id: user.id } } : {}) }, select: { id: true } })
        || await tx.mtmAgent.findFirst({ where: { organizationId, email: input.email, NOT: { id: agentId } }, select: { id: true } })) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_EMAIL_TAKEN", 409)
    }
    if (input.managerId) {
      const manager = await tx.mtmAgent.findFirst({ where: { organizationId, id: input.managerId, status: "ACTIVE", role: { in: [...ATTENDANCE_MANAGER_ROLES] } }, select: { id: true } })
      if (!manager || await managerAssignmentCreatesCycle(tx, { organizationId, agentId, managerId: input.managerId })) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_MANAGER_INVALID", 422)
    }
    const { teamId, departmentId } = await resolveAttendanceUnit(tx, organizationId, input, card.departmentId)
    // The CRM user needs an address; without a real one it keeps one that reaches nobody.
    const userEmail = emailChange ? input.email ?? `staff-${randomUUID()}@${NO_EMAIL_DOMAIN}` : undefined
    if (user) await tx.user.update({ where: { id: user.id }, data: { name: input.name, ...(phoneChange ? { phone: input.phone } : {}), ...(userEmail ? { email: userEmail } : {}) } })
    await tx.mtmAgent.update({ where: { organizationId, id: agentId }, data: { name: input.name, position: input.position, teamId, departmentId, managerId: input.managerId,
      ...(phoneChange ? { phone: input.phone } : {}), ...(emailChange ? { email: input.email ?? null } : {}) } })
    const hire = input.hireDate && !(await history(tx, organizationId, [agentId])).length ? await recordAttendanceInitialHire(tx, actor, agentId, input.hireDate, timezone) : null
    const before = { name: user?.name ?? card.name, phone: beforePhone, email: beforeEmail, position: card.position, teamId: card.teamId, departmentId: card.departmentId, managerId: card.managerId }
    const after = { name: input.name, phone: phoneChange ? input.phone! : beforePhone, email: emailChange ? input.email ?? null : beforeEmail, position: input.position, teamId, departmentId, managerId: input.managerId }
    const audit = await tx.mtmAuditLog.create({ data: { organizationId, actorUserId: actor.userId, agentId, entity: "agent", entityId: agentId,
      action: "MTM_ATTENDANCE_EMPLOYEE_UPDATED", metadataKind: "mtm_attendance_employee_card", oldData: before,
      newData: { ...after, ...(hire ? { hireEventId: hire.id, hireDate: input.hireDate } : {}) } }, select: { id: true } })
    if (editsLogin && user) await logAudit(organizationId, "user_updated", "user", user.id, after.email ?? after.name, {
      userId: actor.userId, oldValue: { name: before.name, phone: before.phone, email: before.email },
      newValue: { name: after.name, phone: after.phone, email: after.email, source: "personnel" } }, tx)
    return { auditId: audit.id, userId: user?.id ?? null, before, after }
  }
  const result = !editsLogin ? await prisma.$transaction(save, { timeout: 15_000 }) : await (async () => {
    // Admission precedes target credential inspection. Repeat authorization
    // inside save after the fence; no locks survive this separate preflight.
    await runWithTenant(organizationId, () => prisma.$transaction(async tx => {
      await requireAttendanceEmployeeAdmin(tx, actor)
      if (!await tx.mtmAgent.findFirst({ where: { organizationId, id: agentId, ...ATTENDANCE_TRACKED_CARD_WHERE }, select: { id: true } })) {
        throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_NOT_FOUND", 404)
      }
    }, { timeout: 15_000 }))
    const fenced = await runWithTenant(organizationId, () => withLegacyCredentialMaintenance(prisma, organizationId,
      [{ kind: "ACTOR", actorId: agentId }], save))
    if (!fenced.allowed) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_LOGIN_LOCKED", 409)
    return fenced.value
  })()
  if (!editsLogin && result.userId) await logAudit(organizationId, "user_updated", "user", result.userId, result.after.email ?? result.after.name, {
    userId: actor.userId, oldValue: { name: result.before.name, phone: result.before.phone, email: result.before.email },
    newValue: { name: result.after.name, phone: result.after.phone, email: result.after.email, source: "personnel" } })
  return { agentId, eventId: result.auditId, idempotent: false }
}

/** Calendar entries that record a person's own leave or absence: history, like the agent delete counts them. */
const HISTORY_CALENDAR_SOURCES = ["HRM", "WORKFORCE_LEAVE", "WORKFORCE_ABSENCE"]

/**
 * Personnel → employee page → remove (owner, 2026-10-16: «где удаление
 * сотрудников»), by the rule the owner set for MTM agents on 2026-10-06:
 * - DELETE: only someone with no work history (added by mistake). The card goes
 *   for good; the office employee's CRM login is switched off first.
 * - DISMISS: someone with history is let go instead — a TERMINATION on their
 *   last working day, the card inactive, the office login switched off. Their
 *   marks stay for the timesheet.
 * A CRM user Personnel did not add (an administrator, a sales manager) is not
 * removed here: their account belongs to Settings → Users.
 */
export async function removeAttendanceEmployee(actor: AttendanceReviewer, agentId: string, raw: unknown) {
  const parsed = AttendanceEmployeeRemoveSchema.safeParse(raw)
  if (!parsed.success) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_INVALID", 400)
  const input = parsed.data, organizationId = actor.organizationId
  const result = await prisma.$transaction(async tx => {
    const timezone = await requireAttendanceEmployeeAdmin(tx, actor)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`workforce-employment:${organizationId}:${agentId}`}))`
    const [card] = await tx.$queryRaw<Array<{ name: string; userId: string | null; status: string }>>`
      SELECT name, "userId", status FROM mtm_agents WHERE "organizationId" = ${organizationId} AND id = ${agentId} AND ${attendanceTrackedCardSql()} FOR UPDATE`
    if (!card) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_NOT_FOUND", 404)
    if (card.userId) await tx.$queryRaw`SELECT id FROM users WHERE "organizationId" = ${organizationId} AND id = ${card.userId} FOR UPDATE`
    const user = card.userId ? await tx.user.findFirst({ where: { organizationId, id: card.userId }, select: { id: true, role: true, isActive: true } }) : null
    if (user && user.role !== OFFICE_EMPLOYEE_CRM_ROLE) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_CRM_USER", 409)
    if (user?.id === actor.userId) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_CRM_USER", 409)
    // The office login goes first: the database keeps an active user's card.
    const closeLogin = async () => { if (user?.isActive) await tx.user.update({ where: { id: user.id }, data: { isActive: false, passwordChangedAt: new Date() } }) }
    if (input.mode === "DELETE") {
      const kinds = await agentHistory(tx, organizationId, agentId)
      const calendar = await tx.mtmWorkCalendarDay.count({ where: { organizationId, agentId, source: { in: HISTORY_CALENDAR_SOURCES } } })
      // Employment history lives outside the Prisma models agentHistory reads.
      const employment = await history(tx, organizationId, [agentId])
      if (kinds.length || calendar || employment.length) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_HAS_HISTORY", 409)
      await closeLogin()
      await tx.mtmAgent.delete({ where: { organizationId, id: agentId } })
      await tx.mtmAuditLog.create({ data: { organizationId, actorUserId: actor.userId, agentId: null, entity: "agent", entityId: agentId,
        action: "MTM_ATTENDANCE_EMPLOYEE_DELETED", metadataKind: "mtm_attendance_employment", oldData: { name: card.name, userId: card.userId } } })
      return { userId: user?.id ?? null, closed: Boolean(user?.isActive), name: card.name }
    }
    // Dismissal: the last working day is today or before — a future one waits in the history form.
    if (input.lastDay > currentDateKey(new Date(), timezone)) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_DATE_INVALID", 400)
    const previous = await history(tx, organizationId, [agentId])
    if (previous.at(-1)?.kind !== "TERMINATION") {
      if (!previous.length) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_HIRE_REQUIRED", 409)
      const event = await appendEvent(tx, actor, agentId, "TERMINATION", input.lastDay, timezone)
      await tx.mtmAuditLog.create({ data: { organizationId, actorUserId: actor.userId, agentId, entity: "workforce_employment_event", entityId: event.id,
        action: "MTM_ATTENDANCE_EMPLOYMENT_RECORDED", metadataKind: "mtm_attendance_employment", newData: { reason: input.reason, date: input.lastDay, kind: "TERMINATION", eventId: event.id, timezone } } })
    }
    await closeLogin()
    await tx.mtmAgent.update({ where: { organizationId, id: agentId }, data: { status: "INACTIVE" } })
    await tx.mtmAuditLog.create({ data: { organizationId, actorUserId: actor.userId, agentId, entity: "agent", entityId: agentId,
      action: "MTM_ATTENDANCE_EMPLOYEE_DISMISSED", metadataKind: "mtm_attendance_employee_card", oldData: { status: card.status }, newData: { status: "INACTIVE", lastDay: input.lastDay, reason: input.reason } } })
    return { userId: user?.id ?? null, closed: Boolean(user?.isActive), name: card.name }
  }, { timeout: 15_000 }).catch((error: unknown) => {
    // The database refused the delete: a row no check here knows still points at
    // the person, or an append-only table would lose a fact. That is history —
    // and never the constraint's name on HR's screen. Everything rolled back.
    if ((error instanceof Prisma.PrismaClientKnownRequestError && ["P2003", "P2014"].includes(error.code))
      || (error instanceof Error && /foreign key constraint|is immutable|cannot be deleted|IMMUTABLE/i.test(error.message))) {
      throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_HAS_HISTORY", 409)
    }
    throw error
  })
  if (result.userId && result.closed) await logAudit(organizationId, "user_updated", "user", result.userId, result.name, {
    userId: actor.userId, oldValue: { isActive: true }, newValue: { isActive: false, source: "personnel", mode: input.mode } })
  return { agentId, eventId: agentId, idempotent: false, mode: input.mode }
}
