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
import { orgHasModule, moduleDisabledResponse } from "@/lib/api-auth"
import { withRls } from "@/lib/with-rls"
import { buildContractPdfFile, pdfResponseHeaders } from "@/lib/clm/contract-pdf-files"

export const GET = withRls(async (req, { orgId, session }, { params }: { params: Promise<{ id: string }> }) => {
  if (session?.role !== "superadmin" && !(await orgHasModule(orgId, "contracts")))
    return moduleDisabledResponse("contracts")

  const { id } = await params
  try {
    const search = new URL(req.url).searchParams
    const file = await buildContractPdfFile(orgId, id, {
      lang: search.get("lang"),
      tz: search.get("tz"),
      signed: search.get("signed") === "1",
      envelopeId: search.get("envelope"),
    })
    if (!file.ok) return NextResponse.json({ error: file.error }, { status: file.status })
    return new NextResponse(Buffer.from(file.bytes), { headers: pdfResponseHeaders(file.filename, search.get("download") === "1") })
  } catch (e) {
    console.error("[contracts/:id/pdf GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
