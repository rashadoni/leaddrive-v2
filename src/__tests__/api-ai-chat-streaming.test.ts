/**
 * Da Vinci's answer streams while the model writes it — through the real route.
 *
 * What may show before the final answer is only what the route would show
 * anyway: no CRM figure the route has not verified (a number waits for the end
 * of its round), no half-masked customer name, and a round that turns to a
 * tool takes back its preamble. The final answer is the same JSON body as
 * without streaming, sent last.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const { anthropicCreate, anthropicStream, executeVoiceReadToolMock } = vi.hoisted(() => ({
  anthropicCreate: vi.fn(),
  anthropicStream: vi.fn(),
  executeVoiceReadToolMock: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiInteractionLog: { create: vi.fn() },
    deal: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn(), count: vi.fn().mockResolvedValue(0) },
    company: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
    ticket: { count: vi.fn().mockResolvedValue(0) },
    lead: { count: vi.fn().mockResolvedValue(0) },
    contact: { findMany: vi.fn().mockResolvedValue([{ fullName: "Aysel Məmmədova" }]) },
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
    return { messages: { create: anthropicCreate, stream: anthropicStream } }
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
vi.mock("@/lib/ai/agent-router", () => ({
  routeToAgent: vi.fn().mockResolvedValue({ agent: null, intent: "general", confidence: 0.9, isHandoff: false }),
}))

import { POST as POST_CHAT } from "@/app/api/v1/ai/chat/route"
import { getSession, getOrgId, requireAuth } from "@/lib/api-auth"
import { parseSseChunk, type LiveReplyEvent } from "@/lib/ai/chat-live-reply"

const SESSION = { orgId: "org-1", userId: "user-1", role: "admin", email: "a@b.com", name: "Test" }

function ask(message: string, extra: Record<string, unknown> = { stream: true }) {
  return POST_CHAT(new NextRequest(new URL("http://localhost:3000/api/v1/ai/chat"), {
    method: "POST",
    body: JSON.stringify({ message, locale: "ru", ...extra }),
  }))
}

type StreamEvent = Record<string, unknown>
const textDelta = (text: string): StreamEvent => ({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } })
const toolStart = (name: string): StreamEvent => ({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tu_1", name, input: {} } })

/** A MessageStream stand-in: replays the events, then yields the message. */
function round(events: StreamEvent[], content: unknown[]) {
  const handlers: Array<(event: StreamEvent) => void> = []
  return {
    on(name: string, handler: (event: StreamEvent) => void) { if (name === "streamEvent") handlers.push(handler); return this },
    async finalMessage() {
      for (const event of events) for (const handler of handlers) handler(event)
      return { content, usage: { input_tokens: 10, output_tokens: 5 } }
    },
  }
}

async function events(res: Response): Promise<LiveReplyEvent[]> {
  expect(res.headers.get("content-type")).toContain("text/event-stream")
  return parseSseChunk(await res.text()).events
}
const shown = (list: LiveReplyEvent[]) => list.reduce((text, event) =>
  event.type === "delta" ? text + event.text : event.type === "reset" ? "" : text, "")

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ANTHROPIC_API_KEY = "test-key"
  vi.mocked(getSession).mockResolvedValue(SESSION as never)
  vi.mocked(getOrgId).mockResolvedValue("org-1" as never)
  vi.mocked(requireAuth).mockResolvedValue(SESSION as never)
})

describe("Da Vinci streams its answer", () => {
  it("shows the words as they come, unmasks names only whole, and ends with the usual JSON", async () => {
    anthropicStream.mockImplementation(() => round(
      [textDelta("Здравствуйте, [PER"), textDelta("SON_1]! Рады "), textDelta("видеть вас снова.")],
      [{ type: "text", text: "Здравствуйте, [PERSON_1]! Рады видеть вас снова." }],
    ))
    const list = await events(await ask("Напиши короткое приветствие для Aysel Məmmədova"))

    const deltas = list.filter((event) => event.type === "delta").map((event) => (event as { text: string }).text)
    expect(deltas.length).toBeGreaterThan(1)
    expect(deltas.join("")).toBe("Здравствуйте, Aysel Məmmədova! Рады видеть вас снова.")
    expect(deltas.some((text) => text.includes("[") || text.includes("PERSON"))).toBe(false)
    const done = list.at(-1) as Extract<LiveReplyEvent, { type: "done" }>
    expect(done.type).toBe("done")
    expect(done.status).toBe(200)
    expect((done.body as { data: { reply: string } }).data.reply).toBe("Здравствуйте, Aysel Məmmədova! Рады видеть вас снова.")
    expect(anthropicCreate).not.toHaveBeenCalled()
  })

  it("holds a number back until its round ends: it arrives only with the final answer", async () => {
    anthropicStream.mockImplementation(() => round(
      [textDelta("За неделю закрыто "), textDelta("12 сделок, отличный результат.")],
      [{ type: "text", text: "За неделю закрыто 12 сделок, отличный результат." }],
    ))
    const list = await events(await ask("Напиши мотивирующую фразу для команды продаж"))
    expect(shown(list)).toBe("За неделю закрыто ")
    expect((list.at(-1) as { body: { data: { reply: string } } }).body.data.reply).toBe("За неделю закрыто 12 сделок, отличный результат.")
  })

  it("takes back a preamble when the model turns to a tool, and streams nothing after an analytics tool", async () => {
    anthropicStream
      .mockImplementationOnce(() => round(
        [textDelta("Сейчас посмотрю отчёт. "), toolStart("get_crm_period_report")],
        [{ type: "text", text: "Сейчас посмотрю отчёт. " }, { type: "tool_use", id: "tu_1", name: "get_crm_period_report", input: {} }],
      ))
      .mockImplementationOnce(() => round(
        [textDelta("Готово: всего 999 лидов.")],
        [{ type: "text", text: "Готово: всего 999 лидов." }],
      ))
    const list = await events(await ask("Сделай отчёт для руководителя"))
    const resetAt = list.findIndex((event) => event.type === "reset")
    expect(resetAt).toBeGreaterThan(0)
    // Nothing the model wrote after the analytics tool reached the screen.
    expect(list.slice(resetAt).some((event) => event.type === "delta")).toBe(false)
    expect(JSON.stringify(list)).not.toMatch(/999/)
  })

  it("keeps the single JSON answer when it was not asked to stream, or for a user whose customer phones are hidden", async () => {
    anthropicCreate.mockResolvedValue({ content: [{ type: "text", text: "Привет!" }], usage: { input_tokens: 1, output_tokens: 1 } })
    const plain = await ask("Скажи привет", {})
    expect(plain.headers.get("content-type")).toContain("application/json")
    expect((await plain.json()).data.reply).toBe("Привет!")

    const operator = { ...SESSION, role: "sales", hideCustomerPhoneForOperators: true }
    vi.mocked(requireAuth).mockResolvedValue(operator as never)
    const hidden = await ask("Скажи привет")
    expect(hidden.headers.get("content-type")).not.toContain("text/event-stream")
    expect(anthropicStream).not.toHaveBeenCalled()
  })
})

/** A stream that sends `events`, then says nothing more until it is aborted. */
function silentRound(events: StreamEvent[]) {
  const handlers: Array<(event: StreamEvent) => void> = []
  let fail: ((error: Error) => void) | undefined
  const self = {
    aborted: false,
    on(name: string, handler: (event: StreamEvent) => void) { if (name === "streamEvent") handlers.push(handler); return self },
    finalMessage() {
      for (const event of events) for (const handler of handlers) handler(event)
      return new Promise((_resolve, reject) => { fail = reject })
    },
    abort() { self.aborted = true; fail?.(new Error("Request was aborted.")) },
  }
  return self
}

describe("Da Vinci does not wait for ever on a model that goes silent", () => {
  // Production 2026-11-09: after the first word Anthropic's stream stopped
  // for 65 s; the person watched half a sentence for a minute.
  beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }) })
  afterEach(() => { vi.useRealTimers() })

  it("cuts the silent stream off after 20 s, takes back its words and shows the answer asked again", async () => {
    const stalled = silentRound([textDelta("Здравствуйте! Чем ")])
    anthropicStream
      .mockImplementationOnce(() => stalled)
      .mockImplementationOnce(() => round(
        [textDelta("Здравствуйте! Чем могу помочь?")],
        [{ type: "text", text: "Здравствуйте! Чем могу помочь?" }],
      ))
    const res = await ask("Привет! Ты на связи?")
    const body = res.text()
    await vi.advanceTimersByTimeAsync(20_000)
    const list = parseSseChunk(await body).events
    expect(stalled.aborted).toBe(true)
    expect(anthropicStream).toHaveBeenCalledTimes(2)
    const resetAt = list.findIndex((event) => event.type === "reset")
    expect(resetAt).toBeGreaterThan(0)
    expect(shown(list)).toBe("Здравствуйте! Чем могу помочь?")
    const done = list.at(-1) as Extract<LiveReplyEvent, { type: "done" }>
    expect(done.status).toBe(200)
    expect((done.body as { data: { reply: string } }).data.reply).toBe("Здравствуйте! Чем могу помочь?")
  })

  it("says the model did not answer when it stays silent twice", async () => {
    anthropicStream.mockImplementation(() => silentRound([]))
    const res = await ask("Привет! Ты на связи?")
    const body = res.text()
    await vi.advanceTimersByTimeAsync(40_000)
    const done = parseSseChunk(await body).events.at(-1) as Extract<LiveReplyEvent, { type: "done" }>
    expect(anthropicStream).toHaveBeenCalledTimes(2)
    expect(done.status).toBe(504)
    expect(done.body).toEqual({ error: "Da Vinci did not answer in time" })
  })
})
