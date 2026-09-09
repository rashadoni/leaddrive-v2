import { prisma } from "@/lib/prisma"

const TELEGRAM_API_BASE = process.env.TELEGRAM_API_BASE || "https://api.telegram.org"

export type TelegramParseMode = "HTML" | null

export type TelegramSendTargetResult =
  | { success: true; botToken: string; chatId: string; metadataChatId?: string }
  | { success: false; error: string }

export type TelegramTextSendResult =
  | { success: true; messageId?: string; chatId: string; metadataChatId?: string }
  | { success: false; error: string; chatId?: string; metadataChatId?: string }

function getSettingsChatId(settings: unknown): string | null {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null
  const chatId = (settings as { chatId?: unknown }).chatId
  if (typeof chatId === "string" && chatId) return chatId
  if (typeof chatId === "number") return String(chatId)
  return null
}

/**
 * Resolve the tenant Telegram bot + final chat target.
 *
 * Preserves the historical inbox behavior:
 * - numeric `to` is used directly as chat_id;
 * - non-numeric `to` falls back to ChannelConfig.settings.chatId when configured;
 * - otherwise the raw `to` value is sent to Telegram.
 */
export async function resolveTelegramSendTarget({
  organizationId,
  to,
  channelConfigId,
  preferExplicitTo = false,
}: {
  organizationId: string
  to: string
  channelConfigId?: string | null
  /** Campaign broadcasts may pass a real recipient handle; keep inbox fallback behavior by default. */
  preferExplicitTo?: boolean
}): Promise<TelegramSendTargetResult> {
  const channel = channelConfigId
    ? await prisma.channelConfig.findFirst({ where: { id: channelConfigId, organizationId, channelType: "telegram", isActive: true } })
    : await prisma.channelConfig.findFirst({ where: { organizationId, channelType: "telegram", isActive: true } })

  if (!channel?.botToken) return { success: false, error: "Telegram бот не настроен" }

  const settingsChatId = getSettingsChatId(channel.settings)
  const numericTo = /^-?\d+$/.test(to)
  const chatId = numericTo ? to : (preferExplicitTo ? to : (settingsChatId ?? to))
  if (!chatId) return { success: false, error: "Не указан Chat ID" }

  return {
    success: true,
    botToken: channel.botToken,
    chatId,
    metadataChatId: numericTo ? to : (preferExplicitTo ? undefined : (settingsChatId ?? undefined)),
  }
}

export async function sendTelegramText({
  organizationId,
  to,
  body,
  channelConfigId,
  parseMode,
  preferExplicitTo,
}: {
  organizationId: string
  to: string
  body: string
  channelConfigId?: string | null
  parseMode?: TelegramParseMode
  preferExplicitTo?: boolean
}): Promise<TelegramTextSendResult> {
  const target = await resolveTelegramSendTarget({ organizationId, to, channelConfigId, preferExplicitTo })
  if (!target.success) return target

  try {
    const payload: Record<string, unknown> = { chat_id: target.chatId, text: body }
    if (parseMode) payload.parse_mode = parseMode
    const response = await fetch(`${TELEGRAM_API_BASE}/bot${target.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    const data = (await response.json()) as {
      ok?: boolean
      description?: string
      result?: { message_id?: number | string }
    }

    if (!data.ok) {
      return {
        success: false,
        error: data.description || "Telegram error",
        chatId: target.chatId,
        metadataChatId: target.metadataChatId,
      }
    }

    return {
      success: true,
      messageId: data.result?.message_id ? String(data.result.message_id) : undefined,
      chatId: target.chatId,
      metadataChatId: target.metadataChatId,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Telegram error",
      chatId: target.chatId,
      metadataChatId: target.metadataChatId,
    }
  }
}
