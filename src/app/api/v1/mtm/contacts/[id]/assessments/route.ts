import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { DoctorAssessmentCreateSchema, parseBody } from "@/lib/mtm-validators"
import { canManageFieldMasterData, contactScopeForActor } from "@/lib/mtm/field-scope"
import {
  doctorAssessmentRequestHash,
  doctorScoringContext,
  utcDoctorScoringDate,
} from "@/lib/mtm/doctor-scoring"
import {
  professionalGlossaryIsGoverned,
  professionalGlossaryProvenance,
} from "@/lib/mtm/professional-glossary"
import { writeMtmAudit } from "@/lib/mtm-audit"

async function scopedContact(id: string, organizationId: string, actor: NonNullable<Awaited<ReturnType<typeof doctorScoringContext>>["actor"]>, asOf: Date) {
  return prisma.mtmContact.findFirst({
    where: {
      id,
      organizationId,
      deletedAt: null,
      type: "DOCTOR",
      ...(actor.role === "ADMIN" ? {} : { AND: [contactScopeForActor(actor, asOf)] }),
    },
    select: { id: true, displayName: true },
  })
}

export const GET = withRouteFieldRlsAuth("read", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const { actor, timezone, asOf } = await doctorScoringContext(auth)
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const contact = await scopedContact(id, auth.orgId, actor, asOf)
  if (!contact) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const assessments = await prisma.mtmDoctorAssessment.findMany({
    where: { organizationId: auth.orgId, contactId: id },
    orderBy: [{ periodStart: "desc" }, { createdAt: "desc" }],
    include: {
      formula: { select: {
        id: true,
        version: true,
        name: true,
        definition: true,
        definitionHash: true,
        glossarySchemaVersion: true,
        approvalReference: true,
        sourceSystem: true,
        sourceReference: true,
        sourceObservedAt: true,
        status: true,
        signedAt: true,
      } },
      enteredByAgent: { select: { id: true, name: true } },
      reviewedByAgent: { select: { id: true, name: true } },
    },
  })
  return NextResponse.json({
    success: true,
    data: {
      contact,
      assessments,
      timezone,
      capabilities: { canAssess: canManageFieldMasterData(actor), canReview: canManageFieldMasterData(actor) },
    },
  })
})

export const POST = withRouteFieldRlsAuth("write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const { actor, asOf } = await doctorScoringContext(auth)
  if (!actor || !canManageFieldMasterData(actor)) {
    return NextResponse.json({ error: "Agents can observe doctor assessments but cannot enter scores", code: "MTM_DOCTOR_ASSESSMENT_READ_ONLY" }, { status: 403 })
  }
  const parsed = parseBody(DoctorAssessmentCreateSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const contact = await scopedContact(id, auth.orgId, actor, asOf)
  if (!contact) return NextResponse.json({ error: "Doctor is outside your scope" }, { status: 404 })

  const requestHash = doctorAssessmentRequestHash(parsed.data)
  const existing = await prisma.mtmDoctorAssessment.findFirst({
    where: { organizationId: auth.orgId, clientAssessmentId: parsed.data.clientAssessmentId },
  })
  if (existing) {
    if (existing.requestHash !== requestHash || existing.contactId !== id) {
      return NextResponse.json({ error: "Assessment retry payload differs", code: "MTM_DOCTOR_ASSESSMENT_IDEMPOTENCY_CONFLICT" }, { status: 409 })
    }
    return NextResponse.json({ success: true, data: existing })
  }

  const formula = await prisma.mtmDoctorScoringFormula.findFirst({
    where: { id: parsed.data.formulaId, organizationId: auth.orgId, status: "ACTIVE", signedAt: { not: null } },
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
  if (!formula || !professionalGlossaryIsGoverned(formula)) {
    return NextResponse.json({
      error: "A signed active formula with a governed professional glossary is required",
      code: "MTM_PROFESSIONAL_GLOSSARY_NOT_ACTIVE",
    }, { status: 409 })
  }

  const assessment = await prisma.mtmDoctorAssessment.create({
    data: {
      organizationId: auth.orgId,
      contactId: id,
      formulaId: formula.id,
      enteredByAgentId: actor.agentId,
      clientAssessmentId: parsed.data.clientAssessmentId,
      requestHash,
      office: parsed.data.office ?? null,
      patientsPerMonth: parsed.data.patientsPerMonth ?? null,
      bedCount: parsed.data.bedCount ?? null,
      isKol: parsed.data.isKol ?? false,
      kolLevel: parsed.data.kolLevel ?? null,
      profile: parsed.data.profile ?? null,
      psychotype: parsed.data.psychotype ?? null,
      granularCategory: parsed.data.granularCategory ?? null,
      actualScore: parsed.data.actualScore == null ? null : new Prisma.Decimal(parsed.data.actualScore),
      targetScore: parsed.data.targetScore == null ? null : new Prisma.Decimal(parsed.data.targetScore),
      periodStart: utcDoctorScoringDate(parsed.data.periodStart),
      periodEnd: parsed.data.periodEnd ? utcDoctorScoringDate(parsed.data.periodEnd) : null,
      source: parsed.data.source,
      provenance: {
        ...parsed.data.provenance,
        ...professionalGlossaryProvenance(formula),
      } as Prisma.InputJsonValue,
      formulaVersion: formula.version,
      status: "PENDING",
      createdBy: auth.userId || null,
    },
  })
  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: actor.agentId,
    action: "DOCTOR_ASSESSMENT_CREATE",
    entity: "doctor_assessment",
    entityId: assessment.id,
    metadataKind: "doctor_assessment",
    newData: assessment,
    req,
  }).catch((error) => console.warn("[MTM/contacts assessments POST] audit failed", error))
  return NextResponse.json({ success: true, data: assessment }, { status: 201 })
})
