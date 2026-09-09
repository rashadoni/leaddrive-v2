import { describe, it, expect, beforeEach } from "vitest"
import crypto from "crypto"
import type { NextRequest } from "next/server"
import { vi } from "vitest"

/**
 * X (Twitter) OAuth callback — signed state carried in the `state` param (survives any host) OR the
 * cookie (same-host). Port of the TikTok subdomain fix (#257): a cookie-only state caused
 * `missing_cookie` on tenant subdomains where the cookie host ≠ the fixed TWITTER_REDIRECT_URI host.
 * The HMAC signature guards integrity; the cookie↔state cross-check guards CSRF when both are
 * present; the param-only path additionally requires a matching session. The PKCE verifier rides
 * ENCRYPTED (field `v`) inside the signed payload — the state param is URL-visible, so a plaintext
 * verifier there would defeat PKCE — and the token exchange hard-requires the client secret.
 */
vi.mock("@/lib/prisma", () => ({
  prisma: { socialAccount: { upsert: vi.fn().mockResolvedValue({ id: "social-1" }) } },
}))
vi.mock("@/lib/secure-token", () => ({
  encryptToken: vi.fn((token: string) => `enc:${token}`),
  decryptToken: vi.fn((token: string) => (token.startsWith("enc:") ? token.slice(4) : token)),
}))
vi.mock("@/lib/api-auth", () => ({ getOrgId: vi.fn() }))
vi.mock("@/lib/rls-context", () => ({ runWithTenant: vi.fn((_org: string, fn: () => unknown) => fn()) }))

import { GET } from "@/app/api/v1/social/oauth/twitter/callback/route"
import { getOrgId } from "@/lib/api-auth"

const SECRET = process.env.NEXTAUTH_SECRET || "ld-social-oauth"
function sign(obj: object): string {
  const payload = JSON.stringify(obj)
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("hex")
  return Buffer.from(payload + "." + sig).toString("base64url")
}
function req(stateParam: string, cookieVal?: string): NextRequest {
  return {
    url: `http://0.0.0.0:3001/api/v1/social/oauth/twitter/callback?code=CODE&state=${encodeURIComponent(stateParam)}`,
    cookies: { get: (n: string) => (n === "ld_tw_oauth" && cookieVal ? { value: cookieVal } : undefined) },
    headers: {
      get: (h: string) =>
        h === "x-forwarded-host" ? "app.leaddrivecrm.org" : h === "x-forwarded-proto" ? "https" : null,
    },
  } as unknown as NextRequest
}
function locOf(res: Response): URL {
  return new URL(res.headers.get("location") || "")
}
async function errorOf(res: Response): Promise<string | null> {
  return locOf(res).searchParams.get("error")
}
const valid = () => sign({ orgId: "org1", state: "nonce", v: "enc:pkce-verifier", ts: Date.now() })

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.TWITTER_CLIENT_ID // valid state then stops at "not_configured" — got PAST the state gate
  delete process.env.TWITTER_CLIENT_SECRET
  delete process.env.TWITTER_REDIRECT_URI
  vi.mocked(getOrgId).mockResolvedValue(undefined as never)
})

describe("X (Twitter) OAuth callback signed-state acceptance", () => {
  it("accepts the state PARAM when the cookie is dropped (subdomain fix) — no longer missing_cookie", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1" as never) // matching session satisfies the param-only CSRF gate
    const err = await errorOf(await GET(req(valid())))
    expect(err).not.toBe("missing_cookie")
    expect(err).toBe("not_configured") // reached the token-exchange stage → state gate passed
  })

  it("rejects the param-only path when NO session resolves (cookie gave no CSRF proof)", async () => {
    expect(await errorOf(await GET(req(valid())))).toBe("no_session")
  })

  it("accepts the cookie when it matches the state param", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1" as never)
    const s = valid()
    expect(await errorOf(await GET(req(s, s)))).toBe("not_configured")
  })

  it("rejects when the cookie differs from the state param (CSRF cross-check)", async () => {
    const evil = sign({ orgId: "evil", state: "x", v: "enc:v", ts: Date.now() })
    expect(await errorOf(await GET(req(valid(), evil)))).toBe("state_mismatch")
  })

  it("rejects a tampered/forged state (bad signature)", async () => {
    const forged = Buffer.from(JSON.stringify({ orgId: "evil", state: "x", v: "enc:v", ts: Date.now() }) + ".deadbeef").toString("base64url")
    expect(await errorOf(await GET(req(forged)))).toBe("bad_signature")
  })

  it("rejects an expired state (older than 30 min)", async () => {
    const old = sign({ orgId: "org1", state: "nonce", v: "enc:pkce-verifier", ts: Date.now() - 40 * 60 * 1000 })
    expect(await errorOf(await GET(req(old)))).toBe("expired")
  })

  it("hard-requires the client secret — configured id+redirect without a secret is still not_configured", async () => {
    // The PKCE verifier travels (encrypted) in the URL-visible state param, so confidential-client
    // Basic auth is the hard gate; the route must refuse to run as a public client.
    vi.mocked(getOrgId).mockResolvedValue("org1" as never)
    process.env.TWITTER_CLIENT_ID = "cid"
    process.env.TWITTER_REDIRECT_URI = "https://app.leaddrivecrm.org/api/v1/social/oauth/twitter/callback"
    expect(await errorOf(await GET(req(valid())))).toBe("not_configured")
  })

  it("rejects when the session org differs from the state's org (insider CSRF cross-check)", async () => {
    vi.mocked(getOrgId).mockResolvedValue("differentOrg" as never)
    expect(await errorOf(await GET(req(valid())))).toBe("org_mismatch")
  })

  it("redirects to the PUBLIC host (x-forwarded-host), not the internal upstream in req.url", async () => {
    // req.url host is 0.0.0.0:3001 (behind nginx); the redirect must use app.leaddrivecrm.org.
    const loc = locOf(await GET(req(valid())))
    expect(loc.host).toBe("app.leaddrivecrm.org")
    expect(loc.protocol).toBe("https:")
  })
})
