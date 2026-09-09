import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

type Handler = (request: NextRequest, auth: { orgId: string; userId: string; role: string }) => Promise<Response>

const mockPrisma = vi.hoisted(() => ({
  socialAccount: { upsert: vi.fn() },
  socialProviderCapabilityProof: { upsert: vi.fn() },
}))
const deps = vi.hoisted(() => ({
  getOrgId: vi.fn(),
  encryptToken: vi.fn(),
  compileOrganizationSourceRoutePlans: vi.fn(),
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: Handler) => (request: NextRequest) => handler(request, { orgId: "org-1", userId: "user-1", role: "admin" }),
}))
// `orgHasModule` backs the either-module entitlement in withSocialConnectAuth
// (connect flow serves both the inbox and social monitoring) — the mock grants it.
vi.mock("@/lib/api-auth", () => ({
  getOrgId: deps.getOrgId,
  // withSocialConnectAuth требует РЕАЛЬНУЮ сессию (API-ключи в connect-флоу не
  // допускаются) и проверяет «любой из двух модулей» через orgHasModule.
  getSession: vi.fn(async () => ({ orgId: "org-1", userId: "user-1", role: "admin", email: "a@b.c", name: "A" })),
  orgHasModule: vi.fn(async () => true),
  moduleDisabledResponse: vi.fn(),
}))
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("@/lib/rls-context", () => ({ runWithTenant: vi.fn((_org: string, callback: () => unknown) => callback()) }))
vi.mock("@/lib/secure-token", () => ({ encryptToken: deps.encryptToken }))
vi.mock("@/lib/social/source-route-plan", () => ({
  SOURCE_ROUTE_POLICY_VERSION: "social-monitoring-v2-pr2",
  compileOrganizationSourceRoutePlans: deps.compileOrganizationSourceRoutePlans,
}))

import { GET as startBusinessOAuth } from "@/app/api/v1/social/oauth/tiktok-business/start/route"
import { GET as finishBusinessOAuth } from "@/app/api/v1/social/oauth/tiktok-business/callback/route"

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.stubEnv("NEXTAUTH_SECRET", "oauth-test-secret")
  vi.stubEnv("TIKTOK_BUSINESS_AUTHORIZATION_URL", "https://business-api.tiktok.com/portal/auth?app_id=app-1")
  vi.stubEnv("TIKTOK_BUSINESS_REDIRECT_URI", "https://app.example.com/api/v1/social/oauth/tiktok-business/callback")
  vi.stubEnv("TIKTOK_BUSINESS_CLIENT_ID", "client-1")
  vi.stubEnv("TIKTOK_BUSINESS_CLIENT_SECRET", "secret-1")
  deps.getOrgId.mockResolvedValue("org-1")
  deps.encryptToken.mockReturnValue("encrypted-business-token")
  deps.compileOrganizationSourceRoutePlans.mockResolvedValue([])
  mockPrisma.socialAccount.upsert.mockResolvedValue({ id: "account-1" })
  mockPrisma.socialProviderCapabilityProof.upsert.mockResolvedValue({ id: "proof-1", status: "DRAFT" })
})

async function beginFlow() {
  const response = await startBusinessOAuth(new NextRequest("https://app.example.com/api/v1/social/oauth/tiktok-business/start"))
  const location = response.headers.get("location") as string
  const state = new URL(location).searchParams.get("state") as string
  const cookie = response.headers.get("set-cookie")?.split(";")[0] as string
  return { response, location, state, cookie }
}

describe("TikTok Business OAuth", () => {
  it("uses only an approved TikTok authorization host and carries signed tenant state", async () => {
    const flow = await beginFlow()
    expect(flow.response.status).toBe(307)
    expect(new URL(flow.location).hostname).toBe("business-api.tiktok.com")
    expect(flow.state).toBeTruthy()
    expect(flow.cookie).toContain("ld_tt_business_oauth=")

    vi.stubEnv("TIKTOK_BUSINESS_AUTHORIZATION_URL", "https://attacker.example.com/oauth")
    const rejected = await startBusinessOAuth(new NextRequest("https://app.example.com/api/v1/social/oauth/tiktok-business/start"))
    expect(rejected.status).toBe(500)
  })

  it("exchanges the one-time auth code, stores a purpose-separated token, and creates a DRAFT capability proof", async () => {
    const flow = await beginFlow()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      message: "OK",
      data: {
        access_token: "business-access",
        refresh_token: "business-refresh",
        expires_in: 86400,
        open_id: "business-open-id",
        scope: "video.list,comment.list,user.info.basic",
      },
    }), { status: 200, headers: { "content-type": "application/json" } }))
    vi.stubGlobal("fetch", fetchMock)
    const callback = new NextRequest(`https://app.example.com/api/v1/social/oauth/tiktok-business/callback?auth_code=once&state=${encodeURIComponent(flow.state)}`, {
      headers: { cookie: flow.cookie, host: "app.example.com", "x-forwarded-proto": "https" },
    })

    const response = await finishBusinessOAuth(callback)

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toContain("connected=tiktok_business")
    expect(fetchMock).toHaveBeenCalledWith("https://business-api.tiktok.com/open_api/v1.3/tt_user/oauth2/token/", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ client_id: "client-1", client_secret: "secret-1", grant_type: "authorization_code", auth_code: "once", redirect_uri: "https://app.example.com/api/v1/social/oauth/tiktok-business/callback" }),
    }))
    expect(deps.encryptToken).toHaveBeenCalledWith("business-access::business-refresh", "oauth:tiktok-business")
    expect(mockPrisma.socialProviderCapabilityProof.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ status: "DRAFT", capability: "READ_OWNED_COMMENTS", contentScopes: ["OWNED"], schemaVersion: "v1.3" }),
    }))
    expect(deps.compileOrganizationSourceRoutePlans).toHaveBeenCalledWith("org-1")
  })

  it("does not store credentials when TikTok omits the required comment scope", async () => {
    const flow = await beginFlow()
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      data: { access_token: "access", refresh_token: "refresh", expires_in: 86400, open_id: "id", scope: "video.list" },
    }), { status: 200 })))
    const callback = new NextRequest(`https://app.example.com/api/v1/social/oauth/tiktok-business/callback?auth_code=once&state=${encodeURIComponent(flow.state)}`, {
      headers: { cookie: flow.cookie, host: "app.example.com", "x-forwarded-proto": "https" },
    })

    const response = await finishBusinessOAuth(callback)
    expect(response.headers.get("location")).toContain("tiktok_business_required_scopes_missing")
    expect(mockPrisma.socialAccount.upsert).not.toHaveBeenCalled()
  })
})
