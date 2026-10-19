import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { demoSocialReleaseHealth, releaseDueDemoSocialConnections } from "@/lib/demo-center/demo-social-release"

/**
 * Every five minutes: unbind the prospects' Facebook Pages whose demo is over
 * — unsubscribe the Page from our app, revoke the grant, wipe our copy
 * (src/lib/demo-center/demo-social-release.ts). With no connections it reads
 * one empty table and does nothing.
 */
export async function POST(req: NextRequest) {
  // Authenticate first: the engine reads every connection under RLS bypass.
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  // The deploy calls this to prove the schedule answers and that nothing is
  // stranded. It reads and changes nothing, and sends nothing to Meta.
  if (new URL(req.url).searchParams.get("smoke") === "1") {
    try {
      const health = await demoSocialReleaseHealth()
      return NextResponse.json({ success: true, smoke: true, ...health })
    } catch (error) {
      console.error(`[demo-social-release] smoke failed: ${error instanceof Error ? error.name : "error"}`)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  }

  try {
    const run = await releaseDueDemoSocialConnections()
    return NextResponse.json({ success: true, ...run })
  } catch (error) {
    // The name only: a database error's message can quote the row.
    console.error(`[demo-social-release] failed: ${error instanceof Error ? error.name : "error"}`)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
