import type { PrismaClient } from "@prisma/client"
import { getBusinessHoursDecision } from "@/lib/inbox/business-hours"
import { sendChannelReply } from "@/lib/chatbot-autoreply"
import { chatwootSourceStillUnanswered } from "@/lib/inbox/chatwoot-source-guard"
import { maybeAiAutoReply, selectUncoveredAiInboundBatch } from "@/lib/social/ai-autoreply"

const AI_FEATURE = "aiAutoReply"
const PROVIDER_WINDOW_MS = 23 * 60 * 60 * 1000
const PROVIDER_WINDOW_CHANNELS = new Set(["facebook", "instagram", "whatsapp"])
const SUPPORTED_CHANNELS = new Set([
  "tiktok",
  "facebook",
  "instagram",
  "telegram",
  "vkontakte",
  "whatsapp",
])

type Db = Pick<
  PrismaClient,
  "aiAgentConfig" | "organization" | "channelConfig" | "socialConversation" | "channelMessage"
>

const STALE_AI_SEND_ATTEMPT_MS = 3 * 60 * 1000

type AutonomousReplyInput = {
  orgId: string
  channelConfigId: string
  platform: string
  conversationId: string
  pageId: string
  externalId: string
  userMessage: string
  senderName: string
  contactId?: string | null
  inboundMessageId?: string
  inboundMessageIds?: string[]
  preSend?: () => Promise<boolean>
  origin: "backlog"
  send: (text: string) => Promise<boolean | "unknown">
}

type AutonomousReply = (
  input: AutonomousReplyInput,
) => Promise<{ replied: boolean; escalated: boolean; skipped?: string }>

export type AutonomousAgentRunResult = {
  organizations: number
  candidates: number
  replied: number
  escalated: number
  skipped: Record<string, number>
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function replyMode(settings: unknown, channelType: string): string {
  const configured = asRecord(settings).replyMode
  if (typeof configured === "string") return configured
  // Match the existing routing contract: WhatsApp historically defaults to AI;
  // every other channel must be explicitly switched to AI.
  return channelType === "whatsapp" ? "ai" : "agent"
}

function effectivePlatform(conversationPlatform: string, channelType: string): string {
  if (conversationPlatform === "tiktok" || channelType === "chatwoot") return "tiktok"
  return conversationPlatform || channelType
}

function increment(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1
}

/**
 * Sequential, bounded backlog sweep for the autonomous Inbox agent.
 *
 * Safety invariants:
 * - opt-in at agent, organization and channel levels;
 * - only open, non-snoozed conversations where the latest persisted message is
 *   a real inbound customer message;
 * - provider 24-hour windows are respected for Meta/WhatsApp;
 * - business hours are respected;
 * - maybeAiAutoReply retains the atomic reply lease, rollout, budgets, quality
 *   gate, per-contact caps and escalation behavior;
 * - processing is deliberately sequential so a backlog cannot create an API
 *   or memory spike.
 */
export async function runAutonomousInboxAgent(
  db: Db,
  options: {
    now: Date
    reply?: AutonomousReply
    businessOpen?: (input: {
      organizationId: string
      channelType: string
      now: Date
    }) => Promise<boolean>
  },
): Promise<AutonomousAgentRunResult> {
  const reply = options.reply ?? maybeAiAutoReply
  const businessOpen = options.businessOpen ?? (async (input) => {
    const decision = await getBusinessHoursDecision(input)
    return decision.open
  })
  const result: AutonomousAgentRunResult = {
    organizations: 0,
    candidates: 0,
    replied: 0,
    escalated: 0,
    skipped: {},
  }

  const configuredAgents = await db.aiAgentConfig.findMany({
    where: {
      agentType: "inbox",
      isActive: true,
    },
    orderBy: [{ organizationId: "asc" }, { priority: "desc" }],
    select: {
      organizationId: true,
      autonomousLookbackDays: true,
      autonomousBatchSize: true,
      autonomousBacklogEnabled: true,
    },
  })
  const agents = new Map<string, typeof configuredAgents[number]>()
  for (const config of configuredAgents) {
    if (!agents.has(config.organizationId)) agents.set(config.organizationId, config)
  }
  if (agents.size === 0) return result

  const organizations = await db.organization.findMany({
    where: { id: { in: [...agents.keys()] }, isActive: true },
    select: { id: true, features: true },
  })

  for (const organization of organizations) {
    if (!Array.isArray(organization.features) || !organization.features.includes(AI_FEATURE)) {
      increment(result.skipped, "feature-off")
      continue
    }
    const agent = agents.get(organization.id)
    if (!agent) continue

    const channelConfigs = await db.channelConfig.findMany({
      where: { organizationId: organization.id, isActive: true },
      select: {
        id: true,
        channelType: true,
        pageId: true,
        settings: true,
      },
    })
    const aiChannels = channelConfigs.filter((config) => {
      const platform = effectivePlatform("", config.channelType)
      return SUPPORTED_CHANNELS.has(platform) && replyMode(config.settings, platform) === "ai"
    })
    if (aiChannels.length === 0) {
      increment(result.skipped, "no-ai-channels")
      continue
    }

    result.organizations++
    const batchSize = Math.max(1, Math.min(100, agent.autonomousBatchSize || 20))
    const lookbackDays = Math.max(1, Math.min(30, agent.autonomousLookbackDays || 7))
    const floor = new Date(options.now.getTime() - lookbackDays * 24 * 60 * 60 * 1000)
    // Scan beyond the send batch because already-answered conversations can
    // legitimately sit between unanswered ones. Actual AI/send work remains
    // bounded by batchSize and is processed sequentially.
    const scanSize = Math.min(1000, Math.max(100, batchSize * 10))
    const recoveryScopes: Array<Record<string, unknown>> = [
      { aiReplyPendingMessageId: { not: null } },
    ]
    if (agent.autonomousBacklogEnabled) {
      recoveryScopes.push({ lastMessageAt: { gte: floor, lte: options.now } })
    }
    const candidates = await db.socialConversation.findMany({
      where: {
        organizationId: organization.id,
        channelConfigId: { in: aiChannels.map((config) => config.id) },
        status: "open",
        assignedTo: null,
        AND: [
          { OR: recoveryScopes },
          { OR: [{ snoozedUntil: null }, { snoozedUntil: { lt: options.now } }] },
        ],
      },
      orderBy: { lastMessageAt: "asc" },
      take: scanSize,
      select: {
        id: true,
        channelConfigId: true,
        platform: true,
        externalId: true,
        contactId: true,
        contactName: true,
        tags: true,
        lastMessageAt: true,
        aiReplyPendingMessageId: true,
        messages: {
          orderBy: { createdAt: "desc" },
          take: 500,
          select: {
            id: true,
            direction: true,
            body: true,
            status: true,
            createdAt: true,
            metadata: true,
          },
        },
      },
    })

    let eligible = 0
    for (const conversation of candidates) {
      result.candidates++
      const config = aiChannels.find((item) => item.id === conversation.channelConfigId)
      const pending = Boolean(conversation.aiReplyPendingMessageId)
      const staleAttempts = conversation.messages.filter((message) => {
        const metadata = asRecord(message.metadata)
        return message.direction === "outbound"
          && message.status === "pending"
          && metadata.deliveryAttempted === true
          && options.now.getTime() - message.createdAt.getTime() >= STALE_AI_SEND_ATTEMPT_MS
      })
      for (const attempt of staleAttempts) {
        await db.channelMessage.update({
          where: { id: attempt.id },
          data: {
            status: "failed",
            metadata: {
              ...asRecord(attempt.metadata),
              aiAutoReply: true,
              deliveryUnknown: true,
              recoveryReason: "stale_send_attempt",
            },
          },
        })
      }
      const batch = selectUncoveredAiInboundBatch(conversation.messages)
      const last = batch.at(-1)
      if (pending && batch.length === 0) {
        if (staleAttempts.length) {
          increment(result.skipped, "delivery-unknown")
        } else {
          const activeAttempt = conversation.messages.some((message) => {
            const metadata = asRecord(message.metadata)
            return message.direction === "outbound"
              && message.status === "pending"
              && metadata.deliveryAttempted === true
          })
          if (activeAttempt) {
            increment(result.skipped, "reply-in-flight")
            continue
          }
          increment(result.skipped, "already-answered")
        }
        await db.socialConversation.updateMany({
          where: {
            id: conversation.id,
            organizationId: organization.id,
            aiReplyPendingMessageId: { not: null },
          },
          data: { aiReplyPendingMessageId: null },
        })
        continue
      }
      if (!config || !last || batch.length === 0 || (!pending && !agent.autonomousBacklogEnabled)) {
        increment(result.skipped, "not-unanswered")
        continue
      }
      if (conversation.tags.some((tag) => tag.trim().toLowerCase() === "spam")) {
        increment(result.skipped, "spam")
        continue
      }

      const platform = effectivePlatform(conversation.platform, config.channelType)
      if (
        PROVIDER_WINDOW_CHANNELS.has(platform)
        && options.now.getTime() - last.createdAt.getTime() > PROVIDER_WINDOW_MS
      ) {
        increment(result.skipped, "provider-window-expired")
        continue
      }
      // A pending marker represents a live webhook turn that was already
      // accepted during its normal channel window. Recover it regardless of
      // the optional backlog schedule; ordinary backlog still respects hours.
      if (!pending && !await businessOpen({
        organizationId: organization.id,
        channelType: platform,
        now: options.now,
      })) {
        increment(result.skipped, "outside-business-hours")
        continue
      }
      if (eligible >= batchSize) break
      eligible++

      const preSend = pending && platform === "tiktok"
        ? () => chatwootSourceStillUnanswered({
            organizationId: organization.id,
            channelConfigId: config.id,
            channelSettings: config.settings,
            chatwootConversationId: conversation.externalId,
            chatwootInboxId: asRecord(last.metadata).chatwootInboxId,
            inboundProviderMessageIds: batch.map(
              (message) => asRecord(message.metadata).chatwootProviderMessageId,
            ),
            db,
          })
        : undefined

      const outcome = await reply({
        orgId: organization.id,
        channelConfigId: config.id,
        platform,
        conversationId: conversation.id,
        pageId: config.pageId || platform,
        externalId: conversation.externalId,
        userMessage: batch.map((message) => message.body.trim()).join("\n\n"),
        senderName: conversation.contactName || conversation.externalId,
        contactId: conversation.contactId,
        inboundMessageId: last.id,
        inboundMessageIds: batch.map((message) => message.id),
        ...(preSend ? { preSend } : {}),
        origin: "backlog",
        send: async (text) => {
          const sent = await sendChannelReply({
            orgId: organization.id,
            channelType: platform,
            to: conversation.externalId,
            text,
            contactId: conversation.contactId,
            channelConfigId: config.id,
          })
          return sent.ok ? true : sent.deliveryUnknown ? "unknown" : false
        },
      }).catch((error: unknown) => {
        console.error(
          "[autonomous-inbox-agent] conversation failed",
          conversation.id,
          error instanceof Error ? error.message : error,
        )
        return { replied: false, escalated: false, skipped: "error" }
      })

      if (outcome.replied) result.replied++
      if (outcome.escalated) result.escalated++
      if (outcome.skipped) increment(result.skipped, outcome.skipped)
    }
  }

  return result
}
