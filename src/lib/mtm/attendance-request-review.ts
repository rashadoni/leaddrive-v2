import { readAttendanceRevocations } from "@/lib/mtm/attendance-request-revocation"
import type { AttendanceRevocation } from "@/lib/mtm/attendance-revocation-contract"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import type { MtmRouteActor } from "@/lib/mtm/route-permissions"
import { resolveAttendanceReviewerScope, type AttendanceReviewer } from "@/lib/mtm/attendance-request-decision"
import { AttendanceRequestError, type AttendanceRequestDto } from "@/lib/mtm/attendance-request-contract"
import { attendanceRequestDto, attendanceRequestSelect } from "@/lib/mtm/attendance-request-store"
import { readAttendanceTwoStepApproval } from "@/lib/mtm/attendance-approval-chain"
import { readAttendanceRequestLimits } from "@/lib/mtm/attendance-request-limit-store"
import { attendanceLateLeaveNotice } from "@/lib/mtm/attendance-request-limits"
import { currentDateKey } from "@/lib/mtm/mobile-week"

export const AttendanceReviewQuerySchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED", "ALL"]).default("PENDING"),
  cursor: z.string().uuid().optional(),
  requestId: z.string().uuid().optional(),
}).strict()
/**
 * `approval` — two-step approval (attendance-approval-chain.ts): the manager's
 * half, if given, and whose turn it is while the request is pending. `canDecide`
 * — whether this reviewer has a decision left to make on it.
 */
export type AttendanceReviewApproval = { twoStep: boolean; awaiting: "MANAGER" | "HR" | null
  manager: { name: string | null; at: string; note: string | null } | null
  /** This reviewer's approval would only pass the request on to HR. */
  passesToHr: boolean }
export type AttendanceReviewItem = AttendanceRequestDto & { employeeName: string; teamName: string | null; reviewerName: string | null; cancellation?: AttendanceRevocation
  approval: AttendanceReviewApproval; canDecide: boolean
  /** An annual leave asked for later than the company's notice (Personnel → Settings → request rules). */
  lateNotice: { days: number; required: number } | null }

/** With two steps, a manager has nothing left on a request a manager already approved. */
export function attendanceAwaitingReviewerWhere(actor: Pick<MtmRouteActor, "role">, twoStep: boolean): Prisma.MtmHrmRequestWhereInput {
  return twoStep && actor.role !== "ADMIN" ? { managerApprovedAt: null } : {}
}

/** Shared by the queue and Panel counts. The report-wide HR grant is not a review grant. */
export function attendanceReviewWhere(organizationId: string, userId: string, actor: MtmRouteActor, includeInactive = false): Prisma.MtmHrmRequestWhereInput {
  if (!["ADMIN", "MANAGER", "SUPERVISOR"].includes(actor.role) || (actor.role !== "ADMIN" && actor.scopedAgentIds === null)) {
    throw new AttendanceRequestError("MTM_ATTENDANCE_DECISION_FORBIDDEN", 403)
  }
  return {
    organizationId, attendanceDetails: { not: Prisma.DbNull },
    agent: { is: { organizationId, ...(includeInactive ? {} : { status: "ACTIVE" }), OR: [{ userId: null }, { userId: { not: userId } }] } },
    AND: [
      ...(actor.scopedAgentIds === null ? [] : [{ agentId: { in: [...actor.scopedAgentIds] } }]),
      ...(actor.agentId ? [{ agentId: { not: actor.agentId } }] : []),
    ],
  }
}

export async function listAttendanceRequestsForReview(reviewer: AttendanceReviewer, raw: unknown) {
  const parsed = AttendanceReviewQuerySchema.safeParse(raw)
  if (!parsed.success) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_INVALID", 400)
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const actor = await resolveAttendanceReviewerScope(tx, reviewer)
    const { status, cursor, requestId } = parsed.data
    const scope = attendanceReviewWhere(reviewer.organizationId, reviewer.userId, actor, status !== "PENDING")
    const where = { ...scope, ...(status === "ALL" ? { AND: [...(Array.isArray(scope.AND) ? scope.AND : []), { OR: [{ status: { not: "PENDING" as const } }, { agent: { is: { status: "ACTIVE" as const } } }] }] } : { status }) }
    const before = cursor ? await tx.mtmHrmRequest.findFirst({ where: { ...where, id: cursor }, select: { submittedAt: true } }) : null
    if (cursor && !before) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_CHANGED")
    const rows = await tx.mtmHrmRequest.findMany({
      where: { ...where, ...(requestId ? { id: requestId } : {}), ...(before ? { OR: [{ submittedAt: { lt: before.submittedAt } }, { submittedAt: before.submittedAt, id: { lt: cursor! } }] } : {}) },
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }], take: 51,
      select: { ...attendanceRequestSelect, agent: { select: { name: true, team: { select: { name: true } } } }, decidedByUserId: true,
        managerApprovedByUserId: true, managerApprovedAt: true, managerApprovalNote: true },
    })
    const twoStep = await readAttendanceTwoStepApproval(tx, reviewer.organizationId)
    // Read leniently: a broken stored rule hides the mark, it never hides the queue.
    const noticeDays = await readAttendanceRequestLimits(reviewer.organizationId, tx).then(limits => limits.leaveNoticeDays, () => 0)
    const reviewerIds = [...new Set(rows.flatMap((row) => [row.decidedByUserId, row.managerApprovedByUserId].filter((id): id is string => Boolean(id))))]
    const users = reviewerIds.length ? await tx.user.findMany({ where: { organizationId: reviewer.organizationId, id: { in: reviewerIds } }, select: { id: true, name: true } }) : []
    const names = new Map(users.map((user) => [user.id, user.name]))
    const lateNotice = (row: (typeof rows)[number]) => {
      const dto = attendanceRequestDto(row)
      return attendanceLateLeaveNotice({ kind: dto.details.kind, startDate: dto.startDate, submittedDate: currentDateKey(row.submittedAt, dto.details.timezone) }, noticeDays)
    }
    const cancellations = await readAttendanceRevocations(tx, reviewer.organizationId, rows.slice(0, 50).filter(row => row.status === "CANCELLED").map(row => row.id))
    return { items: rows.slice(0, 50).map((row): AttendanceReviewItem => ({ ...attendanceRequestDto(row), employeeName: row.agent.name,
      teamName: row.agent.team?.name ?? null, cancellation: cancellations.get(row.id), reviewerName: row.decidedByUserId ? names.get(row.decidedByUserId) ?? null : null,
      approval: { twoStep, awaiting: twoStep && row.status === "PENDING" ? row.managerApprovedAt ? "HR" : "MANAGER" : null,
        manager: row.managerApprovedAt ? { name: row.managerApprovedByUserId ? names.get(row.managerApprovedByUserId) ?? null : null, at: row.managerApprovedAt.toISOString(), note: row.managerApprovalNote } : null,
        passesToHr: twoStep && row.status === "PENDING" && actor.role !== "ADMIN" && !row.managerApprovedAt },
      canDecide: row.status === "PENDING" && !(twoStep && actor.role !== "ADMIN" && row.managerApprovedAt),
      lateNotice: lateNotice(row) })), nextCursor: rows.length > 50 ? rows[49].id : null }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15_000 })
}
