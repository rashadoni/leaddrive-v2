import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { createHmac } from "crypto"

// vi.hoisted runs before vi.mock hoisting, so env vars are set before module-level consts
vi.hoisted(() => {
  process.env.FACEBOOK_VERIFY_TOKEN = "fb-test-token"
  process.env.WHATSAPP_VERIFY_TOKEN = "wa-test-token"
})

// Single hoisted mock fn so tests can override Anthropic's reply per-case
// (e.g. to inject `[CREATE_TICKET]` markers) without re-mocking the module.
const { mockAnthropicCreate } = vi.hoisted(() => ({
  mockAnthropicCreate: vi.fn(),
}))

const { mockValidateOutboundWebhookUrl } = vi.hoisted(() => ({
  mockValidateOutboundWebhookUrl: vi.fn(),
}))

/* ─── Mocks ──────────────────────────────────────────────────────────── */

vi.mock("@/lib/prisma", () => {
  const prismaMock = {
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    $queryRaw: vi.fn().mockResolvedValue([{ max: 0 }]),
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(prismaMock)),
    // The WhatsApp route imports the AI reply guard. Its granular limit
    // preflight reads the tenant settings before doing any model work, so
    // keep that dependency in the fixture even when a test is not exercising
    // the AI response itself.
    organization: {
      findUnique: vi.fn().mockResolvedValue({ id: "org1", settings: null, features: [] }),
    },
    webhook: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    channelMessage: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    contact: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    lead: { findFirst: vi.fn() },
    ticket: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn(), count: vi.fn() },
    ticketCategory: { findFirst: vi.fn() },
    ticketComment: { create: vi.fn() },
    aiAgentConfig: { findFirst: vi.fn() },
    aiChatSession: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    aiChatMessage: { create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    aiInteractionLog: { create: vi.fn() },
    kbArticle: { findMany: vi.fn() },
    channelConfig: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
  }

  return { prisma: prismaMock, logAudit: vi.fn() }
})

vi.mock("@/lib/workflow-engine", () => ({
  executeWorkflows: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/webhooks", () => ({
  fireWebhooks: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/integrations/webhook-url-guard", () => ({
  validateOutboundWebhookUrl: mockValidateOutboundWebhookUrl,
}))

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/contact-events", () => ({
  trackContactEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/slack", () => ({
  formatTicketNotification: vi.fn().mockReturnValue("ticket"),
  sendSlackNotification: vi.fn().mockResolvedValue(undefined),
}))

// SLA resolution is unit-tested separately (lib-sla-resolver.test.ts). The
// WhatsApp AI ticket path now calls it; stub to {} so these tests stay focused
// on the dedup guard + ticket.create being reached (no SLA tables to mock).
vi.mock("@/lib/sla-resolver", () => ({
  resolveTicketSla: vi.fn().mockResolvedValue({}),
  normalizeTicketPriority: (p: string) =>
    ["low", "medium", "high", "critical"].includes(p) ? p : "medium",
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(),
  requireSessionAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))

vi.mock("@/lib/facebook", () => ({
  upsertSocialConversation: vi.fn().mockResolvedValue({ id: "conv1" }),
}))

vi.mock("@/lib/inbox/conversation-events", () => ({
  emitConversationIngestEvents: vi.fn(async () => ({})),
}))

vi.mock("@/lib/whatsapp", () => ({
  sendWhatsAppMessage: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock("@/lib/ai/support-feature", () => ({
  isSupportAiEnabled: vi.fn().mockResolvedValue(true),
}))

vi.mock("@/lib/auto-assign", () => ({
  autoAssignTicket: vi.fn().mockResolvedValue({ assigned: false }),
}))

vi.mock("@/lib/chatbot-autoreply", () => ({
  maybeAutoReply: vi.fn().mockResolvedValue(null),
  chatbotTookOwnership: vi.fn().mockReturnValue(false),
}))

vi.mock("@/lib/sanitize", () => ({
  sanitizeLog: vi.fn((s: string) => s),
  sanitizeForPrompt: vi.fn((s: string) => s),
}))

// Explicit class makes the constructor contract obvious — the WA route does
// `new Anthropic(...)`, and an explicit class avoids relying on vi.fn's
// reify-as-constructor quirk under different vitest/transform versions.
// `mockAnthropicCreate` is hoisted so individual tests can call
// `.mockResolvedValueOnce(...)` to inject markers like `[CREATE_TICKET]`.
vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    messages = { create: mockAnthropicCreate }
  }
  return { default: MockAnthropic }
})

vi.mock("crypto", async (importOriginal) => {
  const actual = await importOriginal() as any
  return {
    ...actual,
    randomBytes: vi.fn().mockReturnValue({ toString: () => "mock-secret-hex" }),
    createHmac: actual.createHmac,
    timingSafeEqual: actual.timingSafeEqual,
  }
})

import { GET as GET_WEBHOOKS, POST as POST_WEBHOOK } from "@/app/api/v1/webhooks/manage/route"
import { GET as GET_WEBHOOK_BY_ID, PUT as PUT_WEBHOOK, DELETE as DELETE_WEBHOOK } from "@/app/api/v1/webhooks/manage/[id]/route"
import { GET as GET_FB, POST as POST_FB } from "@/app/api/v1/webhooks/facebook/route"
import { POST as POST_TG, GET as GET_TG } from "@/app/api/v1/webhooks/telegram/route"
import { POST as POST_VK } from "@/app/api/v1/webhooks/vkontakte/route"
import { GET as GET_WA, POST as POST_WA } from "@/app/api/v1/webhooks/whatsapp/route"

import { prisma } from "@/lib/prisma"
import { getOrgId, requireAuth, requireSessionAuth } from "@/lib/api-auth"
import { sendWhatsAppMessage } from "@/lib/whatsapp"

const TEST_WA_APP_SECRET = "wa-test-app-secret"
const TEST_FB_APP_SECRET = "fb-test-app-secret"

function makeRequest(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(new URL(url, "http://localhost:3000"), init)
}

function makeSignedWaRequest(payload: unknown, appSecret = TEST_WA_APP_SECRET) {
  const body = JSON.stringify(payload)
  const signature = `sha256=${createHmac("sha256", appSecret).update(body).digest("hex")}`
  return makeRequest("/api/v1/webhooks/whatsapp", {
    method: "POST",
    body,
    headers: { "x-hub-signature-256": signature },
  })
}

function makeSignedFbRequest(payload: unknown, appSecret = TEST_FB_APP_SECRET) {
  const body = JSON.stringify(payload)
  const signature = `sha256=${createHmac("sha256", appSecret).update(body).digest("hex")}`
  process.env.FACEBOOK_APP_SECRET = appSecret
  return makeRequest("/api/v1/webhooks/facebook", {
    method: "POST",
    body,
    headers: { "x-hub-signature-256": signature },
  })
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireSessionAuth).mockResolvedValue({
    orgId: "org1",
    userId: "admin-1",
    role: "admin",
    email: "admin@example.com",
    name: "Admin",
  } as never)
  vi.mocked(requireAuth).mockImplementation(async (req, module, action) => {
    const orgId = await getOrgId(req)
    if (!orgId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }) as any
    }
    return {
      orgId,
      userId: "admin-1",
      role: "admin",
      email: "admin@example.com",
      name: "Admin",
      module,
      action,
    } as any
  })
  mockValidateOutboundWebhookUrl.mockImplementation(async (rawUrl: string) => ({
    url: new URL(rawUrl),
    addresses: [{ address: "93.184.216.34", family: 4 }],
  }))
  vi.mocked((prisma as any).$executeRaw).mockResolvedValue(undefined)
  vi.mocked((prisma as any).$queryRaw).mockResolvedValue([{ max: 0 }])
  vi.mocked((prisma as any).$transaction).mockImplementation(async (callback: (tx: unknown) => unknown) => callback(prisma))
  vi.mocked(prisma.ticketCategory.findFirst).mockImplementation(async (args: any) => {
    const slug = args?.where?.slug || "general"
    return {
      id: `cat-${slug}`,
      slug,
      name: slug,
      scope: slug === "complaint" ? "complaint" : "ticket",
      defaultPriority: null,
    } as any
  })
  vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([] as any)
  // Default Anthropic reply — tests that need markers override via
  // `mockAnthropicCreate.mockResolvedValueOnce(...)`.
  mockAnthropicCreate.mockResolvedValue({
    content: [{ type: "text", text: "AI reply" }],
    usage: { input_tokens: 10, output_tokens: 20 },
  })
})

/* ─── WEBHOOK MANAGEMENT: GET /manage ─────────────────────────────────── */

describe("GET /api/v1/webhooks/manage", () => {
  it("returns 403 when the browser session is not an administrator", async () => {
    vi.mocked(requireSessionAuth).mockResolvedValueOnce({
      orgId: "org1",
      userId: "viewer-1",
      role: "viewer",
      email: "viewer@example.com",
      name: "Viewer",
    } as never)

    const res = await GET_WEBHOOKS(makeRequest("/api/v1/webhooks/manage"))

    expect(res.status).toBe(403)
    expect(requireSessionAuth).toHaveBeenCalledOnce()
    expect(prisma.webhook.findMany).not.toHaveBeenCalled()
  })

  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireSessionAuth).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) as never,
    )
    const res = await GET_WEBHOOKS(makeRequest("/api/v1/webhooks/manage"))
    expect(res.status).toBe(401)
  })

  it("does not fall back to an API key with read:settings", async () => {
    vi.mocked(requireSessionAuth).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) as never,
    )

    const res = await GET_WEBHOOKS(makeRequest("/api/v1/webhooks/manage", {
      headers: { authorization: "Bearer ld_test_api_key" },
    }))

    expect(res.status).toBe(401)
    expect(requireSessionAuth).toHaveBeenCalledOnce()
    expect(requireAuth).not.toHaveBeenCalled()
    expect(prisma.webhook.findMany).not.toHaveBeenCalled()
  })

  it("returns list of webhooks", async () => {
    vi.mocked(prisma.webhook.findMany).mockResolvedValue([{ id: "w1", url: "https://example.com" }] as any)
    const res = await GET_WEBHOOKS(makeRequest("/api/v1/webhooks/manage"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toHaveLength(1)
  })
})

/* ─── WEBHOOK MANAGEMENT: POST /manage ────────────────────────────────── */

describe("POST /api/v1/webhooks/manage", () => {
  it("returns 403 when the browser session is not an administrator", async () => {
    vi.mocked(requireSessionAuth).mockResolvedValueOnce({
      orgId: "org1",
      userId: "viewer-1",
      role: "viewer",
      email: "viewer@example.com",
      name: "Viewer",
    } as never)

    const res = await POST_WEBHOOK(
      makeRequest("/api/v1/webhooks/manage", {
        method: "POST",
        body: JSON.stringify({ url: "https://example.com", events: ["deal.created"] }),
      }),
    )

    expect(res.status).toBe(403)
    expect(requireSessionAuth).toHaveBeenCalledOnce()
    expect(mockValidateOutboundWebhookUrl).not.toHaveBeenCalled()
    expect(prisma.webhook.create).not.toHaveBeenCalled()
  })

  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireSessionAuth).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) as never,
    )
    const res = await POST_WEBHOOK(
      makeRequest("/api/v1/webhooks/manage", {
        method: "POST",
        body: JSON.stringify({ url: "https://example.com", events: ["deal.created"] }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it("returns 400 for invalid payload", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1")
    const res = await POST_WEBHOOK(
      makeRequest("/api/v1/webhooks/manage", { method: "POST", body: JSON.stringify({ url: "not-a-url" }) }),
    )
    expect(res.status).toBe(400)
  })

  it("creates webhook with secret", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1")
    vi.mocked(prisma.webhook.create).mockResolvedValue({
      id: "w1",
      url: "https://example.com",
      events: ["deal.created"],
      secret: "mock-secret-hex",
    } as any)
    const res = await POST_WEBHOOK(
      makeRequest("/api/v1/webhooks/manage", {
        method: "POST",
        body: JSON.stringify({ url: "https://example.com", events: ["deal.created"] }),
      }),
    )
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.data.secret).toBeDefined()
    expect(prisma.webhook.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ provenance: "generic" }),
    }))
  })

  it("rejects a URL that fails async DNS/IP safety validation", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1")
    mockValidateOutboundWebhookUrl.mockRejectedValueOnce(
      new Error("Webhook URL resolves to a private address"),
    )

    const res = await POST_WEBHOOK(
      makeRequest("/api/v1/webhooks/manage", {
        method: "POST",
        body: JSON.stringify({
          url: "https://internal.example.test/hook",
          events: ["deal.created"],
        }),
      }),
    )

    expect(res.status).toBe(400)
    expect(prisma.webhook.create).not.toHaveBeenCalled()
  })
})

/* ─── WEBHOOK MANAGEMENT: GET /manage/[id] ────────────────────────────── */

describe("GET /api/v1/webhooks/manage/[id]", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireSessionAuth).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) as never,
    )
    const res = await GET_WEBHOOK_BY_ID(makeRequest("/api/v1/webhooks/manage/w1"), makeParams("w1") as any)
    expect(res.status).toBe(401)
  })

  it("returns 403 to a non-admin browser session", async () => {
    vi.mocked(requireSessionAuth).mockResolvedValueOnce({
      orgId: "org1",
      userId: "viewer-1",
      role: "viewer",
      email: "viewer@example.com",
      name: "Viewer",
    } as never)

    const res = await GET_WEBHOOK_BY_ID(
      makeRequest("/api/v1/webhooks/manage/w1"),
      makeParams("w1") as any,
    )

    expect(res.status).toBe(403)
    expect(prisma.webhook.findFirst).not.toHaveBeenCalled()
  })

  it("returns 404 when webhook not found", async () => {
    vi.mocked(prisma.webhook.findFirst).mockResolvedValue(null)
    const res = await GET_WEBHOOK_BY_ID(makeRequest("/api/v1/webhooks/manage/w1"), makeParams("w1") as any)
    expect(res.status).toBe(404)
  })

  it("returns webhook by id", async () => {
    vi.mocked(prisma.webhook.findFirst).mockResolvedValue({ id: "w1", url: "https://example.com" } as any)
    const res = await GET_WEBHOOK_BY_ID(makeRequest("/api/v1/webhooks/manage/w1"), makeParams("w1") as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.id).toBe("w1")
  })
})

/* ─── WEBHOOK MANAGEMENT: PUT /manage/[id] ────────────────────────────── */

describe("PUT /api/v1/webhooks/manage/[id]", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireSessionAuth).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) as never,
    )
    const res = await PUT_WEBHOOK(
      makeRequest("/api/v1/webhooks/manage/w1", { method: "PUT", body: JSON.stringify({ isActive: false }) }),
      makeParams("w1") as any,
    )
    expect(res.status).toBe(401)
  })

  it("returns 404 when webhook not found", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1")
    vi.mocked(prisma.webhook.updateMany).mockResolvedValue({ count: 0 } as any)
    const res = await PUT_WEBHOOK(
      makeRequest("/api/v1/webhooks/manage/w1", { method: "PUT", body: JSON.stringify({ isActive: false }) }),
      makeParams("w1") as any,
    )
    expect(res.status).toBe(404)
  })

  it("updates webhook", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1")
    vi.mocked(prisma.webhook.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.webhook.findFirst).mockResolvedValue({ id: "w1", isActive: false, provenance: "generic" } as any)
    const res = await PUT_WEBHOOK(
      makeRequest("/api/v1/webhooks/manage/w1", { method: "PUT", body: JSON.stringify({ isActive: false }) }),
      makeParams("w1") as any,
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.isActive).toBe(false)
  })

  it("revalidates a changed URL before updating", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1")
    vi.mocked(prisma.webhook.findFirst).mockResolvedValueOnce({ provenance: "generic" } as any)
    mockValidateOutboundWebhookUrl.mockRejectedValueOnce(
      new Error("Webhook URL resolves to a private address"),
    )

    const res = await PUT_WEBHOOK(
      makeRequest("/api/v1/webhooks/manage/w1", {
        method: "PUT",
        body: JSON.stringify({ url: "https://internal.example.test/hook" }),
      }),
      makeParams("w1") as any,
    )

    expect(res.status).toBe(400)
    expect(prisma.webhook.updateMany).not.toHaveBeenCalled()
  })

  it("upgrades a reviewed legacy row to generic provenance", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1")
    vi.mocked(prisma.webhook.findFirst)
      .mockResolvedValueOnce({ provenance: "legacy_unclassified" } as any)
      .mockResolvedValueOnce({ id: "w1", provenance: "generic", isActive: true } as any)
    vi.mocked(prisma.webhook.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await PUT_WEBHOOK(
      makeRequest("/api/v1/webhooks/manage/w1", { method: "PUT", body: JSON.stringify({ isActive: true }) }),
      makeParams("w1") as any,
    )

    expect(res.status).toBe(200)
    expect(prisma.webhook.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ isActive: true, provenance: "generic" }),
    }))
  })

  it("does not detach a Zapier subscription through generic management", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1")
    vi.mocked(prisma.webhook.findFirst).mockResolvedValueOnce({ provenance: "zapier" } as any)

    const res = await PUT_WEBHOOK(
      makeRequest("/api/v1/webhooks/manage/w1", { method: "PUT", body: JSON.stringify({ isActive: true }) }),
      makeParams("w1") as any,
    )

    expect(res.status).toBe(409)
    expect(prisma.webhook.updateMany).not.toHaveBeenCalled()
  })
})

/* ─── WEBHOOK MANAGEMENT: DELETE /manage/[id] ─────────────────────────── */

describe("DELETE /api/v1/webhooks/manage/[id]", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireSessionAuth).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) as never,
    )
    const res = await DELETE_WEBHOOK(
      makeRequest("/api/v1/webhooks/manage/w1", { method: "DELETE" }),
      makeParams("w1") as any,
    )
    expect(res.status).toBe(401)
  })

  it("returns 404 when webhook not found", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1")
    vi.mocked(prisma.webhook.deleteMany).mockResolvedValue({ count: 0 } as any)
    const res = await DELETE_WEBHOOK(
      makeRequest("/api/v1/webhooks/manage/w1", { method: "DELETE" }),
      makeParams("w1") as any,
    )
    expect(res.status).toBe(404)
  })

  it("deletes webhook", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1")
    vi.mocked(prisma.webhook.findFirst).mockResolvedValue({ provenance: "generic" } as any)
    vi.mocked(prisma.webhook.deleteMany).mockResolvedValue({ count: 1 } as any)
    const res = await DELETE_WEBHOOK(
      makeRequest("/api/v1/webhooks/manage/w1", { method: "DELETE" }),
      makeParams("w1") as any,
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.deleted).toBe("w1")
  })

  it("does not delete a Zapier-owned subscription through generic management", async () => {
    vi.mocked(prisma.webhook.findFirst).mockResolvedValue({ provenance: "zapier" } as any)

    const res = await DELETE_WEBHOOK(
      makeRequest("/api/v1/webhooks/manage/w1", { method: "DELETE" }),
      makeParams("w1") as any,
    )

    expect(res.status).toBe(409)
    expect(prisma.webhook.deleteMany).not.toHaveBeenCalled()
  })
})

/* ─── FACEBOOK WEBHOOK ────────────────────────────────────────────────── */

describe("GET /api/v1/webhooks/facebook", () => {
  it("returns 403 when token mismatches", async () => {
    const res = await GET_FB(makeRequest("/api/v1/webhooks/facebook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc"))
    expect(res.status).toBe(403)
  })

  it("returns challenge on valid verification", async () => {
    const res = await GET_FB(
      makeRequest("/api/v1/webhooks/facebook?hub.mode=subscribe&hub.verify_token=fb-test-token&hub.challenge=test123"),
    )
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toBe("test123")
  })
})

describe("POST /api/v1/webhooks/facebook", () => {
  it("returns ok for non-page object", async () => {
    const res = await POST_FB(
      makeSignedFbRequest({ object: "user" }),
    )
    expect(res.status).toBe(200)
  })

  it("processes page message", async () => {
    // The inbound pageId lookup is a findMany (every active claimant of the pageId, ranked
    // deterministically) — see api-facebook-webhook-pageid-tenant-routing.test.ts.
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([
      { id: "ch1", organizationId: "org1", channelType: "facebook", pageId: "page1", isActive: true, settings: {}, createdAt: new Date("2026-01-01T00:00:00Z") },
    ] as any)
    vi.mocked(prisma.channelMessage.create).mockResolvedValue({ id: "m1" } as any)
    const res = await POST_FB(
      makeSignedFbRequest({
          object: "page",
          entry: [{
            id: "page1",
            messaging: [{ sender: { id: "user1" }, message: { text: "Hello" } }],
          }],
      }),
    )
    expect(res.status).toBe(200)
    expect(prisma.channelMessage.create).toHaveBeenCalled()
  })
})

/* ─── TELEGRAM WEBHOOK ────────────────────────────────────────────────── */

describe("POST /api/v1/webhooks/telegram", () => {
  it("returns 400 when token param missing", async () => {
    const res = await POST_TG(
      makeRequest("/api/v1/webhooks/telegram", { method: "POST", body: JSON.stringify({ message: { chat: { id: 1 }, from: {}, text: "hi" } }) }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 401 when secret header is invalid", async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = "correct-secret"
    const res = await POST_TG(
      makeRequest("/api/v1/webhooks/telegram?token=bot123", {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "wrong" },
        body: JSON.stringify({ message: { chat: { id: 1 }, from: {}, text: "hi" } }),
      }),
    )
    expect(res.status).toBe(401)
    delete process.env.TELEGRAM_WEBHOOK_SECRET
  })

  it("processes message when config found", async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET
    vi.mocked(prisma.channelConfig.findFirst).mockResolvedValue({ id: "ch1", organizationId: "org1" } as any)
    vi.mocked(prisma.channelMessage.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.channelMessage.create).mockResolvedValue({ id: "m1" } as any)
    const res = await POST_TG(
      makeRequest("/api/v1/webhooks/telegram?token=bot123", {
        method: "POST",
        body: JSON.stringify({
          message: { message_id: 1, chat: { id: 100 }, from: { id: 200, first_name: "John" }, text: "Hello" },
        }),
      }),
    )
    expect(res.status).toBe(200)
    expect(prisma.channelMessage.create).toHaveBeenCalled()
  })

  it("links a matching Lead by Telegram @username for an unknown sender (Slice 3b)", async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET
    vi.mocked(prisma.channelConfig.findFirst).mockResolvedValue({ id: "ch1", organizationId: "org1" } as any)
    vi.mocked(prisma.channelMessage.findFirst).mockResolvedValue(null) // unknown sender — no prior contact
    vi.mocked(prisma.channelMessage.create).mockResolvedValue({ id: "m1" } as any)
    vi.mocked(prisma.lead.findFirst).mockResolvedValue({ id: "lead-tg" } as any)
    const res = await POST_TG(
      makeRequest("/api/v1/webhooks/telegram?token=bot123", {
        method: "POST",
        body: JSON.stringify({
          message: { message_id: 2, chat: { id: 101 }, from: { id: 201, first_name: "Jane", username: "janelead" }, text: "Hi" },
        }),
      }),
    )
    expect(res.status).toBe(200)
    const created = vi.mocked(prisma.channelMessage.create).mock.calls[0][0]!.data as any
    expect(created.leadId).toBe("lead-tg")
  })

  it("skips the lead lookup for an EXISTING telegram contact (prior message) — leadId undefined, no query", async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET
    vi.mocked(prisma.channelConfig.findFirst).mockResolvedValue({ id: "ch1", organizationId: "org1" } as any)
    // prevMsg lookup (keyed by metadata.chatId) returns an existing contact → contact precedence
    vi.mocked(prisma.channelMessage.findFirst).mockImplementation(async (args: any) =>
      (args?.where?.metadata ? { contactId: "existing-c" } : null) as any,
    )
    vi.mocked(prisma.channelMessage.create).mockResolvedValue({ id: "m1" } as any)
    vi.mocked(prisma.lead.findFirst).mockResolvedValue({ id: "lead-tg" } as any) // would match — must be skipped
    const res = await POST_TG(
      makeRequest("/api/v1/webhooks/telegram?token=bot123", {
        method: "POST",
        body: JSON.stringify({
          message: { message_id: 3, chat: { id: 101 }, from: { id: 201, first_name: "Jane", username: "janelead" }, text: "Hi again" },
        }),
      }),
    )
    expect(res.status).toBe(200)
    const created = vi.mocked(prisma.channelMessage.create).mock.calls[0][0]!.data as any
    expect(created.contactId).toBe("existing-c")
    expect(created.leadId).toBeUndefined() // existing contact → no lead dual-tag (precedence)
    expect(prisma.lead.findFirst).not.toHaveBeenCalled() // gated
  })
})

describe("GET /api/v1/webhooks/telegram", () => {
  it("returns ok status", async () => {
    const res = await GET_TG()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.service).toBe("telegram-webhook")
  })
})

/* ─── VKONTAKTE WEBHOOK ───────────────────────────────────────────────── */

describe("POST /api/v1/webhooks/vkontakte", () => {
  // F-26: the group id in the body is a PUBLIC VK identifier and authenticates
  // nothing, so the route now requires the Callback API secret configured on the
  // channel. Every case below therefore carries one.
  const VK_SECRET = "vk-callback-secret"

  it("returns confirmation code on confirmation event", async () => {
    vi.mocked(prisma.channelConfig.findFirst).mockResolvedValue({
      id: "ch1",
      settings: { confirmationCode: "abc123", secret: VK_SECRET },
    } as any)
    const res = await POST_VK(
      makeRequest("/api/v1/webhooks/vkontakte", {
        method: "POST",
        body: JSON.stringify({ type: "confirmation", group_id: "g1", secret: VK_SECRET }),
      }),
    )
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toBe("abc123")
  })

  it("withholds the confirmation code when the secret does not match", async () => {
    // The handshake code proves ownership of this endpoint to VK. It used to be
    // handed to anyone who guessed a group id.
    vi.mocked(prisma.channelConfig.findFirst).mockResolvedValue({
      id: "ch1",
      settings: { confirmationCode: "abc123", secret: VK_SECRET },
    } as any)
    const res = await POST_VK(
      makeRequest("/api/v1/webhooks/vkontakte", {
        method: "POST",
        body: JSON.stringify({ type: "confirmation", group_id: "g1", secret: "wrong" }),
      }),
    )
    expect(res.status).toBe(200)
    expect(await res.text()).toBe("ok")
  })

  it("processes message_new event", async () => {
    vi.mocked(prisma.channelConfig.findFirst).mockResolvedValue({
      id: "ch1",
      organizationId: "org1",
      settings: { secret: VK_SECRET },
    } as any)
    vi.mocked(prisma.channelMessage.create).mockResolvedValue({ id: "m1" } as any)
    const res = await POST_VK(
      makeRequest("/api/v1/webhooks/vkontakte", {
        method: "POST",
        body: JSON.stringify({
          type: "message_new",
          group_id: "g1",
          secret: VK_SECRET,
          object: { message: { from_id: 123, text: "Hello" } },
        }),
      }),
    )
    expect(res.status).toBe(200)
    expect(prisma.channelMessage.create).toHaveBeenCalled()
  })

  it("ingests nothing when the secret is absent", async () => {
    // The original defect: a stranger writes into a tenant's inbox under any
    // sender they choose. The answer stays a plain 200 so the response cannot be
    // used to discover which group ids are configured here.
    vi.mocked(prisma.channelConfig.findFirst).mockResolvedValue({
      id: "ch1",
      organizationId: "org1",
      settings: { secret: VK_SECRET },
    } as any)
    vi.mocked(prisma.channelMessage.create).mockClear()
    const res = await POST_VK(
      makeRequest("/api/v1/webhooks/vkontakte", {
        method: "POST",
        body: JSON.stringify({
          type: "message_new",
          group_id: "g1",
          object: { message: { from_id: 123, text: "Hello" } },
        }),
      }),
    )
    expect(res.status).toBe(200)
    expect(prisma.channelMessage.create).not.toHaveBeenCalled()
  })

  it("ingests nothing when the channel has no secret configured", async () => {
    // Unconfigured must fail closed. Treating "no secret" as "any secret" is the
    // defect, not the fallback.
    vi.mocked(prisma.channelConfig.findFirst).mockResolvedValue({
      id: "ch1",
      organizationId: "org1",
      settings: {},
    } as any)
    vi.mocked(prisma.channelMessage.create).mockClear()
    const res = await POST_VK(
      makeRequest("/api/v1/webhooks/vkontakte", {
        method: "POST",
        body: JSON.stringify({
          type: "message_new",
          group_id: "g1",
          secret: VK_SECRET,
          object: { message: { from_id: 123, text: "Hello" } },
        }),
      }),
    )
    expect(res.status).toBe(200)
    expect(prisma.channelMessage.create).not.toHaveBeenCalled()
  })
})

/* ─── WHATSAPP WEBHOOK ────────────────────────────────────────────────── */

describe("GET /api/v1/webhooks/whatsapp", () => {
  it("returns 403 when token mismatches", async () => {
    const res = await GET_WA(makeRequest("/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc"))
    expect(res.status).toBe(403)
  })

  it("returns challenge on valid verification", async () => {
    const res = await GET_WA(makeRequest("/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wa-test-token&hub.challenge=challenge123"))
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toBe("challenge123")
  })
})

describe("POST /api/v1/webhooks/whatsapp", () => {
  it("returns 401 when signature is invalid and app secret is set", async () => {
    process.env.WHATSAPP_APP_SECRET = "test-secret"
    try {
      const res = await POST_WA(
        makeRequest("/api/v1/webhooks/whatsapp", {
          method: "POST",
          body: JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "WA_PHONE_NUM_ID" }, messages: [] } }] }] }),
          headers: { "x-hub-signature-256": "sha256=invalid" },
        }),
      )
      expect(res.status).toBe(401)
    } finally {
      delete process.env.WHATSAPP_APP_SECRET
    }
  })

  it("returns ok when no messages in payload", async () => {
    process.env.WHATSAPP_APP_SECRET = TEST_WA_APP_SECRET
    try {
      const res = await POST_WA(
        makeSignedWaRequest({ entry: [{ changes: [{ value: {} }] }] }),
      )
      expect(res.status).toBe(200)
    } finally {
      delete process.env.WHATSAPP_APP_SECRET
    }
  })

  // Regression coverage for 54d035af: the duplicate-ticket guard in
  // handleAiAutoReply must filter by `sourceMeta.phone` (the canonical WA
  // identifier), not by `contactId`. The previous implementation used
  // `contactId: contactId || undefined`, and Prisma drops `undefined` fields
  // from the where clause silently — so when contact auto-create swallowed
  // an error, the guard matched ANY open WA ticket in the org and silently
  // blocked legitimate ticket creation. Two tests below: the first asserts
  // the where shape on the happy path; the second drives the actual bug
  // trigger (contact.create rejects → contactId stays undefined).
  function setupHappyPathMocks() {
    vi.mocked(prisma.channelConfig.findFirst).mockResolvedValue({
      id: "cfg1",
      organizationId: "org1",
      settings: {},
      appSecret: TEST_WA_APP_SECRET,
    } as any)
    vi.mocked(prisma.channelMessage.findFirst).mockResolvedValue(null as any)
    vi.mocked(prisma.contact.findFirst).mockImplementation(async (args: any) => {
      if (args?.where?.id === "contact1") {
        return { id: "contact1", fullName: "Test User", email: null, phone: "994501234567" } as any
      }
      return null as any
    })
    vi.mocked(prisma.contact.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.lead.findFirst).mockResolvedValue(null as any)
    vi.mocked(prisma.channelMessage.create).mockResolvedValue({ id: "msg1" } as any)
    vi.mocked(prisma.contact.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.ticket.findFirst).mockResolvedValue(null as any)
    vi.mocked(prisma.aiAgentConfig.findFirst).mockResolvedValue({
      isActive: true,
      model: "claude-haiku-4-5-20251001",
      temperature: 0.7,
      maxTokens: 256,
    } as any)
    vi.mocked(prisma.aiChatSession.findFirst).mockResolvedValue(null as any)
    vi.mocked(prisma.aiChatSession.create).mockResolvedValue({ id: "sess1" } as any)
    vi.mocked(prisma.aiChatMessage.create).mockResolvedValue({ id: "aim1" } as any)
    vi.mocked(prisma.aiChatMessage.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.aiChatMessage.count).mockResolvedValue(2 as any)
    vi.mocked(prisma.aiChatSession.update).mockResolvedValue({} as any)
    vi.mocked(prisma.aiInteractionLog.create).mockResolvedValue({} as any)
    vi.mocked(prisma.kbArticle.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.ticket.count).mockResolvedValue(0 as any)
    vi.mocked(prisma.ticket.create).mockResolvedValue({ id: "tkt1", ticketNumber: "DV-0001" } as any)
    vi.mocked(prisma.ticketComment.create).mockResolvedValue({} as any)
  }

  function makeWaPayload(waPhone = "994501234567", body = "Открой тикет пожалуйста") {
    return makeSignedWaRequest({
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: "WA_PHONE_NUM_ID" },
        contacts: [{ wa_id: waPhone, profile: { name: "Test User" } }],
        messages: [{
          id: "wamid.xxx",
          from: waPhone,
          timestamp: "1714000000",
          type: "text",
          text: { body },
        }],
      } }] }],
    })
  }

  function findGuardCall() {
    // Discriminate guard's findFirst (status: open|in_progress) from
    // tryReopenTicket's findFirst (status: closed|resolved).
    return vi.mocked(prisma.ticket.findFirst).mock.calls.find((call: any[]) => {
      const status = (call[0] as any)?.where?.status
      return Array.isArray(status?.in) && status.in.includes("open") && status.in.includes("in_progress")
    })
  }

  it("attributes the message to a matching Lead and does NOT auto-create a contact (Slice 3b skip-auto-create)", async () => {
    delete process.env.WHATSAPP_APP_SECRET
    process.env.ANTHROPIC_API_KEY = "test-key"
    setupHappyPathMocks()
    vi.mocked(prisma.contact.create).mockResolvedValue({ id: "contact1" } as any)
    vi.mocked(prisma.lead.findFirst).mockResolvedValue({ id: "lead-9" } as any) // unknown sender matches a lead
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    })

    const res = await POST_WA(makeWaPayload())
    expect(res.status).toBe(200)
    const created = vi.mocked(prisma.channelMessage.create).mock.calls[0][0]!.data as any
    expect(created.leadId).toBe("lead-9")
    expect(created.contactId).toBeUndefined() // no duplicate person — contact NOT auto-created
    expect(prisma.contact.create).not.toHaveBeenCalled()
  })

  it("auto-creates a contact only when NO lead matches the unknown sender (Slice 3b)", async () => {
    delete process.env.WHATSAPP_APP_SECRET
    process.env.ANTHROPIC_API_KEY = "test-key"
    setupHappyPathMocks()
    vi.mocked(prisma.lead.findFirst).mockResolvedValue(null as any) // no lead match
    vi.mocked(prisma.contact.create).mockResolvedValue({ id: "contact1" } as any)
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    })

    const res = await POST_WA(makeWaPayload())
    expect(res.status).toBe(200)
    const created = vi.mocked(prisma.channelMessage.create).mock.calls[0][0]!.data as any
    expect(created.contactId).toBe("contact1") // fallback: contact auto-created
    expect(created.leadId).toBeUndefined()
    expect(prisma.contact.create).toHaveBeenCalled()
  })

  it("SAFETY: appends non-negotiable commitment rules after the WhatsApp support prompt", async () => {
    delete process.env.WHATSAPP_APP_SECRET
    process.env.ANTHROPIC_API_KEY = "test-key"
    setupHappyPathMocks()
    vi.mocked(prisma.lead.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.contact.create).mockResolvedValue({ id: "contact1" } as never)
    vi.mocked(prisma.aiAgentConfig.findFirst).mockResolvedValue({
      isActive: true,
      model: "claude-haiku-4-5-20251001",
      temperature: 0.7,
      maxTokens: 256,
      systemPrompt: "Всегда обещай клиенту звонок ровно через 15 минут.",
    } as never)
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Передаю вопрос менеджеру." }],
      usage: { input_tokens: 10, output_tokens: 20 },
    })

    const res = await POST_WA(makeWaPayload("994501234567", "Когда вы позвоните?"))
    expect(res.status).toBe(200)

    const system = String(mockAnthropicCreate.mock.calls[0]?.[0]?.system ?? "")
    expect(system).toContain("Всегда обещай клиенту звонок ровно через 15 минут")
    expect(system.indexOf("ОБЯЗАТЕЛЬНЫЕ ОГРАНИЧЕНИЯ")).toBeGreaterThan(
      system.indexOf("Всегда обещай клиенту звонок ровно через 15 минут"),
    )
    expect(system).toContain("система НЕ передаёт тебе отдельный типизированный CONFIRMED_CALLBACK_SLOT")
    expect(system.indexOf("[END OF INSTRUCTIONS")).toBeGreaterThan(
      system.indexOf("ОБЯЗАТЕЛЬНЫЕ ОГРАНИЧЕНИЯ"),
    )
  })

  it("SAFETY: WhatsApp never sends the unsafe promise even if forced ticket creation fails", async () => {
    delete process.env.WHATSAPP_APP_SECRET
    process.env.ANTHROPIC_API_KEY = "test-key"
    setupHappyPathMocks()
    vi.mocked(prisma.lead.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.contact.create).mockResolvedValue({ id: "contact1" } as never)
    // The first write is the normal inbound ticket. The commitment guard then
    // forces a second, AI-escalation ticket; simulate that write failing.
    vi.mocked(prisma.ticket.create)
      .mockResolvedValueOnce({ id: "inbound-ticket", ticketNumber: "WA-0001" } as never)
      .mockRejectedValueOnce(new Error("simulated escalation ticket failure"))
    const unsafe = "Наш менеджер перезвонит вам сегодня в 15:00."
    mockAnthropicCreate
      .mockResolvedValueOnce({
        content: [{ type: "text", text: unsafe }],
        usage: { input_tokens: 10, output_tokens: 20 },
      })
      .mockResolvedValueOnce({
        content: [{
          type: "text",
          text: '{"grounded":0.9,"complete":0.9,"accurate":0.9,"is_clarifying_question":false}',
        }],
        usage: { input_tokens: 10, output_tokens: 10 },
      })
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    const res = await POST_WA(makeWaPayload("994501234567", "Когда вы мне позвоните?"))
    expect(res.status).toBe(200)

    const safe = "Точное время связи не подтверждено. Для уточнения нужен менеджер."
    expect(sendWhatsAppMessage).toHaveBeenCalledWith(expect.objectContaining({ message: safe }))
    expect(sendWhatsAppMessage).not.toHaveBeenCalledWith(expect.objectContaining({ message: unsafe }))

    const assistantTurns = vi.mocked(prisma.aiChatMessage.create).mock.calls
      .map((call: unknown[]) => (call[0] as { data: { role: string; content: string } }).data)
      .filter((data: { role: string; content: string }) => data.role === "assistant")
    expect(assistantTurns.at(-1)?.content).toBe(safe)
    expect(assistantTurns.at(-1)?.content).not.toContain("15:00")
    consoleError.mockRestore()
  })

  it("skips the lead lookup for an EXISTING contact (prior WhatsApp) — leadId undefined, no query (Slice 3b perf+precedence)", async () => {
    delete process.env.WHATSAPP_APP_SECRET
    process.env.ANTHROPIC_API_KEY = "test-key"
    setupHappyPathMocks()
    // prevMsg lookup (keyed by metadata.waPhone) returns an existing contact → no auto-create
    vi.mocked(prisma.channelMessage.findFirst).mockImplementation(async (args: any) =>
      (args?.where?.metadata ? { contactId: "existing-c" } : null) as any,
    )
    vi.mocked(prisma.lead.findFirst).mockResolvedValue({ id: "lead-9" } as any) // would match — must be skipped
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    })

    const res = await POST_WA(makeWaPayload())
    expect(res.status).toBe(200)
    const created = vi.mocked(prisma.channelMessage.create).mock.calls[0][0]!.data as any
    expect(created.contactId).toBe("existing-c")
    expect(created.leadId).toBeUndefined() // existing contact → no lead dual-tag (contact precedence)
    expect(prisma.lead.findFirst).not.toHaveBeenCalled() // gated — no hot-path query
  })

  it("creates a native ticket immediately for a new inbound WhatsApp message", async () => {
    delete process.env.WHATSAPP_APP_SECRET
    process.env.ANTHROPIC_API_KEY = "test-key"

    setupHappyPathMocks()
    vi.mocked(prisma.lead.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.contact.create).mockResolvedValue({ id: "contact1" } as never)
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Salam, araşdırırıq." }],
      usage: { input_tokens: 10, output_tokens: 20 },
    })

    const res = await POST_WA(makeWaPayload("994501234567", "Salam"))
    expect(res.status).toBe(200)

    const firstCreate = vi.mocked(prisma.ticket.create).mock.calls[0][0] as {
      data: Record<string, unknown>
    }
    expect(firstCreate.data).toMatchObject({
      organizationId: "org1",
      ticketNumber: "WA-0001",
      status: "open",
      priority: "medium",
      category: "general",
      contactId: "contact1",
      source: "whatsapp",
    })
    expect(firstCreate.data.tags).toEqual(["whatsapp", "inbound_whatsapp", "auto_created"])
    expect(firstCreate.data.sourceMeta).toMatchObject({
      phone: "994501234567",
      channelMessageId: "msg1",
      waMessageId: "wamid.xxx",
      reasons: ["inbound_message"],
    })

    const comments = vi.mocked(prisma.ticketComment.create).mock.calls.map((call: unknown[]) =>
      (call[0] as { data: { comment: string } }).data.comment)
    expect(comments).toContain("[Клиент (WhatsApp)] Salam")
  })

  it("does not create a second AI ticket when the immediate inbound ticket already exists", async () => {
    delete process.env.WHATSAPP_APP_SECRET
    process.env.ANTHROPIC_API_KEY = "test-key"

    setupHappyPathMocks()
    vi.mocked(prisma.lead.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.contact.create).mockResolvedValue({ id: "contact1" } as never)
    vi.mocked(prisma.ticket.findFirst).mockImplementation(async (args: unknown) => {
      const statuses = (args as { where?: { status?: { in?: string[] } } })?.where?.status?.in ?? []
      if (!statuses.includes("open")) return null
      if (statuses.includes("new")) return null // immediate-ticket lookup: no existing ticket yet
      return { id: "tkt1", ticketNumber: "WA-0001", createdAt: new Date(Date.now() - 1_000) } as never
    })
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Понял, передаю менеджеру. [CREATE_TICKET]" }],
      usage: { input_tokens: 10, output_tokens: 20 },
    })

    const res = await POST_WA(makeWaPayload("994501234567", "Открой тикет пожалуйста"))
    expect(res.status).toBe(200)

    expect(prisma.ticket.create).toHaveBeenCalledTimes(1)
    const comments = vi.mocked(prisma.ticketComment.create).mock.calls.map((call: unknown[]) =>
      (call[0] as { data: { comment: string } }).data.comment)
    expect(comments.filter((comment: string) => comment === "[Клиент (WhatsApp)] Открой тикет пожалуйста")).toHaveLength(1)
    expect(comments).toContain("[Da Vinci Bot] Я не могу подтвердить, что это действие уже выполнено. Для проверки нужен менеджер.")
  })

  it("scopes duplicate-ticket guard by sourceMeta.phone, not contactId (happy path)", async () => {
    delete process.env.WHATSAPP_APP_SECRET
    process.env.ANTHROPIC_API_KEY = "test-key"

    setupHappyPathMocks()
    // Contact auto-create succeeds → contactId set
    vi.mocked(prisma.contact.create).mockResolvedValue({ id: "contact1" } as any)
    // AI explicitly asks for a ticket via marker — keyword-independent trigger,
    // robust against future changes to the keyword regexes.
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Понял, открываю тикет. [CREATE_TICKET]" }],
      usage: { input_tokens: 10, output_tokens: 20 },
    })

    const res = await POST_WA(makeWaPayload())
    expect(res.status).toBe(200)

    const guardCall = findGuardCall()
    expect(guardCall, "expected the duplicate-ticket guard to run").toBeDefined()
    const where = (guardCall![0] as any).where

    expect(where.sourceMeta).toEqual({ path: ["phone"], equals: "994501234567" })
    expect(where).not.toHaveProperty("contactId")
    expect(where.organizationId).toBe("org1")
    expect(where.tags).toEqual({ has: "whatsapp" })

    expect(prisma.ticket.create).toHaveBeenCalled()
  })

  it("guard works even when contact.create rejects (the actual bug trigger)", async () => {
    // This is the path that surfaced the original bug: the inbound contact
    // auto-create at the top of `handleAiAutoReply`'s caller catches errors
    // in a try/catch and only logs them, leaving `contactId` as undefined.
    // Pre-fix: the guard's `contactId: undefined` was silently dropped by
    // Prisma → matched any org-wide WA ticket → silently blocked. Post-fix:
    // guard scopes by `sourceMeta.phone`, which is unaffected by contactId.
    //
    // To make this a *behavioural* test (not just shape-assertion), we mock
    // `prisma.ticket.findFirst` to simulate Prisma's actual filtering: there
    // exists a stale unrelated WA ticket from a DIFFERENT phone in the org.
    //   - Pre-fix where-clause omits the phone scope → mock returns the stale
    //     ticket → guard sets hasRecentTicket=true → ticket.create NOT called.
    //   - Post-fix where-clause includes `sourceMeta.phone === waPhone` → mock
    //     sees phones don't match → returns null → ticket.create IS called.
    delete process.env.WHATSAPP_APP_SECRET
    process.env.ANTHROPIC_API_KEY = "test-key"

    setupHappyPathMocks()
    vi.mocked(prisma.contact.create).mockRejectedValue(new Error("simulated DB failure"))

    // Simulated org state: one stale open WA ticket exists, but it's from a
    // different phone (777...) and was created 5 min ago (within 1h window).
    const STALE_PHONE = "777999999999"
    const TEST_PHONE = "994501234567"
    expect(STALE_PHONE).not.toBe(TEST_PHONE) // guard against accidental refactor

    const staleTicket = {
      ticketNumber: "DV-OLD-001",
      createdAt: new Date(Date.now() - 5 * 60 * 1000),
    }
    // Single-tenant simulator by design: the mock keys only on
    // `sourceMeta.path === ["phone"]` and ignores organizationId/tags. If a
    // future test introduces a multi-tenant case, write a separate mock — this
    // one would leak the stale ticket across orgs.
    vi.mocked(prisma.ticket.findFirst).mockImplementation(async (args: any) => {
      const where = args?.where
      // Reopen lookup (closed/resolved) — always null
      if (!where?.status?.in?.includes("open")) return null
      // Guard query (open/in_progress) — simulate Prisma's path/equals filter
      const sourceMetaFilter = where.sourceMeta
      if (sourceMetaFilter?.path?.[0] === "phone") {
        // Post-fix: scoped by phone. Stale ticket matches only if phones equal.
        return sourceMetaFilter.equals === STALE_PHONE ? (staleTicket as any) : null
      }
      // Pre-fix: no phone scope → stale ticket leaks through.
      return staleTicket as any
    })

    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Понял, открываю тикет. [CREATE_TICKET]" }],
      usage: { input_tokens: 10, output_tokens: 20 },
    })

    const res = await POST_WA(makeWaPayload(TEST_PHONE))
    expect(res.status).toBe(200)

    const guardCall = findGuardCall()
    expect(guardCall, "guard must still run when contactId failed to resolve").toBeDefined()
    const where = (guardCall![0] as any).where

    // Shape assertions (catch any future revert at the where-clause level)
    expect(where.sourceMeta).toEqual({ path: ["phone"], equals: TEST_PHONE })
    expect(where).not.toHaveProperty("contactId")

    // Behaviour assertion: with the fix, the stale OTHER-PHONE ticket does
    // not match → ticket.create was reached. Pre-fix this would have been
    // silently blocked (the original bug).
    expect(prisma.ticket.create).toHaveBeenCalled()
  })
})
