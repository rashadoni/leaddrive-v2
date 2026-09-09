import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { BrandPotentialEndSchema, parseBody } from "@/lib/mtm-validators"
import { brandPotentialContext, canReviewBrandPotential, utcBrandPotentialDate } from "@/lib/mtm/brand-potential"
import { contactScopeForActor } from "@/lib/mtm/field-scope"
import { writeMtmAudit } from "@/lib/mtm-audit"

export const POST = withRouteFieldRlsAuth("write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const { actor, asOf } = await brandPotentialContext(auth)
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const parsed = parseBody(BrandPotentialEndSchema, await req.json().catch(() => null))
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
  if (!canReviewBrandPotential(actor) && before.enteredByAgentId !== actor.agentId) {
    return NextResponse.json({ error: "Only the recorder or a manager can end this period", code: "MTM_BRAND_POTENTIAL_END_FORBIDDEN" }, { status: 403 })
  }
  if (before.status === "ENDED") return NextResponse.json({ success: true, data: before })
  const periodEnd = utcBrandPotentialDate(parsed.data.periodEnd)
  if (before.periodStart && periodEnd < before.periodStart) {
    return NextResponse.json({ error: "periodEnd must not precede periodStart", code: "MTM_BRAND_POTENTIAL_END_DATE" }, { status: 400 })
  }
  const closedAt = new Date()
  const changed = await prisma.mtmFieldPotential.updateMany({
    where: { id, organizationId: auth.orgId, status: { not: "ENDED" }, deletedAt: null },
    data: { status: "ENDED", periodEnd, closedAt, reviewComment: parsed.data.reason },
  })
  if (changed.count !== 1) return NextResponse.json({ error: "Potential changed concurrently", code: "MTM_BRAND_POTENTIAL_CONFLICT" }, { status: 409 })
  const ended = await prisma.mtmFieldPotential.findFirst({ where: { id, organizationId: auth.orgId } })
  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: actor.agentId,
    action: "BRAND_POTENTIAL_END",
    entity: "field_potential",
    entityId: id,
    metadataKind: "brand_potential_period",
    oldData: before,
    newData: { ...ended, reason: parsed.data.reason },
    req,
  }).catch((error) => console.warn("[MTM/brand-potentials end] audit failed", error))
  return NextResponse.json({ success: true, data: ended })
})
