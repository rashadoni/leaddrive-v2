import type { MtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor, type MtmRouteActor } from "@/lib/mtm/route-permissions"

type RouteActorPrisma = Parameters<typeof resolveMtmRouteActor>[0]

export const CONTACT_DICTIONARY_ADMIN_REQUIRED = "MTM_CONTACT_DICTIONARY_ADMIN_REQUIRED"

export async function resolveContactDictionaryActor(
  client: RouteActorPrisma,
  auth: MtmRlsAuth,
): Promise<MtmRouteActor | null> {
  if (auth.principal !== "web") return null
  return resolveMtmRouteActor(client, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
}

export async function resolveContactDictionaryAdministrator(
  client: RouteActorPrisma,
  auth: MtmRlsAuth,
): Promise<MtmRouteActor | null> {
  const actor = await resolveContactDictionaryActor(client, auth)
  return actor?.role === "ADMIN" ? actor : null
}

export async function requireCurrentContactDictionaryAdministrator(
  client: RouteActorPrisma,
  auth: MtmRlsAuth,
): Promise<MtmRouteActor> {
  const actor = await resolveContactDictionaryAdministrator(client, auth)
  if (!actor) throw new Error(CONTACT_DICTIONARY_ADMIN_REQUIRED)
  return actor
}

export function contactDictionaryDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}
