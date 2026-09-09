import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldWebRlsAuth } from "@/lib/with-mtm-rls-auth"
import { VisitPolicyPreviewSchema, parseBody } from "@/lib/mtm-validators"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { resolveMtmVisitPolicy } from "@/lib/mtm/visit-policies"
import { getMtmSettings } from "@/lib/mtm-settings"

export const POST = withRouteFieldWebRlsAuth("read", async (req, auth) => {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
  })
  if (actor?.role !== "ADMIN") {
    return NextResponse.json({ error: "Administrator access required", code: "MTM_POLICY_ADMIN_REQUIRED" }, { status: 403 })
  }
  const settings = await getMtmSettings(auth.orgId)
  if (!settings.visitPoliciesEnabled) return NextResponse.json({ error: "Visit policies are disabled", code: "MTM_VISIT_POLICIES_DISABLED" }, { status: 409 })
  const parsed = parseBody(VisitPolicyPreviewSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response

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
