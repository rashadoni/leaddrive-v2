/**
 * «Черновики в Telegram» — the channel switch (ChannelConfig.settings.telegramDrafts, set on the
 * «Кто отвечает» screen through api/v1/settings/channel-reply). Off unless set. No imports, so the
 * gate, the bot's notices and the settings route can all read it without pulling each other in.
 */
export const TELEGRAM_DRAFTS_KEY = "telegramDrafts"

export function telegramDraftsEnabled(settings: unknown): boolean {
  return Boolean(settings && typeof settings === "object" && (settings as Record<string, unknown>)[TELEGRAM_DRAFTS_KEY] === true)
}

/** The bell's title for a waiting draft — the employees' bot recognises it (telegram-staff/notify). */
export const AI_DRAFT_NOTICE_TITLE = "AI подготовил черновик ответа"
