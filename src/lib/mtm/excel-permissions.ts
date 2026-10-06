import type { prisma as appPrisma } from "@/lib/prisma"
import { resolveMtmRouteActor, type MtmRouteActor } from "@/lib/mtm/route-permissions"
import { canManageFieldMasterData } from "@/lib/mtm/field-scope"

type AppPrisma = typeof appPrisma

export interface MtmExcelAccess {
  actor: MtmRouteActor | null
  /** Institutions, routes, sales and plans. */
  canImport: boolean
  /** Clients (the CONTACTS type). */
  canImportContacts: boolean
}

function enabled(value: unknown): boolean {
  if (value === true) return true
  return Boolean(value && typeof value === "object" && "enabled" in value && value.enabled === true)
}

export async function resolveMtmExcelAccess(
  db: AppPrisma,
  auth: { orgId: string; userId: string; role: string },
): Promise<MtmExcelAccess> {
  const actor = await resolveMtmRouteActor(db, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
  })
  if (!actor) return { actor: null, canImport: false, canImportContacts: false }
  const importFlag = await db.mtmSetting.findUnique({
    where: { organizationId_key: { organizationId: auth.orgId, key: "excelImportsEnabled" } },
    select: { value: true },
  })
  if (importFlag?.value === false) return { actor, canImport: false, canImportContacts: false }
  // A client file does what the «add client» form does, many times over, so it
  // is open to exactly the people that form is open to. The manager opt-in
  // below keeps guarding the other types.
  const canImportContacts = canManageFieldMasterData(actor)
  if (actor.role === "ADMIN") return { actor, canImport: true, canImportContacts }
  if (actor.role !== "MANAGER" && actor.role !== "SUPERVISOR") return { actor, canImport: false, canImportContacts }
  const setting = await db.mtmSetting.findUnique({
    where: { organizationId_key: { organizationId: auth.orgId, key: "excelImportManagers" } },
    select: { value: true },
  })
  return { actor, canImport: enabled(setting?.value), canImportContacts }
}

/** Whether this person may upload and apply a file of the given type. */
export function canImportMtmExcelType(access: MtmExcelAccess, type: string): boolean {
  if (!access.actor) return false
  return type === "CONTACTS" ? access.canImportContacts : access.canImport
}

/** The types this person may import, for the screen to offer. */
export function importableMtmExcelTypes(access: MtmExcelAccess, types: readonly string[]): string[] {
  return types.filter((type) => canImportMtmExcelType(access, type))
}
