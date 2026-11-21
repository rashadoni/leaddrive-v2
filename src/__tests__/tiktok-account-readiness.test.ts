import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockPrisma = vi.hoisted(() => ({ socialAccount: { findFirst: vi.fn() } }))
const deps = vi.hoisted(() => ({ businessAccessToken: vi.fn(), messagingConfigured: vi.fn() }))

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("@/lib/social/tiktok-business-token", () => ({ businessAccessToken: deps.businessAccessToken }))
vi.mock("@/lib/tiktok-messaging/config", () => ({ messagingConfigured: deps.messagingConfigured }))

import {
  deriveTikTokAccountReadiness,
  readTikTokAccountReadiness,
  type TikTokAccountFacts,
} from "@/lib/tiktok-messaging/account-readiness"

const facts = (over: Partial<TikTokAccountFacts> = {}): TikTokAccountFacts => ({
  connected: true,
  username: null,
  displayName: null,
  hasAdvancedAccess: true,
  profileReadFailed: false,
  messagingConfigured: true,
  ...over,
})

const stateOf = (result: { items: { id: string; state: string }[] }, id: string) =>
  result.items.find((item) => item.id === id)?.state

describe("deriveTikTokAccountReadiness", () => {
  it("is ready only when every requirement is met", () => {
    const result = deriveTikTokAccountReadiness(facts({ username: "gobustone" }))
    expect(result.ready).toBe(true)
    expect(result.items.map((item) => item.state)).toEqual(["ok", "ok", "ok"])
  })

  it("asks the tenant to connect before it judges the account", () => {
    const result = deriveTikTokAccountReadiness(facts({ connected: false, hasAdvancedAccess: null }))
    expect(stateOf(result, "account")).toBe("warn")
    expect(stateOf(result, "advancedAccess")).toBe("warn")
    expect(result.ready).toBe(false)
  })

  it("marks a missing app approval as waiting on TikTok, not as the tenant's task", () => {
    const result = deriveTikTokAccountReadiness(facts({ messagingConfigured: false }))
    expect(stateOf(result, "messagingApproval")).toBe("blocked")
    // The account itself is fine; only the platform is holding things up.
    expect(stateOf(result, "account")).toBe("ok")
    expect(stateOf(result, "advancedAccess")).toBe("ok")
    expect(result.ready).toBe(false)
  })

  it("does not call an unknown entitlement a met requirement", () => {
    const unknown = deriveTikTokAccountReadiness(facts({ hasAdvancedAccess: null, profileReadFailed: true }))
    expect(stateOf(unknown, "advancedAccess")).toBe("warn")
    const refused = deriveTikTokAccountReadiness(facts({ hasAdvancedAccess: false }))
    expect(stateOf(refused, "advancedAccess")).toBe("warn")
  })

  it("names the account by its TikTok username, falling back to the display name", () => {
    expect(deriveTikTokAccountReadiness(facts({ username: "gobustone", displayName: "Gobustone" })).items[0].value)
      .toBe("@gobustone")
    expect(deriveTikTokAccountReadiness(facts({ displayName: "Gobustone" })).items[0].value).toBe("Gobustone")
    expect(deriveTikTokAccountReadiness(facts({ connected: false, displayName: "Gobustone" })).items[0].value).toBeNull()
  })
})

describe("readTikTokAccountReadiness", () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.restoreAllMocks()
    mockPrisma.socialAccount.findFirst.mockReset()
    deps.businessAccessToken.mockReset()
    deps.messagingConfigured.mockReset().mockReturnValue(false)
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => { vi.unstubAllGlobals() })

  const ok = (data: Record<string, unknown>) => ({ ok: true, json: async () => ({ code: 0, data }) })
  const rejected = () => ({ ok: true, json: async () => ({ code: 40002, message: "unknown field" }) })

  it("reports a workspace with no TikTok grant without calling TikTok", async () => {
    mockPrisma.socialAccount.findFirst.mockResolvedValue(null)
    const result = await readTikTokAccountReadiness("org-1")
    expect(result.facts.connected).toBe(false)
    expect(result.facts.profileReadFailed).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(deps.businessAccessToken).not.toHaveBeenCalled()
  })

  it("reads the entitlement for the connected account", async () => {
    mockPrisma.socialAccount.findFirst.mockResolvedValue({
      id: "acc-1", handle: "open-id-1", displayName: "TikTok Business open-id-1", accessToken: "enc", tokenExpiresAt: null,
    })
    deps.businessAccessToken.mockResolvedValue({ token: "tok", error: null })
    deps.messagingConfigured.mockReturnValue(true)
    fetchMock.mockResolvedValue(ok({ username: "gobustone", display_name: "Gobustone", has_advanced_access: true }))

    const result = await readTikTokAccountReadiness("org-1")

    const url = new URL(fetchMock.mock.calls[0][0] as string)
    expect(url.origin + url.pathname).toBe("https://business-api.tiktok.com/open_api/v1.3/business/get/")
    expect(url.searchParams.get("business_id")).toBe("open-id-1")
    expect((fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers["Access-Token"]).toBe("tok")
    expect(result.facts).toMatchObject({ connected: true, username: "gobustone", hasAdvancedAccess: true, profileReadFailed: false })
    expect(result.ready).toBe(true)
  })

  it("retries with fewer fields when TikTok refuses the field list, and keeps the decisive one", async () => {
    mockPrisma.socialAccount.findFirst.mockResolvedValue({
      id: "acc-1", handle: "open-id-1", displayName: null, accessToken: "enc", tokenExpiresAt: null,
    })
    deps.businessAccessToken.mockResolvedValue({ token: "tok", error: null })
    fetchMock.mockResolvedValueOnce(rejected()).mockResolvedValueOnce(ok({ display_name: "Gobustone", has_advanced_access: false }))

    const result = await readTikTokAccountReadiness("org-1")

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get("fields") as string)).toContain("username")
    expect(JSON.parse(new URL(fetchMock.mock.calls[1][0] as string).searchParams.get("fields") as string)).not.toContain("username")
    expect(result.facts.hasAdvancedAccess).toBe(false)
    expect(result.facts.profileReadFailed).toBe(false)
    expect(stateOf(result, "advancedAccess")).toBe("warn")
  })

  it("stops after a network failure instead of retrying the same call with fewer fields", async () => {
    mockPrisma.socialAccount.findFirst.mockResolvedValue({
      id: "acc-1", handle: "open-id-1", displayName: "TikTok Business open-id-1", accessToken: "enc", tokenExpiresAt: null,
    })
    deps.businessAccessToken.mockResolvedValue({ token: "tok", error: null })
    fetchMock.mockRejectedValue(new Error("network"))

    const result = await readTikTokAccountReadiness("org-1")

    expect(fetchMock).toHaveBeenCalledTimes(1)
    // Unreachable is not "refused": the entitlement stays unknown and the screen says so.
    expect(result.facts.hasAdvancedAccess).toBeNull()
    expect(result.facts.profileReadFailed).toBe(true)
    expect(result.facts.connected).toBe(true)
  })

  it("does not ask TikTok when the stored grant yields no token", async () => {
    mockPrisma.socialAccount.findFirst.mockResolvedValue({
      id: "acc-1", handle: "open-id-1", displayName: null, accessToken: null, tokenExpiresAt: null,
    })
    deps.businessAccessToken.mockResolvedValue({ token: null, error: null })

    const result = await readTikTokAccountReadiness("org-1")

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.facts.profileReadFailed).toBe(true)
    expect(result.ready).toBe(false)
  })

  it("scopes the lookup to the caller's organisation and active grants only", async () => {
    mockPrisma.socialAccount.findFirst.mockResolvedValue(null)
    await readTikTokAccountReadiness("org-7")
    expect(mockPrisma.socialAccount.findFirst.mock.calls[0][0].where).toMatchObject({
      organizationId: "org-7", platform: "tiktok", isActive: true,
    })
  })
})
