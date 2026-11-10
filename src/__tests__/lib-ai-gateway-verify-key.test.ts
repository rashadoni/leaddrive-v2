/**
 * A key the organization types into «ИИ и расходы» is checked at its provider
 * before it is saved (src/lib/ai/gateway/verify-key.ts): at the provider's own
 * address, in a header and never in the URL, with a request that costs nothing
 * (Voyage: one word). Refused → not saved; no answer → "try again", not saved.
 */
import { describe, expect, it } from "vitest"
import { verifyProviderKey } from "@/lib/ai/gateway/verify-key"

const KEY = "test-key-0123456789-ABCDEFGHIJ" // gitleaks:allow — not a key

function recorder(status: number, body = "{}") {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(body, { status })
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

const HOSTS = {
  anthropic: "https://api.anthropic.com/",
  gemini: "https://generativelanguage.googleapis.com/",
  openai: "https://api.openai.com/",
  voyage: "https://api.voyageai.com/",
  google_vision: "https://vision.googleapis.com/",
} as const

describe("checking an organization's own key at its provider", () => {
  it.each(Object.entries(HOSTS))("%s: asks the provider's own address, the key in a header only", async (provider, host) => {
    const { calls, fetchImpl } = recorder(200)
    expect(await verifyProviderKey(provider as keyof typeof HOSTS, KEY, fetchImpl)).toBe("ok")
    expect(calls).toHaveLength(1)
    expect(calls[0].url.startsWith(host)).toBe(true)
    expect(calls[0].url).not.toContain(KEY)
    expect(Object.values(calls[0].init.headers as Record<string, string>).some((v) => v.includes(KEY))).toBe(true)
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal)
  })

  it.each(Object.keys(HOSTS))("%s: 401/403 is a refused key, 429 a real but busy one, 5xx no answer", async (provider) => {
    const p = provider as keyof typeof HOSTS
    expect(await verifyProviderKey(p, KEY, recorder(401).fetchImpl)).toBe("invalid")
    expect(await verifyProviderKey(p, KEY, recorder(403).fetchImpl)).toBe("invalid")
    expect(await verifyProviderKey(p, KEY, recorder(429).fetchImpl)).toBe("ok")
    expect(await verifyProviderKey(p, KEY, recorder(503).fetchImpl)).toBe("unreachable")
    const failing = (async () => { throw new Error("network") }) as unknown as typeof fetch
    expect(await verifyProviderKey(p, KEY, failing)).toBe("unreachable")
  })

  it.each(["gemini", "google_vision"] as const)("%s: Google's 400 is a bad key only when Google says so", async (provider) => {
    const bad = JSON.stringify({ error: { code: 400, message: "API key not valid. Please pass a valid API key.", details: [{ reason: "API_KEY_INVALID" }] } })
    expect(await verifyProviderKey(provider, KEY, recorder(400, bad).fetchImpl)).toBe("invalid")
    expect(await verifyProviderKey(provider, KEY, recorder(400, JSON.stringify({ error: { message: "Empty request" } })).fetchImpl)).toBe("ok")
  })

  it("has no check for Speech-to-Text, which takes no key", async () => {
    await expect(verifyProviderKey("google_speech", KEY, recorder(200).fetchImpl)).rejects.toThrow()
  })
})
