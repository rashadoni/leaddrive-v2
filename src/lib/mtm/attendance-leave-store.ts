import { createHash, randomUUID } from "node:crypto"
import { ATTENDANCE_TRACKED_CARD_WHERE } from "@/lib/mtm/attendance-tracking"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import { currentAttendanceReadActor } from "@/lib/mtm/attendance-read-access"
import type { AttendanceReviewer } from "@/lib/mtm/attendance-request-decision"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { readAttendanceProjectionInTransaction } from "@/lib/mtm/attendance-report-store"
import { attendanceLeaveBalance } from "@/lib/mtm/attendance-leave-balance"
import { AttendanceLeavePolicyInputSchema, AttendanceLeaveProfileInputSchema, AttendanceLeavePolicySchema, AttendanceLeaveProfileSchema, AttendanceLeaveQuerySchema,
  type AttendanceLeavePolicy, type AttendanceLeaveProfile, type AttendanceLeaveRevision, type AttendanceLeaveDirectory } from "@/lib/mtm/attendance-leave-contract"

type Tx = Prisma.TransactionClient
type Row = { id: string; year: number; version: number; createdAt: Date; value: unknown; requestHash: string; createdBy: string }
const fail = (code: string, status = 409): never => { throw new AttendanceRequestError(`MTM_ATTENDANCE_LEAVE_${code}`, status) }
const policyDto = (row: Row): AttendanceLeaveRevision<AttendanceLeavePolicy> => ({ id: row.id, year: row.year, version: row.version, createdAt: row.createdAt.toISOString(), value: AttendanceLeavePolicySchema.parse(row.value) })
const profileDto = (row: Row): AttendanceLeaveRevision<AttendanceLeaveProfile> => ({ id: row.id, year: row.year, version: row.version, createdAt: row.createdAt.toISOString(), value: AttendanceLeaveProfileSchema.parse(row.value) })
async function admin(tx: Tx, reviewer: AttendanceReviewer) {
  await currentAttendanceReadActor(tx, reviewer)
  const user = await tx.user.findFirst({ where: { id: reviewer.userId, organizationId: reviewer.organizationId }, select: { role: true } })
  if (!user || !["admin", "superadmin"].includes(user.role)) return fail("ADMIN_REQUIRED", 403)
}
async function latestPolicy(tx: Tx, organizationId: string, year: number) {
  const [row] = await tx.$queryRaw<Row[]>`SELECT id,year,version,"createdAt",value,"requestHash","createdBy" FROM mtm_attendance_leave_policies
    WHERE "organizationId"=${organizationId} AND year=${year} ORDER BY version DESC LIMIT 1`
  return row ?? null
}
async function save(reviewer: AttendanceReviewer, raw: unknown, kind: "policy" | "profile") {
  const parsed = kind === "policy" ? AttendanceLeavePolicyInputSchema.safeParse(raw) : AttendanceLeaveProfileInputSchema.safeParse(raw)
  if (!parsed.success) return fail("INVALID", 400)
  const input = parsed.data, hash = createHash("sha256").update(JSON.stringify(input)).digest("hex")
  const table = Prisma.raw(kind === "policy" ? '"mtm_attendance_leave_policies"' : '"mtm_attendance_leave_profiles"')
  return prisma.$transaction(async (tx: Tx) => {
    await tx.$executeRaw`SELECT set_config('lock_timeout','3s',true)`
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-attendance-leave:${reviewer.organizationId}:${input.year}`},0))`
    await admin(tx, reviewer)
    const agentId = "agentId" in input ? input.agentId : null
    if (agentId && !await tx.mtmAgent.findFirst({ where: { id: agentId, organizationId: reviewer.organizationId, ...ATTENDANCE_TRACKED_CARD_WHERE }, select: { id: true } })) return fail("EMPLOYEE_UNAVAILABLE", 404)
    const [existing] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT id,year,version,"createdAt",value,"requestHash","createdBy" FROM ${table} WHERE "organizationId"=${reviewer.organizationId} AND "requestId"=${input.requestId}`)
    if (existing) {
      if (existing.requestHash !== hash || existing.createdBy !== reviewer.userId) return fail("REPLAY_MISMATCH")
      return kind === "policy" ? policyDto(existing) : profileDto(existing)
    }
    const scope = agentId ? Prisma.sql`AND "agentId"=${agentId}` : Prisma.empty
    const [previous] = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT id,year,version,"createdAt",value,"requestHash","createdBy" FROM ${table} WHERE "organizationId"=${reviewer.organizationId} AND year=${input.year} ${scope} ORDER BY version DESC LIMIT 1`)
    if ((previous?.id ?? null) !== input.expectedRevisionId) return fail("CHANGED")
    const value = "policy" in input ? input.policy : input.profile, id = randomUUID()
    const agentColumn = agentId ? Prisma.sql`,"agentId"` : Prisma.empty, agentValue = agentId ? Prisma.sql`,${agentId}` : Prisma.empty
    const [created] = await tx.$queryRaw<Row[]>(Prisma.sql`INSERT INTO ${table}(id,"organizationId",year,version,"previousId","requestId","requestHash",value,reason,"createdBy"${agentColumn})
      VALUES(${id},${reviewer.organizationId},${input.year},${(previous?.version ?? 0) + 1},${previous?.id ?? null},${input.requestId},${hash},${JSON.stringify(value)}::jsonb,${input.reason},${reviewer.userId}${agentValue}) RETURNING id,year,version,"createdAt",value,"requestHash","createdBy"`)
    await tx.mtmAuditLog.create({ data: { organizationId: reviewer.organizationId, actorUserId: reviewer.userId, agentId,
      action: kind === "policy" ? "MTM_ATTENDANCE_LEAVE_POLICY_PUBLISHED" : "MTM_ATTENDANCE_LEAVE_PROFILE_PUBLISHED", entity: "mtm_attendance_leave", entityId: id, metadataKind: "mtm_attendance_leave",
      oldData: { revisionId: previous?.id ?? null }, newData: { revisionId: id, year: input.year, reason: input.reason } } })
    return kind === "policy" ? policyDto(created) : profileDto(created)
  }, { timeout: 15000 })
}
export const saveAttendanceLeavePolicy = (reviewer: AttendanceReviewer, raw: unknown) => save(reviewer, raw, "policy")
export const saveAttendanceLeaveProfile = (reviewer: AttendanceReviewer, raw: unknown) => save(reviewer, raw, "profile")

export async function readAttendanceLeaveBalances(reviewer: AttendanceReviewer, raw: unknown): Promise<AttendanceLeaveDirectory> {
  const parsed = AttendanceLeaveQuerySchema.safeParse(raw)
  if (!parsed.success) return fail("INVALID", 400)
  const { year, offset } = parsed.data
  return prisma.$transaction(async (tx: Tx) => {
    const actor = await currentAttendanceReadActor(tx, reviewer)
    const setting = await tx.mtmSetting.findUnique({ where: { organizationId_key: { organizationId: reviewer.organizationId, key: "timezone" } }, select: { value: true } })
    const timezone = setting?.value ?? "Asia/Baku"
    if (typeof timezone !== "string" || !isValidTimezone(timezone)) return fail("TIMEZONE_INVALID")
    const now = new Date(), today = currentDateKey(now, timezone)
    const usedThrough = parsed.data.usedThrough ?? today
    if (usedThrough > today) return fail("FUTURE_USAGE", 400)
    const user = await tx.user.findFirst({ where: { id: reviewer.userId, organizationId: reviewer.organizationId }, select: { role: true } })
    const employees = await tx.mtmAgent.findMany({ where: { organizationId: reviewer.organizationId, ...ATTENDANCE_TRACKED_CARD_WHERE,
      ...(actor.scopedAgentIds === null ? {} : { id: { in: [...actor.scopedAgentIds] } }) }, select: { id: true, name: true, team: { select: { name: true } } }, orderBy: [{ name: "asc" }, { id: "asc" }], skip: offset, take: 51 })
    const page = employees.slice(0, 50), ids = page.map(row => row.id)
    const rawPolicy = await latestPolicy(tx, reviewer.organizationId, year), policy = rawPolicy ? policyDto(rawPolicy) : null
    const profiles = ids.length ? await tx.$queryRaw<(Row & { agentId: string })[]>`SELECT DISTINCT ON ("agentId") id,"agentId",year,version,"createdAt",value,"requestHash","createdBy" FROM mtm_attendance_leave_profiles
      WHERE "organizationId"=${reviewer.organizationId} AND year=${year} AND "agentId"=ANY(${ids}::text[]) ORDER BY "agentId",version DESC` : []
    const byAgent = new Map(profiles.map(row => [row.agentId, profileDto(row)]))
    const report = await readAttendanceProjectionInTransaction(tx, { organizationId: reviewer.organizationId, authorizedEmployeeIds: ids,
      query: { from: `${year}-01-01`, to: `${year}-12-31`, form: "ALL" }, now })
    const rowsByAgent = new Map<string, typeof report.rows>()
    for (const row of report.rows) { const rows = rowsByAgent.get(row.employeeId) ?? []; rows.push(row); rowsByAgent.set(row.employeeId, rows) }
    return { year, usedThrough, today, policy, canManage: !!user && ["admin", "superadmin"].includes(user.role), hasMore: employees.length > 50,
      rows: page.map(employee => attendanceLeaveBalance({ employeeId: employee.id, name: employee.name, teamName: employee.team?.name ?? null,
        rows: rowsByAgent.get(employee.id) ?? [], usedThrough, policy: policy?.value ?? null, profile: byAgent.get(employee.id) ?? null })) }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 })
}
