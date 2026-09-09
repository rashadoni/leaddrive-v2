import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const validateOutboundWebhookUrl = vi.hoisted(() => vi.fn())

/* ── mocks ──────────────────────────────────────────────── */

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    activity: { findMany: vi.fn(), create: vi.fn() },
    user: { findMany: vi.fn() },
    apiKey: { findMany: vi.fn(), create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    webhook: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    auditLog: { findMany: vi.fn(), count: vi.fn(), create: vi.fn() },
    channelConfig: { findMany: vi.fn(), create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    currency: { findMany: vi.fn(), create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    company: { findMany: vi.fn() },
    contact: { findMany: vi.fn() },
    deal: { findMany: vi.fn() },
    lead: { findMany: vi.fn() },
    task: { findMany: vi.fn() },
    organization: { findUnique: vi.fn() },
  },
}))

vi.mock("@/lib/channels/platform-connections", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/channels/platform-connections")>()
  return { ...actual, syncTikTokDmConnectionForChannelConfig: vi.fn().mockResolvedValue(undefined) }
})

vi.mock("@/lib/integrations/webhook-url-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations/webhook-url-guard")>()
  return { ...actual, validateOutboundWebhookUrl }
})

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn(),
  orgHasModule: vi.fn().mockResolvedValue(true),
  requireAuth: vi.fn(),
  requireSessionAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((v: any) => v instanceof Response),
}))

vi.mock("@/lib/contact-events", () => ({
  trackContactEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/constants", () => ({
  PAGE_SIZE: { DEFAULT: 50, SEARCH: 5 },
  isAdmin: vi.fn().mockImplementation((role: string) => role === "admin" || role === "owner"),
  COMPANY_EMAIL: "admin@test.com",
}))

vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}))

/* ── imports ─────────────────────────────────────────────── */

import { GET as activitiesGET, POST as activitiesPOST } from "@/app/api/v1/activities/route"
import { GET as apiKeysGET, POST as apiKeysPOST } from "@/app/api/v1/api-keys/route"
import { DELETE as apiKeysDelete, PATCH as apiKeysPatch } from "@/app/api/v1/api-keys/[id]/route"
import { GET as auditLogGET } from "@/app/api/v1/audit-log/route"
import { GET as channelsGET, POST as channelsPOST } from "@/app/api/v1/channels/route"
import { PUT as channelsPUT, DELETE as channelsDELETE } from "@/app/api/v1/channels/[id]/route"
import { GET as searchGET } from "@/app/api/v1/search/route"
import { POST as demoRequestPOST } from "@/app/api/v1/demo-request/route"
import { GET as orgPlanGET } from "@/app/api/v1/organization/plan/route"

import { prisma } from "@/lib/prisma"
import { getOrgId, getSession, requireAuth, requireSessionAuth } from "@/lib/api-auth"
import { sendEmail } from "@/lib/email"

/* ── helpers ─────────────────────────────────────────────── */

const AUTH = { orgId: "org-1", userId: "user-1", role: "admin", email: "a@b.com", name: "Test" }

function req(url: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), init)
}

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
    const run = callback as unknown as (client: typeof prisma) => Promise<unknown>
    return await run(prisma) as never
  })
  vi.mocked(getOrgId).mockResolvedValue("org-1")
  vi.mocked(getSession).mockResolvedValue(AUTH as any)
  vi.mocked(requireAuth).mockResolvedValue(AUTH as any)
  vi.mocked(requireSessionAuth).mockResolvedValue(AUTH as any)
  validateOutboundWebhookUrl.mockImplementation(async (rawUrl: string) => ({
    url: new URL(rawUrl),
    addresses: [{ address: "93.184.216.34", family: 4 }],
  }))
})

/* ── Activities ──────────────────────────────────────────── */

describe("Activities", () => {
  it("GET returns activities list", async () => {
    vi.mocked(prisma.activity.findMany).mockResolvedValue([
      { id: "a1", subject: "Call", type: "call", createdBy: "user-1", createdAt: new Date() },
    ] as any)
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "user-1", name: "Test" }] as any)

    const res = await activitiesGET(req("/api/v1/activities"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.activities).toHaveLength(1)
    expect(json.data.activities[0].createdByName).toBe("Test")
  })

  it("POST creates activity", async () => {
    const activity = { id: "a2", type: "call", subject: "Follow up", organizationId: "org-1", contactId: "c1" }
    vi.mocked(prisma.activity.create).mockResolvedValue(activity as any)

    const res = await activitiesPOST(
      req("/api/v1/activities", {
        method: "POST",
        body: JSON.stringify({ type: "call", subject: "Follow up", contactId: "c1" }),
      })
    )
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.success).toBe(true)
  })

  it("POST rejects invalid body", async () => {
    const res = await activitiesPOST(
      req("/api/v1/activities", { method: "POST", body: JSON.stringify({ type: "" }) })
    )
    expect(res.status).toBe(400)
  })
})

/* ── API Keys ────────────────────────────────────────────── */

describe("API Keys", () => {
  it("GET lists keys", async () => {
    vi.mocked(prisma.apiKey.findMany).mockResolvedValue([{ id: "k1", name: "MyKey" }] as any)

    const res = await apiKeysGET(req("/api/v1/api-keys"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data).toHaveLength(1)
  })

  it("POST creates key and returns raw key", async () => {
    vi.mocked(prisma.apiKey.create).mockResolvedValue({
      id: "k2", name: "NewKey", keyPrefix: "ld_abcdef", scopes: ["read:contacts"],
      expiresAt: null, createdAt: new Date(),
    } as any)

    const res = await apiKeysPOST(
      req("/api/v1/api-keys", {
        method: "POST",
        body: JSON.stringify({ name: "NewKey", scopes: ["read:contacts"] }),
      })
    )
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.key).toMatch(/^ld_/)
  })

  it("POST rejects missing scopes", async () => {
    const res = await apiKeysPOST(
      req("/api/v1/api-keys", { method: "POST", body: JSON.stringify({ name: "NoScope" }) })
    )
    expect(res.status).toBe(400)
  })

  it("POST rejects scopes outside the canonical API_SCOPES allowlist", async () => {
    const res = await apiKeysPOST(
      req("/api/v1/api-keys", {
        method: "POST",
        body: JSON.stringify({ name: "Escalation", scopes: ["admin:*", "contacts:read"] }),
      }),
    )

    expect(res.status).toBe(400)
    expect(prisma.apiKey.create).not.toHaveBeenCalled()
  })

  it("DELETE revokes key", async () => {
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValue({ id: "k1", organizationId: "org-1" } as any)
    vi.mocked(prisma.apiKey.update).mockResolvedValue({ id: "k1", isActive: false } as any)

    const res = await apiKeysDelete(req("/api/v1/api-keys/k1", { method: "DELETE" }), params("k1"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(prisma.webhook.updateMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", createdByApiKeyId: "k1" },
      data: { isActive: false },
    })
  })

  it("PATCH disable deactivates Zapier subscriptions created by that key", async () => {
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValue({ id: "k1", organizationId: "org-1" } as any)
    vi.mocked(prisma.apiKey.update).mockResolvedValue({ id: "k1", name: "MyKey", isActive: false } as any)

    const res = await apiKeysPatch(
      req("/api/v1/api-keys/k1", { method: "PATCH", body: JSON.stringify({ isActive: false }) }),
      params("k1"),
    )

    expect(res.status).toBe(200)
    expect(prisma.webhook.updateMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", createdByApiKeyId: "k1" },
      data: { isActive: false },
    })
  })

  it("DELETE returns 404 for unknown key", async () => {
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValue(null)

    const res = await apiKeysDelete(req("/api/v1/api-keys/nope", { method: "DELETE" }), params("nope"))
    expect(res.status).toBe(404)
  })
})

/* ── Audit Log ───────────────────────────────────────────── */

describe("Audit Log", () => {
  it("GET returns paginated logs", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([{ id: "l1", action: "create" }] as any)
    vi.mocked(prisma.auditLog.count).mockResolvedValue(1)

    const res = await auditLogGET(req("/api/v1/audit-log?page=1&limit=10"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.total).toBe(1)
    expect(json.data.logs).toHaveLength(1)
  })

  it("GET returns 401 without org", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    vi.mocked(getSession).mockResolvedValue(null as any)
    const res = await auditLogGET(req("/api/v1/audit-log"))
    expect(res.status).toBe(401)
  })

  it("GET returns 500 on DB error", async () => {
    vi.mocked(prisma.auditLog.findMany).mockRejectedValue(new Error("db"))
    const res = await auditLogGET(req("/api/v1/audit-log"))
    const json = await res.json()
    expect(res.status).toBe(500)
    expect(json.error).toBe("Internal server error")
  })
})

/* ── Channels ────────────────────────────────────────────── */

describe("Channels", () => {
  it("GET returns channels", async () => {
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([{ id: "ch1", channelType: "whatsapp" }] as any)

    const res = await channelsGET(req("/api/v1/channels"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data).toHaveLength(1)
  })

  it("POST creates channel", async () => {
    vi.mocked(prisma.channelConfig.create).mockResolvedValue({ id: "ch2", channelType: "telegram" } as any)

    const res = await channelsPOST(
      req("/api/v1/channels", {
        method: "POST",
        body: JSON.stringify({ channelType: "telegram", configName: "Main bot" }),
      })
    )
    expect(res.status).toBe(201)
  })

  it("POST rejects a second TikTok via Chatwoot channel", async () => {
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([
      {
        id: "tiktok-existing",
        channelType: "chatwoot",
        configName: "TikTok via Chatwoot",
        settings: { provider: "tiktok", accountId: "171064", inboxId: "115298" },
      },
    ] as any)

    const res = await channelsPOST(
      req("/api/v1/channels", {
        method: "POST",
        body: JSON.stringify({
          channelType: "chatwoot",
          configName: "TikTok via Chatwoot",
          apiKey: "token",
          settings: { provider: "tiktok", accountId: "171064", inboxId: "115298" },
        }),
      })
    )
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.existingChannelId).toBe("tiktok-existing")
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1)
    expect(prisma.channelConfig.create).not.toHaveBeenCalled()
  })

  it("POST creates the first TikTok via Chatwoot channel inside the dedupe transaction", async () => {
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([])
    vi.mocked(prisma.channelConfig.create).mockResolvedValue({
      id: "tiktok-first",
      organizationId: "org-1",
      channelType: "chatwoot",
      configName: "TikTok via Chatwoot",
      settings: { provider: "tiktok" },
    } as any)

    const res = await channelsPOST(
      req("/api/v1/channels", {
        method: "POST",
        body: JSON.stringify({
          channelType: "chatwoot",
          configName: "TikTok via Chatwoot",
          apiKey: "token",
          settings: { provider: "tiktok", accountId: "171064", inboxId: "115298" },
        }),
      })
    )

    expect(res.status).toBe(201)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.channelConfig.create).toHaveBeenCalledTimes(1)
  })

  it("POST rejects an unsafe Chatwoot baseUrl before creating a channel", async () => {
    validateOutboundWebhookUrl.mockRejectedValueOnce(
      new Error("Webhook URL resolves to a private address"),
    )

    const res = await channelsPOST(
      req("/api/v1/channels", {
        method: "POST",
        body: JSON.stringify({
          channelType: "chatwoot",
          configName: "TikTok via Chatwoot",
          apiKey: "token",
          settings: {
            provider: "tiktok",
            baseUrl: "https://chatwoot-rebind.example",
            accountId: "171064",
          },
        }),
      }),
    )
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/public HTTPS URL/)
    expect(prisma.channelConfig.create).not.toHaveBeenCalled()
  })

  it("POST rejects incomplete WhatsApp Business API credentials", async () => {
    const res = await channelsPOST(
      req("/api/v1/channels", {
        method: "POST",
        body: JSON.stringify({
          channelType: "whatsapp",
          configName: "WhatsApp Business",
          accessToken: "token",
          phoneNumberId: "phone_1",
        }),
      })
    )
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toContain("App Secret")
    expect(prisma.channelConfig.create).not.toHaveBeenCalled()
  })

  it("POST creates a WhatsApp channel only when all webhook/calling credentials are present", async () => {
    vi.mocked(prisma.channelConfig.create).mockResolvedValue({ id: "wa_1", channelType: "whatsapp" } as any)

    const res = await channelsPOST(
      req("/api/v1/channels", {
        method: "POST",
        body: JSON.stringify({
          channelType: "whatsapp",
          configName: "WhatsApp Business",
          accessToken: "token",
          phoneNumberId: "phone_1",
          businessAccountId: "waba_1",
          verifyToken: "verify",
          appSecret: "secret",
        }),
      })
    )

    expect(res.status).toBe(201)
    expect(prisma.channelConfig.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        channelType: "whatsapp",
        apiKey: "token",
        phoneNumber: "phone_1",
        webhookUrl: "waba_1",
      }),
    })
  })

  it("PUT updates channel", async () => {
    vi.mocked(prisma.channelConfig.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.channelConfig.findFirst).mockResolvedValue({ id: "ch1", configName: "Updated" } as any)

    const res = await channelsPUT(
      req("/api/v1/channels/ch1", { method: "PUT", body: JSON.stringify({ configName: "Updated" }) }),
      params("ch1")
    )
    const json = await res.json()
    expect(json.success).toBe(true)
  })

  it("PUT preserves stored WhatsApp credentials when omitted on edit", async () => {
    vi.mocked(prisma.channelConfig.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.channelConfig.findFirst)
      .mockResolvedValueOnce({
        id: "wa_1",
        channelType: "whatsapp",
        accessToken: "token",
        phoneNumberId: "phone_1",
        businessAccountId: "waba_1",
        verifyToken: "verify",
        appSecret: "secret",
      } as any)
      .mockResolvedValueOnce({ id: "wa_1", configName: "Renamed" } as any)

    const res = await channelsPUT(
      req("/api/v1/channels/wa_1", { method: "PUT", body: JSON.stringify({ configName: "Renamed" }) }),
      params("wa_1")
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
  })

  it("DELETE removes channel", async () => {
    vi.mocked(prisma.channelConfig.deleteMany).mockResolvedValue({ count: 1 } as any)

    const res = await channelsDELETE(req("/api/v1/channels/ch1", { method: "DELETE" }), params("ch1"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.deleted).toBe("ch1")
  })

  it("DELETE returns 404 for missing channel", async () => {
    vi.mocked(prisma.channelConfig.deleteMany).mockResolvedValue({ count: 0 } as any)

    const res = await channelsDELETE(req("/api/v1/channels/nope", { method: "DELETE" }), params("nope"))
    expect(res.status).toBe(404)
  })
})


/* ── Search ──────────────────────────────────────────────── */

describe("Search", () => {
  it("GET returns empty for short query", async () => {
    const res = await searchGET(req("/api/v1/search?q=a"))
    const json = await res.json()
    expect(json.data).toEqual([])
  })

  it("GET returns merged results for valid query", async () => {
    vi.mocked(prisma.company.findMany).mockResolvedValue([{ id: "co1", name: "Acme", industry: "Tech" }] as any)
    vi.mocked(prisma.contact.findMany).mockResolvedValue([])
    vi.mocked(prisma.deal.findMany).mockResolvedValue([])
    vi.mocked(prisma.lead.findMany).mockResolvedValue([])
    vi.mocked(prisma.task.findMany).mockResolvedValue([])

    const res = await searchGET(req("/api/v1/search?q=Acme"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.length).toBeGreaterThanOrEqual(1)
    expect(json.data[0].type).toBe("company")
  })
})

/* ── Demo Request ────────────────────────────────────────── */

describe("Demo Request", () => {
  it("POST succeeds with valid fields", async () => {
    const res = await demoRequestPOST(
      new Request("http://localhost:3000/api/v1/demo-request", {
        method: "POST",
        body: JSON.stringify({ name: "John", company: "Acme", email: "j@acme.com" }),
        headers: { "Content-Type": "application/json" },
      })
    )
    const json = await res.json()
    expect(json.success).toBe(true)
  })

  it("POST rejects missing required fields", async () => {
    const res = await demoRequestPOST(
      new Request("http://localhost:3000/api/v1/demo-request", {
        method: "POST",
        body: JSON.stringify({ name: "John" }),
        headers: { "Content-Type": "application/json" },
      })
    )
    expect(res.status).toBe(400)
  })
})

/* ── Organization Plan ───────────────────────────────────── */

describe("Organization Plan", () => {
  it("GET returns plan info", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      plan: "pro", maxUsers: 10, maxContacts: 5000, name: "TestOrg", addons: [],
    } as any)

    const res = await orgPlanGET(req("/api/v1/organization/plan"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.plan).toBe("pro")
    expect(json.data.organizationName).toBe("TestOrg")
  })

  it("GET returns 404 for missing org", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue(null)

    const res = await orgPlanGET(req("/api/v1/organization/plan"))
    expect(res.status).toBe(404)
  })
})
