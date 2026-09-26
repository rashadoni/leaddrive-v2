import { describe, it, expect, beforeEach, vi } from "vitest"
import crypto from "crypto"
import type { NextRequest } from "next/server"

/**
 * A STAGED Meta connect (pinned `?app=<channelConfigId>`, Meta App Review) must leave Social
 * Monitoring exactly as it was.
 *
 * The Facebook callback loops over EVERY Page the connecting Meta user can reach. Until this guard it
 * upserted a SocialAccount for each of them with no staged check — `accessToken` replaced by a token
 * minted by the app under review, `isActive: true` forced — while the inbox side was already confined
 * to staged rows. Production, tenant `leaddrive`: staged connects at 2026-09-20 21:20 and 2026-09-21
 * 13:47 UTC rewrote the SocialAccount of Page 373662722735767 (the daily backups show its ciphertext
 * change twice, each time within milliseconds of the staged ChannelConfig write), and polling of that
 * Page has not succeeded since the minute before the first of them. The staged consent asks for the
 * Messenger scopes only, so that token cannot read a Page's feed at all.
 *
 * These tests run the real callbacks, the real inbox wiring and the real token encryption against an
 * in-memory copy of the tables they write, then read the rows back: the property is "the live rows are
 * what they were", not "upsert was not called".
 */

// A stand-in for Prisma's rows and arguments, which differ per call; typing them is the real client's job.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

const mem = vi.hoisted(() => {
  const db: { channelConfig: Row[]; socialAccount: Row[] } = { channelConfig: [], socialAccount: [] }
  let clock = Date.parse("2026-09-21T13:47:42Z")
  let seq = 0
  const now = () => new Date((clock += 1))

  function matches(row: Row, where: Row = {}): boolean {
    return Object.entries(where).every(([key, cond]) => {
      const value = row[key] ?? null
      if (cond && typeof cond === "object" && !Array.isArray(cond) && !(cond instanceof Date)) {
        if ("in" in cond) return (cond.in as unknown[]).includes(value)
        if ("not" in cond) return value !== cond.not
        throw new Error(`in-memory prisma: unsupported filter on ${key}: ${JSON.stringify(cond)}`)
      }
      return value === (cond ?? null)
    })
  }
  const project = (row: Row, select?: Row): Row =>
    select ? Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, row[k] ?? null])) : { ...row }
  const sorted = (rows: Row[], orderBy?: Row): Row[] => {
    if (!orderBy) return rows
    const [[key, dir]] = Object.entries(orderBy)
    return [...rows].sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (dir === "desc" ? -1 : 1))
  }

  function table(name: keyof typeof db) {
    return {
      findFirst: async ({ where, select }: Row) => {
        const row = db[name].find((r) => matches(r, where))
        return row ? project(row, select) : null
      },
      findMany: async ({ where, select, orderBy }: Row = {}) =>
        sorted(db[name].filter((r) => matches(r, where)), orderBy).map((r) => project(r, select)),
      count: async ({ where }: Row = {}) => db[name].filter((r) => matches(r, where)).length,
      create: async ({ data, select }: Row) => {
        const row = { id: `${name}_${++seq}`, isActive: true, createdAt: now(), updatedAt: now(), ...data }
        db[name].push(row)
        return project(row, select)
      },
      update: async ({ where, data }: Row) => {
        const row = db[name].find((r) => matches(r, where))
        if (!row) throw new Error(`in-memory prisma: no ${name} row for ${JSON.stringify(where)}`)
        Object.assign(row, data, { updatedAt: now() })
        return { ...row }
      },
      // Prisma's compound-unique input, e.g. { organizationId_platform_handle: { organizationId, platform, handle } }.
      upsert: async ({ where, update, create }: Row) => {
        const key = Object.values(where)[0] as Row
        const row = db[name].find((r) => matches(r, key))
        if (row) {
          Object.assign(row, update, { updatedAt: now() })
          return { ...row }
        }
        const created = { id: `${name}_${++seq}`, isActive: true, createdAt: now(), updatedAt: now(), ...create }
        db[name].push(created)
        return { ...created }
      },
    }
  }

  return { db, table, compileOrganizationSourceRoutePlans: vi.fn() }
})

vi.mock("@/lib/prisma", () => ({
  prisma: { channelConfig: mem.table("channelConfig"), socialAccount: mem.table("socialAccount") },
}))
vi.mock("@/lib/api-auth", () => ({ getOrgId: vi.fn(async () => "org_ld") }))
vi.mock("@/lib/social/source-route-plan", () => ({
  compileOrganizationSourceRoutePlans: mem.compileOrganizationSourceRoutePlans,
}))

import { GET as fbCallback } from "@/app/api/v1/social/oauth/facebook/callback/route"
import { GET as igCallback } from "@/app/api/v1/social/oauth/instagram/callback/route"
import { encryptToken, decryptToken } from "@/lib/secure-token"

const ORG = "org_ld"
const LIVE_FB_APP = "1276226757359622"
const REVIEW_APP = "2414060595720618"
const SECRET = process.env.NEXTAUTH_SECRET || "ld-social-oauth"

type GraphPage = { id: string; name: string; access_token: string; instagram_business_account?: { id: string; username?: string } }

/** Everything the Graph API was asked during one round trip. */
let graphCalls: string[] = []

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

/** Meta's side of a Facebook Login round trip: code → token → long token → the granted Pages. */
function stubFacebookGraph(pages: GraphPage[]) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    graphCalls.push(url)
    if (url.includes("/oauth/access_token?client_id=")) return json({ access_token: "SHORT" })
    if (url.includes("grant_type=fb_exchange_token")) return json({ access_token: "LONG" })
    if (url.includes("/me/accounts")) return json({ data: pages })
    if (url.endsWith("/subscribed_apps")) return json({ success: true })
    return new Response("not found", { status: 404 })
  }))
}

/** Meta's side of an Instagram Login round trip for one professional account. */
function stubInstagramGraph(userId: string, username: string) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    graphCalls.push(url)
    if (url.startsWith("https://api.instagram.com/oauth/access_token")) return json({ access_token: "IG_SHORT", user_id: userId })
    if (url.includes("/access_token?grant_type=ig_exchange_token")) return json({ access_token: "REVIEW_IG_LOGIN_TOKEN", expires_in: 5184000 })
    if (url.includes("/me?fields=")) return json({ user_id: userId, username })
    return new Response("not found", { status: 404 })
  }))
}

function signState(fields: Record<string, unknown>): string {
  const payload = JSON.stringify({ orgId: ORG, state: "nonce", ts: Date.now(), ...fields })
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

const landing = (res: Response) => new URL(res.headers.get("location") || "")
const socialAccount = (id: string) => mem.db.socialAccount.find((r) => r.id === id)!
const channelConfig = (id: string) => mem.db.channelConfig.find((r) => r.id === id)!
const at = (iso: string) => new Date(iso)

/**
 * Tenant `leaddrive` as production holds it: the staged app-config rows next to live Pages, one of
 * whose monitoring accounts somebody switched off.
 */
function seedLeaddrive() {
  mem.db.channelConfig = [
    {
      id: "cfg_review", organizationId: ORG, channelType: "facebook", configName: `Meta App Review — CRM ${REVIEW_APP}`,
      pageId: null, apiKey: null, appId: REVIEW_APP, appSecret: "review-secret", verifyToken: "review-verify",
      isActive: true, settings: { appReviewOnly: true }, createdAt: at("2026-09-20T18:20:09Z"), updatedAt: at("2026-09-21T09:02:23Z"),
    },
    {
      id: "cfg_review_ig", organizationId: ORG, channelType: "instagram", configName: "Instagram Direct",
      pageId: null, apiKey: null, appId: "782807994549098", appSecret: "review-ig-secret", verifyToken: "review-ig-verify",
      isActive: true, settings: { igLogin: true, appReviewOnly: true }, createdAt: at("2026-09-21T07:13:20Z"), updatedAt: at("2026-09-21T07:13:20Z"),
    },
    {
      id: "cc_live_ld", organizationId: ORG, channelType: "facebook", configName: "Мыслители прошлого",
      pageId: "PAGE_LD", apiKey: "LIVE_TOKEN_LD", appId: LIVE_FB_APP, appSecret: "live-secret", verifyToken: null,
      isActive: false, settings: { inboxSubscribed: true }, createdAt: at("2026-06-07T08:24:13Z"), updatedAt: at("2026-09-21T12:18:11Z"),
    },
    {
      id: "cc_live_ld_ig", organizationId: ORG, channelType: "instagram", configName: "Мыслители прошлого / @leaddrive.az",
      pageId: "IG_LD", apiKey: "LIVE_TOKEN_LD", appId: LIVE_FB_APP, appSecret: "live-secret", verifyToken: null,
      isActive: false, settings: { inboxSubscribed: true }, createdAt: at("2026-06-07T08:24:13Z"), updatedAt: at("2026-09-11T14:03:22Z"),
    },
  ]
  mem.db.socialAccount = [
    {
      id: "sa_ld", organizationId: ORG, platform: "facebook", handle: "PAGE_LD", displayName: "Мыслители прошлого",
      accessToken: encryptToken("LIVE_TOKEN_LD", "oauth:facebook:PAGE_LD"), isActive: true,
      lastPolledAt: at("2026-09-20T21:18:01Z"), createdAt: at("2026-04-18T20:19:30Z"), updatedAt: at("2026-09-20T21:18:01Z"),
    },
    {
      // Switched off by hand — a connect of some other app must not switch it back on.
      id: "sa_sport", organizationId: ORG, platform: "facebook", handle: "PAGE_SPORT", displayName: "Sport&Diet",
      accessToken: encryptToken("LIVE_TOKEN_SPORT", "oauth:facebook:PAGE_SPORT"), isActive: false,
      lastPolledAt: at("2026-09-21T16:18:11Z"), createdAt: at("2026-04-18T18:53:46Z"), updatedAt: at("2026-09-21T16:18:12Z"),
    },
    {
      id: "sa_ld_ig", organizationId: ORG, platform: "instagram", handle: "IG_LD", displayName: "Мыслители прошлого / @leaddrive.az",
      accessToken: encryptToken("LIVE_TOKEN_LD", "oauth:instagram:IG_LD"), isActive: true,
      lastPolledAt: at("2026-08-25T11:03:51Z"), createdAt: at("2026-04-18T20:19:30Z"), updatedAt: at("2026-08-25T15:11:04Z"),
    },
  ]
}

/** What Meta returns to a consent through the app under review: the live Pages, plus one new one. */
const GRANTED_THROUGH_REVIEW_APP: GraphPage[] = [
  { id: "PAGE_LD", name: "Lead Drive CRM", access_token: "REVIEW_TOKEN_LD", instagram_business_account: { id: "IG_LD", username: "leaddrive.az" } },
  { id: "PAGE_SPORT", name: "Sport&Diet", access_token: "REVIEW_TOKEN_SPORT" },
  { id: "PAGE_SANDBOX", name: "Review Sandbox", access_token: "REVIEW_TOKEN_SANDBOX" },
]

beforeEach(() => {
  vi.unstubAllGlobals()
  graphCalls = []
  mem.compileOrganizationSourceRoutePlans.mockReset()
  seedLeaddrive()
  process.env.FACEBOOK_APP_ID = LIVE_FB_APP
  process.env.FACEBOOK_APP_SECRET = "live-secret"
  process.env.FACEBOOK_REDIRECT_URI = "https://app.leaddrivecrm.org/api/v1/social/oauth/facebook/callback"
  process.env.INSTAGRAM_APP_ID = "782807994549098"
  process.env.INSTAGRAM_APP_SECRET = "ig-secret"
  process.env.INSTAGRAM_REDIRECT_URI = "https://app.leaddrivecrm.org/api/v1/social/oauth/instagram/callback"
})

describe("facebook callback, pinned to the app under review", () => {
  async function stagedConnect() {
    stubFacebookGraph(GRANTED_THROUGH_REVIEW_APP)
    const state = signState({ app: "cfg_review", ret: "channels-facebook", channelId: "cfg_review" })
    return landing(await fbCallback(callbackReq("facebook", state)))
  }

  it("completes the connect through the pinned app — so the checks below are not vacuous", async () => {
    const url = await stagedConnect()
    expect(url.searchParams.get("error")).toBeNull()
    expect(url.searchParams.get("connected")).toBe("facebook")
    expect(url.searchParams.get("pages")).toBe("3")
    expect(url.searchParams.get("ig")).toBe("1")
    expect(graphCalls.some((u) => u.includes(`/oauth/access_token?client_id=${REVIEW_APP}&`))).toBe(true)
  })

  it("leaves a live SocialAccount's accessToken and isActive unchanged", async () => {
    const before = structuredClone(mem.db.socialAccount)
    await stagedConnect()

    for (const id of ["sa_ld", "sa_sport", "sa_ld_ig"]) {
      const was = before.find((r) => r.id === id)!
      expect(socialAccount(id).accessToken).toBe(was.accessToken)
      expect(socialAccount(id).isActive).toBe(was.isActive)
    }
    // Read the way the pollers read it: still the live app's token, and the switched-off account is off.
    expect(decryptToken(socialAccount("sa_ld").accessToken, "oauth:facebook:PAGE_LD")).toBe("LIVE_TOKEN_LD")
    expect(decryptToken(socialAccount("sa_ld_ig").accessToken, "oauth:instagram:IG_LD")).toBe("LIVE_TOKEN_LD")
    expect(socialAccount("sa_sport").isActive).toBe(false)
    // Nothing else about them moved either — not even the name the Page has since been given.
    expect(mem.db.socialAccount).toEqual(before)
  })

  it("creates no SocialAccount for a Page it has not seen before", async () => {
    // A new row would be polled with a token that has no read scope, and would join the meta-social
    // webhook's Page → organization lookup.
    await stagedConnect()
    expect(mem.db.socialAccount.map((r) => r.handle).sort()).toEqual(["IG_LD", "PAGE_LD", "PAGE_SPORT"])
  })

  it("does not recompile Social Monitoring's route plans (that resets live circuit breakers)", async () => {
    await stagedConnect()
    expect(mem.compileOrganizationSourceRoutePlans).not.toHaveBeenCalled()
  })

  it("still does what staging is for: staged inbox rows, live inbox rows untouched, nothing subscribed", async () => {
    const liveBefore = structuredClone([channelConfig("cc_live_ld"), channelConfig("cc_live_ld_ig")])
    await stagedConnect()

    const staged = mem.db.channelConfig.filter((r) => r.pageId && r.settings?.appReviewOnly === true)
    expect(staged.map((r) => `${r.channelType}:${r.pageId}:${r.apiKey}`).sort()).toEqual([
      "facebook:PAGE_LD:REVIEW_TOKEN_LD",
      "facebook:PAGE_SANDBOX:REVIEW_TOKEN_SANDBOX",
      "facebook:PAGE_SPORT:REVIEW_TOKEN_SPORT",
      "instagram:IG_LD:REVIEW_TOKEN_LD",
    ])
    expect([channelConfig("cc_live_ld"), channelConfig("cc_live_ld_ig")]).toEqual(liveBefore)
    expect(graphCalls.filter((u) => u.endsWith("/subscribed_apps"))).toEqual([])
  })
})

describe("facebook callback, ordinary (unpinned) connect — control", () => {
  it("still refreshes Social Monitoring from the live app and recompiles its plans", async () => {
    // The same table and the same round trip, without the pin: this is what proves the in-memory
    // SocialAccount records the callback's writes, i.e. that the staged tests above can fail.
    stubFacebookGraph([
      { id: "PAGE_LD", name: "Lead Drive CRM", access_token: "LIVE_TOKEN_LD_2" },
      { id: "PAGE_SANDBOX", name: "Review Sandbox", access_token: "LIVE_TOKEN_SANDBOX" },
    ])
    const url = landing(await fbCallback(callbackReq("facebook", signState({ ret: "channels-facebook" }))))

    expect(url.searchParams.get("connected")).toBe("facebook")
    expect(graphCalls.some((u) => u.includes(`/oauth/access_token?client_id=${LIVE_FB_APP}&`))).toBe(true)
    expect(decryptToken(socialAccount("sa_ld").accessToken, "oauth:facebook:PAGE_LD")).toBe("LIVE_TOKEN_LD_2")
    expect(mem.db.socialAccount.some((r) => r.handle === "PAGE_SANDBOX")).toBe(true)
    expect(mem.compileOrganizationSourceRoutePlans).toHaveBeenCalledWith(ORG)
  })
})

describe("instagram callback, pinned to the app under review", () => {
  it("writes no SocialAccount either — its only write is a staged ChannelConfig", async () => {
    stubInstagramGraph("IG_LD", "leaddrive.az")
    const accountsBefore = structuredClone(mem.db.socialAccount)
    const liveBefore = structuredClone(channelConfig("cc_live_ld_ig"))

    const url = landing(await igCallback(callbackReq("instagram", signState({ app: "cfg_review_ig", ret: "channels-instagram" }))))

    expect(url.searchParams.get("connected")).toBe("instagram")
    expect(mem.db.socialAccount).toEqual(accountsBefore)
    expect(channelConfig("cc_live_ld_ig")).toEqual(liveBefore)
    const staged = mem.db.channelConfig.filter((r) => r.pageId === "IG_LD" && r.settings?.appReviewOnly === true)
    expect(staged.map((r) => r.apiKey)).toEqual(["REVIEW_IG_LOGIN_TOKEN"])
  })
})
