import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
const m = vi.hoisted(() => ({ gate: vi.fn(), consume: vi.fn(), save: vi.fn(), exchange: vi.fn(), grant: vi.fn(), access: vi.fn(), subscribe: vi.fn(), audit: vi.fn() }))
vi.mock("@/lib/channels-access", () => ({ gateChannelsAccess: m.gate }))
vi.mock("@/lib/channels/channel-credential-audit", () => ({ auditChannelChange: m.audit }))
vi.mock("@/lib/tiktok-messaging/store", () => ({ consumeMessagingAuthorization: m.consume, saveMessagingConnection: m.save }))
vi.mock("@/lib/tiktok-messaging/api", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/tiktok-messaging/api")>(), exchangeMessagingCode: m.exchange, verifyMessagingGrant: m.grant, verifyMessagingAccountAccess: m.access, subscribeMessagingWebhook: m.subscribe }))
import { GET } from "./route"
import { createMessagingState } from "@/lib/tiktok-messaging/oauth-state"
import { TIKTOK_MESSAGING_SCOPES } from "@/lib/tiktok-messaging/config"
import { TikTokMessagingError } from "@/lib/tiktok-messaging/api"
const callback = (state: string, code = "fixture-code") => new NextRequest(`https://crm.example/api/v1/channels/tiktok-messaging/oauth/callback/?${new URLSearchParams({ state, code })}`)
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("TIKTOK_MESSAGING_CLIENT_ID", "app1"); vi.stubEnv("TIKTOK_MESSAGING_CLIENT_SECRET", "fixture-secret")
  vi.stubEnv("TIKTOK_MESSAGING_AUTHORIZATION_URL", "https://www.tiktok.com/auth/authorize/")
  vi.stubEnv("TIKTOK_MESSAGING_REDIRECT_URI", "https://crm.example/api/v1/channels/tiktok-messaging/oauth/callback/")
  m.gate.mockResolvedValue({ orgId: "org1", userId: "admin1" }); m.consume.mockResolvedValue(true)
  m.exchange.mockResolvedValue({ accessToken: "fixture-access", openId: "business1" }); m.grant.mockResolvedValue([...TIKTOK_MESSAGING_SCOPES])
  m.access.mockResolvedValue(undefined); m.subscribe.mockResolvedValue(undefined); m.save.mockResolvedValue("config1")
})
afterEach(() => vi.unstubAllEnvs())
const result = (response: Response) => new URL(response.headers.get("location")!).searchParams.get("result")
describe("native TikTok OAuth callback", () => {
  it("exchanges documented code only after validating session and consuming one-use state", async () => {
    const state = createMessagingState("org1", "admin1")
    expect(result(await GET(callback(state)))).toBe("connected")
    expect(m.exchange).toHaveBeenCalledWith("fixture-code")
    expect(m.save).toHaveBeenCalledWith("org1", "admin1", expect.anything(), [...TIKTOK_MESSAGING_SCOPES], true, expect.stringMatching(/^oauth-state:/))
    m.consume.mockResolvedValue(false)
    expect(result(await GET(callback(state)))).toBe("expired_state")
    expect(m.exchange).toHaveBeenCalledTimes(1)
  })
  it("rejects a state issued to another tenant or another administrator", async () => {
    for (const state of [createMessagingState("org2", "admin1"), createMessagingState("org1", "admin2")]) expect(result(await GET(callback(state)))).toBe("invalid_state")
    expect(m.consume).not.toHaveBeenCalled(); expect(m.exchange).not.toHaveBeenCalled()
  })
  it("does not save an active grant with missing scopes or without Advanced Access", async () => {
    m.grant.mockResolvedValueOnce(["video.list"])
    expect(result(await GET(callback(createMessagingState("org1", "admin1"))))).toBe("required_scopes_missing")
    m.access.mockRejectedValueOnce(new TikTokMessagingError("tiktok_advanced_access_required"))
    expect(result(await GET(callback(createMessagingState("org1", "admin1"))))).toBe("tiktok_advanced_access_required")
    expect(m.save).not.toHaveBeenCalled()
  })
  it("reports subscription failure separately, without exposing codes or provider errors", async () => {
    m.subscribe.mockRejectedValueOnce(new Error("raw provider token should never appear"))
    const response = await GET(callback(createMessagingState("org1", "admin1")))
    expect(result(response)).toBe("webhook_pending")
    expect(response.headers.get("location")).not.toContain("fixture")
    expect(response.headers.get("referrer-policy")).toBe("no-referrer")
    expect(m.save).toHaveBeenCalledWith("org1", "admin1", expect.anything(), expect.anything(), false, expect.anything())
  })
})
