import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor, isAgentInRouteScope } from "@/lib/mtm/route-permissions"
import { canManageFieldMasterData } from "@/lib/mtm/field-scope"
import { ContactTransferPreviewSchema, parseBody } from "@/lib/mtm-validators"
import { buildContactTransferPreview } from "@/lib/mtm/contact-transfer"

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
    return NextResponse.json({ error: "Forbidden", code: "MTM_CONTACT_TRANSFER_FORBIDDEN" }, { status: 403 })
  }
  const parsed = parseBody(ContactTransferPreviewSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  if (![parsed.data.sourceAgentId, parsed.data.targetAgentId].every((id) => isAgentInRouteScope(actor, id))) {
    return NextResponse.json({ error: "Agent is outside your scope", code: "MTM_CONTACT_TRANSFER_SCOPE_DENIED" }, { status: 403 })
  }

  const preview = await buildContactTransferPreview(prisma, {
    organizationId: auth.orgId,
    ...parsed.data,
    effectiveFrom: utcDate(parsed.data.effectiveFrom),
    actor,
  })
  return NextResponse.json({ success: true, data: preview })
})
