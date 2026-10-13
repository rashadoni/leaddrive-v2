import type { Prisma } from "@prisma/client"
import { createNotification } from "@/lib/notifications"
import { checkPermission, type Role } from "@/lib/permissions"
import { effectiveHiddenModules } from "@/lib/user-module-access"
import { canReviewMtmRouteRequest, resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { MTM_ATTENDANCE_INSTALLATION_NOTIFICATION_ENTITY, MTM_ATTENDANCE_INSTALLATION_NOTIFICATION_KIND } from "@/lib/mtm/attendance-installation-notification"
import az from "../../../messages/az.json"
import ru from "../../../messages/ru.json"
import en from "../../../messages/en.json"

const messages = { az: az.mtmAttendance, ru: ru.mtmAttendance, en: en.mtmAttendance }
/** The durable bell row commits with the request. Email recipients stay opt-in;
 * no external transport runs while this transaction holds employee locks. */
export async function notifyAttendanceInstallationReviewers(tx: Prisma.TransactionClient, input: { organizationId: string; agentId: string; requestId: string }) {
  const { organizationId, agentId, requestId } = input
  const [cards, owner] = await Promise.all([
    tx.mtmAgent.findMany({ where: { organizationId, status: "ACTIVE", role: { in: ["ADMIN", "MANAGER", "SUPERVISOR"] }, userId: { not: null } }, select: { userId: true } }),
    tx.mtmAgent.findFirst({ where: { organizationId, id: agentId }, select: { userId: true } }),
  ])
  const ids = cards.flatMap((card) => card.userId ? [card.userId] : [])
  const users = await tx.user.findMany({ where: { organizationId, isActive: true, anonymizedAt: null,
    ...(owner?.userId ? { id: { not: owner.userId } } : {}),
    OR: [{ role: { in: ["admin", "superadmin"] } }, { id: { in: ids } }],
  }, orderBy: { id: "asc" }, take: 1001, select: { id: true, role: true, preferredLanguage: true, hiddenModules: true } })
  if (users.length > 1000) throw new Error("MTM_ATTENDANCE_INSTALLATION_RECIPIENT_LIMIT")
  for (const user of users) {
    if (!checkPermission(user.role as Role, "mtm", "write") || effectiveHiddenModules(user.role, user.hiddenModules).includes("mtm")) continue
    const actor = await resolveMtmRouteActor(tx, { organizationId, userId: user.id, webRole: user.role })
    if (!actor || !canReviewMtmRouteRequest(actor, agentId)) continue
    const t = messages[user.preferredLanguage === "ru" || user.preferredLanguage === "en" ? user.preferredLanguage : "az"]
    const row = await createNotification({ organizationId, userId: user.id, type: "warning",
      title: t.installationNotificationTitle, message: t.installationNotificationBody,
      entityType: MTM_ATTENDANCE_INSTALLATION_NOTIFICATION_ENTITY, entityId: requestId, kind: MTM_ATTENDANCE_INSTALLATION_NOTIFICATION_KIND,
      idempotencyKey: `mtm-attendance-installation:${requestId}`, client: tx,
    })
    if (!row) throw new Error("MTM_ATTENDANCE_NOTIFICATION_UNAVAILABLE")
  }
}

/** Generic inbox title only; the reason is visible in the protected own detail. */
export async function notifyAttendanceInstallationOwner(tx: Prisma.TransactionClient, input: { organizationId: string; agentId: string; requestId: string; locale?: string | null; action: "APPROVE" | "REJECT" | "REVOKE" }) {
  const locale = input.locale === "ru" || input.locale === "en" ? input.locale : "az"
  await tx.mtmNotification.create({ data: { organizationId: input.organizationId, agentId: input.agentId,
    title: messages[locale].installationDecisionNotification, type: input.action === "APPROVE" ? "info" : "warning",
    metadata: { domain: "route", attendanceInstallationRequestId: input.requestId } } })
}
