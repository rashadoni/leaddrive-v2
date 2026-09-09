import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { canManageFieldMasterData } from "@/lib/mtm/field-scope"
import { resolveOrganizationDetailAccess } from "@/lib/mtm/organization-detail-access"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { CustomerDepartmentCreateSchema, parseBody } from "@/lib/mtm-validators"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withRouteFieldRlsAuth<RouteContext>("write", async (req, auth, { params }) => {
  const { id } = await params
  const { actor, customer } = await resolveOrganizationDetailAccess(auth, id)
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  if (!customer) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!canManageFieldMasterData(actor)) {
    return NextResponse.json({ error: "Organization departments require manager approval", code: "MTM_ORGANIZATION_APPROVAL_REQUIRED" }, { status: 403 })
  }
  const parsed = parseBody(CustomerDepartmentCreateSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const sourceObservedAt = new Date(parsed.data.sourceObservedAt)
  if (sourceObservedAt.getTime() > Date.now() + 5 * 60 * 1000) {
    return NextResponse.json({ error: "sourceObservedAt cannot be in the future" }, { status: 400 })
  }
  try {
    const department = await prisma.mtmCustomerDepartment.create({
      data: {
        organizationId: auth.orgId,
        customerId: id,
        ...parsed.data,
        sourceObservedAt,
        createdByUserId: auth.userId || null,
      },
    })
    await writeMtmAudit({
      organizationId: auth.orgId,
      agentId: actor.agentId,
      action: "FIELD_ORGANIZATION_UPDATE",
      entity: "customer_department",
      entityId: department.id,
      metadataKind: "organization_department_created",
      newData: department,
      req,
    }).catch((error) => console.warn("[MTM/organizations/departments POST] audit failed", error))
    return NextResponse.json({ success: true, data: { department } }, { status: 201 })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "A department with this code already exists", code: "MTM_DEPARTMENT_DUPLICATE" }, { status: 409 })
    }
    throw error
  }
})
