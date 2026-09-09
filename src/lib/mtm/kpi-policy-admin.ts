import type { MtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor, type MtmRouteActor } from "@/lib/mtm/route-permissions"

type RouteActorPrisma = Parameters<typeof resolveMtmRouteActor>[0]
export const KPI_POLICY_ADMIN_REQUIRED = "MTM_KPI_POLICY_ADMIN_REQUIRED"

export async function resolveKpiPolicyAdministrator(client: RouteActorPrisma, auth: MtmRlsAuth): Promise<MtmRouteActor | null> {
  if (auth.principal !== "web") return null
  const actor = await resolveMtmRouteActor(client, {
    organizationId: auth.orgId, userId: auth.userId, webRole: auth.role, agentId: auth.agentId,
  })
  return actor?.role === "ADMIN" ? actor : null
}

export async function requireCurrentKpiPolicyAdministrator(client: RouteActorPrisma, auth: MtmRlsAuth): Promise<MtmRouteActor> {
  const actor = await resolveKpiPolicyAdministrator(client, auth)
  if (!actor) throw new Error(KPI_POLICY_ADMIN_REQUIRED)
  return actor
}

export function kpiPolicyDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}
