import { prisma } from "@/lib/prisma"
import { riskRelevantMentionWhere } from "@/lib/social/risk-mention-visibility"

export interface ViralCandidate {
  mentionId: string
  platform: string
  authorName: string | null
  authorHandle: string | null
  excerpt: string
  sentiment: string | null
  reach: number
  engagement: number
  reason: string  // why this flagged as viral
  score: number  // composite viral score
}

// Per-platform reach/engagement cutoffs (rough, tuned for most org sizes)
const PLATFORM_THRESHOLDS: Record<string, { reach: number; engagement: number }> = {
  twitter:   { reach: 10000, engagement: 200 },
  instagram: { reach:  5000, engagement: 100 },
  facebook:  { reach:  5000, engagement: 100 },
  telegram:  { reach:  3000, engagement:  50 },
  vkontakte: { reach:  3000, engagement:  50 },
  youtube:   { reach: 10000, engagement: 100 },
  tiktok:    { reach: 20000, engagement: 500 },
}

export interface ScoreInput {
  platform: string
  reach: number
  engagement: number
  sentiment: string | null
}

export interface ScoreResult {
  passes: boolean
  reachRatio: number
  engagementRatio: number
  sentimentMultiplier: number
  score: number
  reasons: string[]
}

export function scoreMention(input: ScoreInput): ScoreResult {
  const thresholds = PLATFORM_THRESHOLDS[input.platform] || { reach: 5000, engagement: 100 }
  const reach = input.reach || 0
  const engagement = input.engagement || 0
  const reachRatio = thresholds.reach > 0 ? reach / thresholds.reach : 0
  const engagementRatio = thresholds.engagement > 0 ? engagement / thresholds.engagement : 0
  const passesReach = reachRatio >= 1
  const passesEngagement = engagementRatio >= 1
  const passes = passesReach || passesEngagement
  const sentimentMultiplier = input.sentiment === "negative" ? 2 : input.sentiment === "neutral" ? 1 : 0.7
  const score = (reachRatio + engagementRatio) * sentimentMultiplier
  const reasons: string[] = []
  if (passesReach) reasons.push(`reach ${reach.toLocaleString()} (${Math.round(reachRatio * 100)}% of threshold)`)
  if (passesEngagement) reasons.push(`engagement ${engagement.toLocaleString()} (${Math.round(engagementRatio * 100)}% of threshold)`)
  return { passes, reachRatio, engagementRatio, sentimentMultiplier, score, reasons }
}

export async function findViralMentions(orgId: string, now: Date): Promise<ViralCandidate[]> {
  const recent = new Date(now.getTime() - 24 * 3600000)

  const mentions = await prisma.socialMention.findMany({
    where: {
      organizationId: orgId,
      purgedAt: null,
      deletedAtSource: null,
      AND: [riskRelevantMentionWhere()],
      createdAt: { gte: recent },
      status: { in: ["new", "reviewed"] },
    },
    select: {
      id: true, platform: true, authorName: true, authorHandle: true,
      text: true, sentiment: true, reach: true, engagement: true,
    },
    take: 50,
    orderBy: [{ engagement: "desc" }, { reach: "desc" }],
  })
  if (mentions.length === 0) return []

  const candidates: ViralCandidate[] = []
  for (const m of mentions) {
    const result = scoreMention({ platform: m.platform, reach: m.reach || 0, engagement: m.engagement || 0, sentiment: m.sentiment })
    if (!result.passes) continue

    candidates.push({
      mentionId: m.id,
      platform: m.platform,
      authorName: m.authorName,
      authorHandle: m.authorHandle,
      excerpt: m.text.slice(0, 200),
      sentiment: m.sentiment,
      reach: m.reach || 0,
      engagement: m.engagement || 0,
      reason: result.reasons.join(" + ") + (m.sentiment === "negative" ? " · NEGATIVE → high churn risk" : ""),
      score: result.score,
    })
  }
  return candidates.sort((a, b) => b.score - a.score).slice(0, 10)
}

export async function filterNewViralCandidates(
  orgId: string,
  candidates: ViralCandidate[],
  now: Date,
): Promise<ViralCandidate[]> {
  if (candidates.length === 0) return []
  const ids = candidates.map(c => c.mentionId)
  const existing = await prisma.aiShadowAction.findMany({
    where: {
      organizationId: orgId,
      featureName: { in: ["ai_auto_social_viral", "ai_auto_social_viral_shadow"] },
      entityType: "social_mention",
      entityId: { in: ids },
      OR: [{ approved: null }, { reviewedAt: { gte: new Date(now.getTime() - 3 * 86400000) } }],
    },
    select: { entityId: true },
  })
  const skip = new Set(existing.map((e: { entityId: string }) => e.entityId))
  return candidates.filter(c => !skip.has(c.mentionId))
}

export async function writeViralShadowAction(
  orgId: string,
  candidate: ViralCandidate,
  now: Date,
  shadow: boolean,
) {
  await prisma.aiShadowAction.create({
    data: {
      organizationId: orgId,
      featureName: shadow ? "ai_auto_social_viral_shadow" : "ai_auto_social_viral",
      entityType: "social_mention",
      entityId: candidate.mentionId,
      actionType: "viral_alert",
      payload: {
        platform: candidate.platform,
        authorHandle: candidate.authorHandle,
        authorName: candidate.authorName,
        excerpt: candidate.excerpt,
        sentiment: candidate.sentiment,
        reach: candidate.reach,
        engagement: candidate.engagement,
        reason: candidate.reason,
        viralScore: Math.round(candidate.score * 100) / 100,
      },
      approved: shadow ? null : true,
      reviewedAt: shadow ? null : now,
      reviewedBy: shadow ? null : "system",
    },
  })
}
