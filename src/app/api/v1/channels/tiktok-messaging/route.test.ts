import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"
const m = vi.hoisted(() => ({ gate: vi.fn(), connection: vi.fn(), disconnect: vi.fn(), subscribe: vi.fn(), begin: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: { channelConnection: { findUnique: m.connection } } }))
vi.mock("@/lib/channels-access", () => ({ gateChannelsAccess: m.gate }))
vi.mock("@/lib/channels/channel-credential-audit", () => ({ auditChannelChange: vi.fn() }))
vi.mock("@/lib/rls-context", () => ({ runWithTenant: (_org: string, fn: () => unknown) => fn() }))
vi.mock("@/lib/tiktok-messaging/store", () => ({ messagingIdentity: (organizationId: string) => ({ organizationId }), disconnectMessaging: m.disconnect, retryMessagingSubscription: m.subscribe, beginMessagingAuthorization: m.begin }))
import { GET, POST } from "./route"
import { POST as start } from "./oauth/start/route"
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("TIKTOK_MESSAGING_CLIENT_ID", "app1"); vi.stubEnv("TIKTOK_MESSAGING_CLIENT_SECRET", "fixture-secret")
  vi.stubEnv("TIKTOK_MESSAGING_AUTHORIZATION_URL", "https://www.tiktok.com/auth/authorize/")
  vi.stubEnv("TIKTOK_MESSAGING_REDIRECT_URI", "https://crm.example/api/v1/channels/tiktok-messaging/oauth/callback/")
  m.gate.mockResolvedValue({ orgId: "org1", userId: "admin1" })
  m.connection.mockResolvedValue({ id: "conn1", status: "connected", accessToken: "must-not-leak", refreshToken: "must-not-leak", secretRef: "must-not-leak",
    capabilities: { read: true, reply: true, webhook: true }, settings: { openId: "private-account-id", grantVerified: true, webhookSubscribed: true, refreshExpiresAt: new Date(Date.now() + 86400000).toISOString() }, tokenExpiresAt: new Date(), lastInboundAt: null })
})
afterEach(() => vi.unstubAllEnvs())
const request = (origin = "https://crm.example") => new NextRequest(`${origin}/api/v1/channels/tiktok-messaging`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ action: "disconnect" }) })
describe("native TikTok connection endpoints", () => {
  it("returns only safe status fields and never serializes credentials or private account settings", async () => {
    const response = await GET(new NextRequest("https://crm.example/api/v1/channels/tiktok-messaging"))
    const text = await response.text()
    expect(text).not.toContain("must-not-leak"); expect(text).not.toContain("private-account-id")
    expect(JSON.parse(text)).toMatchObject({ configured: true, status: "connected" })
    expect(response.headers.get("cache-control")).toBe("no-store")
  })
  it("does not mutate without the admin gate or a same-origin POST", async () => {
    m.gate.mockResolvedValueOnce(NextResponse.json({ error: "Forbidden" }, { status: 403 }))
    expect((await POST(request())).status).toBe(403)
    const forged = new NextRequest("https://crm.example/api/v1/channels/tiktok-messaging", { method: "POST", headers: { origin: "https://evil.example" }, body: JSON.stringify({ action: "disconnect" }) })
    expect((await POST(forged)).status).toBe(403)
    expect(m.disconnect).not.toHaveBeenCalled()
  })
  it("requires the canonical callback host and forces a code on repeated consent", async () => {
    expect((await start(request("https://other.example"))).status).toBe(503)
    expect(m.begin).not.toHaveBeenCalled()
    const response = await start(request())
    const url = new URL((await response.json()).authorizationUrl)
    expect(url.searchParams.get("disable_auto_auth")).toBe("1")
    expect(url.searchParams.get("state")).toBeTruthy()
    expect(m.begin).toHaveBeenCalledWith("org1", expect.stringMatching(/^oauth-state:/))
  })
})
