/**
 * GET /api/v1/contracts/:id/documents/:docId/pdf — a price protocol or an
 * acceptance act as PDF (src/lib/clm/contract-document-pdf.ts).
 *   ?lang=az|ru|en — the document's words (default az); ?download=1 — save, else open.
 */
import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { buildDocumentPdfFile, pdfResponseHeaders } from "@/lib/clm/contract-pdf-files"

export const GET = withRlsAuth("contracts", "read", async (req, { orgId }, { params }: { params: Promise<{ id: string; docId: string }> }) => {
  const { id: contractId, docId } = await params
  try {
    const search = new URL(req.url).searchParams
    const file = await buildDocumentPdfFile(orgId, contractId, docId, {
      lang: search.get("lang"),
      tz: search.get("tz"),
      signed: search.get("signed") === "1",
    })
    if (!file.ok) return NextResponse.json({ error: file.error }, { status: file.status })
    return new NextResponse(Buffer.from(file.bytes), { headers: pdfResponseHeaders(file.filename, search.get("download") === "1") })
  } catch (e) {
    console.error("[contracts/:id/documents/:docId/pdf GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
