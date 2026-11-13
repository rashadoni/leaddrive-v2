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
  const page = channelConfigId
    ? await prisma.aiAgentConfig
        .findFirst({ where: { organizationId, agentType: INBOX_PAGE_AGENT_TYPE, channelConfigId } })
        .catch(() => null)
    : null

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
