/**
 * CLM Slice 1c — Contract PDF download.
 *
 * GET /api/v1/contracts/:id/pdf
 *
 * Loads the contract (org-scoped, with company) + org branding, calls
 * `generateContractPdf`, streams back `application/pdf`.
 *
 * Query params:
 *   ?download=1 → forces `Content-Disposition: attachment` (save to disk);
 *                default is `inline` (open in browser tab).
 *
 * Auth: org-scoped via getOrgId. Gated by the "contracts" module.
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { orgHasModule, moduleDisabledResponse } from "@/lib/api-auth"
import { generateContractPdf } from "@/lib/clm/contract-pdf"
import { withRls } from "@/lib/with-rls"

export const GET = withRls(async (req, { orgId, session }, { params }: { params: Promise<{ id: string }> }) => {
  if (session?.role !== "superadmin" && !(await orgHasModule(orgId, "contracts")))
    return moduleDisabledResponse("contracts")

  const { id } = await params

  try {
    const [contract, organization] = await Promise.all([
      prisma.contract.findFirst({
        where: { id, organizationId: orgId },
        include: {
          company: { select: { name: true } },
        },
      }),
      prisma.organization.findUnique({
        where: { id: orgId },
        select: { name: true, logo: true, branding: true },
      }),
    ])

    if (!contract) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (!organization) return NextResponse.json({ error: "Org not found" }, { status: 500 })

    // FIX 5: PDF body-size guard — reject oversized bodies before generation to
    // prevent shared-infra DoS (pdfmake linearises the whole body in memory).
    // 300 000 chars ≈ ~200 A4 pages; real contracts rarely exceed 50 pages.
    const PDF_BODY_CHAR_LIMIT = 300_000
    const bodyLen = (contract.renderedBody ?? "").length
    if (bodyLen > PDF_BODY_CHAR_LIMIT) {
      return NextResponse.json(
        { error: "Contract body too large to render as PDF — use the export/download option instead" },
        { status: 413 },
      )
    }

    const pdf = generateContractPdf({ contract, organization })

    const { searchParams } = new URL(req.url)
    const disposition = searchParams.get("download") === "1" ? "attachment" : "inline"

    // Sanitize contractNumber for Content-Disposition header.
    const safeNumber = contract.contractNumber.replace(/[^\w.\-]/g, "_").slice(0, 50)
    const filename = `${safeNumber}.pdf`

    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="${filename}"`,
        // Contracts are sensitive — do not let a CDN cache them.
        "Cache-Control": "private, no-store",
      },
    })
  } catch (e) {
    console.error("[contracts/:id/pdf GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
