import { describe, it, expect, beforeEach, vi } from "vitest"
import crypto from "crypto"
import type { NextRequest } from "next/server"

/**
 * «Turn on monitoring» on a page's row in Settings → Channels (`from=channels-monitoring`) must turn on
 * monitoring and nothing else.
 *
 * The Facebook callback loops over every Page the person grants and, for the Inbox, switches each Page's and each
 * linked Instagram account's inbox row back on. On 2026-10-27 in tenant `leaddrive` the LeadDrive Page's monitoring
 * had been switched off; pressing the button there would also have switched on the demo workspace's June row for
 * @leaddrive.az — the oldest claim on that account — and its Direct, which the owner keeps in Fanumsec, would have
 * gone to the demo workspace.
 *
 * Real callback, real token encryption, an in-memory copy of the two tables it writes.
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
import { decryptToken } from "@/lib/secure-token"

const ORG = "org_ld"
const LIVE_FB_APP = "1276226757359622"
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

beforeEach(() => {
  for (const key of ["APP_ID", "APP_SECRET", "LOGIN_CONFIG_ID", "VERIFY_TOKEN"]) delete process.env[`FACEBOOK_MESSENGER_${key}`]
  vi.unstubAllGlobals()
  graphCalls = []
  mem.compileOrganizationSourceRoutePlans.mockClear()
  process.env.FACEBOOK_APP_ID = LIVE_FB_APP
  process.env.FACEBOOK_APP_SECRET = "live-secret"
  process.env.FACEBOOK_REDIRECT_URI = "https://app.leaddrivecrm.org/api/v1/social/oauth/facebook/callback"
  // Tenant `leaddrive` on 2026-10-27: the LeadDrive Page's inbox row back on, its monitoring off with the token
  // cleared (a disconnect), and the June Instagram row of the linked @leaddrive.az switched off since 2026-09-11.
  mem.db.channelConfig = [
    {
      id: "cc_ld", organizationId: ORG, channelType: "facebook", configName: "Мыслители прошлого",
      pageId: "PAGE_LD", apiKey: "MESSENGER_TOKEN", appId: LIVE_FB_APP, appSecret: null, verifyToken: null,
      isActive: true, settings: { inboxSubscribed: true }, createdAt: at("2026-06-07T08:24:13Z"), updatedAt: at("2026-10-27T06:50:58Z"),
    },
    {
      id: "cc_ld_ig", organizationId: ORG, channelType: "instagram", configName: "Мыслители прошлого / @leaddrive.az",
      pageId: "IG_LD", apiKey: "OLD_TOKEN", appId: LIVE_FB_APP, appSecret: null, verifyToken: null,
      isActive: false, settings: { inboxSubscribed: true }, createdAt: at("2026-06-07T08:24:13Z"), updatedAt: at("2026-09-11T14:03:22Z"),
    },
  ]
  mem.db.socialAccount = [
    {
      id: "sa_ld", organizationId: ORG, platform: "facebook", handle: "PAGE_LD", displayName: "Lead Drive CRM",
      accessToken: null, isActive: false, lastPolledAt: at("2026-10-27T06:47:44Z"),
      createdAt: at("2026-04-18T20:19:30Z"), updatedAt: at("2026-10-27T06:50:00Z"),
    },
  ]
  stubFacebookGraph([
    { id: "PAGE_LD", name: "Lead Drive CRM", access_token: "PAGE_TOKEN_LD", instagram_business_account: { id: "IG_LD", username: "leaddrive.az" } },
  ])
})

describe("Facebook callback, «turn on monitoring» from a Channels row", () => {
  it("turns the page's monitoring back on and leaves every inbox row as it was", async () => {
    const inboxBefore = structuredClone(mem.db.channelConfig)
    const res = await fbCallback(callbackReq("facebook", signState({ ret: "channels-monitoring", channelId: "cc_ld" })))

    expect(socialAccount("sa_ld")).toMatchObject({ isActive: true })
    expect(decryptToken(socialAccount("sa_ld").accessToken, "oauth:facebook:PAGE_LD")).toBe("PAGE_TOKEN_LD")
    // The linked Instagram account is monitored too, on the same Page token.
    const ig = mem.db.socialAccount.find((r) => r.platform === "instagram" && r.handle === "IG_LD")!
    expect(ig.isActive).toBe(true)
    expect(decryptToken(ig.accessToken, "oauth:instagram:IG_LD")).toBe("PAGE_TOKEN_LD")

    // @leaddrive.az's Direct stays where the owner put it: the demo workspace's Instagram row is still off.
    expect(mem.db.channelConfig).toEqual(inboxBefore)
    expect(channelConfig("cc_ld_ig").isActive).toBe(false)
    expect(graphCalls.some((url) => url.endsWith("/subscribed_apps"))).toBe(false)

    const back = landing(res)
    expect(back.pathname).toBe("/settings/channels")
    expect(back.searchParams.get("oauth")).toBe("facebook")
    expect(back.searchParams.get("channelId")).toBe("cc_ld")
    expect(mem.compileOrganizationSourceRoutePlans).toHaveBeenCalledWith(ORG)
  })

  it("still wires the inbox for an ordinary connect, so the guard is about the button alone", async () => {
    await fbCallback(callbackReq("facebook", signState({})))
    expect(channelConfig("cc_ld_ig").isActive).toBe(true)
  })
})
