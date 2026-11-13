/**
 * Reading and saving what the «ИИ-агент» screen shows per page: the page's own agent, whether the
 * AI answers there, when, and the page's own working hours. The engine side is
 * lib/inbox/page-agent (which agent answers) and lib/inbox/business-hours (which hours apply).
 */
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import {
  DEFAULT_BUSINESS_HOURS_SCHEDULE,
  isValidTimeZone,
  normalizeBusinessHoursSchedule,
  pageBusinessHoursKey,
} from "@/lib/inbox/business-hours"
import {
  AI_SCHEDULES,
  INBOX_AGENT_TYPE,
  INBOX_PAGE_AGENT_TYPE,
  readAiSchedule,
  type AiSchedule,
} from "@/lib/inbox/page-agent"

/**
 * The channels whose automatic replies are written by the inbox agent. WhatsApp is not here on
 * purpose: its AI is a different agent with its own screen, and a page agent saved for a WhatsApp
 * number would be a setting nothing reads.
 */
export const PAGE_AGENT_CHANNEL_TYPES = ["instagram", "facebook", "telegram", "vkontakte", "chatwoot"] as const

export type PageAgentFields = {
  systemPrompt: string
  knowledgeBase: string
  greeting: string
  replyLanguage: "az" | "ru" | "en" | null
}

export type PageHours = { timezone: string; schedule: ReturnType<typeof normalizeBusinessHoursSchedule> }

export type PageAgentRow = {
  channelConfigId: string
  channelType: string
  name: string
  isActive: boolean
  aiOn: boolean
  aiSchedule: AiSchedule
  agent: PageAgentFields | null
  hours: PageHours | null
}

function agentFields(row: { systemPrompt: string | null; knowledgeBase: string | null; greeting: string | null; replyLanguage: string | null }): PageAgentFields {
  const language = row.replyLanguage
  return {
    systemPrompt: row.systemPrompt ?? "",
    knowledgeBase: row.knowledgeBase ?? "",
    greeting: row.greeting ?? "",
    replyLanguage: language === "az" || language === "ru" || language === "en" ? language : null,
  }
}

function replyModeOf(settings: unknown): string {
  const mode = settings && typeof settings === "object" ? (settings as Record<string, unknown>).replyMode : null
  return typeof mode === "string" ? mode : "agent"
}

export async function listPageAgents(organizationId: string): Promise<{
  pages: PageAgentRow[]
  /** What a new page agent starts from, and the hours a page without its own follows. */
  commonAgent: PageAgentFields | null
  defaultTimezone: string
}> {
  const [channels, agents, hours, common] = await Promise.all([
    prisma.channelConfig.findMany({
      where: { organizationId, channelType: { in: [...PAGE_AGENT_CHANNEL_TYPES] } },
      select: { id: true, channelType: true, configName: true, isActive: true, settings: true },
      orderBy: [{ channelType: "asc" }, { createdAt: "asc" }],
    }),
    prisma.aiAgentConfig.findMany({ where: { organizationId, agentType: INBOX_PAGE_AGENT_TYPE } }),
    prisma.businessHours.findMany({ where: { organizationId } }),
    prisma.aiAgentConfig.findFirst({ where: { organizationId, agentType: INBOX_AGENT_TYPE }, orderBy: { priority: "desc" } }),
  ])
  type Hours = { channelType: string; timezone: string; schedule: unknown }
  const hoursByKey = new Map<string, Hours>((hours as Hours[]).map((row) => [row.channelType, row]))
  const agentByPage = new Map<string, (typeof agents)[number]>()
  for (const agent of agents) if (agent.channelConfigId) agentByPage.set(agent.channelConfigId, agent)

  const pages = channels.map((channel: { id: string; channelType: string; configName: string; isActive: boolean; settings: unknown }) => {
    const own = agentByPage.get(channel.id)
    const ownHours = hoursByKey.get(pageBusinessHoursKey(channel.id))
    return {
      channelConfigId: channel.id,
      channelType: channel.channelType,
      name: channel.configName,
      isActive: channel.isActive,
      aiOn: replyModeOf(channel.settings) === "ai",
      aiSchedule: readAiSchedule(channel.settings),
      agent: own ? agentFields(own) : null,
      hours: ownHours
        ? { timezone: ownHours.timezone, schedule: normalizeBusinessHoursSchedule(ownHours.schedule) }
        : null,
    }
  })
  return {
    pages,
    commonAgent: common ? agentFields(common) : null,
    defaultTimezone: hoursByKey.get("all")?.timezone ?? "Asia/Baku",
  }
}

export type PageAgentUpdate = {
  /** The page's own agent; `null` removes it (the common agent answers again). */
  agent?: PageAgentFields | null
  aiOn?: boolean
  aiSchedule?: AiSchedule
  /** The page's own hours; `null` removes them (the platform's hours apply again). */
  hours?: { timezone: string; schedule: unknown } | null
}

export type PageAgentUpdateResult = { ok: true } | { ok: false; status: number; error: string }

export async function updatePageAgent(params: {
  organizationId: string
  channelConfigId: string
  userId: string | null
  update: PageAgentUpdate
}): Promise<PageAgentUpdateResult> {
  const { organizationId, channelConfigId, update } = params
  const channel = await prisma.channelConfig.findFirst({
    where: { id: channelConfigId, organizationId, channelType: { in: [...PAGE_AGENT_CHANNEL_TYPES] } },
    select: { id: true, configName: true, settings: true },
  })
  // Another organisation's page, a page of a kind the inbox agent does not answer, or none at all.
  if (!channel) return { ok: false, status: 404, error: "Page not found" }
  if (update.aiSchedule && !(AI_SCHEDULES as readonly string[]).includes(update.aiSchedule)) {
    return { ok: false, status: 400, error: "Unsupported schedule" }
  }
  if (update.hours && !isValidTimeZone(update.hours.timezone)) {
    return { ok: false, status: 400, error: "Unknown time zone" }
  }

  if (update.agent !== undefined) {
    const existing = await prisma.aiAgentConfig.findFirst({
      where: { organizationId, agentType: INBOX_PAGE_AGENT_TYPE, channelConfigId },
      select: { id: true },
    })
    if (update.agent === null) {
      if (existing) await prisma.aiAgentConfig.deleteMany({ where: { id: existing.id, organizationId } })
    } else {
      const fields = {
        systemPrompt: update.agent.systemPrompt.trim() || null,
        knowledgeBase: update.agent.knowledgeBase.trim() || null,
        greeting: update.agent.greeting.trim() || null,
        replyLanguage: update.agent.replyLanguage,
      }
      if (existing) {
        await prisma.aiAgentConfig.updateMany({ where: { id: existing.id, organizationId }, data: fields })
      } else {
        // Model, temperature and escalation start as the common agent's, so a page that only
        // changes its words does not also change how the answers are produced.
        const common = await prisma.aiAgentConfig.findFirst({
          where: { organizationId, agentType: INBOX_AGENT_TYPE },
          orderBy: { priority: "desc" },
          select: { model: true, temperature: true, maxTokens: true, escalationEnabled: true },
        })
        try {
          await prisma.aiAgentConfig.create({
            data: {
              organizationId,
              agentType: INBOX_PAGE_AGENT_TYPE,
              channelConfigId,
              configName: `Page: ${channel.configName}`.slice(0, 255),
              isActive: true,
              ...(common
                ? { model: common.model, temperature: common.temperature, maxTokens: common.maxTokens, escalationEnabled: common.escalationEnabled }
                : {}),
              ...fields,
            },
          })
        } catch (error) {
          // Two saves at once: the partial unique index kept one row; write our fields into it.
          if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error
          await prisma.aiAgentConfig.updateMany({
            where: { organizationId, agentType: INBOX_PAGE_AGENT_TYPE, channelConfigId },
            data: fields,
          })
        }
      }
    }
  }

  if (update.aiOn !== undefined || update.aiSchedule !== undefined) {
    // MERGE into the channel's settings: the same blob holds the page's tokens and ids.
    const current = (channel.settings && typeof channel.settings === "object" ? channel.settings : {}) as Record<string, unknown>
    const next: Record<string, unknown> = { ...current }
    if (update.aiOn !== undefined) next.replyMode = update.aiOn ? "ai" : "agent"
    if (update.aiSchedule !== undefined) next.aiSchedule = update.aiSchedule
    await prisma.channelConfig.updateMany({
      where: { id: channel.id, organizationId },
      data: { settings: next as Prisma.InputJsonValue },
    })
  }

  if (update.hours !== undefined) {
    const key = pageBusinessHoursKey(channelConfigId)
    if (update.hours === null) {
      await prisma.businessHours.deleteMany({ where: { organizationId, channelType: key } })
    } else {
      const schedule = normalizeBusinessHoursSchedule(update.hours.schedule ?? DEFAULT_BUSINESS_HOURS_SCHEDULE)
      await prisma.businessHours.upsert({
        where: { organizationId_channelType: { organizationId, channelType: key } },
        create: {
          organizationId, channelType: key, timezone: update.hours.timezone,
          schedule: schedule as Prisma.InputJsonValue, isActive: true, createdBy: params.userId,
        },
        update: { timezone: update.hours.timezone, schedule: schedule as Prisma.InputJsonValue, isActive: true },
      })
    }
  }
  return { ok: true }
}
