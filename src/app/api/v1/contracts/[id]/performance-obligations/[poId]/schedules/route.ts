/**
 * CLM Slice 5b-1 — Revenue recognition schedule lines read
 *
 * GET /api/v1/contracts/[id]/performance-obligations/[poId]/schedules
 *   List a PO's schedule lines with their recognition entries.
 *   Org-scoped: verifies contract belongs to org, then PO belongs to contract.
 *   requireAuth("contracts", "read")
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

export const GET = withRlsAuth("contracts", "read", async (_req, auth, { params }: { params: Promise<{ id: string; poId: string }> }) => {
  const orgId = auth.orgId
  const { id, poId } = await params

  try {
    // Verify contract belongs to org
    const contract = await prisma.contract.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true },
    })
    if (!contract) return NextResponse.json({ error: "Not found" }, { status: 404 })

    // Verify PO belongs to contract + org
    const po = await prisma.performanceObligation.findFirst({
      where: { id: poId, contractId: id, organizationId: orgId },
      select: {
        id:               true,
        description:      true,
        recognitionMethod: true,
        allocatedAmount:  true,
        currency:         true,
        status:           true,
      },
    })
    if (!po) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const schedules = await prisma.revenueRecognitionSchedule.findMany({
      where: {
        performanceObligationId: poId,
        organizationId:          orgId,
      },
      orderBy: { lineNumber: "asc" },
      include: {
        entries: {
          orderBy: { postedAt: "asc" },
          select: {
            id:              true,
            recognizedAmount: true,
            currency:        true,
            postedAt:        true,
            postedBy:        true,
            journalRef:      true,
            note:            true,
            createdAt:       true,
          },
        },
      },
    })

    return NextResponse.json({
      success: true,
      data: {
        performanceObligation: po,
        schedules,
      },
    })
  } catch (e) {
    console.error("[performance-obligations/[poId]/schedules GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
