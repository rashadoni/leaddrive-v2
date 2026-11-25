/**
 * GET /api/v1/public/portal-documents/:contractId/pdf — the counterparty's copy
 * of the contract or of one of its documents: the very bytes the CRM prints
 * (src/lib/clm/contract-pdf-files.ts).
 *   ?doc=<documentId> — a protocol or act that went for signing or is signed; without it, the contract;
 *   ?signed=1 — the signed copy with the signature sheet; ?lang, ?tz, ?download=1 as in the CRM.
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { PORTAL_DOCUMENT_STATUSES, portalContractWhere, portalDocumentsAccess } from "@/lib/portal-documents"
import { buildContractPdfFile, buildDocumentPdfFile, pdfResponseHeaders } from "@/lib/clm/contract-pdf-files"

export async function GET(req: Request, { params }: { params: Promise<{ contractId: string }> }) {
  const access = await portalDocumentsAccess()
  if (!access.ok) return NextResponse.json({ error: access.code, code: access.code }, { status: access.status })
  const { user, companyId } = access
  const { contractId } = await params
  const search = new URL(req.url).searchParams
  try {
    return await runWithTenant(user.organizationId, async () => {
      // The contract must be this company's and agreed before anything of it is printed.
      const visible = await prisma.contract.findFirst({ where: portalContractWhere(user.organizationId, companyId, contractId), select: { id: true } })
      if (!visible) return NextResponse.json({ error: "Not found" }, { status: 404 })
      const docId = search.get("doc")
      const opts = { lang: search.get("lang"), tz: search.get("tz"), signed: search.get("signed") === "1" }
      const file = docId
        ? await buildDocumentPdfFile(user.organizationId, contractId, docId, { ...opts, visibleStatuses: PORTAL_DOCUMENT_STATUSES })
        : await buildContractPdfFile(user.organizationId, contractId, opts)
      if (!file.ok) return NextResponse.json({ error: file.error }, { status: file.status })
      return new NextResponse(Buffer.from(file.bytes), { headers: pdfResponseHeaders(file.filename, search.get("download") === "1") })
    })
  } catch (e) {
    console.error("[portal-documents/:contractId/pdf GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
