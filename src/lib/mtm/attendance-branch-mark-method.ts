import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import type { AttendanceReviewer } from "@/lib/mtm/attendance-request-decision"
import { lockAttendanceQrPolicy, requireAttendanceQrAdmin } from "@/lib/mtm/attendance-qr-policy"

/**
 * How a branch confirms a mark (owner, 2026-11-04: «для каждого филиала
 * выбирать, чтобы был сканирование через QR или нет… полевые места, где нету
 * компьютеров… человек именно с приложением по GPS ему проверяет»).
 *
 * QR_GPS: the branch has a screen; a mark without its code is unconfirmed.
 * GPS_ONLY: an open site with no screen; the phone's own fix inside the branch
 * is the whole confirmation, and a mark there without a code is not "QR
 * missing". It needs the place of a mark to be collected — without the phone's
 * fix nothing can say the employee stood there, and the mark stays
 * unconfirmed as before.
 *
 * Kept as one list of branch ids beside the QR rule, not in the branch's
 * revision: changing it must not void the live code of a screen at that branch.
 */
export const ATTENDANCE_GPS_ONLY_BRANCHES_KEY = "attendanceGpsOnlyBranchIds"
export const ATTENDANCE_BRANCH_MARK_METHODS = ["QR_GPS", "GPS_ONLY"] as const
export type AttendanceBranchMarkMethod = typeof ATTENDANCE_BRANCH_MARK_METHODS[number]
const MAX_BRANCHES = 1000

type Tx = Prisma.TransactionClient
const InputSchema = z.object({ branchId: z.string().uuid(), method: z.enum(ATTENDANCE_BRANCH_MARK_METHODS) }).strict()

function idsOf(value: unknown) {
  return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string").slice(0, MAX_BRANCHES) : [])
}
export async function readAttendanceGpsOnlyBranchIds(tx: Tx, organizationId: string) {
  const row = await tx.mtmSetting.findUnique({ where: { organizationId_key: { organizationId, key: ATTENDANCE_GPS_ONLY_BRANCHES_KEY } }, select: { value: true } })
  return idsOf(row?.value)
}

/** One branch's method, by a current administrator; audited, unchanged repeats write nothing. */
export async function saveAttendanceBranchMarkMethod(reviewer: AttendanceReviewer, raw: unknown) {
  const parsed = InputSchema.safeParse(raw)
  if (!parsed.success) throw new AttendanceRequestError("MTM_ATTENDANCE_BRANCH_METHOD_INVALID", 400)
  const { branchId, method } = parsed.data
  return prisma.$transaction(async (tx: Tx) => {
    await lockAttendanceQrPolicy(tx, reviewer.organizationId, true)
    await requireAttendanceQrAdmin(tx, reviewer)
    const [branch] = await tx.$queryRaw<{ active: boolean }[]>`SELECT active FROM mtm_attendance_branch_revisions
      WHERE "organizationId"=${reviewer.organizationId} AND "branchId"=${branchId} ORDER BY version DESC LIMIT 1`
    if (!branch?.active) throw new AttendanceRequestError("MTM_ATTENDANCE_BRANCH_METHOD_NOT_FOUND", 404)
    const ids = await readAttendanceGpsOnlyBranchIds(tx, reviewer.organizationId)
    const before: AttendanceBranchMarkMethod = ids.has(branchId) ? "GPS_ONLY" : "QR_GPS"
    if (before === method) return { branchId, method, changed: false }
    if (method === "GPS_ONLY") ids.add(branchId); else ids.delete(branchId)
    if (ids.size > MAX_BRANCHES) throw new AttendanceRequestError("MTM_ATTENDANCE_BRANCH_METHOD_TOO_LARGE", 422)
    const value = [...ids].sort()
    await tx.mtmSetting.upsert({ where: { organizationId_key: { organizationId: reviewer.organizationId, key: ATTENDANCE_GPS_ONLY_BRANCHES_KEY } },
      create: { organizationId: reviewer.organizationId, key: ATTENDANCE_GPS_ONLY_BRANCHES_KEY, value }, update: { value } })
    await tx.mtmAuditLog.create({ data: { organizationId: reviewer.organizationId, actorUserId: reviewer.userId, action: "MTM_ATTENDANCE_BRANCH_MARK_METHOD_CHANGED",
      entity: "attendance_branch", entityId: branchId, metadataKind: "mtm_attendance_qr", oldData: { method: before }, newData: { method } } })
    return { branchId, method, changed: true }
  }, { timeout: 15000 })
}
