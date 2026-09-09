/**
 * Contract Editor — Slice 1, Step 4. Editor-data loader.
 *
 * GET /api/v1/contracts/:id/editor — returns the contract's editable body as
 * HTML, NON-DESTRUCTIVELY seeded from `renderedBody` when `bodyHtml` is still
 * null (legacy contracts), via `getOrSeedBodyHtml`. Seeding here never persists
 * — the body is only written on an explicit save (PUT /body, Step 3).
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getOrSeedBodyHtml } from "@/lib/clm/seed-body-html"
import { withRlsAuth } from "@/lib/with-rls"

export const GET = withRlsAuth("contracts", "read", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { orgId } = auth
  const { id } = await params

  try {
    const contract = await prisma.contract.findFirst({
      where: { id, organizationId: orgId },
      select: {
        id: true,
        title: true,
        contractNumber: true,
        status: true,
        bodyHtml: true,
        renderedBody: true,
      },
    })
    if (!contract) return NextResponse.json({ error: "Not found" }, { status: 404 })

    return NextResponse.json({
      success: true,
      data: {
        id: contract.id,
        title: contract.title,
        contractNumber: contract.contractNumber,
        status: contract.status,
        bodyHtml: getOrSeedBodyHtml(contract), // seeded → editable even for legacy
      },
    })
  } catch (e) {
    console.error("[contracts/:id/editor GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
