import { randomUUID } from "node:crypto"
import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"
import { isTenantCapabilityEnabled } from "@/lib/tenant-capabilities"
import { readAttendanceFeature } from "@/lib/mtm/attendance-feature"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import type { AttendanceReviewer } from "@/lib/mtm/attendance-request-decision"
import { lockAttendanceQrPolicy, readAttendanceQrRule, requireAttendanceQrAdmin } from "@/lib/mtm/attendance-qr-policy"
import { directory, issueBranchQrImage, lockBranches } from "@/lib/mtm/attendance-qr-store"
import {
  BRANCH_SCREEN_CODE_LIFETIME_MS,
  generateBranchScreenCode,
  generateBranchScreenSecret,
  hashBranchScreenCode,
  hashBranchScreenSecret,
} from "@/lib/mtm/attendance-branch-screen-security"
import type {
  AttendanceBranchScreenDirectory,
  AttendanceBranchScreenPairing,
  AttendanceBranchScreenQr,
} from "@/lib/mtm/attendance-qr-contract"

/**
 * Branch screens: the only place a branch QR is shown (owner, 2026-10-29: a QR
 * opened on a signed-in computer anywhere confirmed a branch the phone was not
 * at). An administrator pairs a tablet at the branch with a one-time code;
 * the tablet then needs no CRM sign-in and shows its own branch's code only.
 */

type Tx = Prisma.TransactionClient
const fail = (code: string, status = 403): never => { throw new AttendanceRequestError(`MTM_ATTENDANCE_SCREEN_${code}`, status) }
// «На связи 1 мин назад» moves at most once a minute: the screen asks for a code every minute.
const LAST_SEEN_STAMP_MS = 60_000

async function currentBranch(tx: Tx, organizationId: string, branchId: string) {
  const [branch] = await tx.$queryRaw<{ id: string; branchId: string; name: string; active: boolean }[]>`SELECT id,"branchId",name,active
    FROM mtm_attendance_branch_revisions WHERE "organizationId"=${organizationId} AND "branchId"=${branchId} ORDER BY version DESC LIMIT 1`
  return branch?.active ? branch : null
}

/** The QR rule, every branch the reader may see, and each branch's paired, unrevoked screens. */
export async function readAttendanceBranchScreens(reviewer: AttendanceReviewer): Promise<AttendanceBranchScreenDirectory> {
  return prisma.$transaction(async (tx: Tx) => {
    const listing = await directory(tx, reviewer)
    const screens = listing.branches.length ? await tx.mtmAttendanceBranchScreen.findMany({
      where: { organizationId: reviewer.organizationId, branchId: { in: listing.branches.map(branch => branch.id) }, pairedAt: { not: null }, revokedAt: null },
      select: { id: true, branchId: true, pairedAt: true, lastSeenAt: true }, orderBy: [{ pairedAt: "asc" }, { id: "asc" }], take: 2001,
    }) : []
    if (screens.length > 2000) return fail("TOO_LARGE", 422)
    return {
      enabled: listing.enabled, canConfigure: listing.canConfigure,
      branches: listing.branches.map(branch => ({ ...branch, screens: screens.filter(screen => screen.branchId === branch.id)
        .map(screen => ({ id: screen.id, pairedAt: screen.pairedAt!.toISOString(), lastSeenAt: screen.lastSeenAt?.toISOString() ?? null })) })),
    }
  }, { timeout: 15000 })
}

/** A one-time code for the tablet at this branch. The code itself is never stored. */
export async function startAttendanceBranchScreenPairing(reviewer: AttendanceReviewer, raw: unknown): Promise<AttendanceBranchScreenPairing> {
  const parsed = z.object({ branchId: z.string().uuid() }).strict().safeParse(raw)
  if (!parsed.success) return fail("INVALID", 400)
  return prisma.$transaction(async (tx: Tx) => {
    await lockAttendanceQrPolicy(tx, reviewer.organizationId)
    await lockBranches(tx, reviewer.organizationId)
    await requireAttendanceQrAdmin(tx, reviewer)
    const branch = await currentBranch(tx, reviewer.organizationId, parsed.data.branchId)
    if (!branch) return fail("BRANCH_UNAVAILABLE", 404)
    const { code, codeHash } = generateBranchScreenCode(), expiresAt = new Date(Date.now() + BRANCH_SCREEN_CODE_LIFETIME_MS)
    const screen = await tx.mtmAttendanceBranchScreen.create({
      data: { id: randomUUID(), organizationId: reviewer.organizationId, branchId: branch.branchId, codeHash, codeExpiresAt: expiresAt, createdBy: reviewer.userId },
      select: { id: true },
    })
    await tx.mtmAuditLog.create({ data: { organizationId: reviewer.organizationId, actorUserId: reviewer.userId, action: "MTM_ATTENDANCE_SCREEN_PAIRING_STARTED",
      entity: "attendance_branch_screen", entityId: screen.id, metadataKind: "mtm_attendance_qr", newData: { branchId: branch.branchId, expiresAt: expiresAt.toISOString() } } })
    return { branch: { id: branch.branchId, name: branch.name }, code, expiresAt: expiresAt.toISOString() }
  }, { timeout: 15000 })
}

/** Takes the screen off at once: its next request for a code is answered UNPAIRED. */
export async function revokeAttendanceBranchScreen(reviewer: AttendanceReviewer, screenId: string): Promise<{ revoked: boolean }> {
  if (!z.string().uuid().safeParse(screenId).success) return fail("NOT_FOUND", 404)
  return prisma.$transaction(async (tx: Tx) => {
    await requireAttendanceQrAdmin(tx, reviewer)
    const now = new Date()
    const changed = await tx.mtmAttendanceBranchScreen.updateMany({
      where: { organizationId: reviewer.organizationId, id: screenId, pairedAt: { not: null }, revokedAt: null },
      data: { revokedAt: now, revokedBy: reviewer.userId },
    })
    if (changed.count !== 1) return fail("NOT_FOUND", 404)
    await tx.mtmAuditLog.create({ data: { organizationId: reviewer.organizationId, actorUserId: reviewer.userId, action: "MTM_ATTENDANCE_SCREEN_REVOKED",
      entity: "attendance_branch_screen", entityId: screenId, metadataKind: "mtm_attendance_qr", newData: { revokedAt: now.toISOString() } } })
    return { revoked: true }
  }, { timeout: 15000 })
}

/** Whether the organization may show a branch QR right now: active, Personnel, attendance and the QR rule on. */
async function screenTenantOpen(tx: Tx, organizationId: string) {
  const organization = await tx.organization.findUnique({ where: { id: organizationId },
    select: { name: true, isActive: true, plan: true, addons: true, features: true, modules: true } })
  if (!organization?.isActive || !isTenantCapabilityEnabled("personnel", organization)) return null
  if (!await readAttendanceFeature(tx, organizationId)) return null
  return { name: organization.name, qrOn: await readAttendanceQrRule(tx, organizationId) }
}

/**
 * The tablet typed a code: it becomes that branch's screen and gets its
 * secret, once. A wrong, used, expired or revoked code all answer null alike.
 */
export async function pairAttendanceBranchScreen(rawCode: unknown): Promise<{ secret: string } | null> {
  const codeHash = hashBranchScreenCode(rawCode)
  if (!codeHash) return null
  // The code is the only thing that names the organization: the one lookup by
  // hash runs outside any organization (the table's policy lets the bypass
  // read it); everything after it, in that organization only.
  const pending = await runWithRlsBypass(() => prisma.mtmAttendanceBranchScreen.findUnique({ where: { codeHash }, select: { id: true, organizationId: true } }))
  if (!pending) return null
  return runWithTenant(pending.organizationId, () => prisma.$transaction(async (tx: Tx) => {
    await lockAttendanceQrPolicy(tx, pending.organizationId)
    if (!await screenTenantOpen(tx, pending.organizationId)) return null
    const now = new Date(), { secret, secretHash } = generateBranchScreenSecret()
    // Two tablets typing one code at once: the row lets one of them have it.
    const changed = await tx.mtmAttendanceBranchScreen.updateMany({
      where: { organizationId: pending.organizationId, id: pending.id, codeHash, codeExpiresAt: { gt: now }, revokedAt: null },
      data: { codeHash: null, codeExpiresAt: null, secretHash, pairedAt: now, lastSeenAt: now },
    })
    if (changed.count !== 1) return null
    await tx.mtmAuditLog.create({ data: { organizationId: pending.organizationId, action: "MTM_ATTENDANCE_SCREEN_PAIRED",
      entity: "attendance_branch_screen", entityId: pending.id, metadataKind: "mtm_attendance_qr", newData: { pairedAt: now.toISOString() } } })
    return { secret }
  }, { timeout: 15000 }))
}

/** What the paired screen shows now: a fresh 60-second code of its branch, or why not. */
export async function issueAttendanceScreenQr(secret: unknown): Promise<AttendanceBranchScreenQr> {
  const secretHash = hashBranchScreenSecret(secret)
  if (!secretHash) return { state: "UNPAIRED" }
  const screen = await runWithRlsBypass(() => prisma.mtmAttendanceBranchScreen.findUnique({
    where: { secretHash }, select: { id: true, organizationId: true, branchId: true, revokedAt: true, lastSeenAt: true } }))
  if (!screen || screen.revokedAt) return { state: "UNPAIRED" }
  return runWithTenant(screen.organizationId, () => prisma.$transaction(async (tx: Tx): Promise<AttendanceBranchScreenQr> => {
    await lockAttendanceQrPolicy(tx, screen.organizationId)
    await lockBranches(tx, screen.organizationId)
    const tenant = await screenTenantOpen(tx, screen.organizationId)
    // An organization that closed, lost Personnel or switched attendance off
    // has no screens: the tablet goes back to the pairing form.
    if (!tenant) return { state: "UNPAIRED" }
    // Revoked between the lookup and this transaction.
    const live = await tx.mtmAttendanceBranchScreen.findFirst({ where: { organizationId: screen.organizationId, id: screen.id, revokedAt: null }, select: { id: true } })
    if (!live) return { state: "UNPAIRED" }
    const now = new Date()
    if (!screen.lastSeenAt || now.getTime() - screen.lastSeenAt.getTime() >= LAST_SEEN_STAMP_MS) {
      await tx.mtmAttendanceBranchScreen.updateMany({ where: { organizationId: screen.organizationId, id: screen.id, revokedAt: null }, data: { lastSeenAt: now } })
    }
    const branch = await currentBranch(tx, screen.organizationId, screen.branchId)
    if (!branch) return { state: "BRANCH_UNAVAILABLE", organizationName: tenant.name }
    const shown = { organizationName: tenant.name, branch: { id: branch.branchId, name: branch.name } }
    if (!tenant.qrOn) return { state: "QR_OFF", ...shown }
    return { state: "SHOWING", ...shown, ...await issueBranchQrImage(screen.organizationId, branch.branchId, branch.id, now) }
  }, { timeout: 15000 }))
}
