import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * getTenantMetaApp — Model B per-tenant Meta app credential resolution.
 * Returns the tenant's own appId/appSecret from their FB/IG ChannelConfig, or null (→ caller falls
 * back to env / LeadDrive's shared app).
 */

const findFirst = vi.fn()
const findMany = vi.fn()
vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: {
      findFirst: (...a: any[]) => findFirst(...a),
      findMany: (...a: any[]) => findMany(...a),
    },
  },
}))

import { getTenantMetaApp, getTenantInstagramLoginApp } from "@/lib/social/tenant-meta-app"

beforeEach(() => { findFirst.mockReset(); findMany.mockReset() })

describe("getTenantMetaApp (Facebook-Login surface)", () => {
  it("returns the appId/appSecret of a non-igLogin FB/IG config", async () => {
    findMany.mockResolvedValue([{ appId: "111", appSecret: "sek", settings: {} }])
    const r = await getTenantMetaApp("org_1")
    expect(r).toEqual({ appId: "111", appSecret: "sek" })
    // scoped to the org + FB/IG channels + the full Model B triple (appId+appSecret+verifyToken)
    const where = findMany.mock.calls[0][0].where
    expect(where.organizationId).toBe("org_1")
    expect(where.channelType).toEqual({ in: ["facebook", "instagram"] })
    expect(where.appId).toEqual({ not: null })
    expect(where.appSecret).toEqual({ not: null })
    expect(where.verifyToken).toEqual({ not: null })
  })

  it("EXCLUDES an Instagram-Login (igLogin) row — never hands its creds to the FB surface", async () => {
    // Newest qualifying row is the IG-Login app; the FB resolver must skip it and take the FB row.
    findMany.mockResolvedValue([
      { appId: "IG_APP", appSecret: "ig_sek", settings: { igLogin: true } },
      { appId: "FB_APP", appSecret: "fb_sek", settings: {} },
    ])
    expect(await getTenantMetaApp("org_1")).toEqual({ appId: "FB_APP", appSecret: "fb_sek" })
  })

  it("returns null when the ONLY qualifying row is an igLogin row (no FB app → env fallback)", async () => {
    findMany.mockResolvedValue([{ appId: "IG_APP", appSecret: "ig_sek", settings: { igLogin: true } }])
    expect(await getTenantMetaApp("org_1")).toBeNull()
  })

  it("returns null when no FB/IG config qualifies (→ env fallback)", async () => {
    findMany.mockResolvedValue([])
    expect(await getTenantMetaApp("org_1")).toBeNull()
  })

  it("returns null for an empty orgId without hitting the DB", async () => {
    expect(await getTenantMetaApp("")).toBeNull()
    expect(findMany).not.toHaveBeenCalled()
  })
})

describe("getTenantInstagramLoginApp", () => {
  it("requires channelType=instagram + settings.igLogin=true + the full triple", async () => {
    findFirst.mockResolvedValue({ appId: "ig1", appSecret: "igsek" })
    const r = await getTenantInstagramLoginApp("org_1")
    expect(r).toEqual({ appId: "ig1", appSecret: "igsek" })
    const where = findFirst.mock.calls[0][0].where
    expect(where.organizationId).toBe("org_1")
    expect(where.channelType).toBe("instagram")
    expect(where.appId).toEqual({ not: null })
    expect(where.appSecret).toEqual({ not: null })
    expect(where.verifyToken).toEqual({ not: null })
    expect(where.settings).toEqual({ path: ["igLogin"], equals: true })
  })

  it("returns null when the org has no IG-Login app config (→ env fallback)", async () => {
    findFirst.mockResolvedValue(null)
    expect(await getTenantInstagramLoginApp("org_1")).toBeNull()
  })

  it("returns null for empty orgId without hitting the DB", async () => {
    findFirst.mockReset()
    expect(await getTenantInstagramLoginApp("")).toBeNull()
    expect(findFirst).not.toHaveBeenCalled()
  })
})
