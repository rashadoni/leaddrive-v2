import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { loadAndCompute } from "@/lib/cost-model/db"
import { getAiCache, setAiCache, invalidateAiCache } from "@/lib/cost-model/db"
import { analyzeTab } from "@/lib/cost-model/ai-analysis"

// "read", though the verb is POST: the request only carries which tab to
// analyse, and nothing of the tenant's is written — the analysis is cached in
// memory. Gating it on "write" would take the button away from a manager, who
// reads the cost model and does not edit it.
export const POST = withRlsAuth("profitability", "read", async (req, { orgId }) => {
  try {
    let body
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
    }
    const tab = body.tab || "analytics"
    const lang = body.lang || "ru"
    const force = body.force === true

    const cacheKey = `${orgId}_${tab}_${lang}`

    // Check cache
    if (!force) {
      const cached = getAiCache(cacheKey)
      if (cached) {
        return NextResponse.json({
          success: true,
          data: {
            analysis: cached.analysis,
            thinking: cached.thinking,
            cached: true,
          },
        })
      }
    }

    // Compute fresh data
    const result = await loadAndCompute(orgId)

    // Call AI
    const { analysis, thinking } = await analyzeTab(tab, result, lang)

    // Cache result
    setAiCache(cacheKey, analysis, thinking)

    return NextResponse.json({
      success: true,
      data: { analysis, thinking, cached: false },
    })
  } catch (error: any) {
    console.error("Da Vinci analysis error:", error)
    if (error.message === "ANTHROPIC_API_KEY not configured") {
      return NextResponse.json({ error: "Da Vinci AI requires ANTHROPIC_API_KEY. Configure in Settings → Integrations." }, { status: 500 })
    }
    if (error.status) {
      // Anthropic API error
      return NextResponse.json({ error: "Da Vinci service unavailable" }, { status: 502 })
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
