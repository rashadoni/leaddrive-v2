import { beforeEach, describe, expect, it, vi } from "vitest"

interface AnthropicRequest {
  messages: Array<{ role: string; content: string }>
}

interface AnthropicRequestOptions {
  signal?: AbortSignal
}

const h = vi.hoisted(() => ({
  lastRequest: null as AnthropicRequest | null,
  lastSignal: null as AbortSignal | null,
  clientOptions: null as Record<string, unknown> | null,
  responseText: "neutral",
  hangUntilAbort: false,
}))

vi.mock("@/lib/ai/anthropic-client", () => ({
  getAnthropicClient: (options?: Record<string, unknown>) => {
    h.clientOptions = options ?? null
    return {
      messages: {
        create: async (request: AnthropicRequest, options?: AnthropicRequestOptions) => {
          h.lastRequest = request
          h.lastSignal = options?.signal ?? null
          if (h.hangUntilAbort) {
            return await new Promise((_, reject) => {
              options?.signal?.addEventListener("abort", () => {
                const error = new Error("aborted")
                error.name = "AbortError"
                reject(error)
              }, { once: true })
            })
          }
          return { content: [{ type: "text", text: h.responseText }] }
        },
      },
    }
  },
}))

import { classifyIntent } from "@/lib/ai/intent-classifier"
import { aiSentiment, aiSentimentDetailed } from "@/lib/sentiment"

beforeEach(() => {
  h.lastRequest = null
  h.lastSignal = null
  h.clientOptions = null
  h.responseText = "neutral"
  h.hangUntilAbort = false
  process.env.ANTHROPIC_API_KEY = "test-key"
})

describe("AI classifier PII masking", () => {
  it("masks raw chat message PII before intent classification", async () => {
    h.responseText = JSON.stringify({ intent: "support_request", confidence: 0.92 })

    const result = await classifyIntent("Need help for aysel@example.com, call +994 50 123 45 67")
    const payload = h.lastRequest?.messages[0]?.content ?? ""

    expect(result).toEqual({ intent: "support_request", confidence: 0.92 })
    expect(payload).toContain("[EMAIL_")
    expect(payload).toContain("[PHONE_")
    expect(payload).not.toContain("aysel@example.com")
    expect(payload).not.toContain("+994 50 123 45 67")
  })

  it("masks social/survey sentiment text PII before Anthropic", async () => {
    h.responseText = "negative"

    const result = await aiSentiment("Terrible service. Email me at leyla@example.com or call +994 55 111 22 33.")
    const payload = h.lastRequest?.messages[0]?.content ?? ""

    expect(result).toBe("negative")
    expect(payload).toContain("[EMAIL_")
    expect(payload).toContain("[PHONE_")
    expect(payload).not.toContain("leyla@example.com")
    expect(payload).not.toContain("+994 55 111 22 33")
  })

  it("aborts a timed-out sentiment request and returns a typed failure", async () => {
    vi.useFakeTimers()
    h.hangUntilAbort = true

    const pending = aiSentimentDetailed("🙄", { timeoutMs: 1_000, logErrors: false })
    await vi.advanceTimersByTimeAsync(1_000)

    await expect(pending).resolves.toEqual({ sentiment: null, errorClass: "TIMEOUT" })
    expect(h.lastSignal?.aborted).toBe(true)
    expect(h.clientOptions).toMatchObject({ timeout: 1_000, maxRetries: 0 })
    vi.useRealTimers()
  })
})
