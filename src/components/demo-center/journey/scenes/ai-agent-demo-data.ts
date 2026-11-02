import type { AiAgentKnowledgeArticle } from "@/components/settings/ai-agent-page-view"
import type { ChannelReplyRow, UiMode } from "@/components/settings/channel-reply-matrix-view"
import type { InboxAgent } from "@/components/settings/inbox-agent-editor-view"
import { LEADDRIVE_AGENT_PROFILE as P, LEADDRIVE_AGENT_PROMPT_WITH_STYLE } from "@/lib/demo-center/journey/leaddrive-agent-profile"

/**
 * What the demo's «AI agent» screen shows: LeadDrive's own agent, in the
 * product's own fields — the same prompt, style, knowledge base, model and
 * temperature its WhatsApp agent answers with
 * (src/lib/demo-center/demo-whatsapp-agent.ts).
 */

/** Telegram's reply mode, as the prospect set it — the first step completes on «ai_draft». */
export const AI_AGENT_REPLY_MODE_PATH = "agent.replyMode"

export const AI_AGENT_DEMO_AGENT: InboxAgent = {
  // The product's placeholders are another business's examples: every field
  // the screen shows is filled.
  systemPrompt: LEADDRIVE_AGENT_PROMPT_WITH_STYLE,
  knowledgeBase: P.knowledgeBase,
  greeting: P.greeting,
  // The style asks for the customer's language: «Müştəriyə görə».
  replyLanguage: "",
  model: P.model,
  temperature: P.temperature,
  escalationEnabled: true,
  // Autonomy creates leads and tasks in a live account: shown, off.
  autoLeadEnabled: false,
  autoAssignSales: true,
  autonomousBacklogEnabled: false,
  autonomousLookbackDays: 7,
  autonomousBatchSize: 20,
}

/** The articles written for LeadDrive, as the «Bilik mənbələri» card lists published ones. */
export const AI_AGENT_DEMO_ARTICLES: readonly AiAgentKnowledgeArticle[] = P.articles.map((article, index) => ({
  id: `leaddrive-kb-${index + 1}`,
  title: article.title,
  content: article.body,
  status: "published",
  updatedAt: "2026-10-18T09:00:00.000Z",
  category: null,
}))

/**
 * The channels the matrix lists. Telegram answers by the setting today, so it
 * is the one the prospect switches; e-mail and SMS store it and show
 * «tezliklə», as in the product. No WhatsApp row: the product's WhatsApp AI is
 * Da Vinci, not this persona — and no Instagram, Facebook or TikTok, which
 * this agent does not answer today.
 */
export function demoChannelRows(telegram: UiMode): ChannelReplyRow[] {
  return [
    {
      id: "demo-telegram",
      channelType: "telegram",
      configName: "LeadDrive satış botu",
      isActive: true,
      reply: { mode: telegram === "agent" ? "agent" : "ai", draftMode: telegram === "ai_draft", modeSource: "explicit" },
    },
    {
      id: "demo-email",
      channelType: "email",
      configName: "LeadDrive e-poçt qutusu",
      isActive: true,
      reply: { mode: "agent", modeSource: "explicit" },
    },
    {
      id: "demo-sms",
      channelType: "sms",
      configName: "SMS bildirişləri",
      isActive: true,
      reply: { mode: "agent", modeSource: "explicit" },
    },
  ]
}

export function isDemoUiMode(value: unknown): value is UiMode {
  return value === "agent" || value === "ai_draft" || value === "ai"
}
