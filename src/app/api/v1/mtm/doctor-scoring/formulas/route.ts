import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { DoctorScoringFormulaCreateSchema, parseBody } from "@/lib/mtm-validators"
import { doctorScoringContext } from "@/lib/mtm/doctor-scoring"
import { parseGovernedDoctorScoringDefinition } from "@/lib/mtm/professional-glossary"
import { writeMtmAudit } from "@/lib/mtm-audit"

export const GET = withMtmRlsAuth("mtm", "read", async (_req, auth) => {
  const { actor } = await doctorScoringContext(auth)
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const formulas = await prisma.mtmDoctorScoringFormula.findMany({
    where: { organizationId: auth.orgId },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  })
  return NextResponse.json({
    success: true,
    data: { formulas, capabilities: { canConfigure: actor.role === "ADMIN" } },
  })
})

export const POST = withMtmRlsAuth("mtm", "write", async (req, auth) => {
  const { actor } = await doctorScoringContext(auth)
  if (!actor || actor.role !== "ADMIN") {
    return NextResponse.json({ error: "Only MTM administrators can configure scoring formulas" }, { status: 403 })
  }
  const parsed = parseBody(DoctorScoringFormulaCreateSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const governed = parseGovernedDoctorScoringDefinition(parsed.data.definition)
  if (!governed.success) {
    return NextResponse.json({
      error: "The formula must include the complete multilingual professional glossary and source authority",
      code: "MTM_PROFESSIONAL_GLOSSARY_INVALID",
      issues: governed.error.flatten(),
    }, { status: 400 })
  }

  try {
    const formula = await prisma.mtmDoctorScoringFormula.create({
      data: {
        organizationId: auth.orgId,
        version: parsed.data.version,
        name: parsed.data.name,
        definition: governed.data.definition as Prisma.InputJsonValue,
        definitionHash: governed.data.definitionHash,
        glossarySchemaVersion: governed.data.glossarySchemaVersion,
        approvalReference: governed.data.approvalReference,
        sourceSystem: governed.data.sourceSystem,
        sourceReference: governed.data.sourceReference,
        sourceObservedAt: governed.data.sourceObservedAt,
        status: "DRAFT",
        createdBy: auth.userId || null,
      },
    })
    await writeMtmAudit({
      organizationId: auth.orgId,
      agentId: actor.agentId,
      action: "DOCTOR_SCORING_FORMULA_CREATE",
      entity: "doctor_scoring_formula",
      entityId: formula.id,
      metadataKind: "doctor_scoring_formula",
      newData: formula,
      req,
    }).catch((error) => console.warn("[MTM/doctor-scoring/formulas POST] audit failed", error))
    return NextResponse.json({ success: true, data: formula }, { status: 201 })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Formula version already exists", code: "MTM_SCORING_FORMULA_VERSION_EXISTS" }, { status: 409 })
    }
    throw error
  }
})
