import type { Prisma } from "@prisma/client"
import { createNotification } from "@/lib/notifications"
import { checkPermission, type Role } from "@/lib/permissions"
import { effectiveHiddenModules } from "@/lib/user-module-access"
import { canReviewMtmRouteRequest, resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { MTM_ATTENDANCE_RISK_NOTIFICATION_ENTITY, MTM_ATTENDANCE_RISK_NOTIFICATION_KIND } from "@/lib/mtm/attendance-risk-notification"
import az from "../../../messages/az.json"
import ru from "../../../messages/ru.json"
import en from "../../../messages/en.json"

/** Only new cases invoke this. The safe bell entry commits with the case;
 * failures roll back the mark. No external email or push inside the transaction. */
export async function notifyAttendanceRiskReviewers(tx: Prisma.TransactionClient, input: { organizationId: string; agentId: string; caseId: string }) {
  const { organizationId, agentId, caseId } = input
  const enabled = await tx.mtmSetting.findUnique({ where: { organizationId_key: { organizationId, key: "attendanceEnabled" } }, select: { value: true } })
  if (enabled?.value !== true) return
  const cards = await tx.mtmAgent.findMany({ where: { organizationId, status: "ACTIVE", role: { in: ["ADMIN", "MANAGER", "SUPERVISOR"] }, userId: { not: null } }, select: { userId: true } })
  const owner = await tx.mtmAgent.findFirst({ where: { organizationId, id: agentId }, select: { userId: true } })
  const ids = cards.flatMap(card => card.userId ? [card.userId] : [])
  const users = await tx.$queryRaw<{ id: string; role: string; preferredLanguage: string | null; hiddenModules: string[]; mtmAttendanceAll: boolean }[]>`
    SELECT id,role,"preferredLanguage","hiddenModules","mtmAttendanceAll" FROM users
    WHERE "organizationId"=${organizationId} AND "isActive" AND "anonymizedAt" IS NULL
      AND (${owner?.userId ?? null}::text IS NULL OR id<>${owner?.userId ?? null})
      AND (role IN ('admin','superadmin') OR "mtmAttendanceAll" OR id=ANY(${ids}::text[])) ORDER BY id LIMIT 1001`
  // Never silently omit recipients above a hidden limit.
  if (users.length > 1000) throw new Error("MTM_ATTENDANCE_RISK_RECIPIENT_LIMIT")
  for (const user of users) {
    if (!checkPermission(user.role as Role, "mtm", "read") || effectiveHiddenModules(user.role, user.hiddenModules).includes("mtm")) continue
    if (user.mtmAttendanceAll !== true && !["admin", "superadmin"].includes(user.role)) {
      const actor = await resolveMtmRouteActor(tx, { organizationId, userId: user.id, webRole: user.role })
      if (!actor || !canReviewMtmRouteRequest(actor, agentId)) continue
    }
    const locale = user.preferredLanguage === "ru" || user.preferredLanguage === "en" ? user.preferredLanguage : "az"
    const t = ({ az, ru, en })[locale].mtmAttendance
    const row = await createNotification({ organizationId, userId: user.id, type: "warning",
      title: t.riskNotificationTitle, message: t.riskNotificationBody,
      entityType: MTM_ATTENDANCE_RISK_NOTIFICATION_ENTITY, entityId: caseId, kind: MTM_ATTENDANCE_RISK_NOTIFICATION_KIND,
      idempotencyKey: `mtm-attendance-risk:${caseId}`, client: tx,
    })
    if (!row) throw new Error("MTM_ATTENDANCE_RISK_NOTIFICATION_UNAVAILABLE")
  }
}
