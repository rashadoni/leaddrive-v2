import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

type AuthContext = { orgId: string; userId: string; role: string }
type RouteHandler = (req: NextRequest, auth: AuthContext) => Promise<Response>

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: RouteHandler) => (req: NextRequest) =>
    handler(req, { orgId: "org-1", userId: "manager-1", role: "manager" }),
}))

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => true),
  RATE_LIMIT_CONFIG: { ai: { maxRequests: 10, windowMs: 60000 } },
}))

vi.mock("@/lib/ai/advisor/service", () => ({
  checkAdvisorQueryGovernance: vi.fn(async () => ({ allowed: true, limit: 2, used: 1 })),
  answerAdvisorQuestion: vi.fn(async () => ({
    intent: "sales",
    answer: "Two sales risks need attention.",
    facts: [],
    sources: [{ label: "Deal", entityType: "deal", entityId: "deal-1", href: "/deals/deal-1" }],
    recommendations: [],
    signals: [],
    scope: {
      organizationId: "org-1",
      userId: "manager-1",
      role: "manager",
      domains: ["sales"],
      totalSignals: 2,
      filteredSignals: 2,
      generatedAt: "2026-06-27T00:00:00.000Z",
    },
  })),
}))

import { POST } from "@/app/api/v1/ai/advisor/query/route"
import { checkRateLimit, RATE_LIMIT_CONFIG } from "@/lib/rate-limit"
import { answerAdvisorQuestion, checkAdvisorQueryGovernance } from "@/lib/ai/advisor/service"

function req(body: unknown) {
  return new NextRequest("http://localhost/api/v1/ai/advisor/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(checkRateLimit).mockReturnValue(true)
  vi.mocked(checkAdvisorQueryGovernance).mockResolvedValue({ allowed: true, limit: 2, used: 1 })
})

describe("POST /api/v1/ai/advisor/query", () => {
  it("answers through rate-limit and tenant governance guards", async () => {
    const res = await POST(req({ question: "Which deals are stalled?", locale: "en" }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toMatchObject({
      answer: "Two sales risks need attention.",
      scope: { organizationId: "org-1", userId: "manager-1", role: "manager" },
    })
    expect(checkRateLimit).toHaveBeenCalledWith("advisor-query:org-1:manager-1", RATE_LIMIT_CONFIG.ai)
    expect(checkAdvisorQueryGovernance).toHaveBeenCalledWith("org-1")
    expect(answerAdvisorQuestion).toHaveBeenCalledWith({
      organizationId: "org-1",
      userId: "manager-1",
      role: "manager",
      question: "Which deals are stalled?",
      locale: "en",
    })
  })

  it("blocks bursty Advisor questions before governance and answer building", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(false)

    const res = await POST(req({ question: "Which deals are stalled?" }))
    const json = await res.json()

    expect(res.status).toBe(429)
    expect(json.error).toBe("Too many Advisor requests. Please try again later.")
    expect(checkAdvisorQueryGovernance).not.toHaveBeenCalled()
    expect(answerAdvisorQuestion).not.toHaveBeenCalled()
  })

  it("blocks tenant Advisor questions when budget or daily cap is exceeded", async () => {
    vi.mocked(checkAdvisorQueryGovernance).mockResolvedValue({
      allowed: false,
      reason: "Daily Advisor request limit exceeded: 2/2",
      limit: 2,
      used: 2,
    })

    const res = await POST(req({ question: "Which deals are stalled?" }))
    const json = await res.json()

    expect(res.status).toBe(429)
    expect(json).toEqual({
      error: "Daily Advisor request limit exceeded: 2/2",
      limit: 2,
      used: 2,
    })
    expect(answerAdvisorQuestion).not.toHaveBeenCalled()
  })
})
