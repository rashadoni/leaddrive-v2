import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"
import { getRlsContext, rlsStorage } from "@/lib/rls-context"
import type { AuthResult } from "@/lib/api-auth"
const m = vi.hoisted(() => ({ session: vi.fn(), module: vi.fn(), count: vi.fn(), consume: vi.fn(), save: vi.fn(), exchange: vi.fn(), grant: vi.fn(), access: vi.fn(), subscribe: vi.fn(), audit: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: { channelConfig: { count: m.count } } }))
vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(), getSession: vi.fn(), requireAuth: vi.fn(), requireSessionAuth: m.session,
  isAuthError: (value: unknown) => value instanceof NextResponse,
  orgHasModule: m.module,
  moduleDisabledResponse: () => NextResponse.json({ error: "Module disabled" }, { status: 403 }),
}))
vi.mock("@/lib/channels/channel-credential-audit", () => ({ auditChannelChange: m.audit }))
vi.mock("@/lib/tiktok-messaging/store", () => ({ consumeMessagingAuthorization: m.consume, saveMessagingConnection: m.save }))
vi.mock("@/lib/tiktok-messaging/api", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/tiktok-messaging/api")>(), exchangeMessagingCode: m.exchange, verifyMessagingGrant: m.grant, verifyMessagingAccountAccess: m.access, subscribeMessagingWebhook: m.subscribe }))
import { GET } from "./route"
import { createMessagingState } from "@/lib/tiktok-messaging/oauth-state"
import { TIKTOK_MESSAGING_SCOPES } from "@/lib/tiktok-messaging/config"
import { TikTokMessagingError } from "@/lib/tiktok-messaging/api"
const callback = (state: string, code = "fixture-code") => new NextRequest(`https://crm.example/api/v1/channels/tiktok-messaging/oauth/callback/?${new URLSearchParams({ state, code })}`)
const admin: AuthResult = { orgId: "org1", userId: "admin1", role: "admin", email: "admin@example.invalid", name: "Admin", principalType: "session" }
beforeEach(() => {
  vi.resetAllMocks()
  rlsStorage.enterWith(undefined as never)
  vi.stubEnv("TIKTOK_MESSAGING_CLIENT_ID", "app1"); vi.stubEnv("TIKTOK_MESSAGING_CLIENT_SECRET", "fixture-secret")
  vi.stubEnv("TIKTOK_MESSAGING_AUTHORIZATION_URL", "https://www.tiktok.com/auth/authorize/")
  vi.stubEnv("TIKTOK_MESSAGING_REDIRECT_URI", "https://crm.example/api/v1/channels/tiktok-messaging/oauth/callback/")
  m.session.mockResolvedValue(admin); m.module.mockResolvedValue(false)
  m.count.mockImplementation(async ({ where }: { where: { organizationId: string } }) => {
    expect(getRlsContext()).toEqual({ orgId: where.organizationId })
    return 1
  })
  m.consume.mockResolvedValue(true)
  m.exchange.mockResolvedValue({ accessToken: "fixture-access", openId: "business1" }); m.grant.mockResolvedValue([...TIKTOK_MESSAGING_SCOPES])
  m.access.mockResolvedValue(undefined); m.subscribe.mockResolvedValue(undefined); m.save.mockResolvedValue("config1")
})
afterEach(() => { vi.unstubAllEnvs(); rlsStorage.enterWith(undefined as never) })
const result = (response: Response) => new URL(response.headers.get("location")!).searchParams.get("result")
describe("native TikTok OAuth callback", () => {
  it("enters session tenant RLS before the real grandfather gate and retains it for connection writes", async () => {
    const contexts: unknown[] = []
    m.session.mockImplementation(async () => { contexts.push(getRlsContext()); return admin })
    m.consume.mockImplementation(async () => { expect(getRlsContext()).toEqual({ orgId: "org1" }); return true })
    m.save.mockImplementation(async () => { expect(getRlsContext()).toEqual({ orgId: "org1" }); return "config1" })
    expect(result(await GET(callback(createMessagingState("org1", "admin1"))))).toBe("connected")
    expect(contexts).toEqual([{ bypass: true }, { orgId: "org1" }])
    expect(m.count).toHaveBeenCalledWith({ where: { organizationId: "org1" } })
    expect(getRlsContext()).toBeUndefined()
  })
  it("does not consume state or call TikTok when session, fresh admin or entitlement access is denied", async () => {
    const state = createMessagingState("org1", "admin1")
    m.session.mockResolvedValueOnce(NextResponse.json({ error: "Unauthorized" }, { status: 401 }))
    expect((await GET(callback(state))).status).toBe(401)
    m.session.mockResolvedValueOnce(admin).mockResolvedValueOnce({ ...admin, role: "viewer" })
    expect((await GET(callback(state))).status).toBe(403)
    m.count.mockResolvedValueOnce(0)
    expect((await GET(callback(state))).status).toBe(403)
    expect(m.consume).not.toHaveBeenCalled(); expect(m.exchange).not.toHaveBeenCalled(); expect(m.save).not.toHaveBeenCalled()
  })
  it("rejects a session actor change between wrapper and fresh channel gate", async () => {
    m.session.mockResolvedValueOnce(admin).mockResolvedValueOnce({ ...admin, userId: "admin2" })
    const response = await GET(callback(createMessagingState("org1", "admin2")))
    expect(response.status).toBe(403)
    expect(m.consume).not.toHaveBeenCalled(); expect(m.exchange).not.toHaveBeenCalled()
  })
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
