import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import {
  canManageFieldMasterData,
  contactScopeForActor,
  customerScopeForActor,
} from "@/lib/mtm/field-scope"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import { writeMtmAudit } from "@/lib/mtm-audit"

export const DELETE = withRouteFieldRlsAuth("write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor || !canManageFieldMasterData(actor)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const settings = await getMtmSettings(auth.orgId)
  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
  const asOf = new Date(`${currentDateKey(new Date(), timezone)}T00:00:00.000Z`)
  const before = await prisma.mtmFieldPotential.findFirst({
    where: {
      id,
      organizationId: auth.orgId,
      deletedAt: null,
      ...(actor.role === "ADMIN" ? {} : {
        AND: [{
          OR: [
            { customer: customerScopeForActor(actor, asOf) },
            { contact: contactScopeForActor(actor, asOf) },
          ],
        }],
      }),
    },
  })
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const deletedAt = new Date()
  const changed = await prisma.mtmFieldPotential.updateMany({
    where: { id, organizationId: auth.orgId, deletedAt: null, updatedAt: before.updatedAt },
    data: { deletedAt },
  })
  if (changed.count !== 1) {
    return NextResponse.json({ error: "Potential changed concurrently", code: "MTM_POTENTIAL_CONFLICT" }, { status: 409 })
  }
  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: actor.agentId,
    action: "FIELD_POTENTIAL_DELETE",
    entity: "field_potential",
    entityId: id,
    metadataKind: "field_potential",
    oldData: before,
    newData: { deletedAt },
    req,
  }).catch((error) => console.warn("[MTM/field-potentials DELETE] audit failed", error))
  return NextResponse.json({ success: true })
})
