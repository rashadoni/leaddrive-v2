import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"
import { getRlsContext, rlsStorage } from "@/lib/rls-context"
import type { AuthResult } from "@/lib/api-auth"
const m = vi.hoisted(() => ({ session: vi.fn(), module: vi.fn(), count: vi.fn(), connection: vi.fn(), disconnect: vi.fn(), subscribe: vi.fn(), begin: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: { channelConfig: { count: m.count }, channelConnection: { findUnique: m.connection } } }))
vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(), getSession: vi.fn(), requireAuth: vi.fn(), requireSessionAuth: m.session,
  isAuthError: (value: unknown) => value instanceof NextResponse,
  orgHasModule: m.module,
  moduleDisabledResponse: () => NextResponse.json({ error: "Module disabled" }, { status: 403 }),
}))
vi.mock("@/lib/channels/channel-credential-audit", () => ({ auditChannelChange: vi.fn() }))
vi.mock("@/lib/tiktok-messaging/store", () => ({ messagingIdentity: (organizationId: string) => ({ organizationId }), disconnectMessaging: m.disconnect, retryMessagingSubscription: m.subscribe, beginMessagingAuthorization: m.begin }))
import { GET, POST } from "./route"
import { POST as start } from "./oauth/start/route"
const admin: AuthResult = { orgId: "org1", userId: "admin1", role: "admin", email: "admin@example.invalid", name: "Admin", principalType: "session" }
beforeEach(() => {
  vi.resetAllMocks()
  rlsStorage.enterWith(undefined as never)
  vi.stubEnv("TIKTOK_MESSAGING_CLIENT_ID", "app1"); vi.stubEnv("TIKTOK_MESSAGING_CLIENT_SECRET", "fixture-secret")
  vi.stubEnv("TIKTOK_MESSAGING_AUTHORIZATION_URL", "https://www.tiktok.com/auth/authorize/")
  vi.stubEnv("TIKTOK_MESSAGING_REDIRECT_URI", "https://crm.example/api/v1/channels/tiktok-messaging/oauth/callback/")
  m.session.mockResolvedValue(admin)
  m.module.mockResolvedValue(false)
  m.count.mockImplementation(async ({ where }: { where: { organizationId: string } }) => {
    expect(getRlsContext()).toEqual({ orgId: where.organizationId })
    return 1
  })
  m.connection.mockResolvedValue({ id: "conn1", status: "connected", accessToken: "must-not-leak", refreshToken: "must-not-leak", secretRef: "must-not-leak",
    capabilities: { read: true, reply: true, webhook: true }, settings: { openId: "private-account-id", grantVerified: true, webhookSubscribed: true, refreshExpiresAt: new Date(Date.now() + 86400000).toISOString() }, tokenExpiresAt: new Date(), lastInboundAt: null })
})
afterEach(() => { vi.unstubAllEnvs(); rlsStorage.enterWith(undefined as never) })
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
    m.session.mockResolvedValue({ ...admin, role: "viewer" })
    expect((await POST(request())).status).toBe(403)
    expect(m.count).not.toHaveBeenCalled()
    m.session.mockResolvedValue(admin)
    const forged = new NextRequest("https://crm.example/api/v1/channels/tiktok-messaging", { method: "POST", headers: { origin: "https://evil.example" }, body: JSON.stringify({ action: "disconnect" }) })
    expect((await POST(forged)).status).toBe(403)
    expect(m.disconnect).not.toHaveBeenCalled()
  })
  it("enters tenant RLS before the real grandfather gate for status, mutation and OAuth start", async () => {
    const contexts: unknown[] = []
    m.session.mockImplementation(async () => { contexts.push(getRlsContext()); return admin })
    m.disconnect.mockImplementation(async () => { expect(getRlsContext()).toEqual({ orgId: "org1" }); return true })
    m.begin.mockImplementation(async () => { expect(getRlsContext()).toEqual({ orgId: "org1" }) })
    expect((await GET(new NextRequest("https://crm.example/api/v1/channels/tiktok-messaging"))).status).toBe(200)
    expect((await POST(request())).status).toBe(200)
    expect((await start(request())).status).toBe(200)
    expect(contexts).toEqual(Array.from({ length: 3 }, () => [{ bypass: true }, { orgId: "org1" }]).flat())
    expect(m.count).toHaveBeenCalledTimes(3)
    expect(getRlsContext()).toBeUndefined()
  })
  it("does not fall back to another principal when browser-session authorization fails", async () => {
    m.session.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }))
    expect((await GET(new NextRequest("https://crm.example/api/v1/channels/tiktok-messaging"))).status).toBe(401)
    expect((await POST(request())).status).toBe(401)
    expect((await start(request())).status).toBe(401)
    expect(m.count).not.toHaveBeenCalled(); expect(m.connection).not.toHaveBeenCalled()
    expect(m.disconnect).not.toHaveBeenCalled(); expect(m.begin).not.toHaveBeenCalled()
  })
  it("honors a fresh administrator denial and rejects a changed actor before starting OAuth", async () => {
    m.session.mockResolvedValueOnce(admin).mockResolvedValueOnce({ ...admin, role: "viewer" })
    expect((await start(request())).status).toBe(403)
    m.session.mockResolvedValueOnce(admin).mockResolvedValueOnce({ ...admin, userId: "admin2" })
    expect((await start(request())).status).toBe(403)
    expect(m.begin).not.toHaveBeenCalled()
  })
  it("keeps the entitlement and same-origin gates ahead of OAuth state creation", async () => {
    m.count.mockResolvedValueOnce(0)
    expect((await start(request())).status).toBe(403)
    const forged = new NextRequest("https://crm.example/api/v1/channels/tiktok-messaging/oauth/start", { method: "POST", headers: { origin: "https://evil.example" } })
    expect((await start(forged)).status).toBe(403)
    expect(m.begin).not.toHaveBeenCalled()
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
