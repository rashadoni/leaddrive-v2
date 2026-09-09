import { beforeEach, describe, expect, it, vi } from "vitest"

interface AnthropicRequest {
  messages: Array<{ role: string; content: string }>
}

const h = vi.hoisted((): {
  lastRequest: AnthropicRequest | null
  responseText: string
} => ({
  lastRequest: null,
  responseText: "{}",
}))

vi.mock("@/lib/ai/anthropic-client", () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async (request: AnthropicRequest) => {
        h.lastRequest = request
        return {
          content: [{ type: "text", text: h.responseText }],
          usage: { input_tokens: 12, output_tokens: 8 },
        }
      },
    },
  }),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiInteractionLog: { create: vi.fn(async () => ({})) },
    ticket: { findMany: vi.fn() },
    aiShadowAction: { findMany: vi.fn(), create: vi.fn() },
  },
}))

vi.mock("@/lib/ai/budget", () => ({
  calculateAiCost: () => 0.001,
}))

import { generateTriageSuggestion } from "@/lib/ai/triage"
import { classifyTicketSentiment } from "@/lib/ai/sentiment"

beforeEach(() => {
  h.lastRequest = null
  h.responseText = "{}"
})

describe("ticket AI jobs PII masking", () => {
  it("masks triage ticket PII before Anthropic and unmasks the JSON response", async () => {
    h.responseText = JSON.stringify({
      category: "technical",
      priority: "high",
      tags: ["login"],
      reasoning: "Customer shared [EMAIL_1] and [PHONE_1] while blocked.",
    })

    const result = await generateTriageSuggestion({
      id: "ticket-1",
      organizationId: "org-1",
      subject: "Login issue for aysel@example.com",
      description: "Please call +994 50 123 45 67. User cannot access production.",
    })
    const payload = h.lastRequest?.messages[0]?.content ?? ""

    expect(result).toMatchObject({
      category: "technical",
      priority: "high",
      reasoning: "Customer shared aysel@example.com and +994 50 123 45 67 while blocked.",
    })
    expect(payload).toContain("[EMAIL_")
    expect(payload).toContain("[PHONE_")
    expect(payload).not.toContain("aysel@example.com")
    expect(payload).not.toContain("+994 50 123 45 67")
  })

  it("masks sentiment ticket PII before Anthropic and unmasks key phrases", async () => {
    h.responseText = JSON.stringify({
      level: "negative_high",
      confidence: 0.91,
      reasoning: "Customer is angry and included [EMAIL_1].",
      keyPhrases: ["refund to [EMAIL_1]", "call [PHONE_1]"],
    })

    const result = await classifyTicketSentiment({
      id: "ticket-2",
      organizationId: "org-1",
      subject: "Refund demanded by aysel@example.com",
      description: "I am angry. Call +994 50 123 45 67 now.",
    })
    const payload = h.lastRequest?.messages[0]?.content ?? ""

    expect(result).toMatchObject({
      level: "negative_high",
      confidence: 0.91,
      reasoning: "Customer is angry and included aysel@example.com.",
      keyPhrases: ["refund to aysel@example.com", "call +994 50 123 45 67"],
    })
    expect(payload).toContain("[EMAIL_")
    expect(payload).toContain("[PHONE_")
    expect(payload).not.toContain("aysel@example.com")
    expect(payload).not.toContain("+994 50 123 45 67")
  })
})
