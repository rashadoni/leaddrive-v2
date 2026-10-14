import { createHash, randomUUID } from "node:crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { checkPermission, type Role } from "@/lib/permissions"
import { effectiveHiddenModules } from "@/lib/user-module-access"
import { canReviewMtmRouteRequest, type MtmRouteActor } from "@/lib/mtm/route-permissions"
import { resolveAttendanceReviewerScope, requireAttendanceReviewer, type AttendanceReviewer } from "@/lib/mtm/attendance-request-decision"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { AttendanceBranchInputSchema, AttendanceBranchAssignmentInputSchema,
  type AttendanceBranch, type AttendancePrimaryBranch, type AttendanceBranchDirectory, type AttendanceBranchAssignments } from "@/lib/mtm/attendance-branches-contract"
import { lockAttendanceFeature } from "@/lib/mtm/attendance-feature"

type Tx = Prisma.TransactionClient
export class AttendanceBranchError extends AttendanceRequestError {}
type BranchRow = Omit<AttendanceBranch, "id" | "revisionId" | "createdAt"> & {
  id: string; branchId: string; createdAt: Date; requestHash: string; createdBy: string
}
type AssignmentRow = Omit<AttendancePrimaryBranch, "revisionId" | "createdAt"> & { id: string; agentId: string; createdAt: Date; requestHash: string; createdBy: string }
const branchDto = (row: BranchRow): AttendanceBranch => ({ id: row.branchId, revisionId: row.id, version: row.version,
  name: row.name, address: row.address, latitude: row.latitude, longitude: row.longitude, radiusMeters: row.radiusMeters,
  active: row.active, createdAt: row.createdAt.toISOString() })
const assignmentDto = (row: AssignmentRow): AttendancePrimaryBranch => ({ revisionId: row.id, version: row.version, branchId: row.branchId, createdAt: row.createdAt.toISOString() })
const reject = (code: string, status = 409): never => { throw new AttendanceBranchError(`MTM_ATTENDANCE_BRANCH_${code}`, status) }
const hash = (userId: string, value: unknown) => createHash("sha256").update(JSON.stringify({ userId, value })).digest("hex")

async function currentUser(tx: Tx, reviewer: AttendanceReviewer) {
  if (reviewer.principalType !== "session") return reject("FORBIDDEN", 403)
  const [user] = await tx.$queryRaw<{ role: string; hiddenModules: string[] }[]>`SELECT role,"hiddenModules" FROM users
    WHERE "organizationId"=${reviewer.organizationId} AND id=${reviewer.userId} AND "isActive" AND "anonymizedAt" IS NULL FOR SHARE`
  if (!user || !checkPermission(user.role as Role, "mtm", "read") || effectiveHiddenModules(user.role, user.hiddenModules).includes("mtm")) return reject("FORBIDDEN", 403)
  return user
}
async function lockRegistry(tx: Tx, organizationId: string) {
  await tx.$executeRaw`SELECT set_config('lock_timeout', '3s', true)`
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-attendance-branches:${organizationId}`},0))`
  await lockAttendanceFeature(tx, organizationId)
}
async function currentBranch(tx: Tx, organizationId: string, branchId: string) {
  const [row] = await tx.$queryRaw<BranchRow[]>`SELECT * FROM mtm_attendance_branch_revisions
    WHERE "organizationId"=${organizationId} AND "branchId"=${branchId} ORDER BY version DESC LIMIT 1`
  return row ?? null
}
async function currentAssignment(tx: Tx, organizationId: string, agentId: string) {
  const [row] = await tx.$queryRaw<AssignmentRow[]>`SELECT * FROM mtm_attendance_primary_branch_revisions
    WHERE "organizationId"=${organizationId} AND "agentId"=${agentId} ORDER BY version DESC LIMIT 1`
  return row ?? null
}

export async function readAttendanceBranches(reviewer: AttendanceReviewer): Promise<AttendanceBranchDirectory> {
  return prisma.$transaction(async (tx: Tx) => {
    const user = await currentUser(tx, reviewer)
    const rows = await tx.$queryRaw<BranchRow[]>`SELECT DISTINCT ON ("branchId") * FROM mtm_attendance_branch_revisions
      WHERE "organizationId"=${reviewer.organizationId} ORDER BY "branchId",version DESC LIMIT 1001`
    if (rows.length > 1000) return reject("TOO_LARGE", 422)
    return { branches: rows.map(branchDto).sort((a,b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)), canManageBranches: ["admin","superadmin"].includes(user.role) }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15_000 })
}

export async function readAttendanceBranchAssignments(reviewer: AttendanceReviewer, readActor: MtmRouteActor, search: string): Promise<AttendanceBranchAssignments> {
  return prisma.$transaction(async (tx: Tx) => {
    await currentUser(tx, reviewer)
    let writer: MtmRouteActor | null = null
    try { writer = await resolveAttendanceReviewerScope(tx, reviewer) }
    catch (error) { if (!(error instanceof AttendanceRequestError) || error.status !== 403) throw error }
    const employees = await tx.mtmAgent.findMany({ where: { organizationId: reviewer.organizationId, status: "ACTIVE",
      ...(readActor.scopedAgentIds === null ? {} : { id: { in: [...readActor.scopedAgentIds] } }),
      ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
    }, select: { id: true, name: true, userId: true, team: { select: { name: true } } }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 51 })
    const ids = employees.slice(0,50).map(employee => employee.id)
    const revisions = ids.length ? await tx.$queryRaw<AssignmentRow[]>`SELECT DISTINCT ON ("agentId") * FROM mtm_attendance_primary_branch_revisions
      WHERE "organizationId"=${reviewer.organizationId} AND "agentId" IN (${Prisma.join(ids)}) ORDER BY "agentId",version DESC` : []
    const primary = new Map(revisions.map(row => [row.agentId, assignmentDto(row)]))
    return { employees: employees.slice(0,50).map(employee => ({ id: employee.id, name: employee.name, teamName: employee.team?.name ?? null,
      canAssign: employee.userId !== reviewer.userId && writer !== null && canReviewMtmRouteRequest(writer, employee.id), primary: primary.get(employee.id) ?? null })), hasMore: employees.length > 50 }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15_000 })
}

/** One immutable publication, checked against the last seen revision. A lost
 * response may replay the same actor/request/hash, never publish a new version. */
export async function saveAttendanceBranch(reviewer: AttendanceReviewer, raw: unknown) {
  const parsed = AttendanceBranchInputSchema.safeParse(raw)
  if (!parsed.success) return reject("INVALID", 400)
  const input = parsed.data, requestHash = hash(reviewer.userId,input)
  return prisma.$transaction(async (tx: Tx) => {
    await lockRegistry(tx, reviewer.organizationId)
    const user = await currentUser(tx, reviewer)
    if (!["admin","superadmin"].includes(user.role)) return reject("ADMIN_REQUIRED", 403)
    await resolveAttendanceReviewerScope(tx, reviewer)
    const [existing] = await tx.$queryRaw<BranchRow[]>`SELECT * FROM mtm_attendance_branch_revisions
      WHERE "organizationId"=${reviewer.organizationId} AND "requestId"=${input.requestId}`
    if (existing) {
      if (existing.requestHash !== requestHash || existing.createdBy !== reviewer.userId) return reject("REPLAY_MISMATCH")
      return { branch: branchDto(existing), idempotent: true }
    }
    const before = input.branchId ? await currentBranch(tx,reviewer.organizationId,input.branchId) : null
    if (input.branchId && !before) return reject("NOT_FOUND", 404)
    if ((before?.id ?? null) !== input.expectedRevisionId) return reject("CHANGED")
    const branchId = before?.branchId ?? randomUUID(), id = randomUUID(), version = (before?.version ?? 0)+1
    if (!before) {
      const [count] = await tx.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count FROM mtm_attendance_branches WHERE "organizationId"=${reviewer.organizationId}`
      if (Number(count.count) >= 1000) return reject("TOO_LARGE", 422)
      await tx.$executeRaw`INSERT INTO mtm_attendance_branches(id,"organizationId") VALUES (${branchId},${reviewer.organizationId})`
    }
    const [saved] = await tx.$queryRaw<BranchRow[]>`INSERT INTO mtm_attendance_branch_revisions
      (id,"organizationId","branchId",version,"previousId","requestId","requestHash",name,address,latitude,longitude,"radiusMeters",active,"createdBy")
      VALUES (${id},${reviewer.organizationId},${branchId},${version},${before?.id ?? null},${input.requestId},${requestHash},${input.name},${input.address},${input.latitude},${input.longitude},${input.radiusMeters},${input.active},${reviewer.userId}) RETURNING *`
    await tx.mtmAuditLog.create({ data: { organizationId: reviewer.organizationId, actorUserId: reviewer.userId,
      action: "MTM_ATTENDANCE_BRANCH_PUBLISHED", entity: "mtm_attendance_branch", entityId: branchId, metadataKind: "mtm_attendance_branch",
      oldData: before ? { revisionId: before.id, version: before.version } : Prisma.JsonNull, newData: { revisionId: id, version, active: input.active } } })
    return { branch: branchDto(saved), idempotent: false }
  }, { timeout: 15_000 })
}
export async function saveAttendancePrimaryBranch(reviewer: AttendanceReviewer, raw: unknown) {
  const parsed = AttendanceBranchAssignmentInputSchema.safeParse(raw)
  if (!parsed.success) return reject("INVALID", 400)
  const input = parsed.data, requestHash = hash(reviewer.userId,input)
  return prisma.$transaction(async (tx: Tx) => {
    await lockRegistry(tx,reviewer.organizationId)
    // Hold the employee row while current status/link and Route scope are checked.
    await tx.$queryRaw`SELECT id FROM mtm_agents WHERE "organizationId"=${reviewer.organizationId} AND id=${input.agentId} FOR SHARE`
    await requireAttendanceReviewer(tx,reviewer,input.agentId)
    const [existing] = await tx.$queryRaw<AssignmentRow[]>`SELECT * FROM mtm_attendance_primary_branch_revisions
      WHERE "organizationId"=${reviewer.organizationId} AND "requestId"=${input.requestId}`
    if (existing) {
      if (existing.requestHash !== requestHash || existing.createdBy !== reviewer.userId) return reject("REPLAY_MISMATCH")
      return { primary: assignmentDto(existing), idempotent: true }
    }
    if (input.branchId && !(await currentBranch(tx,reviewer.organizationId,input.branchId))?.active) return reject("UNAVAILABLE")
    const before = await currentAssignment(tx,reviewer.organizationId,input.agentId)
    if ((before?.id ?? null) !== input.expectedRevisionId) return reject("CHANGED")
    const id = randomUUID(), version = (before?.version ?? 0)+1
    const [saved] = await tx.$queryRaw<AssignmentRow[]>`INSERT INTO mtm_attendance_primary_branch_revisions
      (id,"organizationId","agentId","branchId",version,"previousId","requestId","requestHash","createdBy")
      VALUES (${id},${reviewer.organizationId},${input.agentId},${input.branchId},${version},${before?.id ?? null},${input.requestId},${requestHash},${reviewer.userId}) RETURNING *`
    await tx.mtmAuditLog.create({ data: { organizationId: reviewer.organizationId, actorUserId: reviewer.userId, agentId: input.agentId,
      action: "MTM_ATTENDANCE_PRIMARY_BRANCH_PUBLISHED", entity: "agent", entityId: input.agentId, metadataKind: "mtm_attendance_branch",
      oldData: { revisionId: before?.id ?? null, branchId: before?.branchId ?? null }, newData: { revisionId: id, branchId: input.branchId, version } } })
    return { primary: assignmentDto(saved), idempotent: false }
  }, { timeout: 15_000 })
}
