import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

/**
 * E3.2 — inbox compose-assist (rewrite/shorten/polite/translate/suggest).
 * Covers runAiAssist (input guard, budget guard, AI-failure) + the route (200/400/429).
 */
interface AnthropicRequest {
  messages: Array<{ role: string; content: string }>
}

type RlsHandler = (
  req: NextRequest,
  auth: { orgId: string; userId: string; role: "admin"; email: string; name: string },
  ctx: unknown,
) => Promise<Response>

const h = vi.hoisted((): {
  reply: string
  shouldThrow: boolean
  createCalls: number
  lastRequest: AnthropicRequest | null
} => ({ reply: "Rewritten text", shouldThrow: false, createCalls: 0, lastRequest: null }))
const bg = vi.hoisted(() => ({ allowed: true }))
const kb = vi.hoisted(() => ({ context: "" }))

vi.mock("@/lib/ai/anthropic-client", () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async (request: AnthropicRequest) => {
        h.createCalls++
        h.lastRequest = request
        if (h.shouldThrow) throw new Error("boom")
        return { content: [{ type: "text", text: h.reply }], usage: { input_tokens: 10, output_tokens: 5 } }
      },
    },
  }),
}))
vi.mock("@/lib/ai/budget", () => ({
  checkAiBudget: async () => ({ allowed: bg.allowed, spent: 0, limit: 10, remaining: 10 }),
  calculateAiCost: () => 0.001,
}))
vi.mock("@/lib/inbox/kb-context", () => ({
  buildInboxKbContext: vi.fn(async () => kb.context),
}))
vi.mock("@/lib/prisma", () => ({ prisma: { aiInteractionLog: { create: async () => ({}) } } }))
vi.mock("@/lib/with-rls", () => ({
  withRlsSessionAuth:
    (hnd: RlsHandler) =>
    (req: NextRequest, ctx: unknown) =>
      hnd(req, {
        orgId: "org_1", userId: "u1", role: "admin",
        email: "admin@example.test", name: "Admin",
      }, ctx),
}))

import { runAiAssist } from "@/lib/inbox/ai-assist"
import { POST } from "@/app/api/v1/inbox/ai-assist/route"
import { buildInboxKbContext } from "@/lib/inbox/kb-context"

function postReq(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/v1/inbox/ai-assist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  h.reply = "Rewritten text"
  h.shouldThrow = false
  h.createCalls = 0
  h.lastRequest = null
  bg.allowed = true
  kb.context = ""
  vi.mocked(buildInboxKbContext).mockClear()
})

describe("runAiAssist", () => {
  it("rewrites a draft (ok)", async () => {
    const out = await runAiAssist({ organizationId: "org_1", action: "rewrite", draft: "hello there" })
    expect(out).toEqual({ ok: true, suggestion: "Rewritten text" })
    expect(h.createCalls).toBe(1)
  })

  it("returns empty_input WITHOUT calling the model when the draft is blank", async () => {
    const out = await runAiAssist({ organizationId: "org_1", action: "rewrite", draft: "   " })
    expect(out).toEqual({ ok: false, error: "empty_input" })
    expect(h.createCalls).toBe(0)
  })

  it("suggest works from lastInbound even with an empty draft", async () => {
    const out = await runAiAssist({ organizationId: "org_1", action: "suggest", draft: "", lastInbound: "where is my order?" })
    expect(out.ok).toBe(true)
    expect(h.createCalls).toBe(1)
  })

  it("N1: suggest injects KB-RAG context into the AI Assist prompt", async () => {
    kb.context = "\n\n--- KNOWLEDGE BASE CONTEXT ---\n[KB 1] Delivery SLA\nOrders arrive in 2 days."
    const out = await runAiAssist({ organizationId: "org_1", action: "suggest", draft: "", lastInbound: "When will my order arrive?", lang: "en" })
    expect(out.ok).toBe(true)
    expect(buildInboxKbContext).toHaveBeenCalledWith({
      organizationId: "org_1",
      query: "When will my order arrive?",
      limit: 3,
    })
    const request = h.lastRequest
    expect(request).not.toBeNull()
    if (!request) throw new Error("expected captured Anthropic request")
    expect(request.messages[0].content).toContain("KNOWLEDGE BASE CONTEXT")
    expect(request.messages[0].content).toContain("Orders arrive in 2 days.")
  })

  it("masks inbox draft and inbound PII before calling Anthropic", async () => {
    h.reply = "Reply to [EMAIL_1] or [PHONE_1]."
    const out = await runAiAssist({
      organizationId: "org_1",
      action: "suggest",
      draft: "Tell Aysel to email aysel@example.com",
      lastInbound: "My phone is +994 50 123 45 67 and email is aysel@example.com",
      lang: "en",
    })
    expect(out).toEqual({ ok: true, suggestion: "Reply to aysel@example.com or +994 50 123 45 67." })
    const request = h.lastRequest
    expect(request).not.toBeNull()
    if (!request) throw new Error("expected captured Anthropic request")
    const payload = request.messages[0].content
    expect(payload).toContain("[EMAIL_")
    expect(payload).toContain("[PHONE_")
    expect(payload).not.toContain("aysel@example.com")
    expect(payload).not.toContain("+994 50 123 45 67")
  })

  it("does not pull KB context for rewrite actions", async () => {
    const out = await runAiAssist({ organizationId: "org_1", action: "rewrite", draft: "hello there" })
    expect(out.ok).toBe(true)
    expect(buildInboxKbContext).not.toHaveBeenCalled()
  })

  it("blocks on budget WITHOUT calling the model", async () => {
    bg.allowed = false
    const out = await runAiAssist({ organizationId: "org_1", action: "rewrite", draft: "hi" })
    expect(out).toEqual({ ok: false, error: "budget" })
    expect(h.createCalls).toBe(0)
  })

  it("returns ai_failed when the model throws", async () => {
    h.shouldThrow = true
    const out = await runAiAssist({ organizationId: "org_1", action: "shorten", draft: "long text here" })
    expect(out).toEqual({ ok: false, error: "ai_failed" })
  })

  it("strips code fences from the model output", async () => {
    h.reply = "```\nclean text\n```"
    const out = await runAiAssist({ organizationId: "org_1", action: "rewrite", draft: "x" })
    expect(out).toEqual({ ok: true, suggestion: "clean text" })
  })
})

describe("POST /api/v1/inbox/ai-assist", () => {
  it("200 with a suggestion", async () => {
    const res = await POST(postReq({ action: "rewrite", draft: "hello" }))
    expect(res.status).toBe(200)
    expect((await res.json()).data.suggestion).toBe("Rewritten text")
  })

  it("400 on an unknown action", async () => {
    const res = await POST(postReq({ action: "explode", draft: "hi" }))
    expect(res.status).toBe(400)
  })

  it("400 on empty input", async () => {
    const res = await POST(postReq({ action: "rewrite", draft: "" }))
    expect(res.status).toBe(400)
  })

  it("429 when over budget", async () => {
    bg.allowed = false
    const res = await POST(postReq({ action: "rewrite", draft: "hi" }))
    expect(res.status).toBe(429)
  })
})
