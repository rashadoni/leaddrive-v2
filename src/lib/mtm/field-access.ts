import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import type { MtmRouteActor } from "@/lib/mtm/route-permissions"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"

/**
 * Agent-level field scope for MTM list/report endpoints.
 *
 * Inside one organization RLS separates nothing between teams: the only thing
 * that keeps a manager to "their agents" is this in-code scope. The scope audit
 * of 2026-09-14 found photos, agents, reports, alerts and activity ignoring it —
 * every manager saw the whole company, and a field agent's token could pull the
 * same lists. Every such endpoint now resolves one of three answers:
 *
 *   - organization — web admin/superadmin, an API key (role admin) or an MTM
 *     ADMIN card: no agent filter;
 *   - agents       — a bounded list: MANAGER/SUPERVISOR scope, AGENT only self;
 *   - none         — no MTM card behind the caller (e.g. a web "manager" who
 *     was never linked to an employee card). There is no field scope to show,
 *     so the endpoint refuses with MTM_FIELD_SCOPE_REQUIRED rather than
 *     guessing between "everything" and "nothing".
 */
export type MtmFieldScope =
  | { kind: "organization"; actor: MtmRouteActor }
  | { kind: "agents"; actor: MtmRouteActor; agentIds: string[] }
  | { kind: "none" }

type ActorPrisma = Parameters<typeof resolveMtmRouteActor>[0]

export async function resolveMtmFieldScope(
  prisma: ActorPrisma,
  params: { organizationId: string; userId: string; webRole: string; agentId?: string | null },
): Promise<MtmFieldScope> {
  const actor = await resolveMtmRouteActor(prisma, params)
  return fieldScopeForActor(actor)
}

export function fieldScopeForActor(actor: MtmRouteActor | null): MtmFieldScope {
  if (!actor) return { kind: "none" }
  if (actor.role === "ADMIN") return { kind: "organization", actor }
  if (actor.role === "AGENT") {
    return actor.agentId ? { kind: "agents", actor, agentIds: [actor.agentId] } : { kind: "none" }
  }
  // `null` is the tenant-wide sentinel and is valid only for MTM admins. An
  // inconsistent resolver result fails closed instead of widening the caller.
  if (actor.scopedAgentIds === null) return { kind: "none" }
  return { kind: "agents", actor, agentIds: [...new Set(actor.scopedAgentIds)] }
}

export function isAgentInFieldScope(scope: MtmFieldScope, agentId: string): boolean {
  if (scope.kind === "organization") return true
  if (scope.kind === "none") return false
  return scope.agentIds.includes(agentId)
}

/** `{}` for organization scope, `{ agentId: { in } }` for a bounded one. */
export function fieldScopeAgentIdWhere(scope: MtmFieldScope): { agentId?: { in: string[] } } {
  if (scope.kind === "agents") return { agentId: { in: scope.agentIds } }
  return {}
}

/**
 * A photo belongs to the scope when the agent who took it is in scope, or when
 * it was taken on a visit whose primary agent is in scope (a participant's
 * photo on "my agent's" visit). Shared by the photo list and the file proxy so
 * a URL cannot reach bytes the list would not show. `none` never matches.
 */
export function mtmPhotoFieldScopeWhere(scope: MtmFieldScope): Prisma.MtmPhotoWhereInput {
  if (scope.kind === "organization") return {}
  if (scope.kind === "none" || scope.agentIds.length === 0) return { id: "__no_field_scope__" }
  return {
    OR: [
      { agentId: { in: scope.agentIds } },
      { visit: { is: { agentId: { in: scope.agentIds } } } },
    ],
  }
}

export function mtmFieldScopeRequiredResponse() {
  return NextResponse.json(
    {
      error: "This view needs a field scope: link your user to an active MTM employee card",
      code: "MTM_FIELD_SCOPE_REQUIRED",
    },
    { status: 403 },
  )
}

export function mtmAgentOutOfScopeResponse() {
  return NextResponse.json(
    { error: "Agent is outside your field scope", code: "MTM_AGENT_OUT_OF_SCOPE" },
    { status: 403 },
  )
}
