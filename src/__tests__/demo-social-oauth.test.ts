/**
 * The demo's OAuth state for connecting a prospect's own Facebook Page
 * (src/lib/demo-center/demo-social-oauth.ts): signed, short-lived, and
 * shaped so that it and the product's own state can never be mistaken for
 * each other — the product's callback hands `ldd.…` to the demo before it
 * reads anything else, and the proxy lets only that past the login wall.
 * The routes themselves run against a real database in
 * demo-social-connect-postgres.test.ts.
 */
import crypto from "node:crypto"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => true),
  hashForRateLimit: vi.fn(async (v: string) => `hash_${v.slice(0, 8)}`),
  RATE_LIMIT_CONFIG: {
    api: { maxRequests: 100, windowMs: 60000 },
    ai: { maxRequests: 20, windowMs: 60000 },
    public: { maxRequests: 10, windowMs: 60000 },
    apiKey: { maxRequests: 300, windowMs: 60000 },
    webhook: { maxRequests: 600, windowMs: 60000 },
  },
}))
vi.mock("@/lib/auth", () => ({ auth: <T>(cb: T) => cb }))

import { NextRequest } from "next/server"
import authMiddleware from "@/proxy"
import {
  DEMO_SOCIAL_OAUTH_TTL_MS,
  DEMO_SOCIAL_SCOPES,
  demoSocialDialogUrl,
  isDemoSocialOAuthState,
  readDemoSocialState,
  signDemoSocialState,
} from "@/lib/demo-center/demo-social-oauth"

const NOW = new Date("2026-10-19T10:00:00.000Z")
const ROW = "cmz0demo0social0row01"

/** The product's own state (oauth/facebook/start): base64url of `payload.hmac`. */
function productState(fields: Record<string, unknown>): string {
  const payload = JSON.stringify(fields)
  const sig = crypto.createHmac("sha256", process.env.NEXTAUTH_SECRET || "ld-social-oauth").update(payload).digest("hex")
  return Buffer.from(`${payload}.${sig}`).toString("base64url")
}

describe("the demo's signed state", () => {
  it("names the connection row and nothing else, and reads back while fresh", () => {
    const state = signDemoSocialState(ROW, NOW)
    expect(state).toMatch(/^ldd\.[A-Za-z0-9_-]+\.[0-9a-f]{64}$/)
    expect(JSON.parse(Buffer.from(state.split(".")[1], "base64url").toString("utf8"))).toEqual({ c: ROW, t: NOW.getTime() })
    expect(readDemoSocialState(state, new Date(NOW.getTime() + DEMO_SOCIAL_OAUTH_TTL_MS - 1_000))).toEqual({ ok: true, connectionId: ROW })
  })

  it("is refused once it is older than fifteen minutes, or claims to come from the future", () => {
    expect(readDemoSocialState(signDemoSocialState(ROW, NOW), new Date(NOW.getTime() + DEMO_SOCIAL_OAUTH_TTL_MS + 1_000))).toEqual({ ok: false, reason: "expired" })
    expect(readDemoSocialState(signDemoSocialState(ROW, new Date(NOW.getTime() + 5 * 60_000)), NOW)).toEqual({ ok: false, reason: "expired" })
  })

  it("is refused when anything in it was changed", () => {
    const state = signDemoSocialState(ROW, NOW)
    const [, payload, signature] = state.split(".")
    const other = Buffer.from(JSON.stringify({ c: "cmz0another0row000001", t: NOW.getTime() })).toString("base64url")
    for (const forged of [
      `ldd.${other}.${signature}`,
      `ldd.${payload}.${"0".repeat(64)}`,
      `ldd.${payload}.${signature}.extra`,
      `ldx.${payload}.${signature}`,
      `ldd.${payload}`,
      "ldd.",
    ]) {
      expect(readDemoSocialState(forged, NOW)).toEqual({ ok: false, reason: "invalid" })
    }
  })

  it("can never be mistaken for the product's state, nor the product's for it", () => {
    // base64url has no dot: whatever the product signs, it never starts with «ldd.».
    for (let index = 0; index < 200; index += 1) {
      const state = productState({ orgId: `org-${index}`, state: crypto.randomBytes(16).toString("base64url"), ts: Date.now(), app: "cc-1" })
      expect(state).not.toContain(".")
      expect(isDemoSocialOAuthState(state)).toBe(false)
    }
    expect(isDemoSocialOAuthState(signDemoSocialState(ROW, NOW))).toBe(true)
    expect(isDemoSocialOAuthState(null)).toBe(false)
    // The product's callback decodes its state as base64url and splits on the dot: a demo state gives it no valid payload.
    const decoded = Buffer.from(signDemoSocialState(ROW, NOW), "base64url").toString("utf8")
    expect(() => JSON.parse(decoded.split(".")[0])).toThrow()
  })
})

describe("the dialog for the demo's app", () => {
  const target = (loginConfigId: string | null) => ({
    app: { configId: "cc-staged", appId: "2414060595720618", appSecret: "secret", hasVerifyToken: true, loginConfigId },
    redirectUri: "https://app.leaddrivecrm.org/api/v1/social/oauth/facebook/callback",
  })

  it("asks for exactly the four approved permissions when the app row has no configuration", () => {
    const url = new URL(demoSocialDialogUrl(target(null), "ldd.x.y"))
    expect(url.searchParams.get("scope")).toBe("public_profile,pages_show_list,pages_manage_metadata,pages_messaging")
    expect([...DEMO_SOCIAL_SCOPES]).not.toContain("business_management")
    expect(url.searchParams.get("config_id")).toBeNull()
    expect(url.searchParams.get("client_secret")).toBeNull()
  })

  it("sends the Facebook Login for Business configuration instead, and no scope, as the product does", () => {
    const url = new URL(demoSocialDialogUrl(target("cfg-1"), "ldd.x.y"))
    expect(url.searchParams.get("config_id")).toBe("cfg-1")
    expect(url.searchParams.get("scope")).toBeNull()
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.leaddrivecrm.org/api/v1/social/oauth/facebook/callback")
  })
})

describe("the proxy in front of the product's callback", () => {
  function callback(state: string, method = "GET") {
    const req = new NextRequest(new URL(`/api/v1/social/oauth/facebook/callback?code=c&state=${encodeURIComponent(state)}`, "http://localhost"), {
      method,
      headers: { host: "localhost" },
    })
    ;(req as unknown as { auth: null }).auth = null
    return req
  }
  const loginRedirect = (res: Response | undefined) => (res?.headers?.get("location") ?? "").includes("/login") || res?.status === 401

  it("lets a demo state through without a CRM session — the prospect has none", async () => {
    const res = await authMiddleware(callback(signDemoSocialState(ROW, NOW)) as never)
    expect(loginRedirect(res as Response)).toBe(false)
  })

  it("still sends the product's own state to the login page without a session", async () => {
    const res = await authMiddleware(callback(productState({ orgId: "org-1", state: "s", ts: Date.now() })) as never)
    expect(loginRedirect(res as Response)).toBe(true)
  })

  it("opens nothing else: another method, another path, or a state that only contains «ldd.»", async () => {
    expect(loginRedirect(await authMiddleware(callback(signDemoSocialState(ROW, NOW), "POST") as never) as Response)).toBe(true)
    expect(loginRedirect(await authMiddleware(callback(`x${signDemoSocialState(ROW, NOW)}`) as never) as Response)).toBe(true)
    const start = new NextRequest(new URL(`/api/v1/social/oauth/facebook/start?state=${signDemoSocialState(ROW, NOW)}`, "http://localhost"), { headers: { host: "localhost" } })
    ;(start as unknown as { auth: null }).auth = null
    expect(loginRedirect(await authMiddleware(start as never) as Response)).toBe(true)
  })
})
