/**
 * Who is writing to the bot, re-read on every message like a web session is on
 * every request: an active user of an active organization with Da Vinci, read
 * with their current role and hidden modules. A changed password or «log out
 * everywhere» after the link was made ends the link, as it ends sessions.
 * A reviewer under NDA never gets the bot.
 */
import { prisma } from "@/lib/prisma"
import { checkPermission, type Role } from "@/lib/permissions"
import { getOrgModuleContext } from "@/lib/api-auth"
import { hasModule } from "@/lib/modules"
import { effectiveHiddenModules, moduleContextForUser } from "@/lib/user-module-access"

export interface StaffActor {
  orgId: string
  userId: string
  role: Role
  hiddenModules: string[]
  name: string
}

export type ActorRefusal = "USER_INACTIVE" | "RELINK_REQUIRED" | "NO_AI_MODULE" | "NOT_ALLOWED"

export async function loadStaffActor(link: { organizationId: string; userId: string; linkedAt: Date }): Promise<{ ok: true; actor: StaffActor } | { ok: false; code: ActorRefusal }> {
  const user = await prisma.user.findFirst({
    where: { id: link.userId, organizationId: link.organizationId },
    select: { id: true, name: true, role: true, isActive: true, hiddenModules: true, passwordChangedAt: true, organization: { select: { isActive: true } } },
  })
  if (!user || !user.isActive || user.organization?.isActive !== true) return { ok: false, code: "USER_INACTIVE" }
  if (user.passwordChangedAt && user.passwordChangedAt > link.linkedAt) return { ok: false, code: "RELINK_REQUIRED" }
  const role = user.role as Role
  if (role === ("reviewer" as Role) || !checkPermission(role, "ai", "read")) return { ok: false, code: "NOT_ALLOWED" }

  const hiddenModules = effectiveHiddenModules(role, user.hiddenModules) as string[]
  const orgModules = moduleContextForUser(await getOrgModuleContext(link.organizationId), { hiddenModules })
  if (!hasModule(orgModules, "ai")) return { ok: false, code: "NO_AI_MODULE" }

  return { ok: true, actor: { orgId: link.organizationId, userId: user.id, role, hiddenModules, name: user.name ?? "" } }
}
