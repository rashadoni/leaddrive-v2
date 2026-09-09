/**
 * F3 — agent test sandbox: validation + route (persona preview, no side effects).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: { aiAgentConfig: { findFirst: vi.fn() }, aiInteractionLog: { create: vi.fn() } },
}))
vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn(),
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((v: unknown) => v instanceof Response),
}))
const llmCreate = vi.fn()
vi.mock("@/lib/ai/anthropic-client", () => ({
  getAnthropicClient: () => ({ messages: { create: llmCreate } }),
  AI_DEFAULT_TIMEOUT_MS: 45000,
  AI_DEFAULT_MAX_RETRIES: 1,
}))

import { validateSandboxMessages, SANDBOX_MAX_MESSAGES, SANDBOX_MAX_CONTENT } from "@/lib/ai/agent-sandbox"
import { POST } from "@/app/api/v1/ai-configs/[id]/test/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const req = (body: unknown) =>
  new NextRequest("http://localhost/x", {
    method: "POST",
    headers: { "x-organization-id": "org-1", "content-type": "application/json" },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1", userId: "u-1", role: "admin" } as never)
  vi.mocked(prisma.aiInteractionLog.create).mockResolvedValue({} as never)
})

describe("validateSandboxMessages", () => {
  it("rejects empty / non-array", () => {
    expect(validateSandboxMessages([])).toEqual({ ok: false, error: "empty" })
    expect(validateSandboxMessages(null)).toEqual({ ok: false, error: "empty" })
  })
  it("rejects too many messages", () => {
    const many = Array.from({ length: SANDBOX_MAX_MESSAGES + 1 }, () => ({ role: "user", content: "hi" }))
    expect(validateSandboxMessages(many)).toEqual({ ok: false, error: "too_many" })
  })
  it("rejects over-long content", () => {
    expect(validateSandboxMessages([{ role: "user", content: "x".repeat(SANDBOX_MAX_CONTENT + 1) }]))
      .toEqual({ ok: false, error: "too_long" })
  })
  it("rejects when the last message isn't from the user", () => {
    expect(validateSandboxMessages([{ role: "user", content: "hi" }, { role: "assistant", content: "yo" }]))
      .toEqual({ ok: false, error: "not_user_last" })
  })
  it("accepts a clean transcript ending in a user turn", () => {
    const r = validateSandboxMessages([{ role: "user", content: "hi" }, { role: "assistant", content: "yo" }, { role: "user", content: "more" }])
    expect(r.ok).toBe(true)
  })
})

describe("POST /ai-configs/[id]/test", () => {
  const okConfig = { model: "claude-haiku-4-5-20251001", systemPrompt: "Be nice", temperature: 0.5, maxTokens: 2048, toolsEnabled: ["add_note"] }

  it("404 when the config isn't in the org", async () => {
    vi.mocked(prisma.aiAgentConfig.findFirst).mockResolvedValue(null as never)
    const res = await POST(req({ messages: [{ role: "user", content: "hi" }] }), ctx("nope"))
    expect(res.status).toBe(404)
    expect(llmCreate).not.toHaveBeenCalled()
  })

  it("400 on an invalid conversation", async () => {
    vi.mocked(prisma.aiAgentConfig.findFirst).mockResolvedValue(okConfig as never)
    const res = await POST(req({ messages: [] }), ctx("cfg-1"))
    expect(res.status).toBe(400)
    expect(llmCreate).not.toHaveBeenCalled()
  })

  it("runs the persona, returns reply + trace + toolsAvailable, logs cost, uses NO tools", async () => {
    vi.mocked(prisma.aiAgentConfig.findFirst).mockResolvedValue(okConfig as never)
    llmCreate.mockResolvedValue({
      content: [{ type: "text", text: "Hello there!" }],
      usage: { input_tokens: 30, output_tokens: 12 },
    })
    const res = await POST(req({ messages: [{ role: "user", content: "hi" }] }), ctx("cfg-1"))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.reply).toBe("Hello there!")
    expect(body.data.toolsAvailable).toEqual(["add_note"])
    expect(body.data.promptTokens).toBe(30)
    // the LLM call carried the persona but NO tools param (sandbox = no side effects)
    const callArg = llmCreate.mock.calls[0][0]
    expect(callArg.system).toBe("Be nice")
    expect("tools" in callArg).toBe(false)
    // output tokens capped for a preview
    expect(callArg.max_tokens).toBeLessThanOrEqual(1024)
    expect(vi.mocked(prisma.aiInteractionLog.create)).toHaveBeenCalledTimes(1)
  })

  it("502 when the LLM throws", async () => {
    vi.mocked(prisma.aiAgentConfig.findFirst).mockResolvedValue(okConfig as never)
    llmCreate.mockRejectedValue(new Error("upstream"))
    const res = await POST(req({ messages: [{ role: "user", content: "hi" }] }), ctx("cfg-1"))
    expect(res.status).toBe(502)
  })
})
