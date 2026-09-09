import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { BrandPotentialDecisionSchema, parseBody } from "@/lib/mtm-validators"
import { brandPotentialContext, canReviewBrandPotential } from "@/lib/mtm/brand-potential"
import { contactScopeForActor } from "@/lib/mtm/field-scope"
import { writeMtmAudit } from "@/lib/mtm-audit"

export const POST = withRouteFieldRlsAuth("write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const { actor, asOf } = await brandPotentialContext(auth)
  if (!actor || !canReviewBrandPotential(actor)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const parsed = parseBody(BrandPotentialDecisionSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const before = await prisma.mtmFieldPotential.findFirst({
    where: {
      id,
      organizationId: auth.orgId,
      deletedAt: null,
      contact: { deletedAt: null, ...(actor.role === "ADMIN" ? {} : { AND: [contactScopeForActor(actor, asOf)] }) },
    },
  })
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (before.status !== "PENDING") {
    return NextResponse.json({ error: "Potential was already reviewed", code: "MTM_BRAND_POTENTIAL_ALREADY_REVIEWED" }, { status: 409 })
  }
  const reviewedAt = new Date()
  const changed = await prisma.mtmFieldPotential.updateMany({
    where: { id, organizationId: auth.orgId, status: "PENDING", deletedAt: null },
    data: { status: parsed.data.decision, reviewComment: parsed.data.comment, reviewedByAgentId: actor.agentId, reviewedAt },
  })
  if (changed.count !== 1) return NextResponse.json({ error: "Potential changed concurrently", code: "MTM_BRAND_POTENTIAL_CONFLICT" }, { status: 409 })
  const reviewed = await prisma.mtmFieldPotential.findFirst({ where: { id, organizationId: auth.orgId } })
  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: actor.agentId,
    action: `BRAND_POTENTIAL_${parsed.data.decision}`,
    entity: "field_potential",
    entityId: id,
    metadataKind: "brand_potential_review",
    oldData: before,
    newData: reviewed,
    req,
  }).catch((error) => console.warn("[MTM/brand-potentials decision] audit failed", error))
  return NextResponse.json({ success: true, data: reviewed })
})
