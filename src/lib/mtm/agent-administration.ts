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

export function mtmScopedAgentTerritoryForbidden() {
  return NextResponse.json(
    {
      error: "Only an administrator can make this employee a supervisor or reset their password: their team is outside your territory",
      code: "MTM_AGENT_TERRITORY_REQUIRED",
    },
    { status: 403 },
  )
}

export function mtmAgentManagerCycleResponse() {
  return NextResponse.json(
    { error: "An employee cannot report to themselves or to someone who reports to them", code: "MTM_AGENT_MANAGER_CYCLE" },
    { status: 400 },
  )
}

/** Hard ceiling for walking a reporting line; a longer chain is treated as a cycle. */
const MANAGER_CHAIN_MAX_STEPS = 100

/**
 * True when putting `agentId` under `managerId` would close a loop: the new
 * manager is the card itself or already reports to it (at any depth). Walks
 * up from the new manager, tenant-scoped, one row per level, and stops on an
 * existing loop elsewhere in the chain. An unexpectedly long chain fails
 * closed.
 */
export async function managerAssignmentCreatesCycle(
  prisma: Pick<ActorPrisma, "mtmAgent">,
  params: { organizationId: string; agentId: string; managerId: string },
): Promise<boolean> {
  if (params.managerId === params.agentId) return true
  const seen = new Set<string>()
  let current: string | null = params.managerId
  for (let step = 0; step < MANAGER_CHAIN_MAX_STEPS; step += 1) {
    if (!current || seen.has(current)) return false
    seen.add(current)
    const row: { managerId: string | null } | null = await prisma.mtmAgent.findFirst({
      where: { id: current, organizationId: params.organizationId },
      select: { managerId: true },
    })
    if (!row?.managerId) return false
    if (row.managerId === params.agentId) return true
    current = row.managerId
  }
  return true
}
