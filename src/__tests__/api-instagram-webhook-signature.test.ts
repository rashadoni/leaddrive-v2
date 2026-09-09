import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { NextRequest } from "next/server"
import { createHmac } from "crypto"

/**
 * Instagram-Login webhook (Path B) — Model B per-tenant auth, mirrors the Facebook webhook tests.
 *
 * Each tenant's OWN Instagram-Login Meta app appends ?t=<org-slug> to its callback URL and signs with
 * ITS OWN appSecret / verifies with ITS OWN verifyToken (from their igLogin ChannelConfig). No ?t →
 * env (LeadDrive's shared IG-Login app). When ?t addresses a tenant with no own secret → REJECT (403),
 * never env-fallback (a cross-tenant write guard). Inbound lookup is org-scoped under ?t.
 */
const tenant: { orgId: string | null; verifyToken: string | null; appSecret: string | null } = {
  orgId: null,
  verifyToken: null,
  appSecret: null,
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: {
      findUnique: vi.fn(async ({ where }: any) => (tenant.orgId && where?.slug ? { id: tenant.orgId } : null)),
    },
    channelConfig: {
      // resolveTenantInstagramLoginConfig (no pageId) → tenant verifyToken/appSecret
      findFirst: vi.fn(async () =>
        tenant.verifyToken !== null || tenant.appSecret !== null
          ? { verifyToken: tenant.verifyToken, appSecret: tenant.appSecret }
          : null,
      ),
      // POST inbound candidate lookup → empty (tests assert org-scoping, not delivery)
      findMany: vi.fn(async () => []),
    },
  },
}))
vi.mock("@/lib/facebook", () => ({ upsertSocialConversation: vi.fn() }))
vi.mock("@/lib/social/notify-recipients", () => ({ notifyConversationRecipients: vi.fn() }))

import { POST } from "@/app/api/v1/webhooks/instagram/route"
import { prisma } from "@/lib/prisma"

const BASE = "https://app.leaddrivecrm.org/api/v1/webhooks/instagram"
function reqWith(body: string, signature?: string, url: string = BASE): NextRequest {
  return {
    url,
    nextUrl: new URL(url),
    text: async () => body,
    headers: { get: (k: string) => (k === "x-hub-signature-256" ? signature ?? null : null) },
  } as unknown as NextRequest
}
const emptyPayload = JSON.stringify({ object: "instagram", entry: [] })
const sign = (body: string, secret: string) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex")

beforeEach(() => {
  vi.clearAllMocks()
  tenant.orgId = null
  tenant.verifyToken = null
  tenant.appSecret = null
})
afterEach(() => {
  delete process.env.INSTAGRAM_APP_SECRET
  delete process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN
  delete process.env.ALLOW_UNSIGNED_META_WEBHOOKS
})

describe("IG-Login webhook signature (env fallback — LeadDrive shared app)", () => {
  it("403 on invalid signature when INSTAGRAM_APP_SECRET is set", async () => {
    process.env.INSTAGRAM_APP_SECRET = "ENV"
    expect((await POST(reqWith(emptyPayload, "sha256=dead"))).status).toBe(403)
  })
  it("200 on a valid env signature (no ?t)", async () => {
    process.env.INSTAGRAM_APP_SECRET = "ENV"
    expect((await POST(reqWith(emptyPayload, sign(emptyPayload, "ENV")))).status).toBe(200)
  })
  it("403 when no env secret exists and unsigned bypass is not explicitly enabled", async () => {
    delete process.env.INSTAGRAM_APP_SECRET
    delete process.env.ALLOW_UNSIGNED_META_WEBHOOKS
    expect((await POST(reqWith(emptyPayload))).status).toBe(403)
  })
  it("allows unsigned local/dev payloads only with the explicit bypass flag", async () => {
    delete process.env.INSTAGRAM_APP_SECRET
    process.env.ALLOW_UNSIGNED_META_WEBHOOKS = "1"
    expect((await POST(reqWith(emptyPayload))).status).toBe(200)
  })
})

describe("IG-Login webhook Model B — per-tenant signature (?t)", () => {
  it("verifies with the TENANT's appSecret, not env — 200 on valid tenant signature", async () => {
    process.env.INSTAGRAM_APP_SECRET = "ENV"
    tenant.orgId = "org_acme"
    tenant.appSecret = "ACME"
    expect((await POST(reqWith(emptyPayload, sign(emptyPayload, "ACME"), `${BASE}?t=acme`))).status).toBe(200)
  })
  it("403 when signed with ENV secret but ?t resolves a different tenant secret", async () => {
    process.env.INSTAGRAM_APP_SECRET = "ENV"
    tenant.orgId = "org_acme"
    tenant.appSecret = "ACME"
    expect((await POST(reqWith(emptyPayload, sign(emptyPayload, "ENV"), `${BASE}?t=acme`))).status).toBe(403)
  })
  it("REJECTS (403) when ?t addresses a tenant with NO appSecret — no env fallback", async () => {
    process.env.INSTAGRAM_APP_SECRET = "ENV"
    tenant.orgId = "org_acme"
    tenant.appSecret = null
    expect((await POST(reqWith(emptyPayload, sign(emptyPayload, "ENV"), `${BASE}?t=acme`))).status).toBe(403)
  })
  it("org-scopes the inbound candidate lookup to the verified ?t tenant", async () => {
    process.env.INSTAGRAM_APP_SECRET = "ENV"
    tenant.orgId = "org_acme"
    tenant.appSecret = "ACME"
    const withEntry = JSON.stringify({ object: "instagram", entry: [{ id: "IG_A", messaging: [] }] })
    const res = await POST(reqWith(withEntry, sign(withEntry, "ACME"), `${BASE}?t=acme`))
    expect(res.status).toBe(200)
    const calls = (prisma.channelConfig.findMany as any).mock.calls.map((c: any[]) => c[0])
    expect(calls[0]?.where?.organizationId).toBe("org_acme")
  })
  it("does NOT org-scope (global) on the env path — no ?t", async () => {
    process.env.INSTAGRAM_APP_SECRET = "ENV"
    const withEntry = JSON.stringify({ object: "instagram", entry: [{ id: "IG_X", messaging: [] }] })
    const res = await POST(reqWith(withEntry, sign(withEntry, "ENV"), BASE))
    expect(res.status).toBe(200)
    const calls = (prisma.channelConfig.findMany as any).mock.calls.map((c: any[]) => c[0])
    expect(calls[0]?.where?.organizationId).toBeUndefined()
  })
})

describe("IG-Login webhook Model B — per-tenant GET handshake", () => {
  async function freshGET() {
    vi.resetModules()
    const mod = await import("@/app/api/v1/webhooks/instagram/route")
    return mod.GET
  }
  const getReq = (url: string): NextRequest => ({ url, nextUrl: new URL(url) } as unknown as NextRequest)

  it("echoes challenge when ?t matches the tenant verifyToken", async () => {
    tenant.orgId = "org_acme"
    tenant.verifyToken = "ACME_V"
    const GET = await freshGET()
    const res = await GET(getReq(`${BASE}?t=acme&hub.mode=subscribe&hub.verify_token=ACME_V&hub.challenge=C1`))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe("C1")
  })
  it("403 when ?t present but verify_token does not match the tenant's", async () => {
    tenant.orgId = "org_acme"
    tenant.verifyToken = "ACME_V"
    const GET = await freshGET()
    expect((await GET(getReq(`${BASE}?t=acme&hub.mode=subscribe&hub.verify_token=WRONG&hub.challenge=C1`))).status).toBe(403)
  })
  it("403 when ?t present but tenant has NO verifyToken — no env fallback", async () => {
    process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN = "ENV_V"
    tenant.orgId = "org_acme"
    tenant.verifyToken = null
    const GET = await freshGET()
    expect((await GET(getReq(`${BASE}?t=acme&hub.mode=subscribe&hub.verify_token=ENV_V&hub.challenge=C1`))).status).toBe(403)
    delete process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN
  })
  it("falls back to env verify token when no ?t", async () => {
    process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN = "ENV_V"
    const GET = await freshGET()
    const res = await GET(getReq(`${BASE}?hub.mode=subscribe&hub.verify_token=ENV_V&hub.challenge=ENVC`))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe("ENVC")
    delete process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN
  })
})
