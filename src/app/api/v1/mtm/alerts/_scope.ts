import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import type { MtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { mtmFieldScopeRequiredResponse, resolveMtmFieldScope, type MtmFieldScope } from "@/lib/mtm/field-access"

/**
 * Resolving or deleting an alert is a supervisory act on someone's record.
 * Before the scope audit any web user with MTM write — and a field agent's
 * token — could close or delete alerts of any team. Now:
 *   - no MTM card behind the caller → MTM_FIELD_SCOPE_REQUIRED;
 *   - AGENT → 403: an agent does not close alerts raised about themselves;
 *   - MANAGER/SUPERVISOR → only alerts of agents in scope (others are a 404,
 *     indistinguishable from a missing id);
 *   - admin → any alert in the organization.
 *
 * Shared by the single-alert PATCH/DELETE and the bulk resolve, so closing a
 * whole group can never reach further than closing its rows one by one.
 */
export async function alertWriteScope(auth: MtmRlsAuth): Promise<Response | Exclude<MtmFieldScope, { kind: "none" }>> {
  const scope = await resolveMtmFieldScope(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (scope.kind === "none") return mtmFieldScopeRequiredResponse()
  if (scope.actor.role === "AGENT") {
    return NextResponse.json(
      { error: "Alert review requires manager access", code: "MTM_ALERT_REVIEW_FORBIDDEN" },
      { status: 403 },
    )
  }
  return scope
}
