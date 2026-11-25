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
 *   ?lang=az|ru|en → the PDF's own labels (default az); the text is as written.
 *   ?signed=1&envelope=<id> → the signed copy: the text of the immutable
 *                version that envelope produced when its last signer signed,
 *                plus the signature sheet as the last page. Without
 *                `envelope`, the contract's canonical signed version. 404 when
 *                there is none — never the live (possibly amended) text
 *                under a signature sheet.
 *   ?tz=<IANA zone> → the sheet's times (the browser's zone); UTC otherwise.
 *
 * Auth: org-scoped via getOrgId. Gated by the "contracts" module.
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { orgHasModule, moduleDisabledResponse } from "@/lib/api-auth"
import { generateContractPdf } from "@/lib/clm/contract-pdf"
import type { SignatureSheet } from "@/lib/clm/signature-sheet"
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

    const { searchParams } = new URL(req.url)
    let renderedBody = contract.renderedBody
    let signatureSheet: SignatureSheet | null = null
    if (searchParams.get("signed") === "1") {
      const signed = await loadSignedCopy(orgId, contract.id, searchParams.get("envelope"))
      if (!signed) return NextResponse.json({ error: "This contract has no signed copy" }, { status: 404 })
      renderedBody = signed.body
      signatureSheet = signed.sheet
    }

    // FIX 5: PDF body-size guard — reject oversized bodies before generation to
    // prevent shared-infra DoS (pdfmake linearises the whole body in memory).
    // 300 000 chars ≈ ~200 A4 pages; real contracts rarely exceed 50 pages.
    const PDF_BODY_CHAR_LIMIT = 300_000
    const bodyLen = (renderedBody ?? "").length
    if (bodyLen > PDF_BODY_CHAR_LIMIT) {
      return NextResponse.json(
        { error: "Contract body too large to render as PDF — use the export/download option instead" },
        { status: 413 },
      )
    }

    const pdf = generateContractPdf({
      contract: { ...contract, renderedBody },
      organization,
      lang: searchParams.get("lang"),
      timeZone: searchParams.get("tz"),
      signatureSheet,
    })

    const disposition = searchParams.get("download") === "1" ? "attachment" : "inline"

    // Sanitize contractNumber for Content-Disposition header.
    const safeNumber = contract.contractNumber.replace(/[^\w.\-]/g, "_").slice(0, 50)
    const filename = signatureSheet ? `${safeNumber}-signed.pdf` : `${safeNumber}.pdf`

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

/**
 * The text a completed envelope bound people to, and who signed it. The sign
 * route mints that text as an immutable `signed` version created by
 * `esign:<envelopeId>` in the same transaction that completes the envelope,
 * so the pair is found by that mark — not by the contract's current body.
 */
async function loadSignedCopy(
  orgId: string,
  contractId: string,
  envelopeId: string | null,
): Promise<{ body: string | null; sheet: SignatureSheet } | null> {
  const version = await prisma.contractVersion.findFirst({
    where: envelopeId
      ? { organizationId: orgId, contractId, source: "signed", createdBy: `esign:${envelopeId}` }
      : { organizationId: orgId, contractId, source: "signed", isCanonicalSigned: true },
    orderBy: { versionNo: "desc" },
    select: { versionNo: true, contentHash: true, renderedBody: true, createdBy: true },
  })
  const signedBy = version?.createdBy?.startsWith("esign:") ? version.createdBy.slice("esign:".length) : null
  if (!version || !signedBy) return null

  const envelope = await prisma.esignEnvelope.findFirst({
    where: { id: signedBy, organizationId: orgId, contractId, status: "completed" },
    select: {
      sentAt: true,
      completedAt: true,
      signers: {
        orderBy: { order: "asc" },
        select: {
          order: true,
          fullName: true,
          email: true,
          role: true,
          status: true,
          signatureMethod: true,
          signaturePayload: true,
          viewedAt: true,
          signedAt: true,
          signedIpAddress: true,
        },
      },
    },
  })
  if (!envelope) return null

  return {
    body: version.renderedBody,
    sheet: {
      sentAt: envelope.sentAt,
      completedAt: envelope.completedAt,
      versionNo: version.versionNo,
      contentHash: version.contentHash,
      signers: envelope.signers,
    },
  }
}
