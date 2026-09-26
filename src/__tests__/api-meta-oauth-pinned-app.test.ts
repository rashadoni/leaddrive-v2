import { describe, it, expect, beforeEach, vi } from "vitest"
import type { NextRequest } from "next/server"

/**
 * `?app=<channelConfigId>` on the Facebook / Instagram OAuth start routes — the isolated path used to
 * stage a Meta app that is still under review.
 *
 * The behaviour worth pinning down in a test is the NEGATIVE one. An OAuth start whose credentials do
 * not resolve has always fallen back to LeadDrive's shared production app, silently; a consent screen
 * for the wrong App ID looks exactly like a correct one, and the substitution was only ever caught by
 * reading production by hand. So: when a flow names an app it cannot have, it must fail, and it must
 * not reach Facebook at all.
 */

const findFirst = vi.fn()
const findMany = vi.fn()
const count = vi.fn()

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: {
      findFirst: (...a: any[]) => findFirst(...a),
      findMany: (...a: any[]) => findMany(...a),
      count: (...a: any[]) => count(...a),
    },
  },
}))
// The auth wrapper is exercised by its own tests; here it just supplies the org.
vi.mock("@/lib/social/oauth-access", () => ({
  withSocialConnectAuth: (_action: string, handler: any) => (req: NextRequest) =>
    handler(req, { orgId: "org_1", role: "admin" }),
}))

import { GET as fbStart } from "@/app/api/v1/social/oauth/facebook/start/route"
import { GET as igStart } from "@/app/api/v1/social/oauth/instagram/start/route"

const STAGED = {
  id: "cfg_staged",
  channelType: "facebook",
  appId: "2414060595720618",
  appSecret: "s",
  verifyToken: "v",
  settings: { appReviewOnly: true },
}

function fbReq(query: string): NextRequest {
  return { url: `https://app.leaddrivecrm.org/api/v1/social/oauth/facebook/start${query}` } as unknown as NextRequest
}
function igReq(query: string): NextRequest {
  return { url: `https://app.leaddrivecrm.org/api/v1/social/oauth/instagram/start${query}` } as unknown as NextRequest
}

/** Decode the signed state the start route put on the authorize URL. */
function statePayload(res: Response): Record<string, unknown> {
  const raw = new URL(res.headers.get("location")!).searchParams.get("state")!
  const decoded = Buffer.from(raw, "base64url").toString()
  return JSON.parse(decoded.slice(0, decoded.lastIndexOf(".")))
}

beforeEach(() => {
  findFirst.mockReset()
  findMany.mockReset()
  count.mockReset()
  findMany.mockResolvedValue([])
  count.mockResolvedValue(0)
  process.env.FACEBOOK_APP_ID = "1276226757359622" // the live production app
  process.env.FACEBOOK_REDIRECT_URI = "https://app.leaddrivecrm.org/api/v1/social/oauth/facebook/callback"
  process.env.INSTAGRAM_APP_ID = "782807994549098"
  process.env.INSTAGRAM_REDIRECT_URI = "https://app.leaddrivecrm.org/api/v1/social/oauth/instagram/callback"
})

describe("facebook/start with ?app=", () => {
  it("uses the pinned app, not the env app, and carries the pin in the signed state", async () => {
    findFirst.mockResolvedValue(STAGED)
    const res = await fbStart(fbReq("?from=channels-facebook&app=cfg_staged"))
    const loc = new URL(res.headers.get("location")!)
    expect(loc.searchParams.get("client_id")).toBe("2414060595720618")
    expect(loc.searchParams.get("client_id")).not.toBe(process.env.FACEBOOK_APP_ID)
    expect(statePayload(res).app).toBe("cfg_staged")
  })

  it("requests the Messenger surface and nothing else", async () => {
    // Changed deliberately on 2026-09-20. Asking for the monitoring and Instagram permissions on a
    // staged app does not merely request too much — Facebook refuses the entire dialog:
    //   "Invalid Scopes: pages_read_engagement, pages_read_user_content, instagram_basic,
    //    instagram_manage_messages"
    // Instagram is a separate app and a separate submission, so it cannot be in this request.
    findFirst.mockResolvedValue(STAGED)
    count.mockResolvedValue(0)
    const res = await fbStart(fbReq("?app=cfg_staged"))
    const scope = (new URL(res.headers.get("location")!).searchParams.get("scope") || "").split(",")
    expect(scope).toEqual([
      "public_profile",
      "pages_show_list",
      "business_management",
      "pages_messaging",
      "pages_manage_metadata",
    ])
  })

  it("sends config_id INSTEAD of scope when the tenant runs Facebook Login for Business", async () => {
    // Meta: "config_id has replaced scope (which should not be used)". Sending both is what produced
    // an Invalid Scopes rejection, and a scope-only request is what produced an empty /me/accounts.
    findFirst.mockResolvedValue({ ...STAGED, settings: { appReviewOnly: true, loginConfigId: "1122334455" } })
    const res = await fbStart(fbReq("?app=cfg_staged"))
    const params = new URL(res.headers.get("location")!).searchParams
    expect(params.get("config_id")).toBe("1122334455")
    expect(params.get("scope")).toBeNull()
  })

  it("keeps sending scope when no configuration id is set", async () => {
    findFirst.mockResolvedValue(STAGED)
    const res = await fbStart(fbReq("?app=cfg_staged"))
    const params = new URL(res.headers.get("location")!).searchParams
    expect(params.get("config_id")).toBeNull()
    expect(params.get("scope")).toContain("pages_messaging")
  })

  it("an unpinned flow keeps the historical scope list untouched", async () => {
    count.mockResolvedValue(1)
    const res = await fbStart(fbReq("?from=channels-facebook"))
    const scope = new URL(res.headers.get("location")!).searchParams.get("scope") || ""
    for (const p of ["pages_read_engagement", "instagram_basic", "instagram_manage_messages"]) {
      expect(scope, `existing tenants must keep ${p}`).toContain(p)
    }
  })

  it("FAILS CLOSED when the named row cannot be used — no redirect to Facebook", async () => {
    findFirst.mockResolvedValue({ ...STAGED, verifyToken: null }) // incomplete triple
    const res = await fbStart(fbReq("?app=cfg_staged"))
    expect(res.status).toBe(400)
    expect(res.headers.get("location")).toBeNull()
  })

  it("FAILS CLOSED for a row belonging to another organization", async () => {
    findFirst.mockResolvedValue(null)
    const res = await fbStart(fbReq("?app=cfg_of_another_org"))
    expect(res.status).toBe(400)
  })

  it("refuses an Instagram-Login row on the Facebook surface", async () => {
    findFirst.mockResolvedValue({ ...STAGED, channelType: "instagram", settings: { igLogin: true } })
    expect((await fbStart(fbReq("?app=cfg_staged"))).status).toBe(400)
  })

  it("without ?app the flow is byte-for-byte the historical one", async () => {
    const res = await fbStart(fbReq(""))
    expect(findFirst).not.toHaveBeenCalled()
    expect(new URL(res.headers.get("location")!).searchParams.get("client_id")).toBe("1276226757359622")
    expect(statePayload(res)).toEqual({
      orgId: "org_1",
      state: expect.any(String),
      ts: expect.any(Number),
    })
  })
})

describe("instagram/start with ?app=", () => {
  const IG_STAGED = { ...STAGED, id: "cfg_ig", channelType: "instagram", appId: "IG_NEW", settings: { igLogin: true, appReviewOnly: true } }

  it("uses the pinned Instagram-Login app and carries the pin", async () => {
    findFirst.mockResolvedValue(IG_STAGED)
    const res = await igStart(igReq("?from=channels-instagram&app=cfg_ig"))
    const loc = new URL(res.headers.get("location")!)
    expect(loc.origin + loc.pathname).toBe("https://api.instagram.com/oauth/authorize")
    expect(loc.searchParams.get("client_id")).toBe("IG_NEW")
    expect(statePayload(res).app).toBe("cfg_ig")
  })

  it("FAILS CLOSED rather than falling back to the env Instagram app", async () => {
    findFirst.mockResolvedValue(null)
    const res = await igStart(igReq("?app=cfg_ig"))
    expect(res.status).toBe(400)
    expect(res.headers.get("location")).toBeNull()
  })

  it("refuses a Facebook-Login row on the Instagram-Login surface", async () => {
    findFirst.mockResolvedValue({ ...IG_STAGED, channelType: "facebook", settings: { appReviewOnly: true } })
    expect((await igStart(igReq("?app=cfg_ig"))).status).toBe(400)
  })
})
