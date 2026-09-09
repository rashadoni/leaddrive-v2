import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { isAgentInRouteScope, resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { canManageFieldMasterData } from "@/lib/mtm/field-scope"
import { ContactBulkAssignmentPreviewSchema, parseBody } from "@/lib/mtm-validators"
import { buildContactAssignmentPreview } from "@/lib/mtm/contact-bulk-assignment"

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

export const POST = withRouteFieldRlsAuth("write", async (req, auth) => {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor || !canManageFieldMasterData(actor)) {
    return NextResponse.json({ error: "Forbidden", code: "MTM_CONTACT_ASSIGNMENT_FORBIDDEN" }, { status: 403 })
  }
  const parsed = parseBody(ContactBulkAssignmentPreviewSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  if (parsed.data.targetAgentId && !isAgentInRouteScope(actor, parsed.data.targetAgentId)) {
    return NextResponse.json({ error: "Agent is outside your scope", code: "MTM_CONTACT_ASSIGNMENT_SCOPE_DENIED" }, { status: 403 })
  }
  const preview = await buildContactAssignmentPreview(prisma, {
    organizationId: auth.orgId,
    ...parsed.data,
    effectiveFrom: utcDate(parsed.data.effectiveFrom),
    actor,
  })
  return NextResponse.json({ success: true, data: preview })
})
