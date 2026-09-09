import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

const MAX_DAYS = 365

type AnalyticsResponseRow = Prisma.SurveyResponseGetPayload<{
  select: {
    id: true
    score: true
    category: true
    comment: true
    commentSentiment: true
    channel: true
    answers: true
    completedAt: true
  }
}>

/**
 * GET /api/v1/surveys/[id]/analytics?days=30
 *
 * Returns response volume + NPS/CSAT trend over time, plus per-question
 * aggregates and a simple word-frequency pull from open-text comments. The
 * detail-page dashboard renders this without hitting the per-response list.
 */
export const GET = withRlsAuth("campaigns", "read", async (req: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { id } = await params

  const days = Math.min(MAX_DAYS, Math.max(7, parseInt(req.nextUrl.searchParams.get("days") || "30", 10)))
  const since = new Date(Date.now() - days * 86400_000)

  const survey = await prisma.survey.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, type: true, totalSent: true, questions: true },
  })
  if (!survey) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const responses: AnalyticsResponseRow[] = await prisma.surveyResponse.findMany({
    where: { surveyId: id, organizationId: orgId, completedAt: { gte: since } },
    select: {
      id: true,
      score: true,
      category: true,
      comment: true,
      commentSentiment: true,
      channel: true,
      answers: true,
      completedAt: true,
    },
    take: 5000,
  })

  // Daily / weekly buckets depending on range
  const bucketMode: "day" | "week" = days <= 60 ? "day" : "week"
  const bucketKey = (d: Date): string => {
    if (bucketMode === "day") return d.toISOString().slice(0, 10)
    const copy = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    const dow = copy.getUTCDay() || 7
    copy.setUTCDate(copy.getUTCDate() - (dow - 1))
    return copy.toISOString().slice(0, 10)
  }

  const trendMap = new Map<string, { day: string; total: number; promoters: number; passives: number; detractors: number; sumScore: number; scoredCount: number }>()
  const stepMs = bucketMode === "day" ? 86400_000 : 7 * 86400_000
  for (let t = Date.now(); t >= since.getTime(); t -= stepMs) {
    const key = bucketKey(new Date(t))
    if (!trendMap.has(key)) trendMap.set(key, { day: key, total: 0, promoters: 0, passives: 0, detractors: 0, sumScore: 0, scoredCount: 0 })
  }

  // Channel + category aggregates
  const byChannel = new Map<string, number>()
  let promoters = 0, passives = 0, detractors = 0
  let totalScore = 0, scoredCount = 0
  const wordCounts = new Map<string, number>()
  const commentSentiment = { positive: 0, neutral: 0, negative: 0, unknown: 0 }

  for (const r of responses) {
    const bk = bucketKey(r.completedAt)
    const bucket = trendMap.get(bk)
    if (bucket) {
      bucket.total++
      if (r.category === "promoter") bucket.promoters++
      else if (r.category === "passive") bucket.passives++
      else if (r.category === "detractor") bucket.detractors++
      if (r.score !== null) { bucket.sumScore += r.score; bucket.scoredCount++ }
    }
    if (r.category === "promoter") promoters++
    else if (r.category === "passive") passives++
    else if (r.category === "detractor") detractors++
    if (r.score !== null) { totalScore += r.score; scoredCount++ }
    if (r.channel) byChannel.set(r.channel, (byChannel.get(r.channel) || 0) + 1)

    if (r.comment) {
      // Crude word frequency: 4+ char words, lowercased, stripped of punctuation
      const words = r.comment.toLowerCase().replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter(w => w.length >= 4)
      for (const w of words) wordCounts.set(w, (wordCounts.get(w) || 0) + 1)

      const cs = r.commentSentiment as "positive" | "neutral" | "negative" | null
      if (cs === "positive" || cs === "neutral" || cs === "negative") commentSentiment[cs]++
      else commentSentiment.unknown++
    }
  }

  const trend = Array.from(trendMap.values())
    .sort((a, b) => a.day.localeCompare(b.day))
    .map(b => ({
      day: b.day,
      total: b.total,
      promoters: b.promoters,
      passives: b.passives,
      detractors: b.detractors,
      avgScore: b.scoredCount > 0 ? Number((b.sumScore / b.scoredCount).toFixed(2)) : null,
      nps: b.total > 0 ? Math.round(((b.promoters - b.detractors) / b.total) * 100) : null,
    }))

  const totalResponses = responses.length
  const nps = totalResponses > 0 ? Math.round(((promoters - detractors) / totalResponses) * 100) : null
  const avgScore = scoredCount > 0 ? Number((totalScore / scoredCount).toFixed(2)) : null
  const responseRate = survey.totalSent > 0 ? Number(((totalResponses / survey.totalSent) * 100).toFixed(1)) : null

  const topWords = Array.from(wordCounts.entries())
    .filter(([w]) => !STOPWORDS.has(w))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([word, count]) => ({ word, count }))

  return NextResponse.json({
    success: true,
    data: {
      range: { days, since: since.toISOString() },
      summary: {
        totalSent: survey.totalSent,
        totalResponses,
        responseRate,
        nps,
        avgScore,
        promoters,
        passives,
        detractors,
      },
      channels: Array.from(byChannel.entries()).map(([channel, count]) => ({ channel, count })),
      commentSentiment,
      trend,
      topWords,
    },
  })
})

// Bilingual stopword list (en/ru/az) — keeps top-words signal-rich.
const STOPWORDS = new Set<string>([
  // English
  "this", "that", "with", "from", "have", "your", "have", "been", "they", "their", "them", "what", "which",
  "would", "could", "should", "very", "just", "more", "than", "then", "these", "those", "into", "when", "where",
  "while", "about", "after", "before", "some", "such", "also", "only", "much", "many", "most", "good", "bad",
  // Russian
  "это", "этот", "эта", "это", "очень", "была", "были", "было", "если", "когда", "потому", "также", "тоже",
  "только", "чтобы", "более", "менее", "тогда", "сейчас", "сегодня", "вчера", "завтра", "ещё", "уже", "пока",
  // Azerbaijani
  "olan", "olur", "etmək", "üçün", "bunu", "bunun", "həmin", "burada", "orada", "indi", "sonra", "əvvəl",
])
