import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

const MINUTES_PER_ACTION: Record<string, number> = {
  ai_auto_payment_reminder_shadow: 5,
  ai_auto_payment_reminder: 5,
  ai_auto_acknowledge_shadow: 3,
  ai_auto_acknowledge: 3,
  ai_auto_followup_shadow: 2,
  ai_auto_followup: 2,
  ai_auto_renewal_shadow: 30,
  ai_auto_renewal: 30,
  ai_auto_hot_lead_shadow: 5,
  ai_auto_hot_lead: 5,
  ai_auto_triage_shadow: 2,
  ai_auto_triage: 2,
  ai_auto_stage_advance_shadow: 2,
  ai_auto_stage_advance: 2,
  ai_auto_sentiment_shadow: 5,
  ai_auto_sentiment: 5,
  ai_auto_kb_close_shadow: 4,
  ai_auto_kb_close: 4,
  ai_auto_duplicate_shadow: 3,
  ai_auto_duplicate: 3,
  ai_auto_credit_limit_shadow: 10,
  ai_auto_credit_limit: 10,
  ai_auto_meeting_recap_shadow: 15,
  ai_auto_meeting_recap: 15,
  ai_auto_social_reply_shadow: 5,
  ai_auto_social_reply: 5,
  ai_auto_social_viral_shadow: 5,
  ai_auto_social_viral: 5,
}

// Compute urgency server-side (matches client urgencyLevel logic)
function urgency(featureName: string, payload: any): "critical" | "high" | "normal" {
  const f = featureName.replace("ai_auto_", "").replace("_shadow", "")
  const p = payload || {}
  if (f === "payment_reminder") {
    const d = p.daysOverdue || 0
    if (d >= 30) return "critical"
    if (d >= 7) return "high"
  } else if (f === "acknowledge") {
    const pct = p.percentElapsed || 0
    if (pct >= 90) return "critical"
    if (pct >= 70) return "high"
  } else if (f === "renewal") {
    const d = p.daysUntilEnd ?? 30
    if (d <= 7) return "critical"
    if (d <= 14) return "high"
  } else if (f === "hot_lead") {
    const s = p.score || 0
    if (s >= 95) return "critical"
    if (s >= 85) return "high"
  } else if (f === "credit_limit") {
    const pct = p.percentUsed || 0
    if (pct >= 1.0 || (p.overdueCount || 0) >= 3) return "critical"
    if (pct >= 0.9 || (p.overdueCount || 0) >= 1) return "high"
  } else if (f === "sentiment") {
    const c = p.confidence || 0
    if (c >= 0.9) return "critical"
    if (c >= 0.75) return "high"
  } else if (f === "social_viral") {
    const s = p.viralScore || 0
    if (p.sentiment === "negative" && s >= 2) return "critical"
    if (s >= 2) return "high"
  } else if (f === "triage") {
    if (p.suggestedPriority === "urgent") return "critical"
    if (p.suggestedPriority === "high") return "high"
  } else if (f === "stage_advance") {
    if ((p.probability || 0) >= 80 && (p.daysInStage || 0) >= 30) return "critical"
    if ((p.probability || 0) >= 70 || (p.daysInStage || 0) >= 21) return "high"
  }
  return "normal"
}

export const GET = withRls(async (_req, { orgId }) => {
  const now = new Date()
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const prevMonthStart = new Date(monthStart)
  prevMonthStart.setMonth(prevMonthStart.getMonth() - 1)
  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)

  const [approvedThis, rejectedThis, approvedPrev, pendingTotal, pendingRows, newToday] = await Promise.all([
    prisma.aiShadowAction.findMany({
      where: { organizationId: orgId, approved: true, reviewedAt: { gte: monthStart } },
      select: { featureName: true },
    }),
    prisma.aiShadowAction.count({
      where: { organizationId: orgId, approved: false, reviewedAt: { gte: monthStart } },
    }),
    prisma.aiShadowAction.count({
      where: { organizationId: orgId, approved: true, reviewedAt: { gte: prevMonthStart, lt: monthStart } },
    }),
    prisma.aiShadowAction.count({
      where: { organizationId: orgId, approved: null },
    }),
    prisma.aiShadowAction.findMany({
      where: { organizationId: orgId, approved: null },
      select: { featureName: true, payload: true, createdAt: true },
      take: 500,
      orderBy: { createdAt: "desc" },
    }),
    prisma.aiShadowAction.count({
      where: { organizationId: orgId, createdAt: { gte: dayStart } },
    }),
  ])

  // Aggregate approved
  const byFeature: Record<string, number> = {}
  let minutesSaved = 0
  for (const a of approvedThis) {
    byFeature[a.featureName] = (byFeature[a.featureName] || 0) + 1
    minutesSaved += MINUTES_PER_ACTION[a.featureName] || 2
  }

  // Aggregate pending
  const pendingByFeature: Record<string, number> = {}
  const pendingByUrgency: Record<string, number> = { critical: 0, high: 0, normal: 0 }
  for (const a of pendingRows) {
    pendingByFeature[a.featureName] = (pendingByFeature[a.featureName] || 0) + 1
    pendingByUrgency[urgency(a.featureName, a.payload)]++
  }

  // Top 3 by count (approved + pending combined for dashboard context)
  const topApprovedFeatures = Object.entries(byFeature)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key, count]) => ({ key, count }))

  const topPendingFeatures = Object.entries(pendingByFeature)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([key, count]) => ({ key, count }))

  const trendDelta = approvedPrev > 0
    ? Math.round(((approvedThis.length - approvedPrev) / approvedPrev) * 100)
    : (approvedThis.length > 0 ? 100 : 0)

  return NextResponse.json({
    data: {
      approvedThisMonth: approvedThis.length,
      approvedPrevMonth: approvedPrev,
      rejectedThisMonth: rejectedThis,
      pending: pendingTotal,
      pendingByFeature,
      pendingByUrgency,
      topPendingFeatures,
      topApprovedFeatures,
      newToday,
      minutesSaved,
      byFeature,
      trendDelta,
    },
  })
})
