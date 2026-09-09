import { describe, it, expect, beforeEach } from "vitest"
import crypto from "crypto"
import type { NextRequest } from "next/server"
import { vi } from "vitest"

/**
 * Instagram-Login OAuth callback ("Path B") — same signed-state CSRF scheme as the Facebook flow:
 * the state param survives any host, the cookie (ld_ig_oauth) cross-checks when present, the HMAC
 * signature guards integrity, and the cookie-less path requires a matching session. The not-configured
 * gate keys on INSTAGRAM_APP_ID, so deleting it proves a request got PAST the state gate.
 */
vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "channel-1" }),
      update: vi.fn().mockResolvedValue({ id: "channel-1" }),
    },
  },
}))
vi.mock("@/lib/secure-token", () => ({ encryptToken: vi.fn() }))
vi.mock("@/lib/api-auth", () => ({ getOrgId: vi.fn(), getSession: vi.fn().mockResolvedValue(null) }))

import { GET } from "@/app/api/v1/social/oauth/instagram/callback/route"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

const SECRET = process.env.NEXTAUTH_SECRET || "ld-social-oauth"
function sign(obj: object): string {
  const payload = JSON.stringify(obj)
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("hex")
  return Buffer.from(payload + "." + sig).toString("base64url")
}
function req(stateParam: string, cookieVal?: string): NextRequest {
  return {
    url: `https://app.leaddrivecrm.org/api/v1/social/oauth/instagram/callback?code=CODE&state=${encodeURIComponent(stateParam)}`,
    cookies: { get: (n: string) => (n === "ld_ig_oauth" && cookieVal ? { value: cookieVal } : undefined) },
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
  delete process.env.INSTAGRAM_APP_ID // valid state then stops at "not_configured" — i.e. it got PAST the state gate
  delete process.env.INSTAGRAM_APP_SECRET
  delete process.env.INSTAGRAM_REDIRECT_URI
  vi.mocked(prisma.channelConfig.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.channelConfig.create).mockResolvedValue({ id: "channel-1" } as never)
  vi.mocked(prisma.channelConfig.update).mockResolvedValue({ id: "channel-1" } as never)
  vi.mocked(getOrgId).mockResolvedValue(undefined as never) // no session by default
})

describe("Instagram-Login OAuth callback signed-state acceptance", () => {
  it("rejects the param-only path (no cookie) when NO session resolves — cookie gave no CSRF proof", async () => {
    const err = await errorOf(await GET(req(valid())))
    expect(err).not.toBe("missing_code") // the state param IS accepted as the source...
    expect(err).toBe("no_session")        // ...but CSRF REQUIRES a matching session on the cookie-less path
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

  it("fetches the Instagram profile with bearer auth instead of putting the long token in the URL", async () => {
    process.env.INSTAGRAM_APP_ID = "IG_APP_ID"
    process.env.INSTAGRAM_APP_SECRET = "IG_APP_SECRET"
    process.env.INSTAGRAM_REDIRECT_URI = "https://app.leaddrivecrm.org/api/v1/social/oauth/instagram/callback"
    vi.mocked(getOrgId).mockResolvedValue("org1" as never)
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "https://api.instagram.com/oauth/access_token") {
        const form = init?.body as URLSearchParams
        expect(form.get("client_secret")).toBe("IG_APP_SECRET")
        return new Response(JSON.stringify({ access_token: "SHORT_IG_TOKEN", user_id: "1781" }), { status: 200 })
      }
      if (url.includes("/access_token?grant_type=ig_exchange_token")) {
        return new Response(JSON.stringify({ access_token: "LONG_IG_TOKEN", expires_in: 3600 }), { status: 200 })
      }
      if (url.includes("/me?fields=user_id,username")) {
        return new Response(JSON.stringify({ user_id: "1781", username: "brand" }), { status: 200 })
      }
      return new Response("not found", { status: 404 })
    })
    vi.stubGlobal("fetch", fetchMock)
    const s = valid()

    const res = await GET(req(s, s))

    expect(new URL(res.headers.get("location") || "").searchParams.get("connected")).toBe("instagram")
    const meCall = fetchMock.mock.calls.find(([input]) => String(input).includes("/me?fields=user_id,username"))
    expect(meCall).toBeTruthy()
    const meUrl = new URL(String(meCall?.[0]))
    expect(meUrl.searchParams.has("access_token")).toBe(false)
    expect((meCall?.[1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer LONG_IG_TOKEN" })
    expect(prisma.channelConfig.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org1",
        channelType: "instagram",
        pageId: "1781",
        apiKey: "LONG_IG_TOKEN",
      }),
    }))
  })
})
