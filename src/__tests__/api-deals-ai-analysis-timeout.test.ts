import { describe, it, expect, vi, beforeEach, afterAll } from "vitest"
import { NextRequest } from "next/server"

// Regression coverage for the "Da Vinci аналитика" infinite-spinner bug.
//
// The /deals panel hung forever on "Загрузка..." because POST /deals/ai-analysis
// awaited an Anthropic call built with the SDK defaults (10-min timeout × 2 retries,
// ~30 min worst case) and nothing bounded it. The browser fetch never settled, so
// `aiLoading` never reset. The fix bounds the client (timeout + maxRetries) so a
// stalled upstream surfaces as a clean 503 instead of an open connection.

vi.mock("@/lib/prisma", () => ({
  prisma: {
    deal: { findMany: vi.fn() },
    // Da Vinci теперь сворачивает стадии по смыслу — словарь читается до отчёта.
    pipelineStage: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))
vi.mock("@/lib/api-auth", () => ({ getOrgId: vi.fn(), getSession: vi.fn().mockResolvedValue(null) }))
vi.mock("@/lib/constants", () => ({ DEFAULT_CURRENCY: "USD" }))

// `mock`-prefixed so Vitest's vi.mock hoisting guard allows referencing them.
const mockCreate = vi.fn().mockResolvedValue({
  content: [{ type: "text", text: "AI analysis result" }],
})
const mockCtorOpts: Array<{ timeout?: number; maxRetries?: number } | undefined> = []
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: mockCreate }
    constructor(opts?: { timeout?: number; maxRetries?: number }) {
      mockCtorOpts.push(opts)
    }
  },
}))

import { POST as POST_AI_ANALYSIS } from "@/app/api/v1/deals/ai-analysis/route"
import { prisma } from "@/lib/prisma"
import { getOrgId } from "@/lib/api-auth"

const ORG = "org-1"
const origKey = process.env.ANTHROPIC_API_KEY

function makeReq() {
  return new NextRequest(new URL("http://localhost:3000/api/v1/deals/ai-analysis"), {
    method: "POST",
    body: JSON.stringify({ lang: "en" }),
  })
}

function oneDeal() {
  vi.mocked(prisma.deal.findMany).mockResolvedValueOnce([
    { id: "d1", name: "Big Deal", stage: "WON", valueAmount: 50000, currency: "USD", probability: 100, company: { name: "Acme" }, createdAt: new Date() },
  ] as any)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCtorOpts.length = 0
  mockCreate.mockResolvedValue({ content: [{ type: "text", text: "AI analysis result" }] })
  vi.mocked(getOrgId).mockResolvedValue(ORG)
  process.env.ANTHROPIC_API_KEY = "test-key"
})

afterAll(() => {
  process.env.ANTHROPIC_API_KEY = origKey
})

describe("POST /deals/ai-analysis — timeout hardening", () => {
  it("constructs the Anthropic client with a bounded timeout and limited retries", async () => {
    oneDeal()

    await POST_AI_ANALYSIS(makeReq())

    const opts = mockCtorOpts[0]
    expect(typeof opts?.timeout).toBe("number")
    expect(opts!.timeout!).toBeGreaterThan(0)
    expect(opts!.timeout!).toBeLessThanOrEqual(120_000)
    expect(opts!.maxRetries).toBeLessThanOrEqual(1)
  })

  it("returns 503 (not a hang) when the model call fails or times out", async () => {
    oneDeal()
    mockCreate.mockRejectedValueOnce(
      Object.assign(new Error("Request timed out"), { name: "APIConnectionTimeoutError" }),
    )

    const res = await POST_AI_ANALYSIS(makeReq())
    expect(res.status).toBe(503)
  })

  it("still returns analysis on the happy path", async () => {
    oneDeal()

    const res = await POST_AI_ANALYSIS(makeReq())
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.analysis).toBe("AI analysis result")
  })
})
