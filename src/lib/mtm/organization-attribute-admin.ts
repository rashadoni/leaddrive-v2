import type { MtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor, type MtmRouteActor } from "@/lib/mtm/route-permissions"

type RouteActorPrisma = Parameters<typeof resolveMtmRouteActor>[0]

export const ORGANIZATION_ATTRIBUTE_ADMIN_REQUIRED = "MTM_ORGANIZATION_ATTRIBUTE_ADMIN_REQUIRED"

export async function resolveOrganizationAttributeActor(
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

export async function resolveOrganizationAttributeAdministrator(
  client: RouteActorPrisma,
  auth: MtmRlsAuth,
): Promise<MtmRouteActor | null> {
  const actor = await resolveOrganizationAttributeActor(client, auth)
  return actor?.role === "ADMIN" ? actor : null
}

export async function requireCurrentOrganizationAttributeAdministrator(
  client: RouteActorPrisma,
  auth: MtmRlsAuth,
): Promise<MtmRouteActor> {
  const actor = await resolveOrganizationAttributeAdministrator(client, auth)
  if (!actor) throw new Error(ORGANIZATION_ATTRIBUTE_ADMIN_REQUIRED)
  return actor
}
