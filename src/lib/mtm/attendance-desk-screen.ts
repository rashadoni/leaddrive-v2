import { createHash, randomUUID } from "node:crypto"
import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import type { AttendanceReviewer } from "@/lib/mtm/attendance-request-decision"
import { requireAttendanceSelf, type AttendanceSelf } from "@/lib/mtm/attendance-self-access"
import { lockAttendanceQrPolicy, readAttendanceQrRule, requireAttendanceQrAdmin } from "@/lib/mtm/attendance-qr-policy"
import { readAttendanceFeature } from "@/lib/mtm/attendance-feature"
import { pairScreenByCodeHash } from "@/lib/mtm/attendance-branch-screen-store"
import { hashBranchScreenSecret } from "@/lib/mtm/attendance-branch-screen-security"
import { ATTENDANCE_BRANCH_NETWORKS_KEY, ATTENDANCE_BRANCH_NETWORKS_MAX, ATTENDANCE_DESK_RULE_KEY, readAttendanceBranchNetworks, readAttendanceDeskRule } from "@/lib/mtm/attendance-desk-rules"
import { recordAttendanceBreakKind } from "@/lib/mtm/attendance-break-kinds"
import { ATTENDANCE_BREAK_KIND_ID } from "@/lib/mtm/attendance-break-contract"
import { applyMtmWorkdayEvent, lockMtmWorkdayTransitions, parseMtmWorkdayEvent } from "@/lib/mtm/workday"
import { writeWorkforceWorkdayAuditInTransaction } from "@/lib/workforce/workday-audit"
import { isValidTimezone } from "@/lib/timezone"

/**
 * A desk screen (owner, 2026-11-04: «не обязательно, чтобы было в ресепшене
 * монитор»; «кнопки перекур… не должны отображаться на том же экране, где…
 * ресепшн… два экрана: для сотрудников и общий»). The employee's own computer
 * opens the screen link, shows a pairing QR, and the employee's phone scans it
 * in LeadDrive Time: the computer becomes their workplace at their branch. No
 * administrator types anything.
 *
 * The pairing token is made by the browser and shown only in that QR; the
 * server learns it when the phone sends it, keeps only its digest, and the
 * browser has two minutes to take its screen secret with it. Like a reception
 * screen, the desk shows a code only while it stands at its branch — its own
 * position, or the branch's remembered office network. Unlike it, it also
 * shows its employee's day and break buttons; a reception screen never does.
 */
export const DESK_PAIRING_LIFETIME_MS = 2 * 60_000
export const DESK_SCREENS_PER_EMPLOYEE = 3
const TOKEN = /^mtmd1\.[A-Za-z0-9_-]{43}$/
type Tx = Prisma.TransactionClient
const fail = (code: string, status = 403): never => { throw new AttendanceRequestError(`MTM_ATTENDANCE_DESK_${code}`, status) }

export function hashDeskPairingToken(token: unknown): string | null {
  return typeof token === "string" && TOKEN.test(token) ? createHash("sha256").update(`mtm-desk-pairing:v1:${token}`).digest("hex") : null
}

/** The administrator's switch: employees may pair their own computer. Audited. */
export async function saveAttendanceDeskRule(reviewer: AttendanceReviewer, enabled: unknown) {
  if (typeof enabled !== "boolean") return fail("INVALID", 400)
  return prisma.$transaction(async (tx: Tx) => {
    await lockAttendanceQrPolicy(tx, reviewer.organizationId, true)
    await requireAttendanceQrAdmin(tx, reviewer)
    const before = await readAttendanceDeskRule(tx, reviewer.organizationId)
    if (before === enabled) return { enabled, changed: false }
    await tx.mtmSetting.upsert({ where: { organizationId_key: { organizationId: reviewer.organizationId, key: ATTENDANCE_DESK_RULE_KEY } },
      create: { organizationId: reviewer.organizationId, key: ATTENDANCE_DESK_RULE_KEY, value: enabled }, update: { value: enabled } })
    await tx.mtmAuditLog.create({ data: { organizationId: reviewer.organizationId, actorUserId: reviewer.userId, action: "MTM_ATTENDANCE_DESK_RULE_CHANGED",
      entity: "settings", entityId: reviewer.organizationId, metadataKind: "mtm_attendance_qr", oldData: { enabled: before }, newData: { enabled } } })
    return { enabled, changed: true }
  }, { timeout: 15000 })
}

const NetworkSchema = z.object({ branchId: z.string().uuid(), action: z.enum(["REMEMBER", "FORGET"]) }).strict()
/**
 * «Запомнить сеть этого компьютера»: the address the administrator's browser
 * comes from, as the server sees it, becomes one of the branch's office
 * addresses (up to five). Nobody types an address. FORGET clears the branch's list.
 */
export async function saveAttendanceBranchNetwork(reviewer: AttendanceReviewer, raw: unknown, ip: string | null) {
  const parsed = NetworkSchema.safeParse(raw)
  if (!parsed.success) return fail("INVALID", 400)
  const { branchId, action } = parsed.data
  if (action === "REMEMBER" && !ip) return fail("NETWORK_UNKNOWN", 422)
  return prisma.$transaction(async (tx: Tx) => {
    await lockAttendanceQrPolicy(tx, reviewer.organizationId, true)
    await requireAttendanceQrAdmin(tx, reviewer)
    const [branch] = await tx.$queryRaw<{ active: boolean }[]>`SELECT active FROM mtm_attendance_branch_revisions
      WHERE "organizationId"=${reviewer.organizationId} AND "branchId"=${branchId} ORDER BY version DESC LIMIT 1`
    if (!branch?.active) return fail("BRANCH_UNAVAILABLE", 404)
    const networks = await readAttendanceBranchNetworks(tx, reviewer.organizationId)
    const before = networks[branchId] ?? []
    const after = action === "FORGET" ? [] : before.includes(ip!) ? before : [...before, ip!].slice(-ATTENDANCE_BRANCH_NETWORKS_MAX)
    if (JSON.stringify(before) === JSON.stringify(after)) return { networks: after.length, changed: false }
    const value = { ...networks, [branchId]: after }
    if (!after.length) delete value[branchId]
    await tx.mtmSetting.upsert({ where: { organizationId_key: { organizationId: reviewer.organizationId, key: ATTENDANCE_BRANCH_NETWORKS_KEY } },
      create: { organizationId: reviewer.organizationId, key: ATTENDANCE_BRANCH_NETWORKS_KEY, value }, update: { value } })
    // The journal names the change, not the addresses.
    await tx.mtmAuditLog.create({ data: { organizationId: reviewer.organizationId, actorUserId: reviewer.userId, action: "MTM_ATTENDANCE_BRANCH_NETWORK_CHANGED",
      entity: "attendance_branch", entityId: branchId, metadataKind: "mtm_attendance_qr", oldData: { networks: before.length }, newData: { networks: after.length, action } } })
    return { networks: after.length, changed: true }
  }, { timeout: 15000 })
}

/**
 * The employee's phone read a desk's pairing QR. The desk becomes the
 * employee's workplace at their primary branch once the browser takes it
 * (within two minutes). An employee keeps at most three desks.
 */
export async function startAttendanceDeskPairing(self: AttendanceSelf, raw: unknown) {
  const codeHash = hashDeskPairingToken(raw && typeof raw === "object" ? (raw as { token?: unknown }).token : undefined)
  if (!codeHash) return fail("TOKEN_INVALID", 400)
  return prisma.$transaction(async (tx: Tx) => {
    await lockAttendanceQrPolicy(tx, self.organizationId)
    await requireAttendanceSelf(tx, self)
    if (!await readAttendanceFeature(tx, self.organizationId) || !await readAttendanceQrRule(tx, self.organizationId)) return fail("QR_OFF", 409)
    if (!await readAttendanceDeskRule(tx, self.organizationId)) return fail("OFF", 409)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-attendance-desk:${self.organizationId}:${self.agentId}`},0))`
    const [primary] = await tx.$queryRaw<{ branchId: string | null }[]>`SELECT "branchId" FROM mtm_attendance_primary_branch_revisions
      WHERE "organizationId"=${self.organizationId} AND "agentId"=${self.agentId} ORDER BY version DESC LIMIT 1`
    if (!primary?.branchId) return fail("NO_BRANCH", 409)
    const [branch] = await tx.$queryRaw<{ branchId: string; name: string; active: boolean }[]>`SELECT "branchId",name,active FROM mtm_attendance_branch_revisions
      WHERE "organizationId"=${self.organizationId} AND "branchId"=${primary.branchId} ORDER BY version DESC LIMIT 1`
    if (!branch?.active) return fail("NO_BRANCH", 409)
    const live = await tx.mtmAttendanceBranchScreen.count({ where: { organizationId: self.organizationId, agentId: self.agentId, pairedAt: { not: null }, revokedAt: null } })
    if (live >= DESK_SCREENS_PER_EMPLOYEE) return fail("TOO_MANY", 409)
    // A token already read (twice by one phone, or by two phones) is refused by its unique digest.
    const expiresAt = new Date(Date.now() + DESK_PAIRING_LIFETIME_MS)
    const screen = await tx.mtmAttendanceBranchScreen.create({ data: { id: randomUUID(), organizationId: self.organizationId, branchId: branch.branchId,
      agentId: self.agentId, codeHash, codeExpiresAt: expiresAt, createdBy: self.agentId }, select: { id: true } })
      .catch((error: unknown) => (error as { code?: string })?.code === "P2002" ? fail("TOKEN_USED", 409) : Promise.reject(error))
    await tx.mtmAuditLog.create({ data: { organizationId: self.organizationId, agentId: self.agentId, action: "MTM_ATTENDANCE_DESK_PAIRING_STARTED",
      entity: "attendance_branch_screen", entityId: screen.id, metadataKind: "mtm_attendance_qr", newData: { branchId: branch.branchId, expiresAt: expiresAt.toISOString() } } })
    return { branch: { id: branch.branchId, name: branch.name }, expiresAt: expiresAt.toISOString() }
  }, { timeout: 15000 })
}

/** The desk's browser takes its screen secret with the token it showed; null until the phone confirmed it. */
export async function pairAttendanceDeskScreen(token: unknown) {
  const codeHash = hashDeskPairingToken(token)
  return codeHash ? pairScreenByCodeHash(codeHash, "DESK") : null
}

/** The employee's own desks, for «Мои рабочие места»; and one taken off by the employee. */
export async function listOwnAttendanceDesks(self: AttendanceSelf) {
  return prisma.$transaction(async (tx: Tx) => {
    await requireAttendanceSelf(tx, self)
    const rows = await tx.mtmAttendanceBranchScreen.findMany({ where: { organizationId: self.organizationId, agentId: self.agentId, pairedAt: { not: null }, revokedAt: null },
      select: { id: true, branchId: true, pairedAt: true, lastSeenAt: true, branch: { select: { revisions: { orderBy: { version: "desc" }, take: 1, select: { name: true } } } } }, orderBy: { pairedAt: "asc" }, take: 10 })
    return { desks: rows.map(row => ({ id: row.id, branchName: row.branch.revisions[0]?.name ?? "", pairedAt: row.pairedAt!.toISOString(), lastSeenAt: row.lastSeenAt?.toISOString() ?? null })) }
  }, { timeout: 15000 })
}
export async function revokeOwnAttendanceDesk(self: AttendanceSelf, screenId: unknown) {
  if (!z.string().uuid().safeParse(screenId).success) return fail("NOT_FOUND", 404)
  return prisma.$transaction(async (tx: Tx) => {
    await requireAttendanceSelf(tx, self)
    const now = new Date()
    const changed = await tx.mtmAttendanceBranchScreen.updateMany({ where: { organizationId: self.organizationId, agentId: self.agentId, id: screenId as string, pairedAt: { not: null }, revokedAt: null },
      data: { revokedAt: now, revokedBy: self.agentId } })
    if (changed.count !== 1) return fail("NOT_FOUND", 404)
    await tx.mtmAuditLog.create({ data: { organizationId: self.organizationId, agentId: self.agentId, action: "MTM_ATTENDANCE_SCREEN_REVOKED",
      entity: "attendance_branch_screen", entityId: screenId as string, metadataKind: "mtm_attendance_qr", newData: { revokedAt: now.toISOString(), by: "employee" } } })
    return { revoked: true }
  }, { timeout: 15000 })
}

const BreakSchema = z.object({ action: z.enum(["PAUSE", "RESUME"]), kindId: z.string().regex(ATTENDANCE_BREAK_KIND_ID).nullable().optional(), requestId: z.string().uuid() }).strict()
export type AttendanceDeskBreakResult = { state: "DONE" | "UNPAIRED" | "NO_DAY" | "CONFLICT" }

/**
 * «Перекур» / «Вернуться к работе» pressed on the desk: the same PAUSE/RESUME
 * the phone sends, for the desk's own employee only, at the server's time. A
 * break records no place, so the desk's place does not matter here. `requestId`
 * makes a repeated press (a lost answer) the same event, not a second break.
 */
export async function deskAttendanceBreak(secret: unknown, raw: unknown): Promise<AttendanceDeskBreakResult> {
  const parsed = BreakSchema.safeParse(raw)
  if (!parsed.success) return fail("INVALID", 400)
  const secretHash = hashBranchScreenSecret(secret)
  if (!secretHash) return { state: "UNPAIRED" }
  const screen = await runWithRlsBypass(() => prisma.mtmAttendanceBranchScreen.findUnique({ where: { secretHash }, select: { id: true, organizationId: true, agentId: true, revokedAt: true } }))
  if (!screen || screen.revokedAt || !screen.agentId) return { state: "UNPAIRED" }
  const scope = { organizationId: screen.organizationId, agentId: screen.agentId }
  return runWithTenant(screen.organizationId, () => prisma.$transaction(async (tx: Tx): Promise<AttendanceDeskBreakResult> => {
    if (!await readAttendanceFeature(tx, scope.organizationId) || !await readAttendanceDeskRule(tx, scope.organizationId)) return { state: "UNPAIRED" }
    const agent = await tx.mtmAgent.findFirst({ where: { organizationId: scope.organizationId, id: scope.agentId, status: "ACTIVE" }, select: { id: true } })
    if (!agent) return { state: "UNPAIRED" }
    // The same press again (its answer was lost): the event it made, not a second one.
    const clientEventId = `desk:${parsed.data.requestId}`
    await lockMtmWorkdayTransitions(tx, scope)
    const pressed = await tx.mtmAgentWorkdayEvent.findFirst({ where: { organizationId: scope.organizationId, agentId: scope.agentId, clientEventId }, select: { type: true } })
    if (pressed) return { state: pressed.type === parsed.data.action ? "DONE" : "CONFLICT" }
    const workday = await tx.mtmAgentWorkday.findFirst({ where: { organizationId: scope.organizationId, agentId: scope.agentId, status: { in: ["STARTED", "PAUSED"] } },
      orderBy: { startedAt: "desc" }, select: { id: true } })
    if (!workday) return { state: "NO_DAY" }
    const zone = (await tx.mtmSetting.findUnique({ where: { organizationId_key: { organizationId: scope.organizationId, key: "timezone" } }, select: { value: true } }))?.value
    const now = new Date()
    const data = { action: parsed.data.action, workdayId: workday.id, occurredAt: now.toISOString(),
      ...(parsed.data.action === "PAUSE" && parsed.data.kindId ? { attendanceBreak: { version: 1, kindId: parsed.data.kindId } } : {}) }
    const input = parseMtmWorkdayEvent(data, clientEventId, typeof zone === "string" && isValidTimezone(zone) ? zone : "Asia/Baku", now).input
    if (!input) return fail("INVALID", 400)
    const applied = await applyMtmWorkdayEvent(tx, scope, input, {
      afterEvent: async ({ workday: day, event, beforeWorkday }) => {
        await recordAttendanceBreakKind(tx, scope, input, event.id)
        await writeWorkforceWorkdayAuditInTransaction(tx, { scope, workdayInput: input, beforeWorkday, workday: day, event, channel: "web" })
      },
    })
    return { state: applied.status === "conflict" ? "CONFLICT" : "DONE" }
  }, { timeout: 15000 }))
}
