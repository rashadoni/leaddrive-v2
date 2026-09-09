import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { BrandPotentialCreateSchema, parseBody } from "@/lib/mtm-validators"
import { contactScopeForActor } from "@/lib/mtm/field-scope"
import {
  brandPotentialContext,
  brandPotentialRequestHash,
  canReviewBrandPotential,
  scopedAgentIds,
  utcBrandPotentialDate,
} from "@/lib/mtm/brand-potential"
import { writeMtmAudit } from "@/lib/mtm-audit"
import {
  professionalGlossaryIsGoverned,
  professionalGlossaryProvenance,
} from "@/lib/mtm/professional-glossary"

async function scopedDoctor(contactId: string, organizationId: string, actor: NonNullable<Awaited<ReturnType<typeof brandPotentialContext>>["actor"]>, asOf: Date) {
  return prisma.mtmContact.findFirst({
    where: {
      id: contactId,
      organizationId,
      type: "DOCTOR",
      deletedAt: null,
      ...(actor.role === "ADMIN" ? {} : { AND: [contactScopeForActor(actor, asOf)] }),
    },
    select: { id: true, displayName: true },
  })
}

const detailInclude = {
  agent: { select: { id: true, name: true } },
  enteredByAgent: { select: { id: true, name: true } },
  reviewedByAgent: { select: { id: true, name: true } },
  evidenceVisits: {
    include: {
      visit: { select: { id: true, checkInAt: true, checkOutAt: true, status: true, customer: { select: { id: true, name: true } } } },
    },
  },
} satisfies Prisma.MtmFieldPotentialInclude

export const GET = withRouteFieldRlsAuth("read", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const { actor, settings, timezone, asOf } = await brandPotentialContext(auth)
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const contact = await scopedDoctor(id, auth.orgId, actor, asOf)
  if (!contact) return NextResponse.json({ error: "Doctor is outside your scope" }, { status: 404 })

  const agentScope = scopedAgentIds(actor)
  const [potentials, eligibleVisits] = await Promise.all([
    prisma.mtmFieldPotential.findMany({
      where: {
        organizationId: auth.orgId,
        contactId: id,
        deletedAt: null,
        ...(agentScope === null ? {} : { OR: [{ agentId: null }, { agentId: { in: agentScope } }] }),
      },
      orderBy: [{ periodStart: "desc" }, { createdAt: "desc" }],
      take: 100,
      include: detailInclude,
    }),
    prisma.mtmVisit.findMany({
      where: {
        organizationId: auth.orgId,
        contactId: id,
        deletedAt: null,
        status: "CHECKED_OUT",
        ...(agentScope === null ? {} : { agentId: { in: agentScope } }),
      },
      orderBy: { checkInAt: "desc" },
      take: 25,
      select: { id: true, checkInAt: true, checkOutAt: true, status: true, agentId: true, customer: { select: { id: true, name: true } } },
    }),
  ])

  return NextResponse.json({
    success: true,
    data: {
      contact,
      potentials,
      eligibleVisits,
      timezone,
      capabilities: {
        canRecord: actor.agentId !== null || actor.role === "ADMIN",
        canReview: canReviewBrandPotential(actor),
        perAgentDimension: settings.brandPotentialPerAgentEnabled,
      },
    },
  })
})

export const POST = withRouteFieldRlsAuth("write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const { actor, settings, asOf } = await brandPotentialContext(auth)
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const parsed = parseBody(BrandPotentialCreateSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const body = parsed.data
  const contact = await scopedDoctor(id, auth.orgId, actor, asOf)
  if (!contact) return NextResponse.json({ error: "Doctor is outside your scope" }, { status: 404 })

  const requestHash = brandPotentialRequestHash(id, body)
  const existing = await prisma.mtmFieldPotential.findFirst({
    where: { organizationId: auth.orgId, clientPotentialId: body.clientPotentialId },
    include: detailInclude,
  })
  if (existing) {
    if (existing.requestHash !== requestHash || existing.contactId !== id) {
      return NextResponse.json({ error: "Potential retry payload differs", code: "MTM_BRAND_POTENTIAL_IDEMPOTENCY_CONFLICT" }, { status: 409 })
    }
    return NextResponse.json({ success: true, data: existing })
  }

  const glossaryFormula = await prisma.mtmDoctorScoringFormula.findFirst({
    where: { organizationId: auth.orgId, status: "ACTIVE", signedAt: { not: null } },
    orderBy: { signedAt: "desc" },
    select: {
      id: true,
      version: true,
      definitionHash: true,
      glossarySchemaVersion: true,
      approvalReference: true,
      sourceSystem: true,
      sourceReference: true,
      sourceObservedAt: true,
    },
  })
  if (!glossaryFormula || !professionalGlossaryIsGoverned(glossaryFormula)) {
    return NextResponse.json({
      error: "A signed active professional glossary is required",
      code: "MTM_PROFESSIONAL_GLOSSARY_NOT_ACTIVE",
    }, { status: 409 })
  }

  const candidateAgentId = settings.brandPotentialPerAgentEnabled ? (body.agentId ?? actor.agentId) : null
  if (settings.brandPotentialPerAgentEnabled && !candidateAgentId) {
    return NextResponse.json({ error: "An agent is required by tenant policy", code: "MTM_BRAND_POTENTIAL_AGENT_REQUIRED" }, { status: 400 })
  }
  const allowedAgentIds = scopedAgentIds(actor)
  if (candidateAgentId && allowedAgentIds !== null && !allowedAgentIds.includes(candidateAgentId)) {
    return NextResponse.json({ error: "Agent is outside your scope", code: "MTM_BRAND_POTENTIAL_AGENT_SCOPE" }, { status: 403 })
  }
  if (candidateAgentId) {
    const agent = await prisma.mtmAgent.findFirst({ where: { id: candidateAgentId, organizationId: auth.orgId, status: "ACTIVE" }, select: { id: true } })
    if (!agent) return NextResponse.json({ error: "Agent not found", code: "MTM_BRAND_POTENTIAL_AGENT_INVALID" }, { status: 400 })
  }

  if (body.supersedesPotentialId) {
    const previous = await prisma.mtmFieldPotential.findFirst({
      where: {
        id: body.supersedesPotentialId,
        organizationId: auth.orgId,
        contactId: id,
        deletedAt: null,
        ...(settings.brandPotentialPerAgentEnabled ? { agentId: candidateAgentId } : {}),
      },
      select: { id: true },
    })
    if (!previous) return NextResponse.json({ error: "Previous potential not found", code: "MTM_BRAND_POTENTIAL_REVISION_INVALID" }, { status: 400 })
  }

  if (body.evidenceVisitIds.length > 0) {
    const evidence = await prisma.mtmVisit.findMany({
      where: {
        id: { in: body.evidenceVisitIds },
        organizationId: auth.orgId,
        contactId: id,
        deletedAt: null,
        status: "CHECKED_OUT",
        ...(candidateAgentId
          ? { agentId: candidateAgentId }
          : allowedAgentIds === null
            ? {}
            : { agentId: { in: allowedAgentIds } }),
      },
      select: { id: true },
    })
    if (evidence.length !== body.evidenceVisitIds.length) {
      return NextResponse.json({ error: "One or more evidence visits are invalid", code: "MTM_BRAND_POTENTIAL_EVIDENCE_INVALID" }, { status: 400 })
    }
  }

  const reviewed = canReviewBrandPotential(actor)
  const potential = await prisma.mtmFieldPotential.create({
    data: {
      organizationId: auth.orgId,
      contactId: id,
      customerId: null,
      agentId: candidateAgentId,
      enteredByAgentId: actor.agentId,
      reviewedByAgentId: reviewed ? actor.agentId : null,
      clientPotentialId: body.clientPotentialId,
      requestHash,
      brandExternalId: body.brandExternalId,
      brandName: body.brandName,
      productExternalId: body.productExternalId ?? null,
      productName: body.productName ?? null,
      category: body.category ?? null,
      categoryLabel: body.categoryLabel ?? null,
      potentialValue: new Prisma.Decimal(body.potentialValue),
      coverageValue: new Prisma.Decimal(body.coverageValue),
      periodStart: utcBrandPotentialDate(body.periodStart),
      periodEnd: body.periodEnd ? utcBrandPotentialDate(body.periodEnd) : null,
      source: body.source,
      formulaVersion: glossaryFormula.version,
      provenance: {
        ...body.provenance,
        ...professionalGlossaryProvenance(glossaryFormula),
      } as Prisma.InputJsonValue,
      status: reviewed ? "VERIFIED" : "PENDING",
      reviewedAt: reviewed ? new Date() : null,
      supersedesPotentialId: body.supersedesPotentialId ?? null,
      evidenceVisits: {
        create: body.evidenceVisitIds.map((visitId) => ({ organizationId: auth.orgId, visitId })),
      },
    },
    include: detailInclude,
  })
  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: actor.agentId,
    action: "BRAND_POTENTIAL_CREATE",
    entity: "field_potential",
    entityId: potential.id,
    metadataKind: "brand_potential",
    newData: potential,
    req,
  }).catch((error) => console.warn("[MTM/brand-potentials POST] audit failed", error))
  return NextResponse.json({ success: true, data: potential }, { status: 201 })
})
