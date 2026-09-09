import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { getAnthropicClient } from "@/lib/ai/anthropic-client"

/**
 * AI summary of a segmentation aggregate. Caller posts the aggregated data
 * (from /api/v1/analytics/segments) and we ask Claude Haiku for 3–5 actionable
 * bullet insights. Uses prompt caching on the system prompt.
 */

const SYSTEM_PROMPT = `You are a CRM data analyst. Given a JSON aggregate of a tenant's contacts/leads segmentation,
produce 3–5 concise bullet insights a sales manager can act on. Rules:
- Lead with the number (e.g. "VIP grew 12% to 47 contacts — …").
- Flag anomalies: sudden drops, zero-growth segments, over-concentration in one brand.
- Suggest a concrete next step after the insight if useful.
- Keep each bullet under 25 words.
- Respond in the same language as the "locale" field (default en).
- Return JSON ONLY: { "insights": string[] }. No markdown.`

export const POST = withRlsAuth("contacts", "read", async (req, auth) => {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ success: false, error: "AI not configured" }, { status: 503 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  try {
    const client = getAnthropicClient({ apiKey })
    const res = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 700,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ] as any,
      messages: [
        {
          role: "user",
          content: JSON.stringify(body).slice(0, 12000),
        },
      ],
    })
    const raw = res.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("")
      .trim()
    let insights: string[] = []
    try {
      const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""))
      if (Array.isArray(parsed.insights)) insights = parsed.insights.filter((x: unknown) => typeof x === "string").slice(0, 5)
    } catch {
      // Fallback: split lines
      insights = raw
        .split(/\n/)
        .map(s => s.replace(/^[-•*]\s*/, "").trim())
        .filter(Boolean)
        .slice(0, 5)
    }
    return NextResponse.json({ success: true, data: { insights } })
  } catch (e: any) {
    console.error("[ai-summary]", e)
    return NextResponse.json({ success: false, error: e?.message || "AI error" }, { status: 500 })
  }
})
