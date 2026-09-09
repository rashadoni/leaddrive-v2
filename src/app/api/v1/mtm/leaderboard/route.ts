import { NextResponse } from "next/server"
import { withRouteFieldWebRlsAuth } from "@/lib/with-mtm-rls-auth"
import { computeMtmRankings } from "@/lib/leaderboard/mtm"

// F-13: was N+1 (1 + 9×N queries — ~451 for 50 agents). Now O(1):
// 1 findMany agents + 6 groupBy aggregations regardless of N agents.
// The aggregation logic now lives in `src/lib/leaderboard/mtm.ts`
// (`computeMtmRankings`), shared with the KPI Arena leaderboard. This route is
// a thin period→startDate adapter that preserves the original response shape.
//
// Web-session only: mobile tokens and API keys must remain rejected, while
// Route & Field tenants no longer depend on the legacy broad `mtm`
// entitlement. Role is not narrowed here because the linked team board is
// intentionally visible to every authorized Route & Field web user.
export const GET = withRouteFieldWebRlsAuth("read", async (req, { orgId, principalType }) => {
  // `withRouteFieldWebRlsAuth` keeps the common web/API-key authentication
  // boundary, but this legacy team board was deliberately session-only before
  // the capability split. Preserve that compatibility/security contract.
  if (principalType !== "session") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const period = searchParams.get("period") || "monthly" // weekly, monthly, all

  try {
    const now = new Date()
    let startDate: Date | undefined
    if (period === "weekly") {
      startDate = new Date(now)
      startDate.setDate(now.getDate() - 7)
    } else if (period === "monthly") {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1)
    }

    const ranked = await computeMtmRankings(orgId, startDate, now)
    return NextResponse.json({ success: true, data: { rankings: ranked, period } })
  } catch (e) {
    console.error("[MTM/leaderboard GET]", e)
    return NextResponse.json({ error: "Failed to fetch leaderboard" }, { status: 500 })
  }
})
