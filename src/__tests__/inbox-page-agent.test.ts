import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * One AI agent per page (owner 2026-11-13: «нужно разделение по страницам внутри Instagram…
 * и включение отключение и рабочее время»).
 *
 * The proof is what reaches the model and whether the customer gets an answer: a customer writing
 * to the baby-products account is answered from THAT page's rules and knowledge, another page of
 * the same organisation still gets the common ones, and a page told «only outside working hours»
 * stays silent during them. Only the model and the database rows are stand-ins.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>
const db = vi.hoisted(() => ({ agents: [] as Row[], channels: [] as Row[], hours: [] as Row[], conversations: [] as Row[] }))

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (cond && typeof cond === "object" && "in" in cond) return (cond.in as unknown[]).includes(row[key])
    return row[key] === cond
  })
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: vi.fn(async () => ({ features: ["aiAutoReply"] })) },
    aiChatSession: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({ id: "s1" })), update: vi.fn(async () => ({})) },
    aiChatMessage: { create: vi.fn(async () => ({})), findMany: vi.fn(async () => [{ role: "user", content: "salam" }]) },
    channelMessage: {
      create: vi.fn(async () => ({ id: "out-1" })), update: vi.fn(async () => ({})),
      findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []), count: vi.fn(async () => 0),
    },
    contact: { findFirst: vi.fn(async () => null) },
    socialConversation: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      findFirst: vi.fn(async ({ where }: Row) => db.conversations.find((c) => c.id === where.id) ?? { metadata: {}, assignedTo: null }),
    },
    aiInteractionLog: { create: vi.fn(async () => ({})) },
    aiAgentConfig: { findFirst: vi.fn(async ({ where }: Row) => db.agents.find((a) => matches(a, where)) ?? null) },
    channelConfig: { findFirst: vi.fn(async ({ where }: Row) => db.channels.find((c) => c.id === where.id && c.organizationId === where.organizationId) ?? null) },
    businessHours: { findMany: vi.fn(async ({ where }: Row) => db.hours.filter((h) => matches(h, where))) },
    user: { findMany: vi.fn(async () => []) },
  },
}))
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }))
vi.mock("@/lib/ai/budget", () => ({
  checkAiBudget: vi.fn(async () => ({ allowed: true })),
  calculateAiCost: () => 0,
  getAiLimits: vi.fn(async () => ({ maxRepliesPerConversation: 50, maxRepliesPerContactPerDay: 30, maxOutputTokens: 1024 })),
  checkConversationAiLimits: vi.fn(async () => ({ allowed: true, limits: {} })),
}))
vi.mock("@/lib/sanitize", () => ({ sanitizeForPrompt: (s: string) => s }))
vi.mock("@/lib/inbox/kb-context", () => ({
  buildInboxKbContext: vi.fn(),
  buildInboxKbContextDetailed: vi.fn(async () => ({ context: "", sources: [] })),
}))
const anthropicCreate = vi.fn()
vi.mock("@/lib/ai/anthropic-client", () => ({ getAnthropicClient: () => ({ messages: { create: anthropicCreate } }) }))

import { generateChannelAiReply, maybeAiAutoReply } from "@/lib/social/ai-autoreply"
import { getBusinessHoursDecision, pageBusinessHoursKey } from "@/lib/inbox/business-hours"
import { resolveInboxAgent, whatsAppPageTurn } from "@/lib/inbox/page-agent"

const ORG = "org_zeytun"
const PHARMA = "cfg_pharma"
const BABY = "cfg_baby"

const common = {
  id: "agent_common", organizationId: ORG, agentType: "inbox", isActive: true, channelConfigId: null,
  systemPrompt: "Ты консультант аптечной сети.", knowledgeBase: "Филиалы: Xırdalan, Yasamal.",
  greeting: "Salam! Zeytun Pharma.", replyLanguage: null, model: "claude-sonnet-4-6", temperature: 0.4, maxTokens: 600,
  escalationEnabled: true, autoLeadEnabled: true, autoAssignSales: true, autonomousBacklogEnabled: true,
  autonomousLookbackDays: 5, autonomousBatchSize: 10,
}
const babyAgent = {
  id: "agent_baby", organizationId: ORG, agentType: "inbox_page", isActive: true, channelConfigId: BABY,
  systemPrompt: "Ты консультант по детским товарам, обращайся к мамам тепло.", knowledgeBase: "Подгузники Bambi: 24 AZN.",
  greeting: "Salam! Zeytun Baby.", replyLanguage: "az", model: "claude-sonnet-4-6", temperature: 0.4, maxTokens: 600,
  escalationEnabled: true, autoLeadEnabled: false, autoAssignSales: true, autonomousBacklogEnabled: false,
  autonomousLookbackDays: 7, autonomousBatchSize: 20,
}

// The first call is the reply itself; a later one is the quality judge.
const systemPrompt = () => String(anthropicCreate.mock.calls[0]?.[0].system)

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ANTHROPIC_API_KEY = "test-key"
  db.agents = [{ ...common }, { ...babyAgent }]
  db.channels = [
    { id: PHARMA, organizationId: ORG, settings: { replyMode: "ai" } },
    { id: BABY, organizationId: ORG, settings: { replyMode: "ai" } },
  ]
  db.hours = []
  db.conversations = [
    { id: "conv_baby", organizationId: ORG, channelConfigId: BABY, metadata: {}, assignedTo: null },
    { id: "conv_pharma", organizationId: ORG, channelConfigId: PHARMA, metadata: {}, assignedTo: null },
  ]
  anthropicCreate.mockResolvedValue({ content: [{ type: "text", text: "Salam!" }], usage: { input_tokens: 10, output_tokens: 5 } })
})

const ask = (channelConfigId: string | undefined, conversationId: string) =>
  generateChannelAiReply({
    orgId: ORG, channel: "instagram", externalId: "igsid_1", userMessage: "Qiymət neçədir?", senderName: "Aysel",
    conversationId, channelConfigId,
  })

describe("the agent that answers depends on the page the customer wrote to", () => {
  it("answers on a page with its own agent from that page's rules, knowledge and greeting", async () => {
    await ask(BABY, "conv_baby")

    expect(systemPrompt()).toContain("консультант по детским товарам")
    expect(systemPrompt()).toContain("Подгузники Bambi: 24 AZN")
    expect(systemPrompt()).toContain("Zeytun Baby")
    // Nothing of the common agent leaks into the page's answer — not its rules, not its prices.
    expect(systemPrompt()).not.toContain("консультант аптечной сети")
    expect(systemPrompt()).not.toContain("Xırdalan")
  })

  it("answers on a page without its own agent from the common one, as before", async () => {
    await ask(PHARMA, "conv_pharma")

    expect(systemPrompt()).toContain("консультант аптечной сети")
    expect(systemPrompt()).toContain("Xırdalan")
    expect(systemPrompt()).not.toContain("Bambi")
  })

  it("finds the page from the conversation when the caller does not name it (flows, backlog)", async () => {
    await ask(undefined, "conv_baby")

    expect(systemPrompt()).toContain("Подгузники Bambi")
  })

  it("never takes another organisation's page agent", async () => {
    db.agents.find((a) => a.id === "agent_baby")!.organizationId = "org_other"

    await ask(BABY, "conv_baby")

    expect(systemPrompt()).toContain("консультант аптечной сети")
    expect(systemPrompt()).not.toContain("Bambi")
  })

  it("keeps lead creation and backlog as the organisation set them, whatever the page agent row says", async () => {
    const agent = await resolveInboxAgent({ organizationId: ORG, channelConfigId: BABY })

    expect(agent).toMatchObject({
      pageAgent: true, autoLeadEnabled: true, autonomousBacklogEnabled: true, autonomousLookbackDays: 5, autonomousBatchSize: 10,
    })
  })

  it("leaves the common agent alone for every reader that asks for agentType inbox", async () => {
    // lead-qualification, the backlog cron and the CRM chat router all do exactly this lookup.
    const found = db.agents.filter((a) => a.organizationId === ORG && a.agentType === "inbox")

    expect(found).toHaveLength(1)
    expect(found[0].id).toBe("agent_common")
  })
})

describe("a page's own working hours", () => {
  // Wednesday 2026-11-11, 10:00 in Baku.
  const WORKDAY_MORNING = new Date("2026-11-11T06:00:00Z")
  const day = (start: string, end: string) => ({ enabled: true, intervals: [{ start, end }] })
  const week = (start: string, end: string) =>
    Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, day(start, end)]))

  beforeEach(() => {
    db.hours = [
      { organizationId: ORG, channelType: "all", timezone: "Asia/Baku", isActive: true, schedule: week("09:00", "18:00"), holidays: [] },
      { organizationId: ORG, channelType: pageBusinessHoursKey(BABY), timezone: "Asia/Baku", isActive: true, schedule: week("12:00", "20:00"), holidays: [] },
    ]
  })

  it("win over the company's for that page, and only for that page", async () => {
    const baby = await getBusinessHoursDecision({ organizationId: ORG, channelType: "instagram", channelConfigId: BABY, now: WORKDAY_MORNING })
    const pharma = await getBusinessHoursDecision({ organizationId: ORG, channelType: "instagram", channelConfigId: PHARMA, now: WORKDAY_MORNING })

    expect(baby.open).toBe(false) // 10:00 is before the page's 12:00
    expect(pharma.open).toBe(true) // the company's 09:00–18:00
  })

  it("do not change what a caller without a page gets", async () => {
    const decision = await getBusinessHoursDecision({ organizationId: ORG, channelType: "instagram", now: WORKDAY_MORNING })

    expect(decision.open).toBe(true)
  })
})

describe("when the AI answers on a page", () => {
  const send = vi.fn(async () => true)
  const inbound = (channelConfigId: string, conversationId: string) =>
    maybeAiAutoReply({
      orgId: ORG, channelConfigId, platform: "instagram", conversationId,
      pageId: "PAGE", externalId: "igsid_1", userMessage: "Qiymət neçədir?", senderName: "Aysel", send,
    })
  const alwaysClosed = { enabled: false, intervals: [] }
  const closedWeek = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, alwaysClosed]))
  const openWeek = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { enabled: true, intervals: [{ start: "00:00", end: "23:59" }] }]))
  const pageHours = (channelConfigId: string, schedule: Row) =>
    ({ organizationId: ORG, channelType: pageBusinessHoursKey(channelConfigId), timezone: "Asia/Baku", isActive: true, schedule, holidays: [] })

  beforeEach(() => send.mockClear())

  it("«only outside working hours»: silent while the page is open — no model call, nothing sent", async () => {
    db.channels.find((c) => c.id === BABY)!.settings = { replyMode: "ai", aiSchedule: "outside_hours" }
    db.hours = [pageHours(BABY, openWeek)]

    const result = await inbound(BABY, "conv_baby")

    expect(result).toMatchObject({ replied: false, skipped: "outside_ai_schedule" })
    expect(anthropicCreate).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it("«only outside working hours»: answers once the page is closed", async () => {
    db.channels.find((c) => c.id === BABY)!.settings = { replyMode: "ai", aiSchedule: "outside_hours" }
    db.hours = [pageHours(BABY, closedWeek)]

    const result = await inbound(BABY, "conv_baby")

    expect(result.skipped).not.toBe("outside_ai_schedule")
    expect(anthropicCreate).toHaveBeenCalled()
  })

  it("«only during working hours»: silent while the page is closed", async () => {
    db.channels.find((c) => c.id === BABY)!.settings = { replyMode: "ai", aiSchedule: "inside_hours" }
    db.hours = [pageHours(BABY, closedWeek)]

    const result = await inbound(BABY, "conv_baby")

    expect(result).toMatchObject({ replied: false, skipped: "outside_ai_schedule" })
    expect(anthropicCreate).not.toHaveBeenCalled()
  })

  it("one page's schedule does not silence another page of the same company", async () => {
    db.channels.find((c) => c.id === BABY)!.settings = { replyMode: "ai", aiSchedule: "inside_hours" }
    db.hours = [pageHours(BABY, closedWeek)]

    const result = await inbound(PHARMA, "conv_pharma")

    expect(result.skipped).not.toBe("outside_ai_schedule")
    expect(anthropicCreate).toHaveBeenCalled()
  })

  it("a page nobody gave a schedule answers at any hour, as before", async () => {
    db.hours = [pageHours(PHARMA, closedWeek)]

    const result = await inbound(PHARMA, "conv_pharma")

    expect(result.skipped).not.toBe("outside_ai_schedule")
    expect(anthropicCreate).toHaveBeenCalled()
  })
})

/**
 * WhatsApp is answered by Da Vinci, the support assistant. A number with a page agent keeps Da
 * Vinci and gets the page's words in place of the organisation-wide support instructions; the
 * webhook appends exactly `instructions` to Da Vinci's base prompt.
 */
describe("a WhatsApp number's turn", () => {
  const WA = "cfg_wa"
  const SUPPORT = "Отвечай как служба поддержки аптечной сети."
  const turn = (channelSettings: Row = {}, channelConfigId: string | null = WA) =>
    whatsAppPageTurn({ organizationId: ORG, channelConfigId, channelSettings, supportPrompt: SUPPORT })

  beforeEach(() => {
    db.agents.push({
      ...babyAgent, id: "agent_wa", channelConfigId: WA,
      systemPrompt: "Ты принимаешь заказы оптовых аптек.", knowledgeBase: "Минимальный заказ: 50 AZN.",
      greeting: "Salam! Zeytun topdan.", replyLanguage: "az",
    })
  })

  it("with a page agent: the number's own rules, knowledge, greeting and language — not the support instructions", async () => {
    const result = await turn()

    expect(result).toMatchObject({ allowed: true, pageAgent: true })
    expect(result.instructions).toContain("принимаешь заказы оптовых аптек")
    expect(result.instructions).toContain("Минимальный заказ: 50 AZN")
    expect(result.instructions).toContain("Zeytun topdan")
    expect(result.instructions).not.toContain("служба поддержки аптечной сети")
    // The reply language the page chose reaches the model as a rule of its own.
    expect(result.instructions.split("\n\n").length).toBeGreaterThanOrEqual(4)
  })

  it("without a page agent: exactly what the number got before", async () => {
    const result = await turn({}, "cfg_wa_other")

    expect(result).toEqual({ allowed: true, pageAgent: false, instructions: `\n\nДОПОЛНИТЕЛЬНЫЕ ИНСТРУКЦИИ:\n${SUPPORT}` })
  })

  it("without a page agent and without support instructions: nothing is added", async () => {
    const result = await whatsAppPageTurn({ organizationId: ORG, channelConfigId: "cfg_wa_other", channelSettings: {} })

    expect(result).toEqual({ allowed: true, pageAgent: false, instructions: "" })
  })

  it("another number of the same company does not get this number's agent", async () => {
    const result = await turn({}, "cfg_wa_second")

    expect(result.instructions).not.toContain("оптовых аптек")
  })

  it("«only outside working hours»: the turn is a person's while the number is open", async () => {
    const open = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { enabled: true, intervals: [{ start: "00:00", end: "23:59" }] }]))
    db.hours = [{ organizationId: ORG, channelType: pageBusinessHoursKey(WA), timezone: "Asia/Baku", isActive: true, schedule: open, holidays: [] }]

    expect((await turn({ aiSchedule: "outside_hours" })).allowed).toBe(false)
    expect((await turn({ aiSchedule: "inside_hours" })).allowed).toBe(true)
    expect((await turn({})).allowed).toBe(true)
  })
})

