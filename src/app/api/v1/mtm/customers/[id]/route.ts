import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { normalizeMtmCoordinates } from "@/lib/mtm/geo-coordinates"
import { CustomerUpdateSchema, parseBody } from "@/lib/mtm-validators"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import { canManageFieldMasterData, customerScopeForActor } from "@/lib/mtm/field-scope"
import type { Prisma } from "@prisma/client"

async function context(auth: { orgId: string; userId: string; role: string; agentId: string | null }) {
  const [actor, settings] = await Promise.all([
    resolveMtmRouteActor(prisma, {
      organizationId: auth.orgId,
      userId: auth.userId,
      webRole: auth.role,
      agentId: auth.agentId,
    }),
    getMtmSettings(auth.orgId),
  ])
  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
  const asOf = new Date(`${currentDateKey(new Date(), timezone)}T00:00:00.000Z`)
  return { actor, asOf }
}

export const GET = withRouteFieldRlsAuth("read", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const orgId = auth.orgId
  const { actor, asOf } = await context(auth)
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  try {
    const customer = await prisma.mtmCustomer.findFirst({
      where: {
        id,
        organizationId: orgId,
        deletedAt: null,
        ...(actor.role === "ADMIN" ? {} : { AND: [customerScopeForActor(actor, asOf)] }),
      },
    })
    if (!customer) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ success: true, data: customer })
  } catch (e) {
    console.error("[MTM/customers/[id] GET]", e)
    return NextResponse.json({ error: "Failed to fetch customer" }, { status: 500 })
  }
})

export const PUT = withRouteFieldRlsAuth("write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const orgId = auth.orgId
  const { actor, asOf } = await context(auth)
  if (!actor || !canManageFieldMasterData(actor)) {
    return NextResponse.json({ error: "Agents must request organization changes", code: "CUSTOMER_APPROVAL_REQUIRED" }, { status: 403 })
  }

  try {
    const raw = await req.json()
    const parsed = parseBody(CustomerUpdateSchema, raw)
    if (!parsed.ok) return parsed.response
    const body = parsed.data

    const before = await prisma.mtmCustomer.findFirst({
      where: {
        id,
        organizationId: orgId,
        deletedAt: null,
        ...(actor.role === "ADMIN" ? {} : { AND: [customerScopeForActor(actor, asOf)] }),
      },
      select: { id: true, name: true, code: true, category: true, status: true, geofenceRadius: true },
    })
    if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const data: Prisma.MtmCustomerUpdateManyMutationInput = {}
    if (body.code !== undefined) data.code = body.code ?? null
    if (body.name !== undefined) data.name = body.name
    if (body.objectType !== undefined) data.objectType = body.objectType
    if (body.category !== undefined) data.category = body.category
    if (body.status !== undefined) data.status = body.status
    if (body.address !== undefined) data.address = body.address ?? null
    if (body.city !== undefined) data.city = body.city ?? null
    if (body.district !== undefined) data.district = body.district ?? null
    // The pair moves together: one axis alone is rejected by the validator, and
    // (0, 0) or a cleared axis stores NULL on both (src/lib/mtm/geo-coordinates.ts).
    if (body.latitude !== undefined || body.longitude !== undefined) Object.assign(data, normalizeMtmCoordinates(body))
    if (body.phone !== undefined) data.phone = body.phone ?? null
    if (body.contactPerson !== undefined) data.contactPerson = body.contactPerson ?? null
    if (body.notes !== undefined) data.notes = body.notes ?? null
    if (body.geofenceRadius !== undefined) data.geofenceRadius = body.geofenceRadius ?? null

    const updated = await prisma.mtmCustomer.updateMany({
      where: { id, organizationId: orgId, deletedAt: null },
      data,
    })
    if (updated.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })

    await writeMtmAudit({
      organizationId: orgId,
      agentId: null,
      action: "CUSTOMER_UPDATE",
      entity: "customer",
      entityId: id,
      metadataKind: "customer_update",
      oldData: before,
      newData: data,
      req,
    }).catch((e) => console.warn("[MTM/customers/[id] PUT] audit failed", e))

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update" }, { status: 400 })
  }
})

export const DELETE = withRouteFieldRlsAuth("write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const orgId = auth.orgId
  const { actor, asOf } = await context(auth)
  if (!actor || !canManageFieldMasterData(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  try {
    const before = await prisma.mtmCustomer.findFirst({
      where: {
        id,
        organizationId: orgId,
        deletedAt: null,
        ...(actor.role === "ADMIN" ? {} : { AND: [customerScopeForActor(actor, asOf)] }),
      },
      select: { id: true, name: true, code: true },
    })
    const deleted = await prisma.mtmCustomer.updateMany({
      where: { id, organizationId: orgId, deletedAt: null },
      data: { deletedAt: new Date() },
    })
    if (deleted.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })

    await writeMtmAudit({
      organizationId: orgId,
      agentId: null,
      action: "CUSTOMER_DELETE",
      entity: "customer",
      entityId: id,
      metadataKind: "customer_delete",
      oldData: before,
      req,
    }).catch((e) => console.warn("[MTM/customers/[id] DELETE] audit failed", e))

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to delete" }, { status: 400 })
  }
})
