import { NextRequest, NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { loadBoardReportBundle } from "@/lib/tasks/board-report-bundle"
import type { Role } from "@/lib/permissions"

/**
 * GET /api/v1/divisions/[id]/analytics?range=30d&assignee=&type=&flow=1&sections=
 *
 * Board / department report bundle (Board Reports). Org-scoped + board-access
 * gated; a DEPARTMENT aggregates over its visible child sections. All the scoping
 * + computation lives in loadBoardReportBundle so the PPTX export shares it
 * identically. Tier-2 flow metrics are opt-in via ?flow=1.
 */
export const GET = withRlsAuth("tasks", "read", async (req: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const { searchParams } = new URL(req.url)
  try {
    const res = await loadBoardReportBundle(auth.orgId, auth.userId, auth.role as Role, id, {
      range: searchParams.get("range"),
      assignee: searchParams.get("assignee"),
      type: searchParams.get("type"),
      sections: searchParams.get("sections"),
      withFlow: searchParams.get("flow") === "1",
    })
    if (!res.ok) return NextResponse.json({ error: "Not found" }, { status: res.status })
    return NextResponse.json({ success: true, data: res.data })
  } catch (e) {
    console.error("[divisions analytics GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
