/**
 * GET /api/v1/contracts/:id/documents/:docId/pdf — a price protocol or an
 * acceptance act as PDF (src/lib/clm/contract-document-pdf.ts).
 *   ?lang=az|ru|en — the document's words (default az); ?download=1 — save, else open.
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { generateContractDocumentPdf } from "@/lib/clm/contract-document-pdf"
import { DOCUMENT_SELECT, LINE_SELECT, documentFacts, lineRow, loadContractForDocuments, loadInvoiceSettings } from "@/lib/clm/contract-documents-server"

export const GET = withRlsAuth("contracts", "read", async (req, { orgId }, { params }: { params: Promise<{ id: string; docId: string }> }) => {
  const { id: contractId, docId } = await params
  try {
    const [doc, contract, settings] = await Promise.all([
      prisma.contractDocument.findFirst({
        where: { id: docId, contractId, organizationId: orgId },
        select: { ...DOCUMENT_SELECT, lines: { orderBy: { position: "asc" }, select: LINE_SELECT } },
      }),
      loadContractForDocuments(orgId, contractId),
      loadInvoiceSettings(orgId),
    ])
    if (!doc || !contract) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const search = new URL(req.url).searchParams
    const lang = search.get("lang") === "ru" || search.get("lang") === "en" ? (search.get("lang") as "ru" | "en") : "az"
    const pdf = generateContractDocumentPdf({
      facts: documentFacts(doc, contract, settings),
      lines: doc.lines.map(lineRow),
      currency: doc.currency,
      lang,
    })
    const base = `${contract.contractNumber}-${doc.kind === "price_protocol" ? "protocol" : "act"}-${doc.number}`.replace(/[^\w.\-]/g, "_").slice(0, 80)
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${search.get("download") === "1" ? "attachment" : "inline"}; filename="${base}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    })
  } catch (e) {
    console.error("[contracts/:id/documents/:docId/pdf GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
