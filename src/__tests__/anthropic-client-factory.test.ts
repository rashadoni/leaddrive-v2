import { describe, it, expect, vi, beforeEach, afterAll } from "vitest"

// Central guarantee for the AI-timeout hardening.
//
// Every server-side Anthropic client is built via getAnthropicClient(), which
// bounds the SDK's unbounded default (10-min timeout × 2 retries ≈ 30 min worst
// case) so a stalled upstream surfaces as a clean error instead of an infinite
// hang — the root cause of the /deals "Da Vinci аналитика" infinite-spinner bug.
// This proves the factory always emits a finite timeout + limited retries and
// merges overrides (per-tenant apiKey, longer per-call timeout) correctly.

// `mock`-prefixed so Vitest's vi.mock hoisting guard allows referencing it.
const mockCtorOpts: Array<{ apiKey?: unknown; timeout?: number; maxRetries?: number } | undefined> = []
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: vi.fn() }
    constructor(opts?: { apiKey?: unknown; timeout?: number; maxRetries?: number }) {
      mockCtorOpts.push(opts)
    }
  },
}))

import {
  getAnthropicClient,
  AI_DEFAULT_TIMEOUT_MS,
  AI_DEFAULT_MAX_RETRIES,
} from "@/lib/ai/anthropic-client"

const origKey = process.env.ANTHROPIC_API_KEY

beforeEach(() => {
  mockCtorOpts.length = 0
  process.env.ANTHROPIC_API_KEY = "env-key"
})

afterAll(() => {
  process.env.ANTHROPIC_API_KEY = origKey
})

describe("getAnthropicClient — timeout-bounded factory", () => {
  it("exports finite, sane default constants", () => {
    expect(Number.isFinite(AI_DEFAULT_TIMEOUT_MS)).toBe(true)
    expect(AI_DEFAULT_TIMEOUT_MS).toBeGreaterThan(0)
    expect(AI_DEFAULT_TIMEOUT_MS).toBeLessThanOrEqual(120_000)
    expect(AI_DEFAULT_MAX_RETRIES).toBeGreaterThanOrEqual(0)
    expect(AI_DEFAULT_MAX_RETRIES).toBeLessThanOrEqual(1)
  })

  it("constructs with a finite timeout and bounded retries by default", () => {
    getAnthropicClient()
    const opts = mockCtorOpts[0]
    expect(typeof opts?.timeout).toBe("number")
    expect(Number.isFinite(opts!.timeout!)).toBe(true)
    expect(opts!.timeout!).toBeGreaterThan(0)
    expect(opts!.timeout!).toBeLessThanOrEqual(120_000)
    expect(opts!.maxRetries).toBeLessThanOrEqual(1)
    // defaults wired through
    expect(opts!.timeout).toBe(AI_DEFAULT_TIMEOUT_MS)
    expect(opts!.maxRetries).toBe(AI_DEFAULT_MAX_RETRIES)
  })

  it("defaults apiKey to process.env.ANTHROPIC_API_KEY", () => {
    getAnthropicClient()
    expect(mockCtorOpts[0]?.apiKey).toBe("env-key")
  })

  it("preserves a per-tenant apiKey override while keeping the timeout finite", () => {
    // Mirrors the per-tenant call sites (lead-scoring, web-chat, ai-summary, …)
    // that source the key from config rather than process.env.
    getAnthropicClient({ apiKey: "tenant-key" })
    const opts = mockCtorOpts[0]
    expect(opts?.apiKey).toBe("tenant-key")
    expect(opts!.timeout!).toBeGreaterThan(0)
    expect(opts!.timeout!).toBeLessThanOrEqual(120_000)
    expect(opts!.maxRetries).toBeLessThanOrEqual(1)
  })

  it("applies a longer per-call timeout override (e.g. cost-model heavy calls)", () => {
    getAnthropicClient({ timeout: 240_000, maxRetries: 0 })
    const opts = mockCtorOpts[0]
    expect(opts?.timeout).toBe(240_000)
    expect(Number.isFinite(opts!.timeout!)).toBe(true)
    expect(opts!.maxRetries).toBe(0)
  })

  it("never leaves timeout undefined even if a caller passes an unrelated override", () => {
    getAnthropicClient({ maxRetries: 0 })
    const opts = mockCtorOpts[0]
    expect(typeof opts?.timeout).toBe("number")
    expect(Number.isFinite(opts!.timeout!)).toBe(true)
    expect(opts!.maxRetries).toBe(0)
  })
})
