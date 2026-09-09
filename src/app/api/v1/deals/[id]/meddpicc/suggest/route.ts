/**
 * D3 (Creatio 10X roadmap) — POST /api/v1/deals/[id]/meddpicc/suggest
 *
 * On-demand: the advisor drafts MEDDPICC blocks from the deal's correspondence.
 * Nothing is persisted — the deal card merges the draft into the editor and the
 * manager confirms with the existing Save (PUT /deals/[id]).
 */
import { NextResponse } from "next/server"
import { withRls } from "@/lib/with-rls"
import { suggestMeddpiccFromCorrespondence } from "@/lib/ai/meddpicc-suggest"

export const POST = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  try {
    const result = await suggestMeddpiccFromCorrespondence(orgId, id)
    if (!result) return NextResponse.json({ error: "Deal not found" }, { status: 404 })
    return NextResponse.json({ success: true, data: result })
  } catch {
    return NextResponse.json({ error: "AI suggestion failed" }, { status: 502 })
  }
})
