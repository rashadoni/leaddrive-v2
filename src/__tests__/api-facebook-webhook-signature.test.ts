import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { NextRequest } from "next/server"
import { createHmac } from "crypto"

/**
 * FB DM webhook HMAC verification + Model B per-tenant auth.
 *
 * This endpoint writes inbound DMs into tenant inboxes, so a forged payload would inject messages for
 * any (public) pageId — verify X-Hub-Signature-256 over the raw body with the app secret.
 *
 * Model B: each tenant's OWN Meta app appends ?t=<org-slug> to its callback URL and signs with ITS
 * OWN appSecret / verifies with ITS OWN verifyToken (both from the tenant's ChannelConfig). With no
 * ?t the endpoint falls back to env (LeadDrive's shared app) for backward compat.
 */

// Mutable tenant state the per-tenant tests set; mocks read it.
const tenant: { orgId: string | null; verifyToken: string | null; appSecret: string | null } = {
  orgId: null,
  verifyToken: null,
  appSecret: null,
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: {
      findUnique: vi.fn(async ({ where }: any) =>
        tenant.orgId && where?.slug ? { id: tenant.orgId } : null,
      ),
    },
    channelConfig: {
      findFirst: vi.fn(async () => null),
      // Two different findMany callers share this mock, told apart by `where.pageId`:
      //  - with pageId: the POST inbound-loop channel lookup — return [] so the loop `continue`s;
      //    these tests assert the lookup is ORG-SCOPED, not that a message is delivered.
      //  - without pageId: resolveTenantFacebookConfig's app-config lookup — the tenant's rows, each
      //    carrying settings:{} (non-igLogin) so the resolver's isIgLogin filter keeps it.
      findMany: vi.fn(async (args?: { where?: { pageId?: string } }) =>
        args?.where?.pageId
          ? []
          : tenant.verifyToken !== null || tenant.appSecret !== null
            ? [{ verifyToken: tenant.verifyToken, appSecret: tenant.appSecret, settings: {} }]
            : [],
      ),
    },
  },
}))
vi.mock("@/lib/facebook", () => ({ upsertSocialConversation: vi.fn() }))
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }))

import { POST } from "@/app/api/v1/webhooks/facebook/route"
import { prisma } from "@/lib/prisma"

const BASE = "https://app.leaddrivecrm.org/api/v1/webhooks/facebook"

function reqWith(body: string, signature?: string, url: string = BASE): NextRequest {
  return {
    url,
    nextUrl: new URL(url),
    text: async () => body,
    headers: { get: (k: string) => (k === "x-hub-signature-256" ? signature ?? null : null) },
  } as unknown as NextRequest
}
const payload = JSON.stringify({ object: "page", entry: [] })
const sign = (body: string, secret: string) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex")

beforeEach(() => {
  vi.clearAllMocks()
  tenant.orgId = null
  tenant.verifyToken = null
  tenant.appSecret = null
})
afterEach(() => {
  delete process.env.FACEBOOK_APP_SECRET
  delete process.env.ALLOW_UNSIGNED_META_WEBHOOKS
})

describe("FB webhook signature verification (env fallback — LeadDrive shared app)", () => {
  it("403 on an INVALID signature when FACEBOOK_APP_SECRET is set", async () => {
    process.env.FACEBOOK_APP_SECRET = "SECRET"
    expect((await POST(reqWith(payload, "sha256=deadbeef"))).status).toBe(403)
  })

  it("403 on a MISSING signature when the secret is set", async () => {
    process.env.FACEBOOK_APP_SECRET = "SECRET"
    expect((await POST(reqWith(payload, undefined))).status).toBe(403)
  })

  it("proceeds (200) on a VALID signature", async () => {
    process.env.FACEBOOK_APP_SECRET = "SECRET"
    expect((await POST(reqWith(payload, sign(payload, "SECRET")))).status).toBe(200)
  })

  it("rejects unsigned payloads when no secret is configured by default", async () => {
    delete process.env.FACEBOOK_APP_SECRET
    delete process.env.ALLOW_UNSIGNED_META_WEBHOOKS
    expect((await POST(reqWith(payload, undefined))).status).toBe(403)
  })

  it("skips verification only when the explicit non-production bypass is enabled", async () => {
    delete process.env.FACEBOOK_APP_SECRET
    process.env.ALLOW_UNSIGNED_META_WEBHOOKS = "1"
    expect((await POST(reqWith(payload, undefined))).status).toBe(200)
  })
})

describe("FB webhook Model B — per-tenant signature (?t=<org-slug>)", () => {
  it("verifies with the TENANT's appSecret, not env — 200 on valid tenant signature", async () => {
    process.env.FACEBOOK_APP_SECRET = "LEADDRIVE_ENV_SECRET" // must NOT be the one that validates
    tenant.orgId = "org_acme"
    tenant.appSecret = "ACME_APP_SECRET"
    const url = `${BASE}?t=acme`
    // Signed with the tenant's secret → must pass (proves per-tenant secret is used, not env).
    expect((await POST(reqWith(payload, sign(payload, "ACME_APP_SECRET"), url))).status).toBe(200)
  })

  it("403 when signed with the ENV secret but a tenant (?t) with a DIFFERENT secret is resolved", async () => {
    process.env.FACEBOOK_APP_SECRET = "LEADDRIVE_ENV_SECRET"
    tenant.orgId = "org_acme"
    tenant.appSecret = "ACME_APP_SECRET"
    const url = `${BASE}?t=acme`
    // Signed with the env secret → must FAIL, because the tenant's own secret is the one checked.
    expect((await POST(reqWith(payload, sign(payload, "LEADDRIVE_ENV_SECRET"), url))).status).toBe(403)
  })

  it("REJECTS (403) when ?t addresses a tenant that has no appSecret — NO env fallback", async () => {
    // Residual cross-tenant guard: ?t=acme explicitly addresses acme. If acme has no own appSecret,
    // we must NOT fall back to LeadDrive's env secret — otherwise an env-signed payload could be
    // written into acme's org by slug. Mirrors WhatsApp's tenant-declared-but-unresolved → reject.
    process.env.FACEBOOK_APP_SECRET = "LEADDRIVE_ENV_SECRET"
    tenant.orgId = "org_acme"
    tenant.appSecret = null // org exists, but no FB/IG appSecret configured
    const url = `${BASE}?t=acme`
    // Signed with the env secret → must STILL be rejected (no env fallback when ?t is present).
    expect((await POST(reqWith(payload, sign(payload, "LEADDRIVE_ENV_SECRET"), url))).status).toBe(403)
  })

  it("does NOT resolve an Instagram-Login (igLogin) row for a FB ?t — uses the FB app secret only", async () => {
    // Cross-surface guard: a tenant with BOTH a FB-Login app and an IG-Login app. The IG-Login row is
    // newest, but the FB webhook must skip it (settings.igLogin=true) and verify with the FB app secret.
    process.env.FACEBOOK_APP_SECRET = "ENV"
    tenant.orgId = "org_acme"
    ;(prisma.channelConfig.findMany as any).mockResolvedValueOnce([
      { verifyToken: "IG_V", appSecret: "IG_SEK", settings: { igLogin: true } },
      { verifyToken: "FB_V", appSecret: "FB_SEK", settings: {} },
    ])
    // Signed with the FB row's secret → passes (FB row resolved, igLogin row skipped).
    expect((await POST(reqWith(payload, sign(payload, "FB_SEK"), `${BASE}?t=acme`))).status).toBe(200)
  })

  it("rejects a FB ?t payload signed with the IG-Login app's secret (igLogin row excluded)", async () => {
    process.env.FACEBOOK_APP_SECRET = "ENV"
    tenant.orgId = "org_acme"
    ;(prisma.channelConfig.findMany as any).mockResolvedValueOnce([
      { verifyToken: "IG_V", appSecret: "IG_SEK", settings: { igLogin: true } },
      { verifyToken: "FB_V", appSecret: "FB_SEK", settings: {} },
    ])
    // Signed with the IG-Login secret → 403: the FB resolver excludes the igLogin row, so it can't match.
    expect((await POST(reqWith(payload, sign(payload, "IG_SEK"), `${BASE}?t=acme`))).status).toBe(403)
  })

  it("org-scopes the inbound channel lookup to the verified ?t tenant (no cross-tenant write)", async () => {
    // Cross-tenant guard: a validly-signed payload for tenant `acme` must only resolve channels in
    // acme's org. pageId is not unique across tenants, so an un-scoped lookup would let another tenant
    // (who stored this public Page ID) capture the message.
    process.env.FACEBOOK_APP_SECRET = "ENV"
    tenant.orgId = "org_acme"
    tenant.appSecret = "ACME_SECRET"
    const withEntry = JSON.stringify({ object: "page", entry: [{ id: "PAGE_A", messaging: [] }] })
    const res = await POST(reqWith(withEntry, sign(withEntry, "ACME_SECRET"), `${BASE}?t=acme`))
    expect(res.status).toBe(200) // signature valid → processed (loop finds no channel in-scope → 200)
    // The inbound pageId lookup MUST carry organizationId of the verified tenant.
    const calls = (prisma.channelConfig.findMany as any).mock.calls.map((c: any[]) => c[0])
    const loopCall = calls.find((a: any) => a?.where?.pageId === "PAGE_A")
    expect(loopCall).toBeTruthy()
    expect(loopCall.where.organizationId).toBe("org_acme")
    // ...and be ordered, so which claimant wins is never an unordered-scan accident.
    expect(loopCall.orderBy).toEqual([{ createdAt: "asc" }, { id: "asc" }])
    // The auth-resolver lookup is a findMany requiring the tenant's app-config row — appSecret AND
    // verifyToken non-null — so a historical env-credential page row (no verifyToken) can never be
    // picked to validate a ?t POST with the env secret.
    const manyCall = (prisma.channelConfig.findMany as any).mock.calls
      .map((c: any[]) => c[0])
      .find((a: any) => !a?.where?.pageId)
    expect(manyCall?.where?.appSecret).toEqual({ not: null })
    expect(manyCall?.where?.verifyToken).toEqual({ not: null })
  })

  it("does NOT org-scope (global lookup) on the env/LeadDrive path — no ?t", async () => {
    process.env.FACEBOOK_APP_SECRET = "ENV"
    const withEntry = JSON.stringify({ object: "page", entry: [{ id: "PAGE_X", messaging: [] }] })
    const res = await POST(reqWith(withEntry, sign(withEntry, "ENV"), BASE)) // no ?t
    expect(res.status).toBe(200)
    const calls = (prisma.channelConfig.findMany as any).mock.calls.map((c: any[]) => c[0])
    const loopCall = calls.find((a: any) => a?.where?.pageId === "PAGE_X")
    expect(loopCall).toBeTruthy()
    expect(loopCall.where.organizationId).toBeUndefined() // global — backward compat
    // Un-scoped, so the ordering is what keeps a contested pageId from routing by luck. See
    // api-facebook-webhook-pageid-tenant-routing.test.ts.
    expect(loopCall.orderBy).toEqual([{ createdAt: "asc" }, { id: "asc" }])
  })
})

describe("FB webhook Model B — per-tenant GET verify-token handshake", () => {
  async function freshGET() {
    vi.resetModules()
    const mod = await import("@/app/api/v1/webhooks/facebook/route")
    return mod.GET
  }
  function getReq(url: string): NextRequest {
    return { url, nextUrl: new URL(url) } as unknown as NextRequest
  }

  it("echoes the challenge when ?t matches the TENANT verifyToken", async () => {
    tenant.orgId = "org_acme"
    tenant.verifyToken = "ACME_VERIFY"
    const GET = await freshGET()
    const url = `${BASE}?t=acme&hub.mode=subscribe&hub.verify_token=ACME_VERIFY&hub.challenge=CHAL123`
    const res = await GET(getReq(url))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe("CHAL123")
  })

  it("403 when ?t is set but the verify_token does NOT match the tenant's", async () => {
    tenant.orgId = "org_acme"
    tenant.verifyToken = "ACME_VERIFY"
    const GET = await freshGET()
    const url = `${BASE}?t=acme&hub.mode=subscribe&hub.verify_token=WRONG&hub.challenge=CHAL123`
    expect((await GET(getReq(url))).status).toBe(403)
  })

  it("falls back to env FACEBOOK_VERIFY_TOKEN when no ?t is present", async () => {
    process.env.FACEBOOK_VERIFY_TOKEN = "ENV_VERIFY"
    const GET = await freshGET() // re-import so module-level VERIFY_TOKEN picks up the env
    const url = `${BASE}?hub.mode=subscribe&hub.verify_token=ENV_VERIFY&hub.challenge=ENVCHAL`
    const res = await GET(getReq(url))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe("ENVCHAL")
    delete process.env.FACEBOOK_VERIFY_TOKEN
  })

  it("403 when ?t is present but the tenant has NO verifyToken — does NOT env-fallback", async () => {
    process.env.FACEBOOK_VERIFY_TOKEN = "ENV_VERIFY" // env token exists but must NOT be used for a ?t tenant
    tenant.orgId = "org_acme"
    tenant.verifyToken = null
    const GET = await freshGET()
    // Even presenting the env token must fail — ?t=acme can only be verified by acme's own token.
    const url = `${BASE}?t=acme&hub.mode=subscribe&hub.verify_token=ENV_VERIFY&hub.challenge=C`
    expect((await GET(getReq(url))).status).toBe(403)
    delete process.env.FACEBOOK_VERIFY_TOKEN
  })
})
