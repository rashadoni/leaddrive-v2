import { describe, it, expect, beforeEach } from "vitest"
import crypto from "crypto"
import type { NextRequest } from "next/server"
import { vi } from "vitest"

/**
 * FB OAuth callback — signed state carried in the `state` param (survives any host) OR the cookie
 * (same-host). Fixes `missing_cookie` on tenant subdomains where the cookie host ≠ the fixed
 * FACEBOOK_REDIRECT_URI host. The HMAC signature guards integrity; the cookie↔state cross-check guards
 * CSRF when both are present.
 */
vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: { findMany: vi.fn().mockResolvedValue([]) },
    socialAccount: { upsert: vi.fn().mockResolvedValue({ id: "social-1" }) },
    monitoringSource: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))
vi.mock("@/lib/secure-token", () => ({ encryptToken: vi.fn((token: string) => `enc:${token}`) }))
vi.mock("@/lib/social/inbox-channel", () => ({ ensureInboxChannelForPage: vi.fn() }))
vi.mock("@/lib/api-auth", () => ({ getOrgId: vi.fn(), getSession: vi.fn().mockResolvedValue(null) }))

import { GET } from "@/app/api/v1/social/oauth/facebook/callback/route"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { ensureInboxChannelForPage } from "@/lib/social/inbox-channel"

const SECRET = process.env.NEXTAUTH_SECRET || "ld-social-oauth"
function sign(obj: object): string {
  const payload = JSON.stringify(obj)
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("hex")
  return Buffer.from(payload + "." + sig).toString("base64url")
}
function req(stateParam: string, cookieVal?: string): NextRequest {
  return {
    url: `https://app.leaddrivecrm.org/api/v1/social/oauth/facebook/callback?code=CODE&state=${encodeURIComponent(stateParam)}`,
    cookies: { get: (n: string) => (n === "ld_fb_oauth" && cookieVal ? { value: cookieVal } : undefined) },
    headers: { get: () => null },
  } as unknown as NextRequest
}
async function errorOf(res: Response): Promise<string | null> {
  const loc = res.headers.get("location") || ""
  return loc ? new URL(loc).searchParams.get("error") : null
}
const valid = () => sign({ orgId: "org1", state: "nonce", ts: Date.now() })

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  delete process.env.FACEBOOK_APP_ID // valid state then stops at "not_configured" — i.e. it got PAST the state gate
  delete process.env.FACEBOOK_APP_SECRET
  delete process.env.FACEBOOK_REDIRECT_URI
  vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.socialAccount.upsert).mockResolvedValue({ id: "social-1" } as never)
  vi.mocked(prisma.monitoringSource.findMany).mockResolvedValue([] as never)
  vi.mocked(getOrgId).mockResolvedValue(undefined as never) // no session by default → soft org-cross-check passes
})

describe("FB OAuth callback signed-state acceptance", () => {
  it("rejects the param-only path (no cookie) when NO session resolves — cookie gave no CSRF proof (#2)", async () => {
    const err = await errorOf(await GET(req(valid())))
    expect(err).not.toBe("missing_cookie") // the state param IS accepted as the source...
    expect(err).toBe("no_session")          // ...but CSRF now REQUIRES a matching session on this path
  })

  it("accepts the cookie when it matches the state param", async () => {
    const s = valid()
    expect(["not_configured", "token_exchange_failed"]).toContain(await errorOf(await GET(req(s, s))))
  })

  it("rejects when the cookie differs from the state param (CSRF cross-check)", async () => {
    const evil = sign({ orgId: "evil", state: "x", ts: Date.now() })
    expect(await errorOf(await GET(req(valid(), evil)))).toBe("state_mismatch")
  })

  it("rejects a tampered/forged state (bad signature)", async () => {
    const forged = Buffer.from(JSON.stringify({ orgId: "evil", state: "x", ts: Date.now() }) + ".deadbeef").toString("base64url")
    expect(await errorOf(await GET(req(forged)))).toBe("bad_signature")
  })

  it("rejects an expired state (older than 30 min)", async () => {
    const old = sign({ orgId: "org1", state: "nonce", ts: Date.now() - 40 * 60 * 1000 })
    expect(await errorOf(await GET(req(old)))).toBe("expired")
  })

  it("rejects when the session org differs from the state's org (insider CSRF cross-check)", async () => {
    vi.mocked(getOrgId).mockResolvedValue("differentOrg" as never)
    expect(await errorOf(await GET(req(valid())))).toBe("org_mismatch")
  })

  it("accepts when the session org matches the state's org", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1" as never)
    expect(["not_configured", "token_exchange_failed"]).toContain(await errorOf(await GET(req(valid()))))
  })

  it("fetches managed pages with bearer auth instead of putting the long user token in the URL", async () => {
    process.env.FACEBOOK_APP_ID = "APP_ID"
    process.env.FACEBOOK_APP_SECRET = "APP_SECRET"
    process.env.FACEBOOK_REDIRECT_URI = "https://app.leaddrivecrm.org/api/v1/social/oauth/facebook/callback"
    vi.mocked(getOrgId).mockResolvedValue("org1" as never)
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void init
      const url = String(input)
      if (url.includes("/oauth/access_token?client_id=")) {
        return new Response(JSON.stringify({ access_token: "SHORT_USER_TOKEN" }), { status: 200 })
      }
      if (url.includes("grant_type=fb_exchange_token")) {
        return new Response(JSON.stringify({ access_token: "LONG_USER_TOKEN" }), { status: 200 })
      }
      if (url.includes("/me/accounts")) {
        return new Response(JSON.stringify({
          data: [{ id: "PAGE_1", name: "Brand Page", access_token: "PAGE_TOKEN" }],
        }), { status: 200 })
      }
      return new Response("not found", { status: 404 })
    })
    vi.stubGlobal("fetch", fetchMock)
    const s = valid()

    const res = await GET(req(s, s))

    expect(new URL(res.headers.get("location") || "").searchParams.get("connected")).toBe("facebook")
    const pagesCall = fetchMock.mock.calls.find(([input]) => String(input).includes("/me/accounts"))
    expect(pagesCall).toBeTruthy()
    const pagesUrl = new URL(String(pagesCall?.[0]))
    expect(pagesUrl.searchParams.has("access_token")).toBe(false)
    expect((pagesCall?.[1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer LONG_USER_TOKEN" })
    expect(ensureInboxChannelForPage).toHaveBeenCalledWith("org1", "facebook", "PAGE_1", "Brand Page", "PAGE_TOKEN")
  })
})
