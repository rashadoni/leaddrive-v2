import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { checkRateLimit, RATE_LIMIT_CONFIG } from "@/lib/rate-limit"
import { answerAdvisorQuestion, checkAdvisorQueryGovernance } from "@/lib/ai/advisor/service"

export const POST = withRlsAuth("ai", "read", async (req, auth) => {
  const body = await req.json().catch(() => null) as {
    question?: unknown
    locale?: unknown
  } | null
  const question = typeof body?.question === "string" ? body.question.trim() : ""
  const locale = typeof body?.locale === "string" ? body.locale : undefined

  if (!question) {
    return NextResponse.json({ error: "question is required" }, { status: 400 })
  }
  if (!checkRateLimit(`advisor-query:${auth.orgId}:${auth.userId}`, RATE_LIMIT_CONFIG.ai)) {
    return NextResponse.json({ error: "Too many Advisor requests. Please try again later." }, { status: 429 })
  }
  const governance = await checkAdvisorQueryGovernance(auth.orgId)
  if (!governance.allowed) {
    return NextResponse.json({
      error: governance.reason || "Advisor usage limit exceeded.",
      limit: governance.limit,
      used: governance.used,
    }, { status: 429 })
  }

  const data = await answerAdvisorQuestion({
    organizationId: auth.orgId,
    userId: auth.userId,
    role: auth.role,
    question,
    locale,
  })

  return NextResponse.json({ data })
})
