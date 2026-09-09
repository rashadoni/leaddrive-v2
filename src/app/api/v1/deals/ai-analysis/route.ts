import { NextResponse } from "next/server"
import { withRls } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"
import { DEFAULT_CURRENCY } from "@/lib/constants"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { PiiMasker } from "@/lib/ai/pii-masker"
import { getAnthropicClient } from "@/lib/ai/anthropic-client"
import { canonicalDealStage } from "@/lib/deal-stage-normalization"
import { wonStageNames, lostStageNames } from "@/lib/marketing-attribution/won-stages"

const MODEL = process.env.MANAGER_MODEL || "claude-sonnet-4-5-20250929"

// Upstream Anthropic call is timeout/retry-bounded by the shared factory (see @/lib/ai/anthropic-client).

const LANG_MAP: Record<string, { name: string; instruction: string }> = {
  az: { name: "Azerbaijani", instruction: "Cavab Azərbaycan dilində olmalıdır." },
  ru: { name: "Russian", instruction: "Ответ должен быть на русском языке." },
  en: { name: "English", instruction: "Answer in English." },
}

export const POST = withRls(async (req, { orgId }) => {

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: "Da Vinci AI requires ANTHROPIC_API_KEY. Configure in Settings → Integrations." }, { status: 503 })

  let body: { lang?: string }
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const lang = body.lang && LANG_MAP[body.lang] ? body.lang : "en"
  const langCfg = LANG_MAP[lang]

  // Load all deals with related data
  const deals = await prisma.deal.findMany({
    where: { organizationId: orgId },
    include: {
      company: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  })

  if (deals.length === 0) {
    return NextResponse.json({ error: "No deals found" }, { status: 404 })
  }

  /*
   * Group by what a stage MEANS. Da Vinci reads these numbers out as fact, and
   * with raw spellings it printed CLOSED_WON as a stage of its own: won value
   * missing the largest deal, win rate short by one, and "Recently lost deals"
   * empty for any org that spells its losing stage differently.
   */
  const [configuredWonStages, configuredLostStages] = await Promise.all([
    wonStageNames(orgId),
    lostStageNames(orgId),
  ])
  const canonStage = (stage: string | null | undefined) =>
    canonicalDealStage(stage || "UNKNOWN", configuredWonStages, configuredLostStages)

  // Compute stats
  const stages: Record<string, { count: number; value: number }> = {}
  let totalValue = 0
  let wonValue = 0
  let lostCount = 0
  const currencies: Record<string, number> = {}

  for (const d of deals) {
    const stage = canonStage(d.stage)
    if (!stages[stage]) stages[stage] = { count: 0, value: 0 }
    stages[stage].count++
    stages[stage].value += decimalToNumber(d.valueAmount)
    totalValue += decimalToNumber(d.valueAmount)
    if (stage === "WON") wonValue += decimalToNumber(d.valueAmount)
    if (stage === "LOST") lostCount++
    const cur = d.currency || DEFAULT_CURRENCY
    currencies[cur] = (currencies[cur] || 0) + (decimalToNumber(d.valueAmount))
  }

  const winRate = deals.length > 0
    ? Math.round((stages["WON"]?.count || 0) / deals.length * 100)
    : 0

  const stageLines = Object.entries(stages)
    .map(([stage, data]) => `  - ${stage}: ${data.count} deals, ${data.value.toLocaleString()} total`)
    .join("\n")

  const topDeals = deals
    .filter((d: any) => canonStage(d.stage) !== "LOST")
    .sort((a: any, b: any) => decimalToNumber(b.valueAmount) - decimalToNumber(a.valueAmount))
    .slice(0, 10)
    .map((d: any) => `  - "${d.name}" (${d.company?.name || "no company"}) — ${(decimalToNumber(d.valueAmount)).toLocaleString()} ${d.currency || DEFAULT_CURRENCY}, stage: ${d.stage}, prob: ${d.probability || 0}%${d.expectedCloseDate ? `, close: ${new Date(d.expectedCloseDate).toLocaleDateString()}` : ""}`)
    .join("\n")

  const recentLost = deals
    .filter((d: any) => canonStage(d.stage) === "LOST")
    .slice(0, 5)
    .map((d: any) => `  - "${d.name}" (${d.company?.name || "no company"}) — ${(decimalToNumber(d.valueAmount)).toLocaleString()} ${d.currency || DEFAULT_CURRENCY}`)
    .join("\n")

  const prompt = `You are Da Vinci, an AI sales pipeline analyst for an IT outsourcing company CRM.

${langCfg.instruction}

Here is the current sales pipeline data:

Total deals: ${deals.length}
Total pipeline value: ${totalValue.toLocaleString()}
Win rate: ${winRate}%
Won value: ${wonValue.toLocaleString()}
Lost deals: ${lostCount}

Stage breakdown:
${stageLines}

Top 10 deals by value:
${topDeals || "  (none)"}

Recently lost deals:
${recentLost || "  (none)"}

Provide a comprehensive sales pipeline analysis (300-500 words) with:
1. Executive Summary — overall pipeline health assessment
2. Key Metrics — win rate, conversion, average deal size
3. Risk Analysis — stalled deals, concentration risk, deals at risk
4. Opportunities — highest-potential deals, quick wins
5. Recommendations — 3-5 specific actionable steps to improve pipeline

Use professional CRM analyst style with data-driven insights. Be specific about deal names and numbers.`

  try {
    const client = getAnthropicClient()
    const piiMasker = new PiiMasker()
    const maskedPrompt = piiMasker.mask(prompt)
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      messages: [{ role: "user", content: maskedPrompt }],
    })

    const analysis = piiMasker.unmask(msg.content[0]?.type === "text" ? msg.content[0].text : "")
    return NextResponse.json({ success: true, data: { analysis } })
  } catch (e: any) {
    console.error("Da Vinci deals analysis error:", e)
    return NextResponse.json({ error: "Da Vinci service unavailable" }, { status: 503 })
  }
})
