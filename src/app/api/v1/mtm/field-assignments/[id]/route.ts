import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { isAgentInRouteScope, resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { FieldAssignmentEndSchema, parseBody } from "@/lib/mtm-validators"
import { canManageFieldMasterData } from "@/lib/mtm/field-scope"
import { writeMtmAudit } from "@/lib/mtm-audit"

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

export const PATCH = withRouteFieldRlsAuth("write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor || !canManageFieldMasterData(actor)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const parsed = parseBody(FieldAssignmentEndSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const [customerAssignment, contactAssignment] = await Promise.all([
    prisma.mtmCustomerAgentAssignment.findFirst({ where: { id, organizationId: auth.orgId, deletedAt: null } }),
    prisma.mtmContactAgentAssignment.findFirst({ where: { id, organizationId: auth.orgId, deletedAt: null } }),
  ])
  const before = customerAssignment ?? contactAssignment
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!isAgentInRouteScope(actor, before.agentId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const effectiveTo = utcDate(body.effectiveTo)
  if (effectiveTo < before.effectiveFrom) {
    return NextResponse.json({ error: "End date precedes start date", code: "MTM_ASSIGNMENT_DATE_INVALID" }, { status: 400 })
  }

  const data = { effectiveTo, reason: body.reason ?? before.reason }
  const changed = customerAssignment
    ? await prisma.mtmCustomerAgentAssignment.updateMany({
        where: { id, organizationId: auth.orgId, deletedAt: null, updatedAt: before.updatedAt },
        data,
      })
    : await prisma.mtmContactAgentAssignment.updateMany({
        where: { id, organizationId: auth.orgId, deletedAt: null, updatedAt: before.updatedAt },
        data,
      })
  if (changed.count !== 1) {
    return NextResponse.json({ error: "Assignment changed concurrently", code: "MTM_ASSIGNMENT_CONFLICT" }, { status: 409 })
  }

  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: actor.agentId,
    action: "FIELD_ASSIGNMENT_END",
    entity: customerAssignment ? "customer_assignment" : "contact_assignment",
    entityId: id,
    metadataKind: "field_assignment",
    oldData: before,
    newData: data,
    req,
  }).catch((error) => console.warn("[MTM/field-assignments PATCH] audit failed", error))

  return NextResponse.json({ success: true })
})
