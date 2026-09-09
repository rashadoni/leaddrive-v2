import { NextRequest, NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { loadBoardReportBundle } from "@/lib/tasks/board-report-bundle"
import { boardBundleToPptxModel } from "@/lib/export/board-report-to-pptx"
import { buildReportPptx } from "@/lib/export/report-pptx"
import { resolveOrgPptxBranding } from "@/lib/export/branding"
import { contentDispositionAttachment } from "@/lib/export/tabular"
import type { Role } from "@/lib/permissions"

/**
 * GET /api/v1/divisions/[id]/analytics/pptx?range=30d&assignee=&type=&sections=
 *
 * Branded PowerPoint export of a board / department report. Reuses
 * loadBoardReportBundle so it has the EXACT same org-scoping + board-access gating
 * as the on-screen report (and the analytics JSON route) — the deck can never
 * surface data the report would hide. Always pulls flow metrics for the richest deck.
 */
function rangeLabel(range: string | null): string {
  if (range === "7d") return "Last 7 days"
  if (range === "90d") return "Last 90 days"
  return "Last 30 days"
}

export const GET = withRlsAuth("tasks", "read", async (req: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const { searchParams } = new URL(req.url)
  const range = searchParams.get("range")
  try {
    const res = await loadBoardReportBundle(auth.orgId, auth.userId, auth.role as Role, id, {
      range,
      assignee: searchParams.get("assignee"),
      type: searchParams.get("type"),
      sections: searchParams.get("sections"),
      withFlow: true,
    })
    if (!res.ok) return NextResponse.json({ error: "Not found" }, { status: res.status })

    const branding = await resolveOrgPptxBranding(auth.orgId)
    const generatedAt = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    const model = boardBundleToPptxModel(res.data, res.meta, branding, generatedAt, rangeLabel(range))
    const buf = await buildReportPptx(model)

    const safeKey = (res.meta.key || "board").replace(/[^A-Za-z0-9_-]/g, "")
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": contentDispositionAttachment(`${safeKey}-report.pptx`),
        "Content-Length": String(buf.length),
        "Cache-Control": "no-store",
      },
    })
  } catch (e) {
    console.error("[divisions analytics pptx]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
