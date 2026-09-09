import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { canManageFieldMasterData, contactScopeForActor } from "@/lib/mtm/field-scope"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import { writeMtmAudit } from "@/lib/mtm-audit"

export const DELETE = withRouteFieldRlsAuth("write", async (
  req,
  auth,
  { params }: { params: Promise<{ id: string; workplaceId: string }> },
) => {
  const { id: contactId, workplaceId } = await params
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

  const before = await prisma.mtmContactWorkplace.findFirst({
    where: {
      id: workplaceId,
      contactId,
      organizationId: auth.orgId,
      deletedAt: null,
      ...(actor.role === "ADMIN" ? {} : { contact: contactScopeForActor(actor, asOf) }),
    },
  })
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (before.endedOn && before.endedOn <= asOf) {
    return NextResponse.json({ success: true, data: { workplaceId, endedOn: before.endedOn }, idempotent: true })
  }
  const changed = await prisma.mtmContactWorkplace.updateMany({
    where: { id: workplaceId, contactId, organizationId: auth.orgId, deletedAt: null, updatedAt: before.updatedAt },
    data: { endedOn: asOf, isPrimary: false, updatedBy: auth.userId || null },
  })
  if (changed.count !== 1) {
    return NextResponse.json({ error: "Workplace changed concurrently", code: "MTM_WORKPLACE_CONFLICT" }, { status: 409 })
  }

  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: actor.agentId,
    action: "CONTACT_WORKPLACE_END",
    entity: "contact_workplace",
    entityId: workplaceId,
    metadataKind: "contact_workplace",
    oldData: before,
    newData: { endedOn: asOf },
    req,
  }).catch((error) => console.warn("[MTM/contact workplaces DELETE] audit failed", error))

  return NextResponse.json({ success: true, data: { workplaceId, endedOn: asOf } })
})
