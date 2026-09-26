import { describe, it, expect, beforeEach, vi } from "vitest"
import crypto from "crypto"
import type { NextRequest } from "next/server"

/**
 * Which channel a Meta connect hands back to the channel card — `channelId` on the callback's redirect.
 *
 * 2026-09-21, production, tenant `leaddrive`: "Connect Facebook Page" was started from channel
 * cmua55s6t03n0kpvtm63bclud and came back as
 *   /settings/channels/connect/facebook?mode=existing&stage=connect&connected=facebook&pages=1&ig=0
 * with no row id at all. The page then opened the first live Facebook row it found — another
 * customer's Page, "Andrologiya.az" — under the green "Channel connected" banner, editable and savable.
 *
 * The callback knows exactly which rows it wrote, and the start route knows which row the user
 * pressed Connect on. These tests pin that both are handed back, and that neither can name a row of
 * another tenant or of another channel type.
 */

type Row = { organizationId: string; channelType: string }
const ROWS: Record<string, Row> = {
  cc_origin_fb: { organizationId: "org_1", channelType: "facebook" },
  cc_andro_fb: { organizationId: "org_1", channelType: "facebook" },
  cc_origin_ig: { organizationId: "org_1", channelType: "instagram" },
  cc_other_tenant: { organizationId: "org_2", channelType: "facebook" },
}

const findFirst = vi.fn()
const findMany = vi.fn()
const count = vi.fn()
const create = vi.fn()
const update = vi.fn()
const upsert = vi.fn()

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: {
      findFirst: (...a: unknown[]) => findFirst(...a),
      findMany: (...a: unknown[]) => findMany(...a),
      count: (...a: unknown[]) => count(...a),
      create: (...a: unknown[]) => create(...a),
      update: (...a: unknown[]) => update(...a),
    },
    socialAccount: { upsert: (...a: unknown[]) => upsert(...a) },
  },
}))
// The auth wrapper is exercised by its own tests; here it just supplies the caller's org.
vi.mock("@/lib/social/oauth-access", () => ({
  withSocialConnectAuth: (_action: string, handler: (req: NextRequest, auth: unknown) => unknown) =>
    (req: NextRequest) => handler(req, { orgId: "org_1", role: "admin" }),
}))
vi.mock("@/lib/secure-token", () => ({ encryptToken: vi.fn((token: string) => `enc:${token}`) }))
vi.mock("@/lib/api-auth", () => ({ getOrgId: vi.fn(), getSession: vi.fn().mockResolvedValue(null) }))
// Which row each Page lands in is ensureInboxChannelForPage's business (lib-inbox-channel.test.ts);
// here every Page gets a predictable row id so the callback's choice between them is what is tested.
vi.mock("@/lib/social/inbox-channel", () => ({ ensureInboxChannelForPage: vi.fn() }))
vi.mock("@/lib/social/source-route-plan", () => ({ compileOrganizationSourceRoutePlans: vi.fn() }))

import { GET as fbStart } from "@/app/api/v1/social/oauth/facebook/start/route"
import { GET as igStart } from "@/app/api/v1/social/oauth/instagram/start/route"
import { GET as fbCallback } from "@/app/api/v1/social/oauth/facebook/callback/route"
import { GET as igCallback } from "@/app/api/v1/social/oauth/instagram/callback/route"
import { getOrgId } from "@/lib/api-auth"
import { ensureInboxChannelForPage } from "@/lib/social/inbox-channel"

const SECRET = process.env.NEXTAUTH_SECRET || "ld-social-oauth"

function startReq(provider: "facebook" | "instagram", query: string): NextRequest {
  return { url: `https://app.leaddrivecrm.org/api/v1/social/oauth/${provider}/start${query}` } as unknown as NextRequest
}

/** The signed payload the start route put on the authorize URL. */
function statePayload(res: Response): Record<string, unknown> {
  const raw = new URL(res.headers.get("location")!).searchParams.get("state")!
  const decoded = Buffer.from(raw, "base64url").toString()
  return JSON.parse(decoded.slice(0, decoded.lastIndexOf(".")))
}

function signState(fields: Record<string, unknown>): string {
  const payload = JSON.stringify({ orgId: "org_1", state: "nonce", ts: Date.now(), ...fields })
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("hex")
  return Buffer.from(payload + "." + sig).toString("base64url")
}

function callbackReq(provider: "facebook" | "instagram", state: string): NextRequest {
  const cookieName = provider === "facebook" ? "ld_fb_oauth" : "ld_ig_oauth"
  return {
    url: `https://app.leaddrivecrm.org/api/v1/social/oauth/${provider}/callback?code=CODE&state=${encodeURIComponent(state)}`,
    cookies: { get: (name: string) => (name === cookieName ? { value: state } : undefined) },
    headers: { get: () => null },
  } as unknown as NextRequest
}

function landing(res: Response): URL {
  return new URL(res.headers.get("location") || "")
}

type GraphPage = { id: string; name: string; access_token: string; instagram_business_account?: { id: string; username?: string } }

/** Meta's side of a Facebook Login round trip: token, long token, then the granted Pages. */
function stubFacebookGraph(pages: GraphPage[], options: { shortTokenFails?: boolean } = {}) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("/oauth/access_token?client_id=")) {
      return options.shortTokenFails
        ? new Response("{\"error\":{\"message\":\"bad code\"}}", { status: 400 })
        : new Response(JSON.stringify({ access_token: "SHORT" }), { status: 200 })
    }
    if (url.includes("grant_type=fb_exchange_token")) {
      return new Response(JSON.stringify({ access_token: "LONG" }), { status: 200 })
    }
    if (url.includes("/me/accounts")) return new Response(JSON.stringify({ data: pages }), { status: 200 })
    return new Response("not found", { status: 404 })
  }))
}

/** Meta's side of an Instagram Login round trip for one professional account. */
function stubInstagramGraph(userId: string, username: string) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith("https://api.instagram.com/oauth/access_token")) {
      return new Response(JSON.stringify({ access_token: "IG_SHORT", user_id: userId }), { status: 200 })
    }
    if (url.includes("/access_token?grant_type=ig_exchange_token")) {
      return new Response(JSON.stringify({ access_token: "IG_LONG", expires_in: 5184000 }), { status: 200 })
    }
    if (url.includes("/me?fields=")) {
      return new Response(JSON.stringify({ user_id: userId, username }), { status: 200 })
    }
    return new Response("not found", { status: 404 })
  }))
}

const LEADDRIVE_PAGE: GraphPage = { id: "PAGE_LD", name: "LeadDrive", access_token: "T_LD" }
const ANDRO_PAGE: GraphPage = { id: "PAGE_ANDRO", name: "Andrologiya.az", access_token: "T_ANDRO" }

/** Rows ensureInboxChannelForPage "wrote" for each Page/IG account of the round trip. */
const WIRED_ROW: Record<string, string> = {
  "facebook:PAGE_LD": "cc_origin_fb",
  "facebook:PAGE_ANDRO": "cc_andro_fb",
  "instagram:IG_LD": "cc_ld_ig",
}

beforeEach(() => {
  vi.unstubAllGlobals()
  for (const fn of [findFirst, findMany, count, create, update, upsert]) fn.mockReset()
  findFirst.mockImplementation(async (args: { where: { id?: string; organizationId?: string; channelType?: string } }) => {
    const { id, organizationId, channelType } = args.where
    const row = id ? ROWS[id] : undefined
    if (!row) return null
    if (organizationId !== undefined && row.organizationId !== organizationId) return null
    if (channelType !== undefined && row.channelType !== channelType) return null
    return { id }
  })
  findMany.mockResolvedValue([])
  count.mockResolvedValue(0)
  create.mockResolvedValue({ id: "cc_created" })
  update.mockResolvedValue({})
  upsert.mockResolvedValue({ id: "social" })
  vi.mocked(getOrgId).mockResolvedValue("org_1" as never)
  vi.mocked(ensureInboxChannelForPage).mockReset()
  vi.mocked(ensureInboxChannelForPage).mockImplementation(async (_org, type, pageId) => ({
    created: false,
    subscribed: true,
    channelId: WIRED_ROW[`${type}:${pageId}`],
  }))
  process.env.FACEBOOK_APP_ID = "1276226757359622"
  process.env.FACEBOOK_APP_SECRET = "fb-secret"
  process.env.FACEBOOK_REDIRECT_URI = "https://app.leaddrivecrm.org/api/v1/social/oauth/facebook/callback"
  process.env.INSTAGRAM_APP_ID = "782807994549098"
  process.env.INSTAGRAM_APP_SECRET = "ig-secret"
  process.env.INSTAGRAM_REDIRECT_URI = "https://app.leaddrivecrm.org/api/v1/social/oauth/instagram/callback"
})

describe("start routes: the row Connect was pressed on travels in the signed state", () => {
  it("carries a row of this workspace and of the card's type", async () => {
    const res = await fbStart(startReq("facebook", "?from=channels-facebook&channelId=cc_origin_fb"))
    expect(new URL(res.headers.get("location")!).hostname).toBe("www.facebook.com")
    expect(statePayload(res).channelId).toBe("cc_origin_fb")
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "cc_origin_fb", organizationId: "org_1", channelType: "facebook" },
      select: { id: true },
    })
  })

  it("drops another tenant's row id — and still lets the connect proceed", async () => {
    const res = await fbStart(startReq("facebook", "?from=channels-facebook&channelId=cc_other_tenant"))
    expect(new URL(res.headers.get("location")!).hostname).toBe("www.facebook.com")
    expect(statePayload(res)).not.toHaveProperty("channelId")
  })

  it("drops a row of another channel type (an Instagram row on the Facebook card)", async () => {
    const res = await fbStart(startReq("facebook", "?from=channels-facebook&channelId=cc_origin_ig"))
    expect(statePayload(res)).not.toHaveProperty("channelId")
  })

  it("ignores the id without a channel return target, so Social Monitoring's state is unchanged", async () => {
    const res = await fbStart(startReq("facebook", "?channelId=cc_origin_fb"))
    expect(findFirst).not.toHaveBeenCalled()
    expect(statePayload(res)).toEqual({ orgId: "org_1", state: expect.any(String), ts: expect.any(Number) })
  })

  it("does not even look up an id that cannot be a row id", async () => {
    const res = await fbStart(startReq("facebook", `?from=channels-facebook&channelId=${encodeURIComponent("../x y")}`))
    expect(findFirst).not.toHaveBeenCalled()
    expect(statePayload(res)).not.toHaveProperty("channelId")
  })

  it("does the same on the Instagram-Login start route", async () => {
    const own = await igStart(startReq("instagram", "?from=channels-instagram&channelId=cc_origin_ig"))
    expect(statePayload(own).channelId).toBe("cc_origin_ig")
    const foreign = await igStart(startReq("instagram", "?from=channels-instagram&channelId=cc_other_tenant"))
    expect(statePayload(foreign)).not.toHaveProperty("channelId")
  })
})

describe("facebook callback: the card is handed the row this round trip wired", () => {
  it("names the row it wired — the 2026-09-21 redirect carried no row at all", async () => {
    stubFacebookGraph([LEADDRIVE_PAGE])
    const state = signState({ ret: "channels-facebook", channelId: "cc_origin_fb" })
    const url = landing(await fbCallback(callbackReq("facebook", state)))
    expect(url.pathname).toBe("/settings/channels/connect/facebook")
    expect(url.searchParams.get("connected")).toBe("facebook")
    expect(url.searchParams.get("channelId")).toBe("cc_origin_fb")
  })

  it("names the wired row even when it is not the row the connect started from", async () => {
    // Started on the LeadDrive Page's row, but the Meta user granted a different Page: the card must
    // open the channel that was actually connected, not the one the button sat on.
    stubFacebookGraph([ANDRO_PAGE])
    const state = signState({ ret: "channels-facebook", channelId: "cc_origin_fb" })
    expect(landing(await fbCallback(callbackReq("facebook", state))).searchParams.get("channelId")).toBe("cc_andro_fb")
  })

  it("prefers the origin when several Pages were granted in one go", async () => {
    stubFacebookGraph([ANDRO_PAGE, LEADDRIVE_PAGE])
    const state = signState({ ret: "channels-facebook", channelId: "cc_origin_fb" })
    const url = landing(await fbCallback(callbackReq("facebook", state)))
    expect(url.searchParams.get("pages")).toBe("2")
    expect(url.searchParams.get("channelId")).toBe("cc_origin_fb")
  })

  it("names no row when several Pages were granted and none of them is the origin", async () => {
    // A catalog one-click has no origin. Picking one of the two would be a guess, and on this tenant
    // a guess can be another customer's Page — the card shows a neutral summary instead.
    stubFacebookGraph([ANDRO_PAGE, LEADDRIVE_PAGE])
    const state = signState({ ret: "channels-facebook" })
    const url = landing(await fbCallback(callbackReq("facebook", state)))
    expect(url.searchParams.get("connected")).toBe("facebook")
    expect(url.searchParams.has("channelId")).toBe(false)
  })

  it("never hands back another tenant's row, even from a correctly signed state", async () => {
    stubFacebookGraph([ANDRO_PAGE, LEADDRIVE_PAGE])
    const state = signState({ ret: "channels-facebook", channelId: "cc_other_tenant" })
    const url = landing(await fbCallback(callbackReq("facebook", state)))
    expect(url.searchParams.has("channelId")).toBe(false)
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "cc_other_tenant", organizationId: "org_1", channelType: "facebook" },
      select: { id: true },
    })
  })

  it("hands the Instagram card the Instagram row, never the Page row beside it", async () => {
    stubFacebookGraph([{ ...LEADDRIVE_PAGE, instagram_business_account: { id: "IG_LD", username: "leaddrive" } }])
    const state = signState({ ret: "channels-instagram" })
    const url = landing(await fbCallback(callbackReq("facebook", state)))
    expect(url.pathname).toBe("/settings/channels/connect/instagram")
    expect(url.searchParams.get("channelId")).toBe("cc_ld_ig")
  })

  it("returns the Instagram card to its own row when Meta linked no Instagram account", async () => {
    stubFacebookGraph([LEADDRIVE_PAGE])
    const state = signState({ ret: "channels-instagram", channelId: "cc_origin_ig" })
    const url = landing(await fbCallback(callbackReq("facebook", state)))
    expect(url.searchParams.get("ig")).toBe("0")
    expect(url.searchParams.get("channelId")).toBe("cc_origin_ig")
  })

  it("returns a failed connect to the row it started from", async () => {
    stubFacebookGraph([LEADDRIVE_PAGE], { shortTokenFails: true })
    const state = signState({ ret: "channels-facebook", channelId: "cc_origin_fb" })
    const url = landing(await fbCallback(callbackReq("facebook", state)))
    expect(url.searchParams.get("error")).toBe("token_exchange_failed")
    expect(url.searchParams.get("channelId")).toBe("cc_origin_fb")
  })

  it("keeps a row id off the Social Monitoring return", async () => {
    stubFacebookGraph([LEADDRIVE_PAGE])
    const state = signState({ channelId: "cc_origin_fb" })
    const url = landing(await fbCallback(callbackReq("facebook", state)))
    expect(url.pathname).toBe("/social-monitoring")
    expect(url.searchParams.has("channelId")).toBe(false)
  })
})

describe("instagram callback: the card is handed the one row it wired", () => {
  it("names the row it created", async () => {
    stubInstagramGraph("IG_USER_1", "leaddrive.az")
    create.mockResolvedValue({ id: "cc_new_ig" })
    const state = signState({ ret: "channels-instagram", channelId: "cc_origin_ig" })
    const url = landing(await igCallback(callbackReq("instagram", state)))
    expect(url.searchParams.get("connected")).toBe("instagram")
    expect(url.searchParams.get("channelId")).toBe("cc_new_ig")
    expect(create.mock.calls[0][0]).toMatchObject({ select: { id: true } })
  })

  it("names the row it updated", async () => {
    stubInstagramGraph("IG_USER_1", "leaddrive.az")
    findMany.mockImplementation(async (args: { where: { pageId?: string } }) =>
      args.where.pageId === "IG_USER_1" ? [{ id: "cc_origin_ig", settings: { igLogin: true } }] : [])
    const url = landing(await igCallback(callbackReq("instagram", signState({ ret: "channels-instagram" }))))
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "cc_origin_ig" } }))
    expect(url.searchParams.get("channelId")).toBe("cc_origin_ig")
  })

  it("ignores another tenant's origin id and still names its own row", async () => {
    stubInstagramGraph("IG_USER_1", "leaddrive.az")
    create.mockResolvedValue({ id: "cc_new_ig" })
    const state = signState({ ret: "channels-instagram", channelId: "cc_other_tenant" })
    const url = landing(await igCallback(callbackReq("instagram", state)))
    expect(url.searchParams.get("channelId")).toBe("cc_new_ig")
  })
})
