/**
 * CLM Slice 4c — GET /api/v1/contracts/:id/deviations
 *
 * List all deviation flags for a contract (org-scoped).
 * requireAuth contracts "read".
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

export const GET = withRlsAuth("contracts", "read", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { orgId } = auth
  const { id: contractId } = await params

  // Org-scope: verify the contract belongs to this org.
  const contract = await prisma.contract.findFirst({
    where: { id: contractId, organizationId: orgId },
    select: { id: true },
  })
  if (!contract) {
    return NextResponse.json({ error: "Contract not found" }, { status: 404 })
  }

  const flags = await prisma.contractDeviationFlag.findMany({
    where: { organizationId: orgId, contractId },
    orderBy: [{ severity: "desc" }, { detectedAt: "asc" }],
  })

  return NextResponse.json({ success: true, data: flags })
})
