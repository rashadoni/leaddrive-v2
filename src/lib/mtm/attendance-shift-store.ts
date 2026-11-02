import { createHash, randomUUID } from "node:crypto"
import { ATTENDANCE_TRACKED_CARD_WHERE, attendanceTrackedCardSql } from "@/lib/mtm/attendance-tracking"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { currentAttendanceReadActor } from "@/lib/mtm/attendance-read-access"
import type { AttendanceReviewer } from "@/lib/mtm/attendance-request-decision"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { addDateKeyDays, currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import { readAttendanceRules } from "@/lib/mtm/attendance-rule-store"
import { AttendanceShiftPublishSchema, AttendanceShiftQuerySchema, AttendanceShiftValueSchema,
  type AttendanceShiftAssignment, type AttendanceShiftDirectory, type AttendanceShiftPlan, type AttendanceShiftRoster } from "@/lib/mtm/attendance-shift-contract"
type Tx = Prisma.TransactionClient
type PlanRow = { id: string; version: number; createdAt: Date; teamId: string | null; teamName: string | null; value: unknown; memberCount: number }
const fail = (code: string, status = 409): never => { throw new AttendanceRequestError(`MTM_ATTENDANCE_SHIFT_${code}`, status) }
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")
const toPlan = (row: PlanRow): AttendanceShiftPlan => ({ id: row.id, version: row.version, createdAt: row.createdAt.toISOString(), teamId: row.teamId, teamName: row.teamName, memberCount: row.memberCount, value: AttendanceShiftValueSchema.parse(row.value) })
async function timezoneFor(tx: Tx, organizationId: string) {
  const item = await tx.mtmSetting.findUnique({ where: { organizationId_key: { organizationId, key: "timezone" } }, select: { value: true } })
  const timezone = item?.value ?? "Asia/Baku"
  if (typeof timezone !== "string" || !isValidTimezone(timezone)) return fail("TIMEZONE_INVALID")
  return timezone
}
async function latest(tx: Tx, organizationId: string) {
  const [row] = await tx.$queryRaw<{ id: string; version: number }[]>`SELECT id,version FROM mtm_attendance_shift_plans WHERE "organizationId"=${organizationId} ORDER BY version DESC LIMIT 1`
  return row ?? null
}
const rosterHash = (organizationId: string, teamId: string | null, ids: string[]) => digest({ organizationId, teamId, ids: [...ids].sort() })

/** Internal projection only. Callers establish current authority and provide
 * explicit scoped employees; member rows never expand that authorized set. */
export async function readAttendanceShiftAssignments(tx: Tx, organizationId: string, agentIds: readonly string[], from: string, to: string): Promise<AttendanceShiftAssignment[]> {
  if (!agentIds.length) return []
  const rows = await tx.$queryRaw<(PlanRow & { agentId: string })[]>`SELECT p.id,p.version,p."createdAt",p."teamId",p."teamName",p.value,m."agentId",0::int AS "memberCount"
    FROM mtm_attendance_shift_plans p JOIN mtm_attendance_shift_members m ON m."organizationId"=p."organizationId" AND m."planId"=p.id
    WHERE p."organizationId"=${organizationId} AND m."agentId"=ANY(${[...agentIds]}::text[]) AND p.value->>'from'<=${to} AND p.value->>'to'>=${from}
    ORDER BY p.version,m."agentId" LIMIT 100001`
  if (rows.length > 100000) return fail("HISTORY_TOO_LARGE")
  return rows.map(row => ({ agentId: row.agentId, plan: toPlan(row) }))
}
export async function readAttendanceShiftDirectory(reviewer: AttendanceReviewer, raw: unknown): Promise<AttendanceShiftDirectory> {
  const parsed = AttendanceShiftQuerySchema.safeParse(raw)
  if (!parsed.success) return fail("INVALID", 400)
  return prisma.$transaction(async (tx: Tx) => {
    const actor = await currentAttendanceReadActor(tx, reviewer)
    const timezone = await timezoneFor(tx, reviewer.organizationId)
    const user = await tx.user.findFirst({ where: { organizationId: reviewer.organizationId, id: reviewer.userId }, select: { role: true } })
    const canManage = !!user && ["admin", "superadmin"].includes(user.role)
    const agents = await tx.mtmAgent.findMany({ where: { organizationId: reviewer.organizationId, ...ATTENDANCE_TRACKED_CARD_WHERE,
      ...(actor.scopedAgentIds === null ? {} : { id: { in: [...actor.scopedAgentIds] } }) }, select: { id: true, teamId: true, status: true, attendanceExcluded: true }, take: 5001 })
    if (agents.length > 5000) return fail("DIRECTORY_TOO_LARGE")
    const assignments = await readAttendanceShiftAssignments(tx, reviewer.organizationId, agents.map(agent => agent.id), parsed.data.from, parsed.data.to)
    const plans = new Map<string, AttendanceShiftPlan>()
    for (const assignment of assignments) {
      const saved = plans.get(assignment.plan.id)
      if (saved) saved.memberCount++
      else plans.set(assignment.plan.id, { ...assignment.plan, memberCount: 1 })
    }
    const rosters: AttendanceShiftRoster[] = []
    if (canManage) {
      const active = agents.filter(agent => agent.status === "ACTIVE" && !agent.attendanceExcluded)
      const ids = active.map(agent => agent.id)
      if (ids.length && ids.length <= 500) rosters.push({ teamId: null, name: null, count: ids.length, hash: rosterHash(reviewer.organizationId, null, ids) })
      const teamIds = [...new Set(active.flatMap(agent => agent.teamId ? [agent.teamId] : []))]
      const teams = await tx.mtmTeam.findMany({ where: { organizationId: reviewer.organizationId, id: { in: teamIds } }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      for (const team of teams) {
        const members = active.filter(agent => agent.teamId === team.id).map(agent => agent.id)
        if (members.length <= 500) rosters.push({ teamId: team.id, name: team.name, count: members.length, hash: rosterHash(reviewer.organizationId, team.id, members) })
      }
    }
    return { plans: [...plans.values()].sort((a, b) => b.version - a.version), revisionId: (await latest(tx, reviewer.organizationId))?.id ?? null,
      canManage, timezone, today: currentDateKey(new Date(), timezone), rosters }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 })
}
export async function publishAttendanceShiftPlan(reviewer: AttendanceReviewer, raw: unknown) {
  const parsed = AttendanceShiftPublishSchema.safeParse(raw)
  if (!parsed.success) return fail("INVALID", 400)
  const input = parsed.data, requestHash = digest(input)
  return prisma.$transaction(async (tx: Tx) => {
    await tx.$executeRaw`SELECT set_config('lock_timeout','3s',true)`
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-attendance-shifts:${reviewer.organizationId}`},0))`
    await currentAttendanceReadActor(tx, reviewer)
    const user = await tx.user.findFirst({ where: { organizationId: reviewer.organizationId, id: reviewer.userId }, select: { role: true } })
    if (!user || !["admin", "superadmin"].includes(user.role)) return fail("ADMIN_REQUIRED", 403)
    const [existing] = await tx.$queryRaw<(PlanRow & { requestHash: string; createdBy: string })[]>`SELECT p.*,(SELECT count(*)::int FROM mtm_attendance_shift_members m WHERE m."organizationId"=p."organizationId" AND m."planId"=p.id) AS "memberCount"
      FROM mtm_attendance_shift_plans p WHERE p."organizationId"=${reviewer.organizationId} AND p."requestId"=${input.requestId}`
    if (existing) {
      if (existing.requestHash !== requestHash || existing.createdBy !== reviewer.userId) return fail("REPLAY_MISMATCH")
      return toPlan(existing)
    }
    const previous = await latest(tx, reviewer.organizationId)
    if ((previous?.id ?? null) !== input.expectedRevisionId) return fail("CHANGED")
    const timezone = await timezoneFor(tx, reviewer.organizationId)
    if (input.value.timezone !== timezone) return fail("CHANGED")
    const historicalZones = await tx.$queryRaw<{ timezone: string }[]>`SELECT DISTINCT value->>'timezone' AS timezone FROM mtm_attendance_shift_plans WHERE "organizationId"=${reviewer.organizationId}`
    const rules = await readAttendanceRules(reviewer.organizationId, tx)
    const now = new Date(), zones = [timezone, "Asia/Baku", ...rules.map(rule => rule.timezone), ...historicalZones.map(row => row.timezone)]
    const today = zones.map(zone => currentDateKey(now, zone)).sort().at(-1)!
    if (input.value.from <= today || input.value.to > addDateKeyDays(today, 366)) return fail("FUTURE_REQUIRED")
    if (input.teamId) await tx.$queryRaw`SELECT id FROM mtm_teams WHERE "organizationId"=${reviewer.organizationId} AND id=${input.teamId} FOR SHARE`
    const team = input.teamId ? await tx.mtmTeam.findFirst({ where: { organizationId: reviewer.organizationId, id: input.teamId }, select: { name: true } }) : null
    if (input.teamId && !team) return fail("ROSTER_CHANGED")
    const teamWhere = input.teamId ? Prisma.sql`AND "teamId"=${input.teamId}` : Prisma.empty
    const agents = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM mtm_agents WHERE "organizationId"=${reviewer.organizationId} AND status='ACTIVE'
      AND NOT "attendanceExcluded" AND ${attendanceTrackedCardSql()} ${teamWhere} ORDER BY id LIMIT 501 FOR SHARE`)
    if (!agents.length || agents.length > 500 || rosterHash(reviewer.organizationId, input.teamId, agents.map(agent => agent.id)) !== input.expectedRosterHash) return fail("ROSTER_CHANGED")
    const id = randomUUID(), version = (previous?.version ?? 0) + 1
    const [row] = await tx.$queryRaw<PlanRow[]>`INSERT INTO mtm_attendance_shift_plans(id,"organizationId",version,"previousId","requestId","requestHash","teamId","teamName",value,reason,"createdBy")
      VALUES(${id},${reviewer.organizationId},${version},${previous?.id ?? null},${input.requestId},${requestHash},${input.teamId},${team?.name ?? null},${JSON.stringify(input.value)}::jsonb,${input.reason},${reviewer.userId})
      RETURNING id,version,"createdAt","teamId","teamName",value,${agents.length}::int AS "memberCount"`
    const members = agents.map(agent => ({ id: randomUUID(), agentId: agent.id }))
    await tx.$executeRaw`INSERT INTO mtm_attendance_shift_members(id,"organizationId","planId","agentId")
      SELECT member.id,${reviewer.organizationId},${id},member."agentId" FROM jsonb_to_recordset(${JSON.stringify(members)}::jsonb) AS member(id text,"agentId" text)`
    await tx.mtmAuditLog.create({ data: { organizationId: reviewer.organizationId, actorUserId: reviewer.userId, action: "MTM_ATTENDANCE_SHIFT_PUBLISHED", entity: "mtm_attendance_shift", entityId: id,
      metadataKind: "mtm_attendance_shift", oldData: { revisionId: previous?.id ?? null }, newData: { revisionId: id, version, memberCount: agents.length, from: input.value.from, to: input.value.to, reason: input.reason } } })
    return toPlan(row)
  }, { timeout: 15000 })
}
