import { beforeEach, describe, expect, it, vi } from "vitest"
import type { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    webChatWidget: { findUnique: vi.fn() },
    webChatSession: { create: vi.fn() },
    webChatMessage: { create: vi.fn() },
  },
}))
vi.mock("@/lib/rls-context", () => ({
  runWithTenant: vi.fn((_org: string, fn: () => unknown) => fn()),
  runWithRlsBypass: vi.fn((fn: () => unknown) => fn()),
}))
vi.mock("@/lib/widget-cors", () => ({
  buildWidgetCorsHeaders: vi.fn(async () => ({})),
  isOriginAllowed: vi.fn(() => true),
}))
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(() => true) }))
vi.mock("@/lib/web-chat-contact", () => ({ matchOrCreateWebChatContact: vi.fn() }))

import { prisma } from "@/lib/prisma"
import { POST } from "@/app/api/v1/public/web-chat/session/route"
import { matchOrCreateWebChatContact } from "@/lib/web-chat-contact"
import { checkRateLimit } from "@/lib/rate-limit"

const findWidget = vi.mocked(prisma.webChatWidget.findUnique)
const createSession = vi.mocked(prisma.webChatSession.create)
const createMessage = vi.mocked(prisma.webChatMessage.create)
const matchContact = vi.mocked(matchOrCreateWebChatContact)
const checkLimit = vi.mocked(checkRateLimit)

function request(body: Record<string, unknown>): NextRequest {
  return new Request("http://localhost/api/v1/public/web-chat/session", {
    method: "POST",
    body: JSON.stringify({ key: "wc_test", ...body }),
    headers: { origin: "https://example.com" },
  }) as unknown as NextRequest
}

function widget(preChatForm: unknown = null) {
  return {
    id: "w-1", organizationId: "org-1", enabled: true, publicKey: "wc_test",
    greeting: "Salam!", allowedOrigins: [], preChatForm,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  findWidget.mockResolvedValue(widget() as never)
  createSession.mockResolvedValue({ id: "ws-1" } as never)
  createMessage.mockResolvedValue({ id: "wm-1" } as never)
  matchContact.mockResolvedValue(null)
  checkLimit.mockImplementation(() => true)
})

describe("POST /api/v1/public/web-chat/session — pre-chat form", () => {
  it("REGRESSION PIN: legacy widget (preChatForm NULL) accepts a fully empty submission", async () => {
    const res = await POST(request({}))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(createSession).toHaveBeenCalledWith({
      data: expect.objectContaining({ visitorName: null, visitorEmail: null, visitorPhone: null, contactId: null }),
    })
  })

  it("missing required email → 400 missing_required_fields, NO session created", async () => {
    findWidget.mockResolvedValue(widget({ email: { enabled: true, required: true } }) as never)
    const res = await POST(request({ visitorName: "A" }))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json).toEqual({ error: "missing_required_fields", fields: ["email"] })
    expect(createSession).not.toHaveBeenCalled()
    expect(matchContact).not.toHaveBeenCalled()
  })

  it("creates/links a contact at session start when email or phone is provided", async () => {
    matchContact.mockResolvedValue({ contactId: "ct-9", companyId: null, created: true })
    const res = await POST(request({ visitorEmail: "new@b.co", visitorName: "Guest" }))

    expect(res.status).toBe(200)
    expect(matchContact).toHaveBeenCalledWith(
      "org-1",
      { name: "Guest", email: "new@b.co", phone: null },
      { createIfMissing: true },
    )
    expect(createSession).toHaveBeenCalledWith({
      data: expect.objectContaining({ contactId: "ct-9", visitorEmail: "new@b.co" }),
    })
  })

  it("accepts a padded email (mobile autocomplete) and stores it trimmed", async () => {
    const res = await POST(request({ visitorEmail: " new@b.co " }))

    expect(res.status).toBe(200)
    expect(createSession).toHaveBeenCalledWith({
      data: expect.objectContaining({ visitorEmail: "new@b.co" }),
    })
  })

  it("per-widget contact-creation cap exhausted → session still starts, createIfMissing false", async () => {
    checkLimit.mockImplementation((key: string) => !key.startsWith("wc-contact-create:"))
    const res = await POST(request({ visitorEmail: "new@b.co" }))

    expect(res.status).toBe(200)
    expect(matchContact).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ email: "new@b.co" }),
      { createIfMissing: false },
    )
    expect(createSession).toHaveBeenCalledWith({
      data: expect.objectContaining({ contactId: null }),
    })
  })

  it("no email/phone in submission → contact matcher is not called at all", async () => {
    await POST(request({ visitorName: "Just a name" }))
    expect(matchContact).not.toHaveBeenCalled()
  })

  it("values of DISABLED fields are not persisted", async () => {
    findWidget.mockResolvedValue(widget({ phone: { enabled: false, required: false } }) as never)
    await POST(request({ visitorName: "A", visitorPhone: "+994501112233" }))

    expect(createSession).toHaveBeenCalledWith({
      data: expect.objectContaining({ visitorPhone: null, visitorName: "A" }),
    })
  })

  it("still writes the bot greeting after session creation", async () => {
    await POST(request({}))
    expect(createMessage).toHaveBeenCalledWith({
      data: expect.objectContaining({ sessionId: "ws-1", fromRole: "bot", text: "Salam!" }),
    })
  })
})
