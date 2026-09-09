import type { prisma as appPrisma } from "@/lib/prisma"
import { resolveMtmRouteActor, type MtmRouteActor } from "@/lib/mtm/route-permissions"

type AppPrisma = typeof appPrisma

function enabled(value: unknown): boolean {
  if (value === true) return true
  return Boolean(value && typeof value === "object" && "enabled" in value && value.enabled === true)
}

export async function resolveMtmExcelAccess(
  db: AppPrisma,
  auth: { orgId: string; userId: string; role: string },
): Promise<{ actor: MtmRouteActor | null; canImport: boolean }> {
  const actor = await resolveMtmRouteActor(db, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
  })
  if (!actor) return { actor: null, canImport: false }
  const importFlag = await db.mtmSetting.findUnique({
    where: { organizationId_key: { organizationId: auth.orgId, key: "excelImportsEnabled" } },
    select: { value: true },
  })
  if (importFlag?.value === false) return { actor, canImport: false }
  if (actor.role === "ADMIN") return { actor, canImport: true }
  if (actor.role !== "MANAGER" && actor.role !== "SUPERVISOR") return { actor, canImport: false }
  const setting = await db.mtmSetting.findUnique({
    where: { organizationId_key: { organizationId: auth.orgId, key: "excelImportManagers" } },
    select: { value: true },
  })
  return { actor, canImport: enabled(setting?.value) }
}
