import { isAttendanceMarkExempt } from "@/lib/mtm/attendance-self-access"
import { randomUUID } from "node:crypto"
import type { Prisma } from "@prisma/client"
import QRCode from "qrcode"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { resolveAttendanceReviewerScope, type AttendanceReviewer } from "@/lib/mtm/attendance-request-decision"
import { lockAttendanceQrPolicy, readAttendanceQrRule } from "@/lib/mtm/attendance-qr-policy"
import { issueAttendanceQrToken, verifyAttendanceQrToken, attendanceQrNonceFingerprint } from "@/lib/mtm/attendance-qr-security"
import type { AttendanceQrDirectory, AttendanceQrDisplay, AttendanceQrReceipt, AttendanceQrState } from "@/lib/mtm/attendance-qr-contract"
import type { MtmWorkdayEventInput } from "@/lib/mtm/workday"
import { readAttendanceFeature } from "@/lib/mtm/attendance-feature"

type Tx = Prisma.TransactionClient
const fail = (code: string, status = 403): never => { throw new AttendanceRequestError(`MTM_ATTENDANCE_QR_${code}`, status) }
async function lockBranches(tx: Tx, organizationId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${`mtm-attendance-branches:${organizationId}`},0))`
}
async function directory(tx: Tx, reviewer: AttendanceReviewer): Promise<AttendanceQrDirectory & { revisions: Map<string, string> }> {
  await lockAttendanceQrPolicy(tx, reviewer.organizationId)
  await lockBranches(tx, reviewer.organizationId)
  const actor = await resolveAttendanceReviewerScope(tx, reviewer)
  const ids = actor.scopedAgentIds
  const rows = await tx.$queryRaw<{ id: string; branchId: string; name: string }[]>`WITH current_branches AS (
      SELECT DISTINCT ON ("branchId") id,"branchId",name,active FROM mtm_attendance_branch_revisions
      WHERE "organizationId"=${reviewer.organizationId} ORDER BY "branchId",version DESC
    ), assignments AS (
      SELECT DISTINCT ON ("agentId") "agentId","branchId" FROM mtm_attendance_primary_branch_revisions
      WHERE "organizationId"=${reviewer.organizationId} ORDER BY "agentId",version DESC
    ) SELECT b.id,b."branchId",b.name FROM current_branches b WHERE b.active
      AND (${ids}::text[] IS NULL OR EXISTS(SELECT 1 FROM assignments a JOIN mtm_agents e
        ON e."organizationId"=${reviewer.organizationId} AND e.id=a."agentId" AND e.status='ACTIVE'
        WHERE a."branchId"=b."branchId" AND a."agentId"=ANY(${ids}::text[]))) ORDER BY b.name,b."branchId" LIMIT 1001`
  if (rows.length > 1000) return fail("TOO_LARGE", 422)
  const user = await tx.user.findFirst({ where: { organizationId: reviewer.organizationId, id: reviewer.userId }, select: { role: true } })
  return { enabled: await readAttendanceQrRule(tx, reviewer.organizationId), canConfigure: !!user && ["admin", "superadmin"].includes(user.role),
    branches: rows.map(row => ({ id: row.branchId, name: row.name })), revisions: new Map(rows.map(row => [row.branchId, row.id])) }
}
export async function readAttendanceQrDirectory(reviewer: AttendanceReviewer): Promise<AttendanceQrDirectory> {
  return prisma.$transaction(async (tx: Tx) => { const result = await directory(tx, reviewer); return { enabled: result.enabled, canConfigure: result.canConfigure, branches: result.branches } }, { timeout: 15000 })
}
export async function issueAttendanceBranchQr(reviewer: AttendanceReviewer, raw: unknown): Promise<AttendanceQrDisplay> {
  const parsed = z.object({ branchId: z.string().uuid() }).strict().safeParse(raw)
  if (!parsed.success) return fail("INVALID", 400)
  return prisma.$transaction(async (tx: Tx) => {
    const listing = await directory(tx, reviewer)
    if (!listing.enabled) return fail("DISABLED", 404)
    const branch = listing.branches.find(row => row.id === parsed.data.branchId), revision = listing.revisions.get(parsed.data.branchId)
    if (!branch || !revision) return fail("BRANCH_UNAVAILABLE", 404)
    const now = new Date(), issued = issueAttendanceQrToken(reviewer.organizationId, branch.id, revision, now)
    // Only the short-lived image leaves this endpoint. No token/audit/log row.
    const dataUrl = await QRCode.toDataURL(issued.token, { errorCorrectionLevel: "M", width: 480, margin: 4 })
    return { branch, dataUrl, serverNow: now.toISOString(), expiresAt: issued.expiresAt.toISOString() }
  }, { timeout: 15000 })
}

/** One QR can be used by many employees, but one employee cannot recycle the
 * same code/action on another event. The canonical employee lock serializes it. */
export async function recordAttendanceQr(tx: Tx, scope: { organizationId: string; agentId: string }, input: MtmWorkdayEventInput, eventId: string, finishingOnBreak = false) {
  if (!["START", "FINISH"].includes(input.action)) return
  if (!await readAttendanceFeature(tx, scope.organizationId) || await isAttendanceMarkExempt(tx, scope)) return
  await lockAttendanceQrPolicy(tx, scope.organizationId)
  if (!await readAttendanceQrRule(tx, scope.organizationId)) return
  let state: AttendanceQrState = "NOT_PROVIDED", branchRevisionId: string | null = null, fingerprint: string | null = null
  // Ending a paused day must not disclose the employee's private place.
  const token = finishingOnBreak ? null : input.attendanceQr?.token
  if (token) {
    const proof = verifyAttendanceQrToken(scope.organizationId, token, input.serverReceivedAt, input.claimedAt)
    state = proof.state
    if (proof.state === "VERIFIED") {
      await lockBranches(tx, scope.organizationId)
      const [branch] = await tx.$queryRaw<{ id: string; active: boolean }[]>`SELECT id,active FROM mtm_attendance_branch_revisions
        WHERE "organizationId"=${scope.organizationId} AND "branchId"=${proof.payload.branchId} ORDER BY version DESC LIMIT 1`
      if (!branch?.active || branch.id !== proof.payload.revisionId) state = "BRANCH_CHANGED"
      else {
        const candidate = attendanceQrNonceFingerprint(scope.organizationId, proof.payload.nonce)
        const reused = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM mtm_attendance_qr_evidence
          WHERE "organizationId"=${scope.organizationId} AND "agentId"=${scope.agentId} AND "nonceFingerprint"=${candidate} AND action=${input.action}`
        if (reused.length) state = "REUSED"
        else { fingerprint = candidate; branchRevisionId = branch.id }
      }
    }
  }
  await tx.$executeRaw`INSERT INTO mtm_attendance_qr_evidence(id,"organizationId","agentId","eventId",action,state,"branchRevisionId","nonceFingerprint")
    VALUES (${randomUUID()},${scope.organizationId},${scope.agentId},${eventId},${input.action},${state},${branchRevisionId},${fingerprint})`
}
/** Read the original immutable result even if policy changed or QR expired. */
export async function readAttendanceQrReceipt(tx: Tx, scope: { organizationId: string; agentId: string }, eventId: string): Promise<AttendanceQrReceipt | null> {
  const [row] = await tx.$queryRaw<{ state: AttendanceQrState; branchId: string | null; name: string | null }[]>`SELECT q.state,b."branchId",b.name
    FROM mtm_attendance_qr_evidence q LEFT JOIN mtm_attendance_branch_revisions b ON b."organizationId"=q."organizationId" AND b.id=q."branchRevisionId"
    WHERE q."organizationId"=${scope.organizationId} AND q."agentId"=${scope.agentId} AND q."eventId"=${eventId}`
  return row ? { eventId, state: row.state, branch: row.state === "VERIFIED" && row.branchId && row.name ? { id: row.branchId, name: row.name } : null } : null
}
