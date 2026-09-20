import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Isolation of a STAGED Meta app (one under App Review) from a tenant's live channels.
 *
 * The property under test is not "the new app works" but "the new app cannot reach anything it was
 * not explicitly pointed at". That matters because the org-wide resolver takes the most recently
 * updated qualifying row for the WHOLE organization: on a tenant that holds live customer Pages next
 * to the review sandbox — `leaddrive` holds five — entering a second Meta app would otherwise become
 * the app every Facebook/Instagram reconnect in that tenant runs through.
 */

const findFirst = vi.fn()
const findMany = vi.fn()
const update = vi.fn()
const create = vi.fn()
const subscribePageToMessages = vi.fn()

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: {
      findFirst: (...a: any[]) => findFirst(...a),
      findMany: (...a: any[]) => findMany(...a),
      update: (...a: any[]) => update(...a),
      create: (...a: any[]) => create(...a),
    },
  },
}))
vi.mock("@/lib/social/meta-subscribe", () => ({
  subscribePageToMessages: (...a: any[]) => subscribePageToMessages(...a),
}))

import {
  getTenantMetaApp,
  getTenantInstagramLoginApp,
  getPinnedMetaApp,
  isAppReviewOnly,
} from "@/lib/social/tenant-meta-app"
import { ensureInboxChannelForPage } from "@/lib/social/inbox-channel"

beforeEach(() => {
  findFirst.mockReset()
  findMany.mockReset()
  update.mockReset()
  create.mockReset()
  subscribePageToMessages.mockReset()
  subscribePageToMessages.mockResolvedValue({ success: true })
})

describe("isAppReviewOnly", () => {
  it("is true only for an explicit boolean true", () => {
    expect(isAppReviewOnly({ appReviewOnly: true })).toBe(true)
    expect(isAppReviewOnly({ appReviewOnly: "true" })).toBe(false)
    expect(isAppReviewOnly({ appReviewOnly: false })).toBe(false)
    expect(isAppReviewOnly({})).toBe(false)
    expect(isAppReviewOnly(null)).toBe(false)
    expect(isAppReviewOnly([{ appReviewOnly: true }])).toBe(false)
  })
})

describe("staged app stays out of the org-wide resolvers", () => {
  it("getTenantMetaApp skips a staged row and keeps the live app", async () => {
    // Newest row is the staged one — precisely the ordering that would otherwise hijack the tenant.
    findMany.mockResolvedValue([
      { appId: "NEW_UNDER_REVIEW", appSecret: "n", settings: { appReviewOnly: true } },
      { appId: "LIVE_APP", appSecret: "l", settings: {} },
    ])
    expect(await getTenantMetaApp("org_1")).toEqual({ appId: "LIVE_APP", appSecret: "l" })
  })

  it("getTenantMetaApp returns null when the ONLY row is staged (→ env, i.e. unchanged behaviour)", async () => {
    findMany.mockResolvedValue([
      { appId: "NEW_UNDER_REVIEW", appSecret: "n", settings: { appReviewOnly: true } },
    ])
    expect(await getTenantMetaApp("org_1")).toBeNull()
  })

  it("getTenantInstagramLoginApp skips a staged IG-Login row", async () => {
    findMany.mockResolvedValue([
      { appId: "NEW_IG", appSecret: "n", settings: { igLogin: true, appReviewOnly: true } },
      { appId: "LIVE_IG", appSecret: "l", settings: { igLogin: true } },
    ])
    expect(await getTenantInstagramLoginApp("org_1")).toEqual({ appId: "LIVE_IG", appSecret: "l" })
  })
})

describe("getPinnedMetaApp", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: "cfg_1",
    channelType: "facebook",
    appId: "2414060595720618",
    appSecret: "s",
    verifyToken: "v",
    settings: { appReviewOnly: true },
    ...over,
  })

  it("resolves the named row and scopes the lookup to the caller's org", async () => {
    findFirst.mockResolvedValue(row())
    const r = await getPinnedMetaApp("org_1", "cfg_1", "facebook")
    expect(r).toEqual({ configId: "cfg_1", appId: "2414060595720618", appSecret: "s", hasVerifyToken: true })
    expect(findFirst.mock.calls[0][0].where).toEqual({ id: "cfg_1", organizationId: "org_1" })
  })

  it("returns null for a row in another organization", async () => {
    // Prisma applies the organizationId filter, so a foreign id simply does not match.
    findFirst.mockResolvedValue(null)
    expect(await getPinnedMetaApp("org_1", "cfg_other", "facebook")).toBeNull()
  })

  it.each([
    ["appId", { appId: null }],
    ["appSecret", { appSecret: null }],
    ["verifyToken", { verifyToken: null }],
  ])("fails closed when %s is missing — never falls back to a shared app", async (_label, over) => {
    findFirst.mockResolvedValue(row(over))
    expect(await getPinnedMetaApp("org_1", "cfg_1", "facebook")).toBeNull()
  })

  it("refuses an Instagram-Login row on the Facebook surface", async () => {
    findFirst.mockResolvedValue(row({ channelType: "instagram", settings: { igLogin: true } }))
    expect(await getPinnedMetaApp("org_1", "cfg_1", "facebook")).toBeNull()
  })

  it("refuses a Facebook row on the Instagram-Login surface", async () => {
    findFirst.mockResolvedValue(row())
    expect(await getPinnedMetaApp("org_1", "cfg_1", "instagram-login")).toBeNull()
  })

  it("accepts an Instagram-Login row on its own surface", async () => {
    findFirst.mockResolvedValue(row({ channelType: "instagram", settings: { igLogin: true } }))
    expect(await getPinnedMetaApp("org_1", "cfg_1", "instagram-login")).toMatchObject({ appId: "2414060595720618" })
  })

  it("returns null without touching the DB for empty arguments", async () => {
    expect(await getPinnedMetaApp("", "cfg_1", "facebook")).toBeNull()
    expect(await getPinnedMetaApp("org_1", "", "facebook")).toBeNull()
    expect(findFirst).not.toHaveBeenCalled()
  })
})

describe("ensureInboxChannelForPage — staged connects leave live rows alone", () => {
  it("does NOT update an existing live row, and creates a staged row instead", async () => {
    findMany.mockResolvedValue([{ id: "live_row", settings: { inboxSubscribed: true } }])
    const r = await ensureInboxChannelForPage("org_1", "facebook", "PAGE_1", "Sport&Diet", "tok", { staged: true })

    // The live row is the thing customers' DMs depend on: its page token must not be replaced by one
    // minted by the app under review, and a row somebody switched off must not be switched back on.
    expect(update).not.toHaveBeenCalled()
    expect(r.created).toBe(true)
    expect(r.skippedExisting).toBe(true)
    const created = create.mock.calls[0][0].data
    expect(created.settings.appReviewOnly).toBe(true)
    expect(created.settings.subscriptionPending).toBe(true)
  })

  it("subscribes nothing to a real Page during a staged connect", async () => {
    findMany.mockResolvedValue([])
    const r = await ensureInboxChannelForPage("org_1", "facebook", "PAGE_1", "Test Page", "tok", { staged: true })
    expect(subscribePageToMessages).not.toHaveBeenCalled()
    expect(r.subscribed).toBe(false)
  })

  it("updates an existing STAGED row rather than creating duplicates", async () => {
    findMany.mockResolvedValue([
      { id: "live_row", settings: {} },
      { id: "staged_row", settings: { appReviewOnly: true } },
    ])
    await ensureInboxChannelForPage("org_1", "facebook", "PAGE_1", "Test Page", "tok2", { staged: true })
    expect(create).not.toHaveBeenCalled()
    expect(update.mock.calls[0][0].where).toEqual({ id: "staged_row" })
  })

  it("keeps the ordinary (non-staged) path subscribing and updating as before", async () => {
    findMany.mockResolvedValue([{ id: "live_row", settings: {} }])
    const r = await ensureInboxChannelForPage("org_1", "facebook", "PAGE_1", "Sport&Diet", "tok")
    expect(subscribePageToMessages).toHaveBeenCalledWith("PAGE_1", "tok")
    expect(update.mock.calls[0][0].where).toEqual({ id: "live_row" })
    expect(update.mock.calls[0][0].data.settings.appReviewOnly).toBeUndefined()
    expect(r.subscribed).toBe(true)
  })
})
