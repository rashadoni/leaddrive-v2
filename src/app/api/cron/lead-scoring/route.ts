import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { isAiFeatureEnabled } from "@/lib/ai/budget"
import { recalculateOrgLeadScores } from "@/lib/ai/lead-scoring"
import { runWithRlsBypass } from "@/lib/rls-context"

/**
 * Lead Scoring Cron Endpoint
 * Called by external cron (e.g. daily or every 6 hours)
 * Recalculates lead scores using enhanced heuristic model.
 */
export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  try {
    let totalUpdated = 0

    const orgs = await prisma.organization.findMany({
      where: { isActive: true },
      select: { id: true },
    })

    for (const org of orgs) {
      // Skip if org has features configured but ai_lead_scoring is not among them
      const enabled = await isAiFeatureEnabled(org.id, "ai_lead_scoring")
      if (!enabled) continue

      const updated = await recalculateOrgLeadScores(org.id)
      totalUpdated += updated
    }

    return NextResponse.json({
      success: true,
      data: { totalUpdated, timestamp: new Date().toISOString() },
    })
  } catch (e) {
    console.error("Lead Scoring cron error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
  })
}
