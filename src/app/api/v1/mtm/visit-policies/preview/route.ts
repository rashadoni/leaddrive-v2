import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldWebRlsAuth } from "@/lib/with-mtm-rls-auth"
import { VisitPolicyPreviewSchema, parseBody } from "@/lib/mtm-validators"
import { resolveMtmVisitPolicy } from "@/lib/mtm/visit-policies"
import { getMtmSettings } from "@/lib/mtm-settings"
import { customerScopeForActor } from "@/lib/mtm/field-scope"
import { visitPolicyAccessFor, visitPolicyReadDenied } from "@/lib/mtm/visit-policy-access"

function previewTargetNotFound(code: "MTM_VISIT_AGENT_NOT_FOUND" | "MTM_VISIT_CUSTOMER_NOT_FOUND") {
  return NextResponse.json({ error: "Agent or customer not found", code }, { status: 404 })
}

export const POST = withRouteFieldWebRlsAuth("read", async (req, auth) => {
  const access = await visitPolicyAccessFor(auth)
  if (access.kind === "none") return visitPolicyReadDenied(access)
  const settings = await getMtmSettings(auth.orgId)
  if (!settings.visitPoliciesEnabled) return NextResponse.json({ error: "Visit policies are disabled", code: "MTM_VISIT_POLICIES_DISABLED" }, { status: 409 })
  const parsed = parseBody(VisitPolicyPreviewSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response

  // Managers and supervisors preview only their own agents at customers of
  // their field scope; an out-of-scope id looks exactly like a missing one.
  if (access.kind !== "admin") {
    if (!(access.actor.scopedAgentIds ?? []).includes(parsed.data.agentId)) {
      return previewTargetNotFound("MTM_VISIT_AGENT_NOT_FOUND")
    }
    const customer = await prisma.mtmCustomer.findFirst({
      where: {
        id: parsed.data.customerId,
        organizationId: auth.orgId,
        deletedAt: null,
        ...customerScopeForActor(access.actor, new Date()),
      },
      select: { id: true },
    })
    if (!customer) return previewTargetNotFound("MTM_VISIT_CUSTOMER_NOT_FOUND")
  }

  try {
    const resolution = await resolveMtmVisitPolicy(prisma, {
      organizationId: auth.orgId,
      agentId: parsed.data.agentId,
      customerId: parsed.data.customerId,
      visitType: parsed.data.visitType,
      at: parsed.data.at ? new Date(parsed.data.at) : undefined,
    })
    return NextResponse.json({ success: true, data: resolution })
  } catch (error) {
    const code = error instanceof Error ? error.message : "MTM_POLICY_PREVIEW_FAILED"
    if (code === "MTM_VISIT_AGENT_NOT_FOUND" || code === "MTM_VISIT_CUSTOMER_NOT_FOUND") {
      return NextResponse.json({ error: "Agent or customer not found", code }, { status: 404 })
    }
    throw error
  }
})
