import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { DoctorAssessmentDecisionSchema, parseBody } from "@/lib/mtm-validators"
import { canManageFieldMasterData, contactScopeForActor } from "@/lib/mtm/field-scope"
import { doctorScoringContext } from "@/lib/mtm/doctor-scoring"
import { writeMtmAudit } from "@/lib/mtm-audit"

export const POST = withMtmRlsAuth("mtm", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const { actor, asOf } = await doctorScoringContext(auth)
  if (!actor || !canManageFieldMasterData(actor) || actor.role === "AGENT") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const parsed = parseBody(DoctorAssessmentDecisionSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response

  const assessment = await prisma.mtmDoctorAssessment.findFirst({
    where: {
      id,
      organizationId: auth.orgId,
      contact: {
        deletedAt: null,
        ...(actor.role === "ADMIN" ? {} : { AND: [contactScopeForActor(actor, asOf)] }),
      },
    },
  })
  if (!assessment) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (assessment.status !== "PENDING") {
    return NextResponse.json({ error: "Assessment was already reviewed", code: "MTM_DOCTOR_ASSESSMENT_ALREADY_REVIEWED" }, { status: 409 })
  }

  const reviewedAt = new Date()
  const changed = await prisma.mtmDoctorAssessment.updateMany({
    where: { id, organizationId: auth.orgId, status: "PENDING" },
    data: {
      status: parsed.data.decision,
      reviewComment: parsed.data.comment,
      reviewedByAgentId: actor.agentId,
      reviewedAt,
    },
  })
  if (changed.count !== 1) {
    return NextResponse.json({ error: "Assessment changed concurrently", code: "MTM_DOCTOR_ASSESSMENT_CONFLICT" }, { status: 409 })
  }
  const reviewed = await prisma.mtmDoctorAssessment.findFirst({ where: { id, organizationId: auth.orgId } })
  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: actor.agentId,
    action: `DOCTOR_ASSESSMENT_${parsed.data.decision}`,
    entity: "doctor_assessment",
    entityId: id,
    metadataKind: "doctor_assessment_review",
    oldData: assessment,
    newData: reviewed,
    req,
  }).catch((error) => console.warn("[MTM/doctor-assessments decision] audit failed", error))
  return NextResponse.json({ success: true, data: reviewed })
})
