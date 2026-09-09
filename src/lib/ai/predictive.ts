import { prisma } from "@/lib/prisma"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { applyAdjustment, getAdjustment } from "@/lib/adaptive-ai/adjustments"
import { canonicalDealStage, resolveStageVocabulary, type StageVocabulary } from "@/lib/deal-stage-normalization"
import { wonStageNames, lostStageNames } from "@/lib/marketing-attribution/won-stages"

/**
 * Which stage strings this org actually uses for won and lost.
 *
 * Every query below used to name `"WON"` and `"LOST"` directly. Stage is a free
 * string — pipelines are configured per org, and rows also arrive from imports
 * and seeds — so a second spelling of the same stage is normal, and in
 * production `CLOSED_WON` sits alongside `WON`. Under literal matching that
 * deal was absent from history, absent from revenue, and simultaneously part of
 * the open pipeline it had already left.
 */
async function stageVocabulary(orgId: string): Promise<StageVocabulary> {
  const [configuredWon, configuredLost, stored] = await Promise.all([
    wonStageNames(orgId),
    lostStageNames(orgId),
    prisma.deal.findMany({
      where: { organizationId: orgId },
      distinct: ["stage"],
      select: { stage: true },
    }),
  ])
  return resolveStageVocabulary(
    stored.map((d: { stage: string }) => d.stage),
    configuredWon,
    configuredLost,
  )
}

// ── Deal Win Probability ──

export interface PredictionFactor {
  key: string
  params?: Record<string, string | number>
}

export interface DealPrediction {
  winProbability: number
  expectedCloseDate: Date | null
  riskFactors: PredictionFactor[]
  positiveFactors: PredictionFactor[]
  confidence: number
}

function daysSince(date: Date | null | undefined): number {
  if (!date) return 999
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000)
}

export async function predictDealWin(dealId: string, orgId: string): Promise<DealPrediction> {
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, organizationId: orgId },
    include: {
      pipeline: { include: { stages: true } },
    },
  })
  if (!deal) {
    return { winProbability: 0, expectedCloseDate: null, riskFactors: [{ key: "dealNotFound" }], positiveFactors: [], confidence: 0 }
  }

  /*
   * A closed deal has an outcome, not a forecast.
   *
   * Without this the card on a won deal read "win probability 44%" next to a
   * risk of "no activity for 17 days" — the model scoring a race that finished
   * a fortnight ago. Nothing downstream asked whether the deal was still open,
   * because every stage test here compared against the literal "WON" and a
   * deal stored as CLOSED_WON never looked closed to any of them.
   *
   * Confidence is 100 on purpose: this is a fact being reported, and the only
   * way to be wrong about it is for the stage itself to be wrong.
   */
  const vocabulary = await stageVocabulary(orgId)
  const canonical = canonicalDealStage(deal.stage, vocabulary.wonStages, vocabulary.lostStages)
  if (canonical === "WON" || canonical === "LOST") {
    return {
      winProbability: canonical === "WON" ? 100 : 0,
      expectedCloseDate: deal.expectedClose ?? null,
      riskFactors: [],
      positiveFactors: [],
      confidence: 100,
    }
  }

  const activities = await prisma.activity.findMany({
    where: { organizationId: orgId, relatedType: "deal", relatedId: dealId },
    orderBy: { createdAt: "desc" },
  })

  // Stage probability — matched by meaning, so a renamed or aliased stage still
  // finds its configured probability instead of silently falling back.
  const stageProbability =
    deal.pipeline?.stages?.find(
      (s: any) =>
        canonicalDealStage(s.name, vocabulary.wonStages, vocabulary.lostStages) === canonical,
    )?.probability || deal.probability || 0

  // Activity metrics
  const lastActivityDate = activities[0]?.createdAt || null
  const daysSinceLastActivity = daysSince(lastActivityDate)
  const activityCount = activities.length
  const dealAge = daysSince(deal.createdAt)

  // Historical data
  const historicalDeals = await prisma.deal.findMany({
    where: { organizationId: orgId, stage: { in: vocabulary.closedStages } },
    select: { stage: true, valueAmount: true, probability: true },
  })
  const wonCount = historicalDeals.filter((d: any) =>
    vocabulary.wonStages.includes(d.stage),
  ).length
  const totalClosed = historicalDeals.length

  // Heuristic scoring
  let score = stageProbability

  // Activity engagement
  if (daysSinceLastActivity > 30) score -= 25
  else if (daysSinceLastActivity > 14) score -= 15
  else if (daysSinceLastActivity <= 3) score += 5

  if (activityCount > 10) score += 10
  else if (activityCount > 5) score += 5
  else if (activityCount < 2) score -= 10

  // Deal age penalty
  if (dealAge > 180) score -= 20
  else if (dealAge > 90) score -= 10

  // Expected close date
  if (deal.expectedClose) {
    const daysToClose = daysSince(deal.expectedClose) * -1
    if (daysToClose < 0) score -= 10 // overdue
  }

  // Historical calibration
  if (totalClosed > 10) {
    const historicalWinRate = (wonCount / totalClosed) * 100
    score = score * 0.7 + historicalWinRate * 0.3
  }

  score = Math.max(0, Math.min(100, Math.round(score)))

  // Risk factors
  const riskFactors: PredictionFactor[] = []
  if (daysSinceLastActivity > 14) riskFactors.push({ key: "noActivityDays", params: { days: daysSinceLastActivity } })
  if (dealAge > 90) riskFactors.push({ key: "dealOpenDays", params: { days: dealAge } })
  if (activityCount < 3) riskFactors.push({ key: "fewInteractions" })
  if (deal.expectedClose && new Date(deal.expectedClose) < new Date()) riskFactors.push({ key: "overdueCloseDate" })

  const positiveFactors: PredictionFactor[] = []
  if (activityCount > 5) positiveFactors.push({ key: "interactionsCount", params: { count: activityCount } })
  if (daysSinceLastActivity <= 3) positiveFactors.push({ key: "recentActivity" })
  if (stageProbability >= 70) positiveFactors.push({ key: "highProbabilityStage", params: { probability: stageProbability } })

  const confidence = totalClosed > 20 ? 80 : totalClosed > 5 ? 50 : 30

  // A9 Adaptive AI Models — apply accumulated user-feedback bias.
  // `score` here is integer percent (0-100); applyAdjustment uses a
  // proportional nudge so a high-score deal moves more in absolute
  // terms than a low-score one. maxNudge=0.10 caps the swing at ±10%
  // of the raw value. No-op when the cron hasn't populated an
  // adjustment row yet (returns raw `score` unchanged).
  //
  // Note on units: this engine emits integer percent for the UI's
  // donut renderer. The canonical `predictionValue` storage format
  // (per `PREDICTION_VALUE_FORMAT.prediction_deal_win`, decimal in
  // [0,1]) is enforced at the widget boundary — see
  // `src/app/(dashboard)/deals/[id]/page.tsx` where the call site
  // divides by 100 before posting feedback. The slice-3 cron only
  // reads `rating`, not `predictionValue`, so the two unit systems
  // don't currently collide; if/when a future slice consumes
  // `predictionValue`, parse it as decimal-in-[0,1].
  const adj = await getAdjustment(orgId, "prediction_deal_win")
  const scoreAdjusted = Math.round(
    applyAdjustment(score, adj, { maxNudge: 0.10, min: 0, max: 100 }),
  )

  return {
    winProbability: scoreAdjusted,
    expectedCloseDate: deal.expectedClose,
    riskFactors,
    positiveFactors,
    confidence,
  }
}

// ── Revenue Forecast ──

export interface ForecastData {
  month: string
  committed: number
  bestCase: number
  pipeline: number
  actual: number
}

export async function generateRevenueForecast(orgId: string, months: number = 6): Promise<ForecastData[]> {
  const now = new Date()
  const forecast: ForecastData[] = []
  const vocabulary = await stageVocabulary(orgId)

  // Past 6 months: actual revenue
  for (let i = 5; i >= 0; i--) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59)
    const monthLabel = monthStart.toLocaleDateString("en", { month: "short" })

    /*
      * Attribution by `stageChangedAt`, not `updatedAt`.
      *
      * `updatedAt` moves whenever any column of the row changes, so editing a
      * note on a deal closed last year credited its whole value to the month of
      * the edit. That is not a history of revenue, it is a history of typing.
      *
      * Deals that were never moved through the app carry no stage date, and
      * they stay out of the chart rather than being pinned to an invented
      * month. Their value still counts in all-time revenue, which needs no date
      * to be true.
      */
    const wonDeals = await prisma.deal.findMany({
      where: {
        organizationId: orgId,
        stage: { in: vocabulary.wonStages },
        stageChangedAt: { gte: monthStart, lte: monthEnd },
      },
      select: { valueAmount: true },
    })
    const actual = wonDeals.reduce((s: number, d: any) => s + decimalToNumber(d.valueAmount), 0)

    // Past months: actual = committed = bestCase = pipeline
    forecast.push({ month: monthLabel, actual, committed: actual, bestCase: actual, pipeline: actual })
  }

  // Future months: forecasted
  for (let i = 0; i < months; i++) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() + i, 1)
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + i + 1, 0, 23, 59, 59)
    const monthLabel = monthStart.toLocaleDateString("en", { month: "short" })

    // Committed: deals already WON or probability >= 90
    const committedDeals = await prisma.deal.findMany({
      where: {
        organizationId: orgId,
        expectedClose: { gte: monthStart, lte: monthEnd },
        OR: [{ stage: { in: vocabulary.wonStages } }, { probability: { gte: 90 } }],
      },
      select: { valueAmount: true },
    })
    const committed = committedDeals.reduce((s: number, d: any) => s + decimalToNumber(d.valueAmount), 0)

    // Best case: committed + deals with probability >= 70
    const bestCaseDeals = await prisma.deal.findMany({
      where: {
        organizationId: orgId,
        expectedClose: { gte: monthStart, lte: monthEnd },
        probability: { gte: 70 },
        stage: { notIn: vocabulary.closedStages },
      },
      select: { valueAmount: true },
    })
    const bestCase = committed + bestCaseDeals.reduce((s: number, d: any) => s + decimalToNumber(d.valueAmount), 0)

    // Pipeline: all active deals weighted by probability
    const pipelineDeals = await prisma.deal.findMany({
      where: {
        organizationId: orgId,
        expectedClose: { gte: monthStart, lte: monthEnd },
        stage: { notIn: vocabulary.closedStages },
      },
      select: { valueAmount: true, probability: true },
    })
    const pipelineWeighted = pipelineDeals.reduce(
      (s: number, d: any) => s + decimalToNumber(d.valueAmount) * ((d.probability || 0) / 100), 0
    )

    // Actual: paid invoices this month
    let actual = 0
    try {
      const invoices = await prisma.invoice.findMany({
        where: {
          organizationId: orgId,
          status: "paid",
          paidAt: { gte: monthStart, lte: monthEnd },
        },
        select: { totalAmount: true },
      })
      actual = invoices.reduce((s: number, inv: any) => s + (inv.totalAmount || 0), 0)
    } catch { /* invoice model might not have all fields */ }

    forecast.push({
      month: monthLabel,
      committed,
      bestCase,
      pipeline: committed + pipelineWeighted,
      actual,
    })
  }

  return forecast
}

// ── Churn Risk ──

export interface ChurnRisk {
  companyId: string
  companyName: string
  riskScore: number
  factors: string[]
  lastActivity: Date | null
}

export async function calculateChurnRisk(orgId: string): Promise<ChurnRisk[]> {
  const vocabulary = await stageVocabulary(orgId)
  const companies = await prisma.company.findMany({
    where: { organizationId: orgId },
    select: {
      id: true,
      name: true,
      activities: { orderBy: { createdAt: "desc" as const }, take: 1, select: { createdAt: true } },
      tickets: { where: { status: { notIn: ["closed", "resolved"] } }, select: { id: true } },
      deals: { where: { stage: { notIn: vocabulary.closedStages } }, select: { id: true } },
    },
  })

  const results: ChurnRisk[] = []

  for (const company of companies) {
    let risk = 0
    const factors: string[] = []
    const lastActivity = company.activities[0]?.createdAt || null
    const days = daysSince(lastActivity)

    if (days > 60) { risk += 40; factors.push(`noActivity:${days}`) }
    else if (days > 30) { risk += 20; factors.push(`noActivity:${days}`) }

    if (company.tickets.length > 3) { risk += 20; factors.push(`openTickets:${company.tickets.length}`) }
    if (company.deals.length === 0) { risk += 15; factors.push("noActiveDeals") }

    if (risk > 20) {
      results.push({
        companyId: company.id,
        companyName: company.name,
        riskScore: Math.min(100, risk),
        factors,
        lastActivity,
      })
    }
  }

  return results.sort((a, b) => b.riskScore - a.riskScore)
}

// ── Deal Velocity ──

export interface StageVelocity {
  stage: string
  avgDays: number
  dealCount: number
}

export interface VelocityAnalysis {
  stages: StageVelocity[]
  bottleneck: string | null
  avgCycleDays: number
}

export async function dealVelocityAnalysis(orgId: string): Promise<VelocityAnalysis> {
  // Get won deals with stage change history via activities
  const vocabulary = await stageVocabulary(orgId)
  const wonDeals = await prisma.deal.findMany({
    where: { organizationId: orgId, stage: { in: vocabulary.wonStages } },
    select: { id: true, createdAt: true, stageChangedAt: true, stage: true },
  })

  // Get pipeline stages
  const pipelines = await prisma.pipeline.findMany({
    where: { organizationId: orgId },
    include: { stages: { orderBy: { sortOrder: "asc" } } },
  })

  const allStages = pipelines.flatMap((p: any) => p.stages.map((s: any) => s.name))
  const uniqueStages: string[] = [...new Set(allStages as string[])]

  // Simple velocity: average cycle time
  // Only deals that record when they were won. `updatedAt` was standing in for
  // a close date and inflated every cycle by however long the row kept being
  // edited afterwards; a deal with no stage date has no measurable cycle.
  const cycleTimes = wonDeals
    .filter((d: any) => d.stageChangedAt)
    .map((d: any) =>
      Math.floor((new Date(d.stageChangedAt).getTime() - new Date(d.createdAt).getTime()) / 86400000),
    )
  const avgCycleDays = cycleTimes.length > 0
    ? Math.round(cycleTimes.reduce((a: number, b: number) => a + b, 0) / cycleTimes.length)
    : 0

  // Stage-level analysis using current active deals
  const activeDeals = await prisma.deal.findMany({
    where: { organizationId: orgId, stage: { notIn: vocabulary.closedStages } },
    select: { stage: true, stageChangedAt: true, createdAt: true },
  })

  const stageData: StageVelocity[] = uniqueStages
    .filter((s: string) => !vocabulary.closedStages.includes(s))
    .map((stage: string) => {
      const dealsInStage = activeDeals.filter((d: any) => d.stage === stage)
      const avgDays = dealsInStage.length > 0
        ? Math.round(dealsInStage.reduce((s: number, d: any) => s + daysSince(d.stageChangedAt || d.createdAt), 0) / dealsInStage.length)
        : 0
      return { stage, avgDays, dealCount: dealsInStage.length }
    })

  const bottleneck = stageData.length > 0
    ? stageData.reduce((max, s) => s.avgDays > max.avgDays ? s : max, stageData[0]).stage
    : null

  return { stages: stageData, bottleneck, avgCycleDays }
}
