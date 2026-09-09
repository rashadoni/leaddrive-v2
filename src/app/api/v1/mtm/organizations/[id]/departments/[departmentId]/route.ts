import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { canManageFieldMasterData } from "@/lib/mtm/field-scope"
import { resolveOrganizationDetailAccess } from "@/lib/mtm/organization-detail-access"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"

type RouteContext = { params: Promise<{ id: string; departmentId: string }> }

export const DELETE = withRouteFieldRlsAuth<RouteContext>("write", async (req, auth, { params }) => {
  const { id, departmentId } = await params
  const { actor, customer } = await resolveOrganizationDetailAccess(auth, id)
  if (!actor || !canManageFieldMasterData(actor)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  if (!customer) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const before = await prisma.mtmCustomerDepartment.findFirst({
    where: { id: departmentId, organizationId: auth.orgId, customerId: id, archivedAt: null },
  })
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const archivedAt = new Date()
  const changed = await prisma.mtmCustomerDepartment.updateMany({
    where: { id: departmentId, organizationId: auth.orgId, customerId: id, archivedAt: null },
    data: { archivedAt },
  })
  if (changed.count !== 1) return NextResponse.json({ error: "Department changed concurrently" }, { status: 409 })
  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: actor.agentId,
    action: "FIELD_ORGANIZATION_UPDATE",
    entity: "customer_department",
    entityId: departmentId,
    metadataKind: "organization_department_archived",
    oldData: before,
    newData: { archivedAt },
    req,
  }).catch((error) => console.warn("[MTM/organizations/departments DELETE] audit failed", error))
  return NextResponse.json({ success: true })
})
