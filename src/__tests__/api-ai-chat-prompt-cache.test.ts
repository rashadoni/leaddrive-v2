/**
 * Da Vinci's requests to Anthropic carry prompt-cache markers — through the
 * real route (2026-11-09: before this, every question and every tool round
 * sent the tools and the whole system prompt as fresh input).
 *
 * A cache is a byte-exact prefix. What is checked here is behaviour on the
 * request bytes, not the shape of a call:
 *  - the cached rules block is identical across two questions that differ in
 *    page, clock, question and the people they mention;
 *  - nothing of the request (page, clock, question, a customer's real name)
 *    is inside it, and the org's known names are masked there as before;
 *  - the next tool round of the same question re-sends the previous round
 *    unchanged with the marker moved to its new end (never more than four);
 *  - the budget prices cache reads and writes, and the timing line reports
 *    them as numbers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const { anthropicCreate, executeVoiceReadToolMock, routeToAgentMock, aiLogCreate, companiesMock } = vi.hoisted(() => ({
  anthropicCreate: vi.fn(),
  executeVoiceReadToolMock: vi.fn(),
  routeToAgentMock: vi.fn(),
  aiLogCreate: vi.fn(),
  companiesMock: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiInteractionLog: { create: aiLogCreate },
    deal: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn(), count: vi.fn().mockResolvedValue(0) },
    company: { count: vi.fn().mockResolvedValue(0), findMany: companiesMock },
    ticket: { count: vi.fn().mockResolvedValue(0) },
    lead: { count: vi.fn().mockResolvedValue(0) },
    contact: { findMany: vi.fn().mockResolvedValue([{ fullName: "Aysel Məmmədova" }, { fullName: "Rauf Əliyev" }]) },
    organization: { findUnique: vi.fn().mockResolvedValue(null) },
    agentHandoff: { create: vi.fn() },
  },
  logAudit: vi.fn(),
}))

vi.mock("@/lib/api-auth", () => ({
  getSession: vi.fn(),
  getOrgId: vi.fn(),
  requireAuth: vi.fn(),
  getOrgModuleContext: vi.fn().mockResolvedValue({
    plan: "pro",
    addons: ["ai"],
    modules: { ai: true, crm: true, sales: true, support: true, leads: true, tasks: true, ai_smart_search: true },
  }),
  isAuthError: vi.fn((v) => v instanceof NextResponse),
}))

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockReturnValue(true),
  RATE_LIMIT_CONFIG: { ai: { maxRequests: 20, windowMs: 60000 } },
}))

vi.mock("@anthropic-ai/sdk", () => ({
  default: function MockAnthropic() {
    return { messages: { create: anthropicCreate, stream: vi.fn() } }
  },
}))

vi.mock("@/lib/ai/tools", () => ({
  CRM_TOOLS: [],
  TOOL_META: {},
  getEnabledTools: vi.fn().mockReturnValue([]),
  getEnabledToolsForAgent: vi.fn().mockReturnValue([]),
  filterToolsByTenantModules: vi.fn((tools) => tools),
}))

vi.mock("@/lib/ai/tool-executor", () => ({ executeTool: vi.fn() }))
vi.mock("@/lib/ai/voice/execute-read-tool", () => ({ executeVoiceReadTool: executeVoiceReadToolMock }))
vi.mock("@/lib/ai/chat-analytics-executor", () => ({
  executeChatAnalyticsTool: vi.fn(),
  loadChatAnalyticsTimezone: vi.fn().mockResolvedValue("Asia/Baku"),
}))
vi.mock("@/lib/ai/predictive", () => ({
  predictDealWin: vi.fn().mockResolvedValue({ winProbability: 50, confidence: 60, riskFactors: [] }),
}))
vi.mock("@/lib/ai/next-best-action", () => ({ generateNextBestActions: vi.fn().mockResolvedValue([]) }))
vi.mock("@/lib/sharing-rules", () => ({ applyRecordFilter: vi.fn(async (_o, _u, _r, _e, where) => where) }))
vi.mock("@/lib/ai/agent-router", () => ({ routeToAgent: routeToAgentMock }))

import { POST as POST_CHAT } from "@/app/api/v1/ai/chat/route"
import { getSession, getOrgId, requireAuth } from "@/lib/api-auth"
import { calculateAiCost } from "@/lib/ai/budget"

const SESSION = { orgId: "org-1", userId: "user-1", role: "admin", email: "a@b.com", name: "Test" }
// An agent whose own prompt names a customer company: it must reach the model
// masked, and masked the same way every time.
const AGENT = {
  id: "agent-1",
  configName: "Satış köməkçisi",
  agentType: "sales",
  systemPrompt: "Bizim əsas müştərimiz Acme Corp-dur.",
  model: "claude-sonnet-4-6",
  maxTokens: 1024,
  temperature: 0.2,
  maxToolRounds: 5,
}

function ask(message: string, context: Record<string, string>) {
  return POST_CHAT(new NextRequest(new URL("http://localhost:3000/api/v1/ai/chat"), {
    method: "POST",
    body: JSON.stringify({ message, locale: "az", context }),
  }))
}

type Block = { type: string; text?: string; cache_control?: unknown }
type Params = {
  system: Block[]
  tools?: Array<{ name: string; cache_control?: unknown }>
  messages: Array<{ role: string; content: string | Block[] }>
}
const call = (n: number) => anthropicCreate.mock.calls[n][0] as Params
const markers = (params: Params) => {
  let count = params.system.filter((block) => block.cache_control).length
  count += (params.tools ?? []).filter((tool) => tool.cache_control).length
  for (const message of params.messages) {
    if (Array.isArray(message.content)) count += message.content.filter((block) => block.cache_control).length
  }
  return count
}

const reply = (text: string, usage: Record<string, number> = { input_tokens: 10, output_tokens: 5 }) =>
  ({ content: [{ type: "text", text }], usage })

let writes: string[] = []
let stdoutSpy: { mockRestore(): void } | undefined

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ANTHROPIC_API_KEY = "test-key"
  vi.mocked(getSession).mockResolvedValue(SESSION as never)
  vi.mocked(getOrgId).mockResolvedValue("org-1" as never)
  vi.mocked(requireAuth).mockResolvedValue(SESSION as never)
  routeToAgentMock.mockResolvedValue({ agent: AGENT, intent: "general", confidence: 1, isHandoff: false })
  companiesMock.mockResolvedValue([{ name: "Acme Corp" }, { name: "Beta MMC" }])
  executeVoiceReadToolMock.mockResolvedValue({ body: { data: { id: "rec-1", name: "Aysel Məmmədova", phone: "+994 50 123 45 67" } } })
  writes = []
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk))
    return true
  })
})
afterEach(() => stdoutSpy?.mockRestore())

describe("Da Vinci's prompt cache", () => {
  it("keeps the cached rules byte-identical between questions, with nothing of the request inside", async () => {
    anthropicCreate.mockResolvedValue(reply("Salam!"))
    vi.useFakeTimers({ toFake: ["Date"] })
    try {
      vi.setSystemTime(new Date("2026-11-09T08:00:00Z"))
      await ask("Aysel Məmmədova ilə görüşə hazırlaş", { url: "/contacts/c-1", title: "Aysel Məmmədova" })
      vi.setSystemTime(new Date("2026-11-09T08:03:41Z"))
      await ask("Beta MMC üçün məktub yaz", { url: "/companies/b-1", title: "Beta MMC — Rauf Əliyev" })
    } finally {
      vi.useRealTimers()
    }

    const [first, second] = [call(0), call(1)]
    expect(first.system[0].cache_control).toEqual({ type: "ephemeral" })
    expect(second.system[0].text).toBe(first.system[0].text)
    // Tools render before system and are covered by the same marker.
    expect(second.tools?.map((tool) => tool.name)).toEqual(first.tools?.map((tool) => tool.name))

    const stable = first.system[0].text!
    // The org's customer in the agent prompt is masked, and stays [COMPANY_1].
    expect(stable).toContain("[COMPANY_1]")
    expect(stable).not.toContain("Acme Corp")
    // Nothing of either request: page, clock, question, people.
    for (const piece of ["/contacts/c-1", "/companies/b-1", "2026-11-09", "Reporting clock", "Current page",
      "Aysel", "Rauf", "Beta MMC", "görüşə", "məktub", "[PERSON_", "[COMPANY_2]"]) {
      expect(stable, piece).not.toContain(piece)
    }

    // The request's own part follows, unmarked, still masked.
    expect(first.system[1].cache_control).toBeUndefined()
    expect(first.system[1].text).toContain("Reporting clock: 2026-11-09T08:00:00.000Z")
    expect(second.system[1].text).toContain("Reporting clock: 2026-11-09T08:03:41.000Z")
    expect(second.system[1].text).toContain("[COMPANY_2]")
    expect(second.system[1].text).not.toContain("Beta MMC")
    expect(second.system[1].text).not.toContain("Rauf")
  })

  it("re-reads the previous round inside one question: same prefix, marker moved to the new end", async () => {
    anthropicCreate
      .mockResolvedValueOnce({
        content: [{ type: "tool_use", id: "tu_1", name: "find_record", input: { query: "[PERSON_1]" } }],
        usage: { input_tokens: 40, cache_creation_input_tokens: 6000, cache_read_input_tokens: 0, output_tokens: 20 },
      })
      .mockResolvedValueOnce(reply("Tapdım.", {
        input_tokens: 5, cache_creation_input_tokens: 90, cache_read_input_tokens: 6040, output_tokens: 15,
      }))

    const res = await ask("Aysel Məmmədova kimdir?", { url: "/", title: "" })
    expect(res.status).toBe(200)
    expect(anthropicCreate).toHaveBeenCalledTimes(2)
    const [round0, round1] = [call(0), call(1)]

    // Round 0: the question itself carries the tail marker.
    const question = round0.messages.at(-1)!
    expect(Array.isArray(question.content)).toBe(true)
    expect((question.content as Block[]).at(-1)!.cache_control).toEqual({ type: "ephemeral" })
    expect(markers(round0)).toBe(2)

    // Round 1 repeats round 0's request byte for byte (markers aside) ...
    const strip = (params: Params) => JSON.stringify({ system: params.system, tools: params.tools, messages: params.messages },
      (key, value) => (key === "cache_control" ? undefined : value))
    const round0Bytes = strip(round0)
    const round1Prefix = strip({ ...round1, messages: round1.messages.slice(0, round0.messages.length) })
    expect(round1Prefix).toBe(round0Bytes)
    // ... with the marker on the tool result, not left on the question.
    expect(markers(round1)).toBe(2)
    const toolResult = round1.messages.at(-1)!.content as Block[]
    expect(toolResult.at(-1)!.type).toBe("tool_result")
    expect(toolResult.at(-1)!.cache_control).toEqual({ type: "ephemeral" })
    // The tool's customer data went to the model masked, as before.
    expect(JSON.stringify(round1.messages)).not.toContain("Aysel")
    expect(JSON.stringify(round1.messages)).not.toContain("123 45 67")

    // The budget pays for every prompt token, at the cache's prices.
    const log = aiLogCreate.mock.calls[0][0].data
    expect(log.promptTokens).toBe(40 + 6000 + 5 + 90 + 6040)
    expect(log.completionTokens).toBe(35)
    expect(log.costUsd).toBeCloseTo(calculateAiCost("claude-sonnet-4-6", 45, 35, { readTokens: 6040, writeTokens: 6090 }), 12)

    // The timing line: numbers only.
    const line = JSON.parse(writes.find((chunk) => chunk.includes('"ai_chat_timing"'))!)
    expect(line).toMatchObject({
      rounds: 2, inputTokens: 45, cacheReadTokens: 6040, cacheWriteTokens: 6090, outputTokens: 35,
    })
    expect(JSON.stringify(line)).not.toMatch(/Aysel|kimdir|org-1|user-1/)
  })
})

describe("calculateAiCost with the prompt cache", () => {
  it("prices a cache read at a tenth of input and a 5-minute write at 1.25×", () => {
    // claude-sonnet-4-6: $3 input, $15 output per million.
    expect(calculateAiCost("claude-sonnet-4-6", 1_000_000, 0)).toBeCloseTo(3, 9)
    expect(calculateAiCost("claude-sonnet-4-6", 0, 0, { readTokens: 1_000_000 })).toBeCloseTo(0.3, 9)
    expect(calculateAiCost("claude-sonnet-4-6", 0, 0, { writeTokens: 1_000_000 })).toBeCloseTo(3.75, 9)
    expect(calculateAiCost("claude-sonnet-4-6", 100, 50, {})).toBe(calculateAiCost("claude-sonnet-4-6", 100, 50))
  })

  it("prices Opus 4.6 and 4.8 at Anthropic's $5 / $25, not Opus 4's $15 / $75", () => {
    expect(calculateAiCost("claude-opus-4-8", 1_000_000, 1_000_000)).toBeCloseTo(30, 9)
    expect(calculateAiCost("claude-opus-4-6", 1_000_000, 1_000_000)).toBeCloseTo(30, 9)
  })
})
