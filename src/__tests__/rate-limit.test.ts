import { describe, it, expect, beforeEach } from "vitest"
import {
  checkRateLimit,
  getRateLimitRemaining,
  resetRateLimit,
  hashForRateLimit,
  RATE_LIMIT_CONFIG,
} from "@/lib/rate-limit"

describe("rate-limit", () => {
  beforeEach(() => {
    resetRateLimit("test-key")
  })

  it("allows requests within the limit", () => {
    const config = { maxRequests: 3, windowMs: 60000 }
    expect(checkRateLimit("test-key", config)).toBe(true)
    expect(checkRateLimit("test-key", config)).toBe(true)
    expect(checkRateLimit("test-key", config)).toBe(true)
  })

  it("blocks requests over the limit", () => {
    const config = { maxRequests: 2, windowMs: 60000 }
    expect(checkRateLimit("test-key", config)).toBe(true)
    expect(checkRateLimit("test-key", config)).toBe(true)
    expect(checkRateLimit("test-key", config)).toBe(false)
  })

  it("tracks different keys independently", () => {
    const config = { maxRequests: 1, windowMs: 60000 }
    expect(checkRateLimit("key-a", config)).toBe(true)
    expect(checkRateLimit("key-b", config)).toBe(true)
    expect(checkRateLimit("key-a", config)).toBe(false)
    expect(checkRateLimit("key-b", config)).toBe(false)
    resetRateLimit("key-a")
    resetRateLimit("key-b")
  })

  it("returns correct remaining count", () => {
    const config = { maxRequests: 5, windowMs: 60000 }
    expect(getRateLimitRemaining("test-key", config)).toBe(5)
    checkRateLimit("test-key", config)
    checkRateLimit("test-key", config)
    expect(getRateLimitRemaining("test-key", config)).toBe(3)
  })

  it("resetRateLimit clears the key", () => {
    const config = { maxRequests: 1, windowMs: 60000 }
    checkRateLimit("test-key", config)
    expect(checkRateLimit("test-key", config)).toBe(false)
    resetRateLimit("test-key")
    expect(checkRateLimit("test-key", config)).toBe(true)
  })

  it("returns full remaining for unknown key", () => {
    const config = { maxRequests: 100, windowMs: 60000 }
    expect(getRateLimitRemaining("never-used", config)).toBe(100)
  })
})

describe("hashForRateLimit", () => {
  it("is deterministic for the same input", async () => {
    const a = await hashForRateLimit("ld_test_key_abc")
    const b = await hashForRateLimit("ld_test_key_abc")
    expect(a).toBe(b)
  })

  it("produces different hashes for different inputs", async () => {
    const a = await hashForRateLimit("ld_key_1")
    const b = await hashForRateLimit("ld_key_2")
    expect(a).not.toBe(b)
  })

  it("returns a 16-char lowercase hex string", async () => {
    const h = await hashForRateLimit("ld_anything")
    expect(h).toMatch(/^[0-9a-f]{16}$/)
  })

  it("does not contain raw input substrings", async () => {
    const key = "ld_secret_marker_42"
    const h = await hashForRateLimit(key)
    expect(h).not.toContain("secret")
    expect(h).not.toContain("marker")
    expect(h).not.toContain("42")
  })

  it("handles empty string without throwing", async () => {
    const h = await hashForRateLimit("")
    expect(h).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe("RATE_LIMIT_CONFIG.webhook", () => {
  it("has the expected threshold of 600 per minute", () => {
    expect(RATE_LIMIT_CONFIG.webhook.maxRequests).toBe(600)
    expect(RATE_LIMIT_CONFIG.webhook.windowMs).toBe(60000)
  })

  it("tracks two different webhook namespaces independently", () => {
    const a = "webhook:telegram:1.2.3.4"
    const b = "webhook:facebook:1.2.3.4"
    resetRateLimit(a)
    resetRateLimit(b)
    expect(checkRateLimit(a, RATE_LIMIT_CONFIG.webhook)).toBe(true)
    expect(checkRateLimit(b, RATE_LIMIT_CONFIG.webhook)).toBe(true)
    expect(getRateLimitRemaining(a, RATE_LIMIT_CONFIG.webhook)).toBe(599)
    expect(getRateLimitRemaining(b, RATE_LIMIT_CONFIG.webhook)).toBe(599)
    resetRateLimit(a)
    resetRateLimit(b)
  })

  it("blocks the 601st request from the same source within the window", () => {
    const key = "webhook:flood:5.6.7.8"
    resetRateLimit(key)
    for (let i = 0; i < 600; i++) {
      expect(checkRateLimit(key, RATE_LIMIT_CONFIG.webhook)).toBe(true)
    }
    expect(checkRateLimit(key, RATE_LIMIT_CONFIG.webhook)).toBe(false)
    resetRateLimit(key)
  })
})

describe("RATE_LIMIT_CONFIG.apiKey", () => {
  it("has the expected threshold of 300 per minute", () => {
    expect(RATE_LIMIT_CONFIG.apiKey.maxRequests).toBe(300)
    expect(RATE_LIMIT_CONFIG.apiKey.windowMs).toBe(60000)
  })

  it("tracks two different API-key hashes independently", () => {
    const a = "apikey:aaaa1111aaaa1111"
    const b = "apikey:bbbb2222bbbb2222"
    resetRateLimit(a)
    resetRateLimit(b)
    expect(checkRateLimit(a, RATE_LIMIT_CONFIG.apiKey)).toBe(true)
    expect(checkRateLimit(b, RATE_LIMIT_CONFIG.apiKey)).toBe(true)
    expect(getRateLimitRemaining(a, RATE_LIMIT_CONFIG.apiKey)).toBe(299)
    expect(getRateLimitRemaining(b, RATE_LIMIT_CONFIG.apiKey)).toBe(299)
    resetRateLimit(a)
    resetRateLimit(b)
  })

  it("blocks the 301st request within the window", () => {
    const key = "apikey:flood-test"
    resetRateLimit(key)
    for (let i = 0; i < 300; i++) {
      expect(checkRateLimit(key, RATE_LIMIT_CONFIG.apiKey)).toBe(true)
    }
    expect(checkRateLimit(key, RATE_LIMIT_CONFIG.apiKey)).toBe(false)
    resetRateLimit(key)
  })
})

describe("RATE_LIMIT_CONFIG.authPrincipal", () => {
  it("limits one hashed CRM principal to 10 attempts per minute", () => {
    expect(RATE_LIMIT_CONFIG.authPrincipal.maxRequests).toBe(10)
    expect(RATE_LIMIT_CONFIG.authPrincipal.windowMs).toBe(60000)
  })
})
