import type { MtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor, type MtmRouteActor } from "@/lib/mtm/route-permissions"

type RouteActorPrisma = Parameters<typeof resolveMtmRouteActor>[0]

export const COVERAGE_POLICY_ADMIN_REQUIRED = "MTM_COVERAGE_POLICY_ADMIN_REQUIRED"

export async function resolveCoveragePolicyAdministrator(
  client: RouteActorPrisma,
  auth: MtmRlsAuth,
): Promise<MtmRouteActor | null> {
  if (auth.principal !== "web") return null
  const actor = await resolveMtmRouteActor(client, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  return actor?.role === "ADMIN" ? actor : null
}

export async function requireCurrentCoveragePolicyAdministrator(
  client: RouteActorPrisma,
  auth: MtmRlsAuth,
): Promise<MtmRouteActor> {
  const actor = await resolveCoveragePolicyAdministrator(client, auth)
  if (!actor) throw new Error(COVERAGE_POLICY_ADMIN_REQUIRED)
  return actor
}

export function coveragePolicyDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}
