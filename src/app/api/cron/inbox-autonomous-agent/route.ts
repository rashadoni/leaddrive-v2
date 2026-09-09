import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { runAutonomousInboxAgent } from "@/lib/inbox/autonomous-agent-cron"
import { repairClosedTikTokQualifications } from "@/lib/inbox/repair-closed-qualifications"

export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
    const authError = requireCronAuth(req)
    if (authError) return authError

    try {
      const qualificationRepair = await repairClosedTikTokQualifications(new Date())
      const result = await runAutonomousInboxAgent(prisma, { now: new Date() })
      return NextResponse.json({ ok: true, qualificationRepair, ...result })
    } catch (error) {
      console.error("[inbox-autonomous-agent cron]", error)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  })
}
