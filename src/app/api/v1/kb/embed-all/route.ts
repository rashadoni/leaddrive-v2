import { NextResponse } from "next/server"
import { withRls } from "@/lib/with-rls"
import { embedAllKbArticles } from "@/lib/ai/embeddings"

/**
 * POST /api/v1/kb/embed-all
 * Backfill embeddings for all published KB articles.
 * Admin-only, run once or after bulk article changes.
 */
export const POST = withRls(async (_req, { orgId }) => {
  try {
    const count = await embedAllKbArticles(orgId)
    return NextResponse.json({ success: true, data: { articlesEmbedded: count } })
  } catch (err: any) {
    console.error("Embed all error:", err)
    return NextResponse.json({ error: err.message || "Embedding failed" }, { status: 500 })
  }
})
