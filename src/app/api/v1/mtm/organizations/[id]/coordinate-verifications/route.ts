import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { canManageFieldMasterData } from "@/lib/mtm/field-scope"
import { resolveOrganizationDetailAccess } from "@/lib/mtm/organization-detail-access"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { CustomerCoordinateVerificationSchema, parseBody } from "@/lib/mtm-validators"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withRouteFieldRlsAuth<RouteContext>("write", async (req, auth, { params }) => {
  const { id } = await params
  const { actor, customer } = await resolveOrganizationDetailAccess(auth, id)
  if (!actor || !canManageFieldMasterData(actor)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  if (!customer) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (customer.latitude === null || customer.longitude === null) {
    return NextResponse.json({ error: "Organization has no coordinates", code: "MTM_COORDINATES_MISSING" }, { status: 409 })
  }
  const parsed = parseBody(CustomerCoordinateVerificationSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const sourceObservedAt = new Date(parsed.data.sourceObservedAt)
  if (sourceObservedAt.getTime() > Date.now() + 5 * 60 * 1000) {
    return NextResponse.json({ error: "sourceObservedAt cannot be in the future" }, { status: 400 })
  }
  const receipt = await prisma.mtmCustomerCoordinateVerification.create({
    data: {
      organizationId: auth.orgId,
      customerId: id,
      latitude: customer.latitude,
      longitude: customer.longitude,
      ...parsed.data,
      sourceObservedAt,
      verifiedByUserId: auth.userId,
    },
  })
  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: actor.agentId,
    action: "FIELD_ORGANIZATION_UPDATE",
    entity: "customer_coordinate_verification",
    entityId: receipt.id,
    metadataKind: "organization_coordinate_verified",
    newData: receipt,
    req,
  }).catch((error) => console.warn("[MTM/organizations/coordinate-verifications POST] audit failed", error))
  return NextResponse.json({ success: true, data: { coordinateVerification: receipt } }, { status: 201 })
})
