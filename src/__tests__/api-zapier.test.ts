/**
 * Tests for L6 Native Zapier Connector — subscribe-hooks API surface.
 * Covers: /me, /triggers, /subscribe (POST), /subscribe/[id] (DELETE),
 * /samples/[trigger] (GET).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import crypto from "crypto"

/* ─── Mocks ──────────────────────────────────────────────────────────── */

const { mockValidateOutboundWebhookUrl } = vi.hoisted(() => ({
  mockValidateOutboundWebhookUrl: vi.fn(async (rawUrl: string) => {
    const url = new URL(rawUrl)
    if (
      url.protocol !== "https:" ||
      ["localhost", "127.0.0.1", "10.0.0.1"].includes(url.hostname)
    ) {
      throw new Error("unsafe URL")
    }
    return {
      url,
      addresses: [{ address: "93.184.216.34", family: 4 }],
    }
  }),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    apiKey: {
      findFirst: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    webhook: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    lead: { findFirst: vi.fn() },
    deal: { findFirst: vi.fn() },
    contact: { findFirst: vi.fn() },
    company: { findFirst: vi.fn() },
    ticket: { findFirst: vi.fn() },
  },
}))

vi.mock("@/lib/url-validation", () => ({
  isPrivateUrl: vi.fn((u: string) => /^https?:\/\/(localhost|127\.|10\.|192\.168\.)/i.test(u)),
}))

vi.mock("@/lib/integrations/webhook-url-guard", () => ({
  validateOutboundWebhookUrl: mockValidateOutboundWebhookUrl,
}))

import { prisma } from "@/lib/prisma"
import { requiredScopesForEvent } from "@/lib/zapier-auth"
import { GET as GET_ME } from "@/app/api/v1/zapier/me/route"
import { GET as GET_TRIGGERS } from "@/app/api/v1/zapier/triggers/route"
import { POST as POST_SUBSCRIBE } from "@/app/api/v1/zapier/subscribe/route"
import { DELETE as DELETE_SUBSCRIBE } from "@/app/api/v1/zapier/subscribe/[id]/route"
import { GET as GET_SAMPLE } from "@/app/api/v1/zapier/samples/[trigger]/route"

const ORG_ID = "org_test_001"
const RAW_KEY = "ld_test_key_abcdefghijklmnop"
const KEY_HASH = crypto.createHash("sha256").update(RAW_KEY).digest("hex")

const apiKeyFixture = {
  id: "apikey_001",
  organizationId: ORG_ID,
  name: "Zapier Integration",
  keyHash: KEY_HASH,
  scopes: ["read:deals", "write:deals", "read:leads", "write:leads", "read:contacts", "read:companies", "read:tickets"],
  isActive: true,
  expiresAt: null,
  organization: { name: "Acme Corp", slug: "acme", isActive: true },
}

// Loose typing — Next 16 RequestInit type tightened (no `signal: null`),
// matches the pre-existing test-suite pattern. See docs/tech-debt-known-issues.md.
type ReqInit = ConstructorParameters<typeof NextRequest>[1]

function authedReq(url: string, init: ReqInit = {}): NextRequest {
  const headers = new Headers(init?.headers as HeadersInit)
  headers.set("authorization", `Bearer ${RAW_KEY}`)
  return new NextRequest(url, { ...init, headers })
}

function unauthedReq(url: string, init: ReqInit = {}): NextRequest {
  return new NextRequest(url, init)
}

/* ─── Tests ──────────────────────────────────────────────────────────── */

describe("L6 Zapier — requiredScopesForEvent unit", () => {
  it("maps deal.created → read:deals / write:deals", () => {
    expect(requiredScopesForEvent("deal.created")).toEqual(["read:deals", "write:deals"])
  })

  it("maps company.created → read:companies (not 'companys')", () => {
    // Regression guard: naive `${entity}s` mapping produced "companys" and broke subscribe.
    const scopes = requiredScopesForEvent("company.created")
    expect(scopes).toContain("read:companies")
    expect(scopes).toContain("write:companies")
    expect(scopes.some(s => s.endsWith("companys"))).toBe(false)
  })

  it("maps lead.converted → read:leads / write:leads", () => {
    expect(requiredScopesForEvent("lead.converted")).toEqual(["read:leads", "write:leads"])
  })

  it("maps ticket.resolved → read:tickets / write:tickets", () => {
    expect(requiredScopesForEvent("ticket.resolved")).toEqual(["read:tickets", "write:tickets"])
  })

  it("falls back to naive pluralization for unknown entity prefixes", () => {
    expect(requiredScopesForEvent("foo.created")).toEqual(["read:foos", "write:foos"])
  })
})


describe("L6 Zapier — /api/v1/zapier/me", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("401 when no Authorization header", async () => {
    const res = await GET_ME(unauthedReq("http://x/api/v1/zapier/me"))
    expect(res.status).toBe(401)
  })

  it("401 when API key hash not found", async () => {
    ;(prisma.apiKey.findFirst as any).mockResolvedValueOnce(null)
    const res = await GET_ME(authedReq("http://x/api/v1/zapier/me"))
    expect(res.status).toBe(401)
  })

  it("returns org + scopes for valid API key", async () => {
    ;(prisma.apiKey.findFirst as any).mockResolvedValueOnce(apiKeyFixture)
    const res = await GET_ME(authedReq("http://x/api/v1/zapier/me"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      id: "apikey_001",
      org_id: ORG_ID,
      org_name: "Acme Corp",
      org_slug: "acme",
      api_key_name: "Zapier Integration",
    })
    expect(body.scopes).toContain("read:deals")
  })

  it("401 when key has expired", async () => {
    const expired = { ...apiKeyFixture, expiresAt: new Date(Date.now() - 1000) }
    ;(prisma.apiKey.findFirst as any).mockResolvedValueOnce(expired)
    const res = await GET_ME(authedReq("http://x/api/v1/zapier/me"))
    expect(res.status).toBe(401)
  })

  it("401 when the API key belongs to an inactive organization", async () => {
    ;(prisma.apiKey.findFirst as any).mockResolvedValueOnce({
      ...apiKeyFixture,
      organization: { ...apiKeyFixture.organization, isActive: false },
    })
    const res = await GET_ME(authedReq("http://x/api/v1/zapier/me"))
    expect(res.status).toBe(401)
  })

  it("401 on Bearer header with non-ld_ prefix", async () => {
    const headers = new Headers()
    headers.set("authorization", "Bearer some_other_key")
    const req = new NextRequest("http://x/api/v1/zapier/me", { headers })
    const res = await GET_ME(req)
    expect(res.status).toBe(401)
  })
})

describe("L6 Zapier — /api/v1/zapier/triggers", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns full trigger catalog for authed request", async () => {
    ;(prisma.apiKey.findFirst as any).mockResolvedValueOnce(apiKeyFixture)
    const res = await GET_TRIGGERS(authedReq("http://x/api/v1/zapier/triggers"))
    expect(res.status).toBe(200)
    const body = await res.json()
    const keys = body.triggers.map((t: any) => t.key)
    expect(keys).toContain("deal.created")
    expect(keys).toContain("ticket.resolved")
    expect(keys).toContain("lead.converted")
  })

  it("401 without auth", async () => {
    const res = await GET_TRIGGERS(unauthedReq("http://x/api/v1/zapier/triggers"))
    expect(res.status).toBe(401)
  })
})

describe("L6 Zapier — POST /api/v1/zapier/subscribe", () => {
  beforeEach(() => vi.clearAllMocks())

  it("creates a webhook subscription for valid event", async () => {
    ;(prisma.apiKey.findFirst as any).mockResolvedValueOnce(apiKeyFixture)
    ;(prisma.webhook.findFirst as any).mockResolvedValueOnce(null) // dedupe path: no existing
    ;(prisma.webhook.create as any).mockResolvedValueOnce({
      id: "wh_001",
      organizationId: ORG_ID,
      url: "https://hooks.zapier.com/abc",
      events: ["deal.created"],
      secret: "secret",
      isActive: true,
      createdAt: new Date("2026-05-14T10:00:00Z"),
    })

    const req = authedReq("http://x/api/v1/zapier/subscribe", {
      method: "POST",
      body: JSON.stringify({ event: "deal.created", target_url: "https://hooks.zapier.com/abc" }),
    })
    const res = await POST_SUBSCRIBE(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBe("wh_001")
    expect(body.event).toBe("deal.created")
    expect(body.target_url).toBe("https://hooks.zapier.com/abc")
    expect((prisma.webhook.create as any)).toHaveBeenCalledTimes(1)
    expect((prisma.webhook.create as any)).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: ORG_ID,
        createdByApiKeyId: "apikey_001",
        provenance: "zapier",
        events: ["deal.created"],
      }),
    }))
  })

  it("rejects unknown event with 400", async () => {
    ;(prisma.apiKey.findFirst as any).mockResolvedValueOnce(apiKeyFixture)
    const req = authedReq("http://x/api/v1/zapier/subscribe", {
      method: "POST",
      body: JSON.stringify({ event: "fake.event", target_url: "https://hooks.zapier.com/abc" }),
    })
    const res = await POST_SUBSCRIBE(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("unknown_event")
  })

  it("rejects private/loopback target_url with 400 (SSRF defence)", async () => {
    ;(prisma.apiKey.findFirst as any).mockResolvedValueOnce(apiKeyFixture)
    const req = authedReq("http://x/api/v1/zapier/subscribe", {
      method: "POST",
      body: JSON.stringify({ event: "deal.created", target_url: "http://localhost:9999/cb" }),
    })
    const res = await POST_SUBSCRIBE(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("invalid_target")
  })

  it("returns 403 when API key lacks required scope", async () => {
    const lowScopeKey = { ...apiKeyFixture, scopes: ["read:contacts"] /* no deals scope */ }
    ;(prisma.apiKey.findFirst as any).mockResolvedValueOnce(lowScopeKey)
    const req = authedReq("http://x/api/v1/zapier/subscribe", {
      method: "POST",
      body: JSON.stringify({ event: "deal.created", target_url: "https://hooks.zapier.com/abc" }),
    })
    const res = await POST_SUBSCRIBE(req)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe("insufficient_scope")
    expect(body.required_any_of).toContain("read:deals")
  })

  it("400 on invalid JSON body", async () => {
    ;(prisma.apiKey.findFirst as any).mockResolvedValueOnce(apiKeyFixture)
    const req = authedReq("http://x/api/v1/zapier/subscribe", {
      method: "POST",
      body: "not json{",
    })
    const res = await POST_SUBSCRIBE(req)
    expect(res.status).toBe(400)
  })

  it("400 on missing fields", async () => {
    ;(prisma.apiKey.findFirst as any).mockResolvedValueOnce(apiKeyFixture)
    const req = authedReq("http://x/api/v1/zapier/subscribe", {
      method: "POST",
      body: JSON.stringify({ event: "deal.created" }), // target_url missing
    })
    const res = await POST_SUBSCRIBE(req)
    expect(res.status).toBe(400)
  })

  // Architect-found plural mapping bug (company → companys vs companies)
  it("accepts company.created subscribe — plural mapping handles 'companies' irregular", async () => {
    ;(prisma.apiKey.findFirst as any).mockResolvedValueOnce(apiKeyFixture)
    ;(prisma.webhook.findFirst as any).mockResolvedValueOnce(null) // no existing dupe
    ;(prisma.webhook.create as any).mockResolvedValueOnce({
      id: "wh_co_001",
      organizationId: ORG_ID,
      url: "https://hooks.zapier.com/co",
      events: ["company.created"],
      secret: "s",
      isActive: true,
      createdAt: new Date(),
    })
    const req = authedReq("http://x/api/v1/zapier/subscribe", {
      method: "POST",
      body: JSON.stringify({ event: "company.created", target_url: "https://hooks.zapier.com/co" }),
    })
    const res = await POST_SUBSCRIBE(req)
    // Pre-fix this was 403 because requiredScopesFor("company.created") returned
    // ["read:companys"] which never matched ["read:companies"].
    expect(res.status).toBe(201)
  })

  it("idempotent: returns existing webhook id when same (org, url, event) already subscribed", async () => {
    ;(prisma.apiKey.findFirst as any).mockResolvedValueOnce(apiKeyFixture)
    ;(prisma.webhook.findFirst as any).mockResolvedValueOnce({
      id: "wh_existing_001",
      organizationId: ORG_ID,
      url: "https://hooks.zapier.com/abc",
      events: ["deal.created"],
      createdAt: new Date("2026-05-10T10:00:00Z"),
      isActive: true,
    })
    const req = authedReq("http://x/api/v1/zapier/subscribe", {
      method: "POST",
      body: JSON.stringify({ event: "deal.created", target_url: "https://hooks.zapier.com/abc" }),
    })
    const res = await POST_SUBSCRIBE(req)
    expect(res.status).toBe(200) // not 201
    const body = await res.json()
    expect(body.id).toBe("wh_existing_001")
    expect(body.deduped).toBe(true)
    expect((prisma.webhook.create as any)).not.toHaveBeenCalled()
    expect((prisma.webhook.findFirst as any)).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: ORG_ID,
        createdByApiKeyId: "apikey_001",
        provenance: "zapier",
        url: "https://hooks.zapier.com/abc",
        isActive: true,
        events: { equals: ["deal.created"] },
      },
    }))
  })

  it("does not dedupe against generic, other-key, or multi-event webhooks", async () => {
    ;(prisma.apiKey.findFirst as any).mockResolvedValueOnce(apiKeyFixture)
    const unrelatedRows = [
      { id: "wh_admin", organizationId: ORG_ID, createdByApiKeyId: null, provenance: "generic", url: "https://hooks.zapier.com/abc", events: ["deal.created"], isActive: true },
      { id: "wh_other_key", organizationId: ORG_ID, createdByApiKeyId: "apikey_other", provenance: "zapier", url: "https://hooks.zapier.com/abc", events: ["deal.created"], isActive: true },
      { id: "wh_multi", organizationId: ORG_ID, createdByApiKeyId: "apikey_001", provenance: "zapier", url: "https://hooks.zapier.com/abc", events: ["deal.created", "lead.created"], isActive: true },
    ]
    ;(prisma.webhook.findFirst as any).mockImplementationOnce(({ where }: any) => {
      // Approximate the relevant Prisma equality predicates against rows that
      // existed before this subscribe request.
      return unrelatedRows.find((row) => (
        row.organizationId === where.organizationId &&
        row.createdByApiKeyId === where.createdByApiKeyId &&
        row.provenance === where.provenance &&
        row.url === where.url &&
        row.isActive === where.isActive &&
        JSON.stringify(row.events) === JSON.stringify(where.events.equals)
      )) ?? null
    })
    ;(prisma.webhook.create as any).mockResolvedValueOnce({
      id: "wh_new_isolated",
      createdAt: new Date("2026-05-14T10:00:00Z"),
    })

    const req = authedReq("http://x/api/v1/zapier/subscribe", {
      method: "POST",
      body: JSON.stringify({ event: "deal.created", target_url: "https://hooks.zapier.com/abc" }),
    })
    const res = await POST_SUBSCRIBE(req)

    expect(res.status).toBe(201)
    expect((prisma.webhook.create as any)).toHaveBeenCalledTimes(1)
    expect((prisma.webhook.create as any)).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ createdByApiKeyId: "apikey_001", provenance: "zapier", events: ["deal.created"] }),
    }))
  })

  it("recovers the same-key subscription that wins a concurrent subscribe race", async () => {
    ;(prisma.apiKey.findFirst as any).mockResolvedValueOnce(apiKeyFixture)
    ;(prisma.webhook.findFirst as any)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "wh_race_winner",
        createdAt: new Date("2026-05-14T10:00:00Z"),
      })
    ;(prisma.webhook.create as any).mockRejectedValueOnce({ code: "P2002" })

    const req = authedReq("http://x/api/v1/zapier/subscribe", {
      method: "POST",
      body: JSON.stringify({ event: "deal.created", target_url: "https://hooks.zapier.com/abc" }),
    })
    const res = await POST_SUBSCRIBE(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ id: "wh_race_winner", deduped: true })
  })
})

describe("L6 Zapier — DELETE /api/v1/zapier/subscribe/[id]", () => {
  beforeEach(() => vi.clearAllMocks())

  it("deactivates owned webhook", async () => {
    ;(prisma.apiKey.findFirst as any).mockResolvedValueOnce(apiKeyFixture)
    ;(prisma.webhook.findFirst as any).mockResolvedValueOnce({
      id: "wh_001",
      organizationId: ORG_ID,
      createdByApiKeyId: "apikey_001",
      provenance: "zapier",
      events: ["deal.created"],
    })

    const req = authedReq("http://x/api/v1/zapier/subscribe/wh_001", { method: "DELETE" })
    const res = await DELETE_SUBSCRIBE(req, { params: Promise.resolve({ id: "wh_001" }) })
    expect(res.status).toBe(200)
    expect((prisma.webhook.updateMany as any)).toHaveBeenCalledWith({
      where: {
        id: "wh_001",
        organizationId: ORG_ID,
        createdByApiKeyId: "apikey_001",
        provenance: "zapier",
        events: { equals: ["deal.created"] },
      },
      data: { isActive: false },
    })
  })

  it.each([
    ["generic/admin", { createdByApiKeyId: null, provenance: "generic", events: ["deal.created"] }],
    ["another key", { createdByApiKeyId: "apikey_other", provenance: "zapier", events: ["deal.created"] }],
    ["multi-event", { createdByApiKeyId: "apikey_001", provenance: "zapier", events: ["deal.created", "lead.created"] }],
  ])("404 and no mutation for %s webhook", async (_label, row) => {
    ;(prisma.apiKey.findFirst as any).mockResolvedValueOnce(apiKeyFixture)
    ;(prisma.webhook.findFirst as any).mockResolvedValueOnce({
      id: "wh_not_owned_subscription",
      organizationId: ORG_ID,
      ...row,
    })

    const req = authedReq("http://x/api/v1/zapier/subscribe/wh_not_owned_subscription", { method: "DELETE" })
    const res = await DELETE_SUBSCRIBE(req, {
      params: Promise.resolve({ id: "wh_not_owned_subscription" }),
    })

    expect(res.status).toBe(404)
    expect((prisma.webhook.updateMany as any)).not.toHaveBeenCalled()
  })

  it("403 when the creator key no longer has the subscribed event scope", async () => {
    ;(prisma.apiKey.findFirst as any).mockResolvedValueOnce({
      ...apiKeyFixture,
      scopes: ["read:contacts"],
    })
    ;(prisma.webhook.findFirst as any).mockResolvedValueOnce({
      id: "wh_deal",
      organizationId: ORG_ID,
      createdByApiKeyId: "apikey_001",
      provenance: "zapier",
      events: ["deal.created"],
    })

    const req = authedReq("http://x/api/v1/zapier/subscribe/wh_deal", { method: "DELETE" })
    const res = await DELETE_SUBSCRIBE(req, { params: Promise.resolve({ id: "wh_deal" }) })

    expect(res.status).toBe(403)
    expect((prisma.webhook.updateMany as any)).not.toHaveBeenCalled()
  })

  it("404 when webhook belongs to a different org (no info leak)", async () => {
    ;(prisma.apiKey.findFirst as any).mockResolvedValueOnce(apiKeyFixture)
    ;(prisma.webhook.findFirst as any).mockResolvedValueOnce(null) // findFirst with orgId scope returns null

    const req = authedReq("http://x/api/v1/zapier/subscribe/wh_other", { method: "DELETE" })
    const res = await DELETE_SUBSCRIBE(req, { params: Promise.resolve({ id: "wh_other" }) })
    expect(res.status).toBe(404)
  })

  it("401 without auth", async () => {
    const req = unauthedReq("http://x/api/v1/zapier/subscribe/wh_001", { method: "DELETE" })
    const res = await DELETE_SUBSCRIBE(req, { params: Promise.resolve({ id: "wh_001" }) })
    expect(res.status).toBe(401)
  })
})

describe("L6 Zapier — GET /api/v1/zapier/samples/[trigger]", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns live sample when org has matching data", async () => {
    ;(prisma.apiKey.findFirst as any).mockResolvedValueOnce(apiKeyFixture)
    ;(prisma.deal.findFirst as any).mockResolvedValueOnce({
      id: "deal_real_001",
      name: "Real Deal",
      valueAmount: 75000,
    })

    const req = authedReq("http://x/api/v1/zapier/samples/deal.created")
    const res = await GET_SAMPLE(req, { params: Promise.resolve({ trigger: "deal.created" }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.source).toBe("live")
    expect(body.sample.id).toBe("deal_real_001")
  })

  it("falls back to static sample when no live data exists", async () => {
    ;(prisma.apiKey.findFirst as any).mockResolvedValueOnce(apiKeyFixture)
    ;(prisma.deal.findFirst as any).mockResolvedValueOnce(null)

    const req = authedReq("http://x/api/v1/zapier/samples/deal.created")
    const res = await GET_SAMPLE(req, { params: Promise.resolve({ trigger: "deal.created" }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.source).toBe("static")
    expect(body.sample.id).toBe("deal_sample_001")
  })

  it("404 for unknown trigger key", async () => {
    ;(prisma.apiKey.findFirst as any).mockResolvedValueOnce(apiKeyFixture)
    const req = authedReq("http://x/api/v1/zapier/samples/bogus.trigger")
    const res = await GET_SAMPLE(req, { params: Promise.resolve({ trigger: "bogus.trigger" }) })
    expect(res.status).toBe(404)
  })

  it("403 when scope missing", async () => {
    const lowScopeKey = { ...apiKeyFixture, scopes: ["read:contacts"] }
    ;(prisma.apiKey.findFirst as any).mockResolvedValueOnce(lowScopeKey)
    const req = authedReq("http://x/api/v1/zapier/samples/deal.created")
    const res = await GET_SAMPLE(req, { params: Promise.resolve({ trigger: "deal.created" }) })
    expect(res.status).toBe(403)
  })
})
