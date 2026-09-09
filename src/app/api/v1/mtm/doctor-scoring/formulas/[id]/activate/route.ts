import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { doctorScoringContext } from "@/lib/mtm/doctor-scoring"
import {
  DoctorScoringFormulaActivateSchema,
  parseGovernedDoctorScoringDefinition,
} from "@/lib/mtm/professional-glossary"
import { parseBody } from "@/lib/mtm-validators"
import { writeMtmAudit } from "@/lib/mtm-audit"

export const POST = withMtmRlsAuth("mtm", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const { actor } = await doctorScoringContext(auth)
  if (!actor || actor.role !== "ADMIN") {
    return NextResponse.json({ error: "Only MTM administrators can sign scoring formulas" }, { status: 403 })
  }
  const parsed = parseBody(DoctorScoringFormulaActivateSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response

  const formula = await prisma.mtmDoctorScoringFormula.findFirst({
    where: { id, organizationId: auth.orgId },
  })
  if (!formula) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (formula.status !== "DRAFT") {
    return NextResponse.json({ error: "Only draft formulas can be activated", code: "MTM_SCORING_FORMULA_NOT_DRAFT" }, { status: 409 })
  }
  const governed = parseGovernedDoctorScoringDefinition(formula.definition)
  const expectedDefinitionHash = parsed.data.expectedDefinitionHash.toLowerCase()
  if (!governed.success
    || governed.data.definitionHash !== expectedDefinitionHash
    || formula.definitionHash !== expectedDefinitionHash
    || formula.glossarySchemaVersion !== governed.data.glossarySchemaVersion) {
    return NextResponse.json({
      error: "Professional glossary definition changed or is not governed",
      code: "MTM_PROFESSIONAL_GLOSSARY_HASH_CONFLICT",
      actualDefinitionHash: governed.success ? governed.data.definitionHash : null,
    }, { status: 409 })
  }
  if (formula.approvalReference !== parsed.data.approvalReference
    || governed.data.approvalReference !== parsed.data.approvalReference) {
    return NextResponse.json({
      error: "Approval reference does not match the immutable formula definition",
      code: "MTM_PROFESSIONAL_GLOSSARY_APPROVAL_CONFLICT",
    }, { status: 409 })
  }

  const signedAt = new Date()
  const activated = await prisma.$transaction(async (tx) => {
    await tx.mtmDoctorScoringFormula.updateMany({
      where: { organizationId: auth.orgId, status: "ACTIVE" },
      data: { status: "RETIRED", retiredAt: signedAt },
    })
    const changed = await tx.mtmDoctorScoringFormula.updateMany({
      where: {
        id,
        organizationId: auth.orgId,
        status: "DRAFT",
        definitionHash: expectedDefinitionHash,
        approvalReference: parsed.data.approvalReference,
        signedAt: null,
      },
      data: { status: "ACTIVE", signedBy: auth.userId || null, signedAt, retiredAt: null },
    })
    if (changed.count !== 1) throw new Error("Formula changed concurrently")
    return tx.mtmDoctorScoringFormula.findFirst({ where: { id, organizationId: auth.orgId } })
  })

  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: actor.agentId,
    action: "DOCTOR_SCORING_FORMULA_ACTIVATE",
    entity: "doctor_scoring_formula",
    entityId: id,
    metadataKind: "doctor_scoring_formula",
    oldData: formula,
    newData: activated,
    req,
  }).catch((error) => console.warn("[MTM/doctor-scoring/formulas activate] audit failed", error))
  return NextResponse.json({ success: true, data: activated })
})
