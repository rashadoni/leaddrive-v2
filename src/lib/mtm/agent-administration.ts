import { NextResponse } from "next/server"
import type { RlsAuth } from "@/lib/with-rls"
import { checkPermission } from "@/lib/permissions"
import { resolveMtmRouteActor, type MtmRouteActor } from "@/lib/mtm/route-permissions"
import { mtmFieldScopeRequiredResponse } from "@/lib/mtm/field-access"

/**
 * Who may create, edit, reset the password of, or delete an MTM employee card.
 *
 * Before the scope audit of 2026-09-14 every web user with the `manager` role
 * could do all of that to any card in the organization — including another
 * region's manager. Now:
 *
 *   - web admin/superadmin, or an MTM ADMIN card → any card;
 *   - a web manager whose own card is MANAGER → only AGENT/SUPERVISOR cards
 *     inside their field scope, cannot hand out MANAGER/ADMIN roles, cannot
 *     link a card to a web login, and cannot move a card under a manager
 *     outside their scope;
 *   - a web manager without an MTM card → MTM_FIELD_SCOPE_REQUIRED;
 *   - everyone else (including mobile tokens and API keys) → admin required.
 */
export type MtmAgentAdministration =
  | { kind: "organization" }
  | { kind: "scoped"; actor: MtmRouteActor & { agentId: string }; agentIds: string[] }
  | { kind: "denied"; response: Response }

/** Roles a scoped manager may manage and assign. */
export const MTM_SCOPED_MANAGEABLE_AGENT_ROLES: readonly string[] = ["AGENT", "SUPERVISOR"]

type ActorPrisma = Parameters<typeof resolveMtmRouteActor>[0]

export function mtmAgentAdministrationDenied() {
  return NextResponse.json(
    { error: "Web administrator access required", code: "MTM_AGENT_ADMIN_REQUIRED" },
    { status: 403 },
  )
}

export async function resolveMtmAgentAdministration(
  prisma: ActorPrisma,
  { orgId, session }: RlsAuth,
): Promise<MtmAgentAdministration> {
  // Agent credentials and authorization links are privileged web operations.
  // Mobile JWTs and API keys reach withRls without a browser session and fail.
  if (!session) return { kind: "denied", response: mtmAgentAdministrationDenied() }
  if (session.role === "superadmin" || session.role === "admin") return { kind: "organization" }

  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: orgId,
    userId: session.userId,
    webRole: session.role,
  })
  if (actor?.role === "ADMIN") return { kind: "organization" }

  const webMayAdminister = checkPermission(session.role, "mtm", "admin")
  if (!actor) {
    return {
      kind: "denied",
      response: webMayAdminister ? mtmFieldScopeRequiredResponse() : mtmAgentAdministrationDenied(),
    }
  }
  const actorAgentId = actor.agentId
  const scopedAgentIds = actor.scopedAgentIds
  if (actor.role === "MANAGER" && webMayAdminister && actorAgentId && scopedAgentIds) {
    return {
      kind: "scoped",
      actor: { ...actor, agentId: actorAgentId },
      agentIds: [...new Set(scopedAgentIds)],
    }
  }
  return { kind: "denied", response: mtmAgentAdministrationDenied() }
}

export function mtmScopedAgentRoleForbidden() {
  return NextResponse.json(
    {
      error: "Only an administrator can manage manager or administrator cards",
      code: "MTM_AGENT_ROLE_ADMIN_REQUIRED",
    },
    { status: 403 },
  )
}

export function mtmScopedAgentLinkForbidden() {
  return NextResponse.json(
    { error: "Only an administrator can link an employee card to a web user", code: "MTM_AGENT_LINK_ADMIN_REQUIRED" },
    { status: 403 },
  )
}
