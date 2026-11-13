/**
 * The inbox AI agent of ONE page — an Instagram account, a Facebook page, a Telegram bot.
 *
 * Until 2026-11-13 an organisation had a single inbox agent (`agentType = "inbox"`): one character
 * and one knowledge base for every channel. A company with six Instagram accounts for six product
 * lines answered all of them in one voice from one price list (owner: «нужно разделение по
 * страницам внутри Instagram», then «и включение отключение и рабочее время»).
 *
 * A page agent is its own row, `agentType = "inbox_page"` with `channelConfigId`. The type is
 * deliberately NOT "inbox": a dozen readers find the organisation's common agent with
 * `findFirst({ agentType: "inbox" })`, and a second row of that type would be picked between at
 * random. Only `resolveInboxAgent` knows about page agents.
 *
 * What a page owns: character and rules, knowledge, greeting, reply language, model. What stays
 * the organisation's: the autonomous settings (lead creation, backlog), the AI limits, and the
 * rules about prices and attacks — those are read from the common agent whichever page answers.
 */
import { prisma } from "@/lib/prisma"
import { getBusinessHoursDecision } from "@/lib/inbox/business-hours"
import { languageRuleFor } from "@/lib/inbox/agent-instruction"

export const INBOX_AGENT_TYPE = "inbox"
export const INBOX_PAGE_AGENT_TYPE = "inbox_page"

/** When the AI answers on a page, against that page's working hours. */
export const AI_SCHEDULES = ["always", "inside_hours", "outside_hours"] as const
export type AiSchedule = (typeof AI_SCHEDULES)[number]

export function readAiSchedule(settings: unknown): AiSchedule {
  const value = settings && typeof settings === "object" ? (settings as Record<string, unknown>).aiSchedule : null
  return (AI_SCHEDULES as readonly string[]).includes(value as string) ? (value as AiSchedule) : "always"
}

/** Whether the AI may take this turn. Hours nobody configured count as open (`evaluateBusinessHours`). */
export function aiScheduleAllows(schedule: AiSchedule, open: boolean): boolean {
  if (schedule === "inside_hours") return open
  if (schedule === "outside_hours") return !open
  return true
}

/** The fields of an agent that a page may have of its own. */
export const PAGE_AGENT_PERSONA_FIELDS = [
  "systemPrompt", "knowledgeBase", "greeting", "replyLanguage", "model", "temperature", "maxTokens", "escalationEnabled",
] as const

type AgentRow = NonNullable<Awaited<ReturnType<typeof prisma.aiAgentConfig.findFirst>>>

/**
 * The agent that answers this conversation: the page's own, else the organisation's common one,
 * else null (built-in defaults — exactly what the engine did before either existed).
 *
 * A page agent carries the common agent's autonomous switches, so creating one for a page never
 * silently turns lead creation off (or on) there.
 */
export async function resolveInboxAgent(params: {
  organizationId: string
  channelConfigId?: string | null
  conversationId?: string | null
}): Promise<(AgentRow & { pageAgent: boolean }) | null> {
  const { organizationId } = params
  const common = await prisma.aiAgentConfig
    .findFirst({ where: { organizationId, agentType: INBOX_AGENT_TYPE, isActive: true }, orderBy: { priority: "desc" } })
    .catch(() => null)

  let channelConfigId = params.channelConfigId ?? null
  if (!channelConfigId && params.conversationId) {
    const conversation = await prisma.socialConversation
      .findFirst({ where: { id: params.conversationId, organizationId }, select: { channelConfigId: true } })
      .catch(() => null)
    channelConfigId = conversation?.channelConfigId ?? null
  }
  const page = await findPageAgent(organizationId, channelConfigId)

  if (!page) return common ? { ...common, pageAgent: false } : null
  return {
    ...page,
    autoLeadEnabled: common?.autoLeadEnabled ?? false,
    autoAssignSales: common?.autoAssignSales ?? true,
    autonomousBacklogEnabled: common?.autonomousBacklogEnabled ?? false,
    autonomousLookbackDays: common?.autonomousLookbackDays ?? page.autonomousLookbackDays,
    autonomousBatchSize: common?.autonomousBatchSize ?? page.autonomousBatchSize,
    pageAgent: true,
  }
}

/** The page's own agent row, or null. Fail-soft: a failed read means "no page agent". */
export async function findPageAgent(organizationId: string, channelConfigId: string | null | undefined): Promise<AgentRow | null> {
  if (!channelConfigId) return null
  try {
    return await prisma.aiAgentConfig.findFirst({ where: { organizationId, agentType: INBOX_PAGE_AGENT_TYPE, channelConfigId } })
  } catch {
    return null
  }
}

/**
 * Whether the AI may take a turn on this page right now, by the page's own «когда отвечает ИИ»
 * against the page's own working hours. One question for every channel — the inbox engine and the
 * WhatsApp webhook both ask it here.
 */
export async function pageAiScheduleAllowsNow(params: {
  organizationId: string
  channelType: string
  channelConfigId?: string | null
  settings: unknown
  now?: Date
}): Promise<boolean> {
  const schedule = readAiSchedule(params.settings)
  if (schedule === "always") return true
  const hours = await getBusinessHoursDecision({
    organizationId: params.organizationId,
    channelType: params.channelType,
    channelConfigId: params.channelConfigId,
    now: params.now,
  })
  return aiScheduleAllows(schedule, hours.open)
}

/**
 * A WhatsApp number's turn.
 *
 * WhatsApp is answered live by Da Vinci, the support assistant — it files tickets, reads
 * contracts and hands booking requests on — not by the inbox engine. So a number does not swap
 * assistants when it gets a page agent: Da Vinci keeps its abilities and its base prompt, and the
 * page's words take the place of the organisation-wide «дополнительные инструкции» of the support
 * agent. Without a page agent the number gets exactly what it got before.
 *
 * `instructions` is appended to Da Vinci's base prompt BEFORE the customer context, so the
 * page's knowledge counts as the company's own facts for the price rule (lib/ai/offer-grounding).
 */
export async function whatsAppPageTurn(params: {
  organizationId: string
  channelConfigId?: string | null
  channelSettings: unknown
  /** The support agent's own extra instructions — used when the number has no page agent. */
  supportPrompt?: string | null
  now?: Date
}): Promise<{ allowed: boolean; instructions: string; pageAgent: boolean }> {
  const allowed = await pageAiScheduleAllowsNow({
    organizationId: params.organizationId,
    channelType: "whatsapp",
    channelConfigId: params.channelConfigId,
    settings: params.channelSettings,
    now: params.now,
  })
  const page = allowed ? await findPageAgent(params.organizationId, params.channelConfigId) : null
  if (!page) {
    const support = params.supportPrompt?.trim()
    return { allowed, pageAgent: false, instructions: support ? `\n\nДОПОЛНИТЕЛЬНЫЕ ИНСТРУКЦИИ:\n${support}` : "" }
  }
  const parts: string[] = []
  if (page.systemPrompt?.trim()) parts.push(`ДОПОЛНИТЕЛЬНЫЕ ИНСТРУКЦИИ:\n${page.systemPrompt.trim()}`)
  if (page.knowledgeBase?.trim()) parts.push(`ФАКТЫ КОМПАНИИ (утверждены компанией; цены и условия называй только отсюда):\n${page.knowledgeBase.trim()}`)
  if (page.greeting?.trim()) parts.push(`ПРИВЕТСТВИЕ (используй ТОЛЬКО в самом первом ответе нового диалога): ${page.greeting.trim()}`)
  const language = languageRuleFor(page.replyLanguage).trim()
  if (language) parts.push(language)
  return { allowed, pageAgent: true, instructions: parts.length ? `\n\n${parts.join("\n\n")}` : "" }
}
