/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

/* ── Prisma mock ─────────────────────────────────────────────────── */
vi.mock("@/lib/prisma", () => ({
  prisma: {
    ticket: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
      aggregate: vi.fn(),
    },
    ticketComment: { create: vi.fn() },
    contact: { findFirst: vi.fn() },
    company: { findUnique: vi.fn() },
    activity: { findMany: vi.fn() },
    deal: { findMany: vi.fn(), aggregate: vi.fn() },
    channelMessage: { findFirst: vi.fn() },
    task: { findMany: vi.fn() },
    recurringInvoice: { findMany: vi.fn(), update: vi.fn() },
    invoice: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    kbArticle: { findMany: vi.fn() },
    aiInteractionLog: { create: vi.fn(), groupBy: vi.fn() },
    aiChatSession: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    aiChatMessage: { findMany: vi.fn() },
    aiAgentConfig: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    agentHandoff: { findMany: vi.fn() },
    organization: { findUnique: vi.fn() },
  },
  logAudit: vi.fn(),
}))

vi.mock("@/lib/api-auth", () => ({
  getSession: vi.fn(),
  getOrgId: vi.fn(),
  requireAuth: vi.fn(),
  isAuthError: vi.fn((v) => v instanceof NextResponse),
}))

vi.mock("@/lib/ai/support-feature", () => ({
  isSupportAiEnabled: vi.fn().mockResolvedValue(true),
  SUPPORT_AI_DISABLED_ERROR: {
    error: "Support AI is disabled for this organization.",
    errorKey: "supportAiDisabled",
  },
}))

vi.mock("@/lib/whatsapp", () => ({
  sendWhatsAppMessage: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/deal-stage-vocabulary", () => ({
  orgStageVocabulary: vi.fn().mockResolvedValue({
    wonStages: ["WON", "SIGNED"],
    lostStages: ["LOST"],
    closedStages: ["WON", "SIGNED", "LOST"],
  }),
}))

vi.mock("@/lib/constants", () => ({
  DEFAULT_CURRENCY: "AZN",
  PAGE_SIZE: { DEFAULT: 20 },
}))

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
}))

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn(),
}))

vi.mock("@/lib/invoice-number", () => ({
  generateInvoiceNumber: vi.fn().mockResolvedValue("INV-001"),
}))
vi.mock("@/lib/invoice-calculations", () => ({
  calculateItemTotal: vi.fn().mockReturnValue(100),
  calculateInvoiceTotals: vi.fn().mockReturnValue({
    subtotal: 100,
    discountAmount: 0,
    taxAmount: 18,
    totalAmount: 118,
  }),
  calculateDueDate: vi.fn().mockReturnValue(new Date("2026-05-01")),
}))
vi.mock("@/lib/invoice-templates", () => ({
  formatMonthYear: vi.fn().mockReturnValue("April 2026"),
}))
vi.mock("@/lib/invoice-html", () => ({
  generateInvoiceHtml: vi.fn().mockReturnValue("<html></html>"),
  getEmailTemplate: vi.fn().mockReturnValue({ subject: "Invoice", html: "<p>Invoice</p>" }),
}))

/* ── Imports ──────────────────────────────────────────────────────── */
import { POST as POST_COMMENT } from "@/app/api/v1/tickets/[id]/comments/route"
import { GET as GET_CONTEXT } from "@/app/api/v1/tickets/[id]/context/route"
import { GET as GET_SIBLINGS } from "@/app/api/v1/tickets/[id]/siblings/route"
import { POST as POST_TICKET_AI } from "@/app/api/v1/tickets/ai/route"
import { GET as GET_NEW_COUNT } from "@/app/api/v1/tickets/new-count/route"
// /api/v1/tasks/calendar removed in Roadmap #23a/b cleanup —
// TaskCalendar now derives from parent's tasks state instead of fetching.
// import { GET as GET_CALENDAR } from "@/app/api/v1/tasks/calendar/route"
import { POST as POST_GENERATE } from "@/app/api/v1/recurring-invoices/generate/route"
import { GET as GET_AI_SESSION } from "@/app/api/v1/ai-sessions/[id]/route"
import { GET as GET_AI_SESSION_STATS } from "@/app/api/v1/ai-sessions/stats/route"
import { GET as GET_AI_CONFIG, PUT as PUT_AI_CONFIG, DELETE as DELETE_AI_CONFIG } from "@/app/api/v1/ai-configs/[id]/route"
import { GET as GET_AI_CONFIG_STATS } from "@/app/api/v1/ai-configs/stats/route"

import { prisma } from "@/lib/prisma"
import { getSession, getOrgId, requireAuth } from "@/lib/api-auth"
import { isSupportAiEnabled } from "@/lib/ai/support-feature"

/* ── Helpers ──────────────────────────────────────────────────────── */
const SESSION = { orgId: "org-1", userId: "user-1", role: "admin", email: "a@b.com", name: "Test" }

function makeReq(url: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), init)
}

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSession).mockResolvedValue(SESSION as any)
  vi.mocked(getOrgId).mockResolvedValue("org-1")
  vi.mocked(requireAuth).mockResolvedValue(SESSION as any)
  vi.mocked(isSupportAiEnabled).mockResolvedValue(true)
})

/* ═══════════════════════════════════════════════════════════════════
   POST /api/v1/tickets/[id]/comments
   ═══════════════════════════════════════════════════════════════════ */
describe("POST /api/v1/tickets/[id]/comments", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    vi.mocked(getSession).mockResolvedValue(null as any)
    vi.mocked(requireAuth).mockResolvedValue(new NextResponse(null, { status: 401 }) as never)
    const res = await POST_COMMENT(
      makeReq("http://localhost:3000/api/v1/tickets/t1/comments", {
        method: "POST",
        body: JSON.stringify({ comment: "hello" }),
      }),
      makeParams("t1"),
    )
    expect(res.status).toBe(401)
  })

  it("returns 400 for empty comment", async () => {
    const res = await POST_COMMENT(
      makeReq("http://localhost:3000/api/v1/tickets/t1/comments", {
        method: "POST",
        body: JSON.stringify({ comment: "" }),
      }),
      makeParams("t1"),
    )
    expect(res.status).toBe(400)
  })

  it("returns 404 when ticket not found", async () => {
    vi.mocked(prisma.ticket.findFirst).mockResolvedValue(null)
    const res = await POST_COMMENT(
      makeReq("http://localhost:3000/api/v1/tickets/t1/comments", {
        method: "POST",
        headers: { "x-user-id": "spoofed-user" },
        body: JSON.stringify({ comment: "test comment" }),
      }),
      makeParams("t1"),
    )
    expect(res.status).toBe(404)
  })

  it("requires a closed ticket to be reopened before another reply", async () => {
    vi.mocked(prisma.ticket.findFirst).mockResolvedValue({ id: "t1", organizationId: "org-1", status: "closed" } as never)

    const res = await POST_COMMENT(
      makeReq("http://localhost:3000/api/v1/tickets/t1/comments", {
        method: "POST",
        body: JSON.stringify({ comment: "should not be created" }),
      }),
      makeParams("t1"),
    )

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ errorKey: "ticketClosed" })
    expect(prisma.ticketComment.create).not.toHaveBeenCalled()
  })

  it("creates comment successfully", async () => {
    vi.mocked(prisma.ticket.findFirst).mockResolvedValue({
      id: "t1",
      organizationId: "org-1",
      assignedTo: "user-2",
      firstResponseAt: null,
      tags: [],
      ticketNumber: "TK-001",
      subject: "Test",
      description: "",
      contactId: null,
    } as any)
    vi.mocked(prisma.ticketComment.create).mockResolvedValue({ id: "c1", comment: "test comment" } as any)
    vi.mocked(prisma.ticket.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await POST_COMMENT(
      makeReq("http://localhost:3000/api/v1/tickets/t1/comments", {
        method: "POST",
        body: JSON.stringify({ comment: "test comment" }),
      }),
      makeParams("t1"),
    )
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(prisma.ticketComment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: "user-1" }),
    }))
  })

  it("keeps manual agent replies available while Support AI is disabled", async () => {
    vi.mocked(isSupportAiEnabled).mockResolvedValue(false)
    vi.mocked(prisma.ticket.findFirst).mockResolvedValue({
      id: "t1",
      organizationId: "org-1",
      assignedTo: "user-2",
      firstResponseAt: null,
      tags: [],
      ticketNumber: "TK-001",
      subject: "Manual reply",
      description: "",
      contactId: null,
    } as any)
    vi.mocked(prisma.ticketComment.create).mockResolvedValue({ id: "c2", comment: "Agent response" } as any)
    vi.mocked(prisma.ticket.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await POST_COMMENT(
      makeReq("http://localhost:3000/api/v1/tickets/t1/comments", {
        method: "POST",
        body: JSON.stringify({ comment: "Agent response" }),
      }),
      makeParams("t1"),
    )

    expect(res.status).toBe(201)
    expect(prisma.ticketComment.create).toHaveBeenCalled()
    expect(isSupportAiEnabled).not.toHaveBeenCalled()
  })
})

/* ═══════════════════════════════════════════════════════════════════
   GET /api/v1/tickets/[id]/context
   ═══════════════════════════════════════════════════════════════════ */
describe("GET /api/v1/tickets/[id]/context", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    vi.mocked(getSession).mockResolvedValue(null as any)
    const res = await GET_CONTEXT(makeReq("http://localhost:3000/api/v1/tickets/t1/context"), makeParams("t1"))
    expect(res.status).toBe(401)
  })

  it("returns 404 when ticket not found", async () => {
    vi.mocked(prisma.ticket.findFirst).mockResolvedValue(null)
    const res = await GET_CONTEXT(makeReq("http://localhost:3000/api/v1/tickets/t1/context"), makeParams("t1"))
    expect(res.status).toBe(404)
  })

  it("returns context data successfully", async () => {
    vi.mocked(prisma.ticket.findFirst).mockResolvedValue({
      id: "t1",
      contactId: "c1",
      companyId: "comp1",
      contact: { id: "c1", fullName: "John" },
      company: { id: "comp1", name: "Acme" },
    } as any)
    vi.mocked(prisma.ticket.findMany).mockResolvedValue([])
    vi.mocked(prisma.activity.findMany).mockResolvedValue([])
    vi.mocked(prisma.deal.findMany).mockResolvedValue([])
    vi.mocked(prisma.deal.aggregate).mockResolvedValue({ _sum: { valueAmount: 5000 } } as any)

    const res = await GET_CONTEXT(makeReq("http://localhost:3000/api/v1/tickets/t1/context"), makeParams("t1"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.lifetimeValue).toBe(5000)
    expect(prisma.deal.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ stage: { notIn: ["WON", "SIGNED", "LOST"] } }),
    }))
    expect(prisma.deal.aggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ stage: { in: ["WON", "SIGNED"] } }),
    }))
  })
})

/* ═══════════════════════════════════════════════════════════════════
   GET /api/v1/tickets/[id]/siblings
   ═══════════════════════════════════════════════════════════════════ */
describe("GET /api/v1/tickets/[id]/siblings", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    vi.mocked(getSession).mockResolvedValue(null as any)
    const res = await GET_SIBLINGS(makeReq("http://localhost:3000/api/v1/tickets/t1/siblings"), makeParams("t1"))
    expect(res.status).toBe(401)
  })

  it("returns 404 when ticket not found", async () => {
    vi.mocked(prisma.ticket.findFirst).mockResolvedValue(null)
    const res = await GET_SIBLINGS(makeReq("http://localhost:3000/api/v1/tickets/t1/siblings"), makeParams("t1"))
    expect(res.status).toBe(404)
  })

  it("returns prev/next siblings", async () => {
    vi.mocked(prisma.ticket.findFirst)
      .mockResolvedValueOnce({ createdAt: new Date("2026-01-15"), assignedTo: null } as any)
      .mockResolvedValueOnce({ id: "prev", ticketNumber: "TK-001", subject: "Prev" } as any)
      .mockResolvedValueOnce({ id: "next", ticketNumber: "TK-003", subject: "Next" } as any)

    const res = await GET_SIBLINGS(makeReq("http://localhost:3000/api/v1/tickets/t2/siblings"), makeParams("t2"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.prev.id).toBe("prev")
    expect(json.data.next.id).toBe("next")
  })
})

/* ═══════════════════════════════════════════════════════════════════
   POST /api/v1/tickets/ai
   ═══════════════════════════════════════════════════════════════════ */
describe("POST /api/v1/tickets/ai", () => {
  it("returns 403 before reading a ticket when Support AI is disabled", async () => {
    vi.mocked(isSupportAiEnabled).mockResolvedValue(false)

    const res = await POST_TICKET_AI(
      makeReq("http://localhost:3000/api/v1/tickets/ai", {
        method: "POST",
        body: JSON.stringify({ action: "reply", ticketId: "t1" }),
      }),
    )

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ errorKey: "supportAiDisabled" })
    expect(prisma.ticket.findFirst).not.toHaveBeenCalled()
    expect(prisma.aiInteractionLog.create).not.toHaveBeenCalled()
  })

  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    vi.mocked(getSession).mockResolvedValue(null as any)
    const res = await POST_TICKET_AI(
      makeReq("http://localhost:3000/api/v1/tickets/ai", {
        method: "POST",
        body: JSON.stringify({ action: "reply", ticketId: "t1" }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it("returns 400 when action or ticketId missing", async () => {
    const res = await POST_TICKET_AI(
      makeReq("http://localhost:3000/api/v1/tickets/ai", {
        method: "POST",
        body: JSON.stringify({ action: "reply" }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 404 when ticket not found", async () => {
    vi.mocked(prisma.ticket.findFirst).mockResolvedValue(null)
    const res = await POST_TICKET_AI(
      makeReq("http://localhost:3000/api/v1/tickets/ai", {
        method: "POST",
        body: JSON.stringify({ action: "reply", ticketId: "t1" }),
      }),
    )
    expect(res.status).toBe(404)
  })

  it("returns fallback reply when no API key", async () => {
    delete process.env.ANTHROPIC_API_KEY
    vi.mocked(prisma.ticket.findFirst).mockResolvedValue({
      id: "t1",
      ticketNumber: "TK-001",
      subject: "Login issue",
      status: "open",
      priority: "high",
      category: "technical",
      description: "Cannot login",
      comments: [],
    } as any)
    vi.mocked(prisma.kbArticle.findMany).mockResolvedValue([])

    const res = await POST_TICKET_AI(
      makeReq("http://localhost:3000/api/v1/tickets/ai", {
        method: "POST",
        body: JSON.stringify({ action: "reply", ticketId: "t1" }),
      }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.text).toBeTruthy()
  })

  it("returns fallback summary when no API key", async () => {
    delete process.env.ANTHROPIC_API_KEY
    vi.mocked(prisma.ticket.findFirst).mockResolvedValue({
      id: "t1",
      ticketNumber: "TK-001",
      subject: "Login issue",
      status: "open",
      priority: "high",
      category: "technical",
      description: "Cannot login",
      comments: [],
    } as any)

    const res = await POST_TICKET_AI(
      makeReq("http://localhost:3000/api/v1/tickets/ai", {
        method: "POST",
        body: JSON.stringify({ action: "summary", ticketId: "t1" }),
      }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.text).toContain("TK-001")
  })

  it("returns 400 for unknown action", async () => {
    vi.mocked(prisma.ticket.findFirst).mockResolvedValue({
      id: "t1", ticketNumber: "TK-001", subject: "X", status: "open",
      priority: "high", category: "tech", description: "", comments: [],
    } as any)

    const res = await POST_TICKET_AI(
      makeReq("http://localhost:3000/api/v1/tickets/ai", {
        method: "POST",
        body: JSON.stringify({ action: "unknown", ticketId: "t1" }),
      }),
    )
    expect(res.status).toBe(400)
  })
})

/* ═══════════════════════════════════════════════════════════════════
   GET /api/v1/tickets/new-count
   ═══════════════════════════════════════════════════════════════════ */
describe("GET /api/v1/tickets/new-count", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getSession).mockResolvedValue(null as any)
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    vi.mocked(getSession).mockResolvedValue(null as any)
    const res = await GET_NEW_COUNT(makeReq("http://localhost:3000/api/v1/tickets/new-count?since=2026-01-01"))
    expect(res.status).toBe(401)
  })

  it("returns 400 when since param missing", async () => {
    const res = await GET_NEW_COUNT(makeReq("http://localhost:3000/api/v1/tickets/new-count"))
    expect(res.status).toBe(400)
  })

  it("returns 400 for invalid date", async () => {
    const res = await GET_NEW_COUNT(makeReq("http://localhost:3000/api/v1/tickets/new-count?since=not-a-date"))
    expect(res.status).toBe(400)
  })

  it("returns count and latest ticket", async () => {
    vi.mocked(prisma.ticket.count).mockResolvedValue(3)
    vi.mocked(prisma.ticket.findFirst).mockResolvedValue({
      id: "t1",
      ticketNumber: "TK-005",
      subject: "New one",
      priority: "medium",
      createdAt: new Date(),
    } as any)

    const res = await GET_NEW_COUNT(makeReq("http://localhost:3000/api/v1/tickets/new-count?since=2026-01-01"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.count).toBe(3)
    expect(json.latest.ticketNumber).toBe("TK-005")
  })
})

// /api/v1/tasks/calendar describe block removed — endpoint deleted in
// Roadmap #23a/b cleanup (TaskCalendar derives from parent tasks state).

/* ═══════════════════════════════════════════════════════════════════
   POST /api/v1/recurring-invoices/generate
   ═══════════════════════════════════════════════════════════════════ */
describe("POST /api/v1/recurring-invoices/generate", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    vi.mocked(getSession).mockResolvedValue(null as any)
    const res = await POST_GENERATE(
      makeReq("http://localhost:3000/api/v1/recurring-invoices/generate", { method: "POST" }),
    )
    expect(res.status).toBe(401)
  })

  it("returns empty report when no due invoices", async () => {
    vi.mocked(prisma.recurringInvoice.findMany).mockResolvedValue([])
    const res = await POST_GENERATE(
      makeReq("http://localhost:3000/api/v1/recurring-invoices/generate", { method: "POST" }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.generated).toBe(0)
  })
})

/* ═══════════════════════════════════════════════════════════════════
   GET /api/v1/ai-sessions/[id]
   ═══════════════════════════════════════════════════════════════════ */
describe("GET /api/v1/ai-sessions/[id]", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    vi.mocked(getSession).mockResolvedValue(null as any)
    const res = await GET_AI_SESSION(makeReq("http://localhost:3000/api/v1/ai-sessions/s1"), makeParams("s1"))
    expect(res.status).toBe(401)
  })

  it("returns 404 when session not found", async () => {
    vi.mocked(prisma.aiChatSession.findFirst).mockResolvedValue(null)
    const res = await GET_AI_SESSION(makeReq("http://localhost:3000/api/v1/ai-sessions/s1"), makeParams("s1"))
    expect(res.status).toBe(404)
  })

  it("returns session with messages", async () => {
    vi.mocked(prisma.aiChatSession.findFirst).mockResolvedValue({
      id: "s1",
      portalUserId: "p1",
      companyId: "c1",
      messagesCount: 2,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
      messages: [
        { id: "m1", role: "user", content: "hi", toolCalls: null, tokenCount: 10, createdAt: new Date() },
        { id: "m2", role: "assistant", content: "hello", toolCalls: null, tokenCount: 15, createdAt: new Date() },
      ],
    } as any)

    const res = await GET_AI_SESSION(makeReq("http://localhost:3000/api/v1/ai-sessions/s1"), makeParams("s1"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.session.messages).toHaveLength(2)
  })
})

/* ═══════════════════════════════════════════════════════════════════
   GET /api/v1/ai-sessions/stats
   ═══════════════════════════════════════════════════════════════════ */
describe("GET /api/v1/ai-sessions/stats", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    vi.mocked(getSession).mockResolvedValue(null as any)
    const res = await GET_AI_SESSION_STATS(makeReq("http://localhost:3000/api/v1/ai-sessions/stats"))
    expect(res.status).toBe(401)
  })

  it("returns computed stats", async () => {
    vi.mocked(prisma.aiChatSession.findMany).mockResolvedValue([
      { status: "resolved", messagesCount: 3, messages: [
        { role: "user", tokenCount: 10, createdAt: new Date("2026-01-01T10:00:00Z") },
        { role: "assistant", tokenCount: 20, createdAt: new Date("2026-01-01T10:00:05Z") },
      ]},
    ] as any)
    vi.mocked(prisma.ticket.aggregate).mockResolvedValue({
      _avg: { satisfactionRating: 4.5 },
      _count: { satisfactionRating: 5 },
    } as any)

    const res = await GET_AI_SESSION_STATS(makeReq("http://localhost:3000/api/v1/ai-sessions/stats"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.totalSessions).toBe(1)
    expect(json.data.deflectionRate).toBeGreaterThan(0)
  })
})

/* ═══════════════════════════════════════════════════════════════════
   GET/PUT/DELETE /api/v1/ai-configs/[id]
   ═══════════════════════════════════════════════════════════════════ */
describe("GET /api/v1/ai-configs/[id]", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    vi.mocked(getSession).mockResolvedValue(null as any)
    const res = await GET_AI_CONFIG(makeReq("http://localhost:3000/api/v1/ai-configs/cfg1"), makeParams("cfg1"))
    expect(res.status).toBe(401)
  })

  it("returns 404 when config not found", async () => {
    vi.mocked(prisma.aiAgentConfig.findFirst).mockResolvedValue(null)
    const res = await GET_AI_CONFIG(makeReq("http://localhost:3000/api/v1/ai-configs/cfg1"), makeParams("cfg1"))
    expect(res.status).toBe(404)
  })

  it("returns config successfully", async () => {
    vi.mocked(prisma.aiAgentConfig.findFirst).mockResolvedValue({
      id: "cfg1",
      configName: "Support Agent",
      model: "claude-haiku-4-5-20251001",
    } as any)
    const res = await GET_AI_CONFIG(makeReq("http://localhost:3000/api/v1/ai-configs/cfg1"), makeParams("cfg1"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.configName).toBe("Support Agent")
  })
})

describe("PUT /api/v1/ai-configs/[id]", () => {
  it("returns 404 when config does not exist", async () => {
    vi.mocked(prisma.aiAgentConfig.updateMany).mockResolvedValue({ count: 0 } as any)
    const res = await PUT_AI_CONFIG(
      makeReq("http://localhost:3000/api/v1/ai-configs/cfg1", {
        method: "PUT",
        body: JSON.stringify({ configName: "Updated" }),
      }),
      makeParams("cfg1"),
    )
    expect(res.status).toBe(404)
  })
})

describe("DELETE /api/v1/ai-configs/[id]", () => {
  it("returns 404 when config does not exist", async () => {
    vi.mocked(prisma.aiAgentConfig.deleteMany).mockResolvedValue({ count: 0 } as any)
    const res = await DELETE_AI_CONFIG(
      makeReq("http://localhost:3000/api/v1/ai-configs/cfg1", { method: "DELETE" }),
      makeParams("cfg1"),
    )
    expect(res.status).toBe(404)
  })

  it("deletes config successfully", async () => {
    vi.mocked(prisma.aiAgentConfig.deleteMany).mockResolvedValue({ count: 1 } as any)
    const res = await DELETE_AI_CONFIG(
      makeReq("http://localhost:3000/api/v1/ai-configs/cfg1", { method: "DELETE" }),
      makeParams("cfg1"),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.deleted).toBe("cfg1")
  })
})

/* ═══════════════════════════════════════════════════════════════════
   GET /api/v1/ai-configs/stats
   ═══════════════════════════════════════════════════════════════════ */
describe("GET /api/v1/ai-configs/stats", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    vi.mocked(getSession).mockResolvedValue(null as any)
    const res = await GET_AI_CONFIG_STATS(makeReq("http://localhost:3000/api/v1/ai-configs/stats"))
    expect(res.status).toBe(401)
  })

  it("returns agent metrics and handoffs", async () => {
    vi.mocked(prisma.aiAgentConfig.findMany).mockResolvedValue([
      { id: "a1", configName: "Support", agentType: "support", model: "haiku", isActive: true },
    ] as any)
    vi.mocked(prisma.aiInteractionLog.groupBy)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    vi.mocked(prisma.agentHandoff.findMany).mockResolvedValue([])

    const res = await GET_AI_CONFIG_STATS(makeReq("http://localhost:3000/api/v1/ai-configs/stats"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.agents).toHaveLength(1)
    expect(json.data.handoffs).toEqual([])
  })
})
