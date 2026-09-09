/**
 * CLM Slice 4c — POST /api/v1/contracts/:id/deviations/rescan
 *
 * Re-run clause governance detection on a contract:
 *   1. Delete flags with status = "flagged" (open, not actioned).
 *   2. Preserve waived + acknowledged flags.
 *   3. Re-detect from the contract's template + current clause library.
 *   4. Insert new flags.
 *
 * requireAuth contracts "write".
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { detectDeviations } from "@/lib/contract-lifecycle/deviation-detector"
import type { TemplateClause } from "@/lib/contract-lifecycle/types"
import { withRlsAuth } from "@/lib/with-rls"

export const POST = withRlsAuth("contracts", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { orgId, userId } = auth
  const { id: contractId } = await params

  // Load the contract (org-scoped) with its template.
  const contract = await prisma.contract.findFirst({
    where: { id: contractId, organizationId: orgId },
    select: { id: true, templateId: true },
  })
  if (!contract) {
    return NextResponse.json({ error: "Contract not found" }, { status: 404 })
  }
  if (!contract.templateId) {
    return NextResponse.json(
      { error: "Contract has no template — cannot re-scan" },
      { status: 422 },
    )
  }

  const template = await prisma.contractTemplate.findFirst({
    where: { id: contract.templateId, organizationId: orgId },
    select: { clauses: true },
  })
  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 })
  }

  // 1. Load current clause library (org-scoped).
  const libraryClauses = await prisma.contractClause.findMany({
    where: { organizationId: orgId },
    select: { id: true, title: true, riskLevel: true, status: true, fallbackOfClauseId: true },
  })

  // 3. Re-detect.
  const clauses = (template.clauses as TemplateClause[]) ?? []
  const templateClauseInputs = clauses.map((c) => ({ title: c.title }))
  const deviations = detectDeviations(templateClauseInputs, libraryClauses)

  // 4. Atomic: delete open (flagged) flags + insert new ones in one transaction
  //    so a createMany failure can't leave the contract with lost flagged rows.
  //    Waived + acknowledged flags are untouched (preserved by the status filter).
  const newFlagData = deviations.map((d) => ({
    organizationId: orgId,
    contractId,
    clauseId:      d.clauseId ?? undefined,
    clauseTitle:   d.clauseTitle,
    deviationType: d.deviationType,
    severity:      d.severity,
    status:        "flagged",
    detectedBy:    userId ?? undefined,
  }))

  let created = 0
  await prisma.$transaction([
    prisma.contractDeviationFlag.deleteMany({
      where: { organizationId: orgId, contractId, status: "flagged" },
    }),
    ...(newFlagData.length > 0
      ? [prisma.contractDeviationFlag.createMany({ data: newFlagData })]
      : []),
  ])
  created = newFlagData.length

  return NextResponse.json({
    success: true,
    data: { created, message: `Re-scan complete. ${created} new flag(s) detected.` },
  })
})
