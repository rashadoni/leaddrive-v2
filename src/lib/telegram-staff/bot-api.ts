/**
 * The few Telegram Bot API calls the employees' bot needs. The token is an
 * argument: it is the organization's own bot (owner 2026-10-25), never one
 * from the environment.
 */
const API = "https://api.telegram.org"
const TIMEOUT_MS = 15_000

export class TelegramApiError extends Error {
  constructor(message: string, readonly code: number | "network") {
    super(message)
    this.name = "TelegramApiError"
  }
}

async function call<T>(token: string, method: string, body: Record<string, unknown>): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    })
  } catch (error) {
    throw new TelegramApiError(error instanceof Error ? error.message : "Telegram is unreachable", "network")
  }
  const json = (await response.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string; error_code?: number } | null
  if (!json?.ok) throw new TelegramApiError(json?.description || `HTTP ${response.status}`, json?.error_code ?? response.status)
  return json.result as T
}

export interface TelegramBotIdentity { id: number; username: string }

export async function getMe(token: string): Promise<TelegramBotIdentity> {
  const me = await call<{ id: number; username?: string; is_bot?: boolean }>(token, "getMe", {})
  if (!me.is_bot || !me.username) throw new TelegramApiError("Not a bot token", 400)
  return { id: me.id, username: me.username }
}

export function setWebhook(token: string, url: string, secret: string) {
  return call<boolean>(token, "setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  })
}

export function deleteWebhook(token: string) {
  return call<boolean>(token, "deleteWebhook", { drop_pending_updates: true })
}

export type InlineButton = { text: string; callback_data?: string; url?: string }

export function sendMessage(token: string, chatId: string, text: string, buttons?: InlineButton[][]) {
  return call<{ message_id: number }>(token, "sendMessage", {
    chat_id: chatId,
    text: text.slice(0, 4000),
    link_preview_options: { is_disabled: true },
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  })
}

export function editMessageText(token: string, chatId: string, messageId: number, text: string, buttons?: InlineButton[][]) {
  return call<unknown>(token, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: text.slice(0, 4000),
    link_preview_options: { is_disabled: true },
    reply_markup: { inline_keyboard: buttons ?? [] },
  })
}

export function answerCallbackQuery(token: string, callbackQueryId: string, text?: string) {
  return call<boolean>(token, "answerCallbackQuery", { callback_query_id: callbackQueryId, ...(text ? { text: text.slice(0, 190) } : {}) })
}

export function sendChatAction(token: string, chatId: string) {
  return call<boolean>(token, "sendChatAction", { chat_id: chatId, action: "typing" })
}
