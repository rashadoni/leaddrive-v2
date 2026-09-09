import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

// vi.hoisted runs before vi.mock hoisting — set env var so portal-auth doesn't throw at import
vi.hoisted(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-for-vitest-portal-auth"
})

// ── Mocks ──

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: { findFirst: vi.fn(), update: vi.fn() },
    channelMessage: { create: vi.fn(), findFirst: vi.fn() },
    whatsAppTemplate: { findFirst: vi.fn(), findMany: vi.fn(), upsert: vi.fn() },
    invoice: { findFirst: vi.fn() },
    contact: { findFirst: vi.fn() },
    // Required by resolveMobileAuth (mobile-auth.ts revocation check).
    mtmAgent: { findFirst: vi.fn().mockResolvedValue({
      role: "AGENT",
      status: "ACTIVE",
      userId: "u1",
      passwordHash: "$2b$12$agent-password-hash",
      organization: { isActive: true, plan: "enterprise", addons: ["mtm"], features: ["mtm"], modules: { mtm: true } },
    }) },
    // FIX C: resolveMobileAuth also checks linked-user isActive (User.isActive).
    user: { findFirst: vi.fn().mockResolvedValue({
      isActive: true,
      passwordHash: "$2b$12$user-password-hash",
      passwordChangedAt: new Date("2026-08-11T12:00:00.123Z"),
    }) },
  },
}))

vi.mock("jose", () => {
  class MockSignJWT {
    constructor() {}
    setProtectedHeader() { return this }
    setExpirationTime() { return this }
    setIssuedAt() { return this }
    async sign() { return "mock-portal-jwt" }
  }
  return {
    SignJWT: MockSignJWT,
    jwtVerify: vi.fn(),
  }
})

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined),
  }),
  // getPortalUser now also checks the Authorization header (native Bearer);
  // default to none so these cookie-path tests fall back to the cookie.
  headers: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(null),
  }),
}))

vi.mock("jsonwebtoken", () => ({
  default: {
    verify: vi.fn(),
    sign: vi.fn().mockReturnValue("mock-jwt-token"),
  },
}))

// ── Imports ──

import { prisma } from "@/lib/prisma"
import jwt from "jsonwebtoken"
import { jwtVerify } from "jose"
import { cookies } from "next/headers"
import { createSessionFingerprint } from "@/lib/session-invalidation"

const db = prisma as any
const mockJwtVerify = jwtVerify as ReturnType<typeof vi.fn>
const mockCookies = cookies as ReturnType<typeof vi.fn>

// ── Global fetch mock ──

const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

// ═════════════════════════════════════════════════════════════════════════
// 1. whatsapp.ts
// ═════════════════════════════════════════════════════════════════════════
import { sendWhatsAppMessage, sendWhatsAppTemplate } from "@/lib/whatsapp"

// Helper: a valid per-tenant ChannelConfig row (new columns populated).
const mockConfig = {
  id: "cfg-1",
  organizationId: "org-1",
  accessToken: "token-123",
  phoneNumberId: "phone-id-1",
  businessAccountId: "bus-1",
  verifyToken: "vt",
  appSecret: "sec",
  displayName: "Tenant 1",
  // legacy columns (empty — new library should not read them when new columns set)
  apiKey: null, phoneNumber: null, webhookUrl: null,
}

describe("whatsapp: sendWhatsAppMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.WHATSAPP_ACCESS_TOKEN
    delete process.env.WHATSAPP_PHONE_NUMBER_ID
  })

  it("returns error when tenant has no WhatsApp ChannelConfig", async () => {
    db.channelConfig.findFirst.mockResolvedValue(null)
    db.channelMessage.create.mockResolvedValue({})
    const result = await sendWhatsAppMessage({ to: "+994501234567", message: "Hello", organizationId: "org-1" })
    expect(result).toEqual({ success: false, error: "WhatsApp not configured for this tenant" })
  })

  it("does NOT fall back to env vars when ChannelConfig is missing (isolation guarantee)", async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = "env-should-not-leak"
    process.env.WHATSAPP_PHONE_NUMBER_ID = "env-phone"
    db.channelConfig.findFirst.mockResolvedValue(null)
    db.channelMessage.create.mockResolvedValue({})
    const result = await sendWhatsAppMessage({ to: "+994501234567", message: "Hi", organizationId: "org-1" })
    expect(result.success).toBe(false)
    expect(result.error).toBe("WhatsApp not configured for this tenant")
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("sends text message when within 24h session window", async () => {
    db.channelConfig.findFirst.mockResolvedValue(mockConfig)
    db.channelMessage.findFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 2 * 3600000) })
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: "wamid-1" }] }),
    })
    db.channelMessage.create.mockResolvedValue({})

    const result = await sendWhatsAppMessage({
      to: "+994501234567", message: "Hello from CRM", organizationId: "org-1",
    })
    expect(result.success).toBe(true)
    expect(result.messageId).toBe("wamid-1")
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(fetchBody.type).toBe("text")
    expect(fetchBody.text.body).toBe("Hello from CRM")
  })

  it("skipLog preserves the 24h window guard while suppressing the transport row", async () => {
    db.channelConfig.findFirst.mockResolvedValue(mockConfig)
    db.channelMessage.findFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 2 * 3600000) })
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: "wamid-linked" }] }) })

    const result = await sendWhatsAppMessage({
      to: "+994501234567", message: "Flow reply", organizationId: "org-1", skipLog: true,
    })

    expect(result.success).toBe(true)
    expect(db.channelMessage.findFirst).toHaveBeenCalled() // session window was still checked
    expect(db.channelMessage.create).not.toHaveBeenCalled() // caller owns the canonical row
  })

  it("returns outside_window error when no inbound in 24h (no hardcoded template fallback)", async () => {
    db.channelConfig.findFirst.mockResolvedValue(mockConfig)
    db.channelMessage.findFirst.mockResolvedValue(null)
    db.channelMessage.create.mockResolvedValue({})

    const result = await sendWhatsAppMessage({
      to: "+994501234567", message: "Hello", organizationId: "org-1",
    })
    expect(result.success).toBe(false)
    expect(result.error).toBe("outside_window_no_template")
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("cleans phone number (removes spaces, dashes, leading +)", async () => {
    db.channelConfig.findFirst.mockResolvedValue(mockConfig)
    db.channelMessage.findFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 1 * 3600000) })
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: "w3" }] }) })
    db.channelMessage.create.mockResolvedValue({})

    await sendWhatsAppMessage({ to: "+994 (50) 123-4567", message: "test", organizationId: "org-1" })
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(fetchBody.to).toBe("994501234567")
  })

  it("returns Meta API error message on send failure", async () => {
    db.channelConfig.findFirst.mockResolvedValue(mockConfig)
    db.channelMessage.findFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 1 * 3600000) })
    mockFetch.mockResolvedValue({
      ok: false, status: 400,
      json: async () => ({ error: { message: "Invalid phone" } }),
    })
    db.channelMessage.create.mockResolvedValue({})

    const result = await sendWhatsAppMessage({ to: "bad", message: "test", organizationId: "org-1" })
    expect(result.success).toBe(false)
    expect(result.error).toBe("Invalid phone")
  })

  it("catches fetch exceptions without throwing", async () => {
    db.channelConfig.findFirst.mockResolvedValue(mockConfig)
    db.channelMessage.findFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 1 * 3600000) })
    mockFetch.mockRejectedValue(new Error("Network error"))
    db.channelMessage.create.mockResolvedValue({})

    const result = await sendWhatsAppMessage({ to: "994501234567", message: "test", organizationId: "org-1" })
    expect(result.success).toBe(false)
    expect(result.error).toBe("Network error")
  })

  it("requires organizationId (no cross-tenant default)", async () => {
    const result = await sendWhatsAppMessage({ to: "994501234567", message: "test" } as any)
    expect(result.success).toBe(false)
    expect(result.error).toBe("organizationId required")
  })
})

describe("whatsapp: sendWhatsAppTemplate", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.WHATSAPP_ACCESS_TOKEN
    delete process.env.WHATSAPP_PHONE_NUMBER_ID
  })

  it("returns error when tenant not configured", async () => {
    db.channelConfig.findFirst.mockResolvedValue(null)
    const result = await sendWhatsAppTemplate({ to: "123", templateName: "test", organizationId: "org-1" })
    expect(result).toEqual({ success: false, error: "WhatsApp not configured for this tenant" })
  })

  it("sends template with correct structure from DB config", async () => {
    db.channelConfig.findFirst.mockResolvedValue(mockConfig)
    db.whatsAppTemplate.findFirst.mockResolvedValue({
      name: "welcome_message", language: "en_US", variables: [],
    })
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: "tmpl-1" }] }) })
    db.channelMessage.create.mockResolvedValue({})

    const result = await sendWhatsAppTemplate({
      to: "994501234567", templateName: "welcome_message", languageCode: "en_US", organizationId: "org-1",
    })
    expect(result.success).toBe(true)
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(fetchBody.template.name).toBe("welcome_message")
    expect(fetchBody.template.language.code).toBe("en_US")
    expect(fetchBody.type).toBe("template")
  })

  it("passes positional variables through as text parameters", async () => {
    db.channelConfig.findFirst.mockResolvedValue(mockConfig)
    db.whatsAppTemplate.findFirst.mockResolvedValue({
      name: "order_update", language: "en_US", variables: ["1", "2"],
    })
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: "ord-1" }] }) })
    db.channelMessage.create.mockResolvedValue({})

    await sendWhatsAppTemplate({
      to: "994501234567", templateName: "order_update", languageCode: "en_US",
      variables: ["ORDER-42", "shipped"], organizationId: "org-1",
    })
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(fetchBody.template.components[0].parameters[0]).toEqual({ type: "text", text: "ORDER-42" })
    expect(fetchBody.template.components[0].parameters[1]).toEqual({ type: "text", text: "shipped" })
  })

  it("returns Meta error on API failure", async () => {
    db.channelConfig.findFirst.mockResolvedValue(mockConfig)
    db.whatsAppTemplate.findFirst.mockResolvedValue(null)
    mockFetch.mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: { message: "Template not found" } }) })

    const result = await sendWhatsAppTemplate({ to: "994501234567", templateName: "nonexistent", organizationId: "org-1" })
    expect(result.success).toBe(false)
    expect(result.error).toBe("Template not found")
  })
})

// ═════════════════════════════════════════════════════════════════════════
// 2. portal-auth.ts
// ═════════════════════════════════════════════════════════════════════════
import { createPortalToken, getPortalUser } from "@/lib/portal-auth"

describe("portal-auth: createPortalToken", () => {
  it("generates a JWT token string", async () => {
    const token = await createPortalToken({
      contactId: "c1", organizationId: "org-1", companyId: "comp-1", fullName: "John", email: "j@t.com",
    }, "$2b$12$portal-password-hash")
    expect(typeof token).toBe("string")
    expect(token.length).toBeGreaterThan(0)
  })
})

describe("portal-auth: getPortalUser", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const portalPasswordHash = "$2b$12$portal-password-hash"
    db.contact.findFirst.mockImplementation(async ({ where }: any) => ({
      id: where.id,
      organizationId: where.organizationId,
      companyId: where.id === "c2" ? null : "comp-1",
      fullName: where.id === "c2" ? "Bob" : "Jane",
      email: where.id === "c2" ? "b@t.com" : "j@t.com",
      portalPasswordHash,
    }))
  })

  it("returns null when no portal-token cookie", async () => {
    mockCookies.mockResolvedValue({ get: vi.fn().mockReturnValue(undefined) })
    const user = await getPortalUser()
    expect(user).toBeNull()
  })

  it("returns user data from valid token", async () => {
    mockCookies.mockResolvedValue({ get: vi.fn().mockReturnValue({ value: "valid-token" }) })
    mockJwtVerify.mockResolvedValue({
      payload: {
        contactId: "c1",
        organizationId: "org-1",
        companyId: "comp-1",
        fullName: "Jane",
        email: "j@t.com",
        portalSessionFingerprint: createSessionFingerprint({
          principalId: "c1",
          passwordHash: "$2b$12$portal-password-hash",
          secret: process.env.NEXTAUTH_SECRET!,
        }),
      },
    })
    const user = await getPortalUser()
    expect(user).toEqual({
      contactId: "c1", organizationId: "org-1", companyId: "comp-1", fullName: "Jane", email: "j@t.com",
    })
  })

  it("returns null when token verification fails", async () => {
    mockCookies.mockResolvedValue({ get: vi.fn().mockReturnValue({ value: "expired" }) })
    mockJwtVerify.mockRejectedValue(new Error("Token expired"))
    const user = await getPortalUser()
    expect(user).toBeNull()
  })

  it("returns companyId as null when empty string in token", async () => {
    mockCookies.mockResolvedValue({ get: vi.fn().mockReturnValue({ value: "tok" }) })
    mockJwtVerify.mockResolvedValue({
      payload: {
        contactId: "c2",
        organizationId: "org-2",
        companyId: "",
        fullName: "Bob",
        email: "b@t.com",
        portalSessionFingerprint: createSessionFingerprint({
          principalId: "c2",
          passwordHash: "$2b$12$portal-password-hash",
          secret: process.env.NEXTAUTH_SECRET!,
        }),
      },
    })
    const user = await getPortalUser()
    expect(user?.companyId).toBeNull()
  })
})

// ═════════════════════════════════════════════════════════════════════════
// 3. mobile-auth.ts
// ═════════════════════════════════════════════════════════════════════════
import { getMobileAuth, requireMobileAuth } from "@/lib/mobile-auth"
describe("mobile-auth: getMobileAuth", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns null when no authorization header", () => {
    const req = new NextRequest("http://localhost/api/test")
    expect(getMobileAuth(req)).toBeNull()
  })

  it("returns null when Authorization is not Bearer", () => {
    const req = new NextRequest("http://localhost/api/test", { headers: { authorization: "Basic abc" } })
    expect(getMobileAuth(req)).toBeNull()
  })

  it("returns null for API key tokens (ld_ prefix)", () => {
    const req = new NextRequest("http://localhost/api/test", { headers: { authorization: "Bearer ld_test_key" } })
    expect(getMobileAuth(req)).toBeNull()
    expect(jwt.verify).not.toHaveBeenCalled()
  })

  it("returns MobileAuthResult on valid token", () => {
    vi.mocked(jwt.verify).mockReturnValue({
      agentId: "agent-1", userId: "u-1", orgId: "org-1",
      email: "agent@test.com", name: "Agent A", role: "agent",
    } as any)
    const req = new NextRequest("http://localhost/api/test", { headers: { authorization: "Bearer valid-token" } })
    expect(getMobileAuth(req)).toEqual({
      agentId: "agent-1", userId: "u-1", orgId: "org-1",
      email: "agent@test.com", name: "Agent A", role: "agent",
    })
  })

  it("returns null when payload lacks agentId", () => {
    vi.mocked(jwt.verify).mockReturnValue({ userId: "u-1" } as any)
    const req = new NextRequest("http://localhost/api/test", { headers: { authorization: "Bearer tok" } })
    expect(getMobileAuth(req)).toBeNull()
  })

  it("returns null when JWT verification throws", () => {
    vi.mocked(jwt.verify).mockImplementation(() => { throw new Error("bad token") })
    const req = new NextRequest("http://localhost/api/test", { headers: { authorization: "Bearer bad" } })
    expect(getMobileAuth(req)).toBeNull()
  })
})

describe("mobile-auth: requireMobileAuth", () => {
  it("returns 401 NextResponse when no auth", async () => {
    const req = new NextRequest("http://localhost/api/v1/mtm/test")
    const result = await requireMobileAuth(req)
    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(401)
  })

  it("returns MobileAuthResult when valid", async () => {
    vi.mocked(jwt.verify).mockReturnValue({
      agentId: "a1", userId: "u1", orgId: "o1", email: "a@b.com", name: "A", role: "agent",
      agentSessionFingerprint: createSessionFingerprint({
        principalId: "a1",
        passwordHash: "$2b$12$agent-password-hash",
        secret: process.env.NEXTAUTH_SECRET!,
      }),
      userSessionFingerprint: createSessionFingerprint({
        principalId: "u1",
        passwordHash: "$2b$12$user-password-hash",
        passwordChangedAt: new Date("2026-08-11T12:00:00.123Z"),
        secret: process.env.NEXTAUTH_SECRET!,
      }),
    } as any)
    const req = new NextRequest("http://localhost/api/v1/mtm/test", { headers: { authorization: "Bearer valid" } })
    const result = await requireMobileAuth(req)
    expect(result).not.toBeInstanceOf(NextResponse)
    expect((result as any).agentId).toBe("a1")
  })
})

// ═════════════════════════════════════════════════════════════════════════
// 4. slack.ts
// ═════════════════════════════════════════════════════════════════════════
import { sendSlackNotification, formatDealNotification, formatTicketNotification, formatGenericNotification } from "@/lib/slack"

describe("slack: sendSlackNotification", () => {
  beforeEach(() => vi.clearAllMocks())

  it("sends POST request to webhook URL", async () => {
    mockFetch.mockResolvedValue({ ok: true })
    const result = await sendSlackNotification("https://hooks.slack.com/test", { text: "Hello" })
    expect(result).toBe(true)
    expect(mockFetch).toHaveBeenCalledWith(
      "https://hooks.slack.com/test",
      expect.objectContaining({ method: "POST", headers: { "Content-Type": "application/json" } })
    )
  })

  it("returns false on non-ok response", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 })
    expect(await sendSlackNotification("https://hooks.slack.com/err", { text: "Fail" })).toBe(false)
  })

  it("returns false on fetch exception", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    mockFetch.mockRejectedValue(new Error("Network timeout"))
    expect(await sendSlackNotification("https://hooks.slack.com/err", { text: "Err" })).toBe(false)
    consoleSpy.mockRestore()
  })

  it("includes message blocks in body when provided", async () => {
    mockFetch.mockResolvedValue({ ok: true })
    const msg = { text: "Test", blocks: [{ type: "section", text: { type: "mrkdwn", text: "Bold" } }] }
    await sendSlackNotification("https://hooks.slack.com/test", msg)
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.blocks).toHaveLength(1)
  })
})

describe("slack: formatDealNotification", () => {
  it("formats deal with all fields", () => {
    const msg = formatDealNotification({ name: "Acme Deal", value: 50000, stage: "Proposal", owner: "Alice" })
    expect(msg.text).toBe("New Deal: Acme Deal")
    expect(msg.blocks![0].text.text).toContain("*Value:* $50,000")
    expect(msg.blocks![0].text.text).toContain("*Stage:* Proposal")
    expect(msg.blocks![0].text.text).toContain("*Owner:* Alice")
  })

  it("omits optional fields when not provided", () => {
    const msg = formatDealNotification({ name: "Simple Deal" })
    expect(msg.text).toBe("New Deal: Simple Deal")
    expect(msg.blocks![0].text.text).not.toContain("Value")
  })
})

describe("slack: formatTicketNotification", () => {
  it("formats ticket with all fields", () => {
    const msg = formatTicketNotification({ ticketNumber: "TKT-001", subject: "Bug report", priority: "high", status: "open" })
    expect(msg.text).toContain("TKT-001")
    expect(msg.blocks![0].text.text).toContain("*Priority:* high")
  })
})

describe("slack: formatGenericNotification", () => {
  it("formats generic entity notification", () => {
    const msg = formatGenericNotification("contact", "created", { id: "c1", name: "John" })
    expect(msg.text).toBe("[contact] created")
    expect(msg.blocks![0].text.text).toContain("*id:* c1")
  })
})

// ═════════════════════════════════════════════════════════════════════════
// 5. invoice-number.ts
// ═════════════════════════════════════════════════════════════════════════
import { generateInvoiceNumber } from "@/lib/invoice-number"

describe("invoice-number: generateInvoiceNumber", () => {
  const year = new Date().getFullYear()
  const prefix = `INV-${year}-`

  beforeEach(() => vi.clearAllMocks())

  it("generates first invoice number INV-YYYY-00001", async () => {
    db.invoice.findFirst.mockResolvedValue(null)
    const num = await generateInvoiceNumber("org-1")
    expect(num).toBe(`${prefix}00001`)
  })

  it("increments from last invoice number", async () => {
    db.invoice.findFirst.mockResolvedValue({ invoiceNumber: `${prefix}00042` })
    const num = await generateInvoiceNumber("org-1")
    expect(num).toBe(`${prefix}00043`)
  })

  it("pads number to 5 digits", async () => {
    db.invoice.findFirst.mockResolvedValue({ invoiceNumber: `${prefix}00009` })
    const num = await generateInvoiceNumber("org-1")
    expect(num).toBe(`${prefix}00010`)
  })

  it("handles non-numeric suffix gracefully (defaults to 1)", async () => {
    db.invoice.findFirst.mockResolvedValue({ invoiceNumber: `${prefix}abc` })
    const num = await generateInvoiceNumber("org-1")
    expect(num).toBe(`${prefix}00001`)
  })
})
