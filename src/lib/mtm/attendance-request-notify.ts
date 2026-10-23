import type { Prisma } from "@prisma/client"
import { createNotification } from "@/lib/notifications"
import { checkPermission, type Role } from "@/lib/permissions"
import { effectiveHiddenModules } from "@/lib/user-module-access"
import { canReviewMtmRouteRequest, resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { MTM_ATTENDANCE_REQUEST_NOTIFICATION_ENTITY, MTM_ATTENDANCE_REQUEST_NOTIFICATION_KIND } from "@/lib/mtm/attendance-request-notification"
import { readAttendanceTwoStepApproval } from "@/lib/mtm/attendance-approval-chain"
import az from "../../../messages/az.json"
import ru from "../../../messages/ru.json"
import en from "../../../messages/en.json"

const messages = { az: az.mtmAttendance, ru: ru.mtmAttendance, en: en.mtmAttendance }
/**
 * Who decides this employee's request: an active CRM login with write on MTM,
 * MTM not hidden from it, and the employee in its scope — an admin, or a
 * manager card linked to the login. Never the employee's own login. The bell
 * (below) and the push to the manager's phone (attendance-request-push.ts)
 * go to the same people.
 */
export async function attendanceRequestReviewers(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; agentId: string },
): Promise<Array<{ id: string; preferredLanguage: string | null; hr: boolean }>> {
  const { organizationId, agentId } = input
  const [cards, owner] = await Promise.all([
    tx.mtmAgent.findMany({ where: { organizationId, status: "ACTIVE", role: { in: ["ADMIN", "MANAGER", "SUPERVISOR"] }, userId: { not: null } }, select: { userId: true } }),
    tx.mtmAgent.findFirst({ where: { organizationId, id: agentId }, select: { userId: true } }),
  ])
  const ids = cards.flatMap((card) => card.userId ? [card.userId] : [])
  const users = await tx.user.findMany({ where: { organizationId, isActive: true, anonymizedAt: null,
    ...(owner?.userId ? { id: { not: owner.userId } } : {}),
    OR: [{ role: { in: ["admin", "superadmin"] } }, { id: { in: ids } }],
  }, orderBy: { id: "asc" }, take: 50, select: { id: true, role: true, preferredLanguage: true, hiddenModules: true } })
  const reviewers: Array<{ id: string; preferredLanguage: string | null; hr: boolean }> = []
  for (const user of users) {
    if (!checkPermission(user.role as Role, "mtm", "write") || effectiveHiddenModules(user.role, user.hiddenModules).includes("mtm")) continue
    const actor = await resolveMtmRouteActor(tx, { organizationId, userId: user.id, webRole: user.role })
    if (!actor || !canReviewMtmRouteRequest(actor, agentId)) continue
    // HR of the two-step approval is an administrator (attendance-approval-chain.ts).
    reviewers.push({ id: user.id, preferredLanguage: user.preferredLanguage, hr: actor.role === "ADMIN" })
  }
  return reviewers
}

/**
 * Who hears of a new request. With two-step approval on, the employee's
 * managers — HR hears once a manager approves (`notifyAttendanceRequestHr`);
 * an employee with no manager to ask goes straight to HR.
 */
export async function attendanceRequestFirstReviewers(tx: Prisma.TransactionClient, input: { organizationId: string; agentId: string }) {
  const reviewers = await attendanceRequestReviewers(tx, input)
  if (!await readAttendanceTwoStepApproval(tx, input.organizationId)) return reviewers
  const managers = reviewers.filter((reviewer) => !reviewer.hr)
  return managers.length ? managers : reviewers
}

/** The durable bell row commits with the request. Email recipients stay opt-in;
 * no external transport runs while this transaction holds employee locks. */
export async function notifyAttendanceRequestReviewers(tx: Prisma.TransactionClient, input: { organizationId: string; agentId: string; requestId: string }) {
  const { organizationId, requestId } = input
  for (const user of await attendanceRequestFirstReviewers(tx, input)) {
    const t = messages[user.preferredLanguage === "ru" || user.preferredLanguage === "en" ? user.preferredLanguage : "az"]
    const row = await createNotification({ organizationId, userId: user.id, type: "warning",
      title: t.requestNotificationTitle, message: t.requestNotificationBody,
      entityType: MTM_ATTENDANCE_REQUEST_NOTIFICATION_ENTITY, entityId: requestId, kind: MTM_ATTENDANCE_REQUEST_NOTIFICATION_KIND,
      idempotencyKey: `mtm-attendance-submitted:${requestId}`, client: tx,
    })
    if (!row) throw new Error("MTM_ATTENDANCE_NOTIFICATION_UNAVAILABLE")
  }
}

/** Two-step approval: a manager approved, HR (the administrators) decides. Commits with that approval. */
export async function notifyAttendanceRequestHr(tx: Prisma.TransactionClient, input: { organizationId: string; agentId: string; requestId: string }) {
  const { organizationId, requestId } = input
  for (const user of (await attendanceRequestReviewers(tx, input)).filter((reviewer) => reviewer.hr)) {
    const t = messages[user.preferredLanguage === "ru" || user.preferredLanguage === "en" ? user.preferredLanguage : "az"]
    const row = await createNotification({ organizationId, userId: user.id, type: "warning",
      title: t.requestHrNotificationTitle, message: t.requestHrNotificationBody,
      entityType: MTM_ATTENDANCE_REQUEST_NOTIFICATION_ENTITY, entityId: requestId, kind: MTM_ATTENDANCE_REQUEST_NOTIFICATION_KIND,
      idempotencyKey: `mtm-attendance-manager-approved:${requestId}`, client: tx,
    })
    if (!row) throw new Error("MTM_ATTENDANCE_NOTIFICATION_UNAVAILABLE")
  }
}
