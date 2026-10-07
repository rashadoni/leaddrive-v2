/**
 * Finance notification settings — the shape kept under
 * `Organization.settings.financeNotifications`, shared by the settings API, the
 * notifier and the nightly deadline job.
 *
 * Telegram goes through the organization's OWN bot into the organization's OWN
 * chat, both stored here. There is deliberately no installation-wide fallback.
 * Until 2026-10-07 the notifier read one `TELEGRAM_FINANCE_CHAT_ID` for the
 * whole installation, so every tenant's counterparties and amounts were
 * addressed to whoever sat in that one chat. An organization that has not
 * configured a bot and a chat sends nothing to Telegram.
 *
 * No server imports: the settings page reads its defaults from here too.
 */

export interface FinanceNotifCategory {
  enabled: boolean
  channels: string[]
}

export interface FinanceNotifSettings {
  recipientEmail: string
  telegramBotToken: string
  telegramChatId: string
  overdue: FinanceNotifCategory
  advance: FinanceNotifCategory & { daysBeforeDeadline: number }
  paymentOrders: FinanceNotifCategory
  billPayments: FinanceNotifCategory
}

/** What the browser gets: the token never leaves the server once saved. */
export type ExposedFinanceNotifSettings = FinanceNotifSettings & {
  telegramBotTokenConfigured: boolean
}

export interface FinanceTelegramTarget {
  botToken: string
  chatId: string
}

export const FINANCE_NOTIF_DEFAULTS: FinanceNotifSettings = {
  recipientEmail: "",
  telegramBotToken: "",
  telegramChatId: "",
  overdue: { enabled: true, channels: ["telegram"] },
  advance: { enabled: true, channels: ["telegram"], daysBeforeDeadline: 7 },
  paymentOrders: { enabled: true, channels: ["telegram"] },
  billPayments: { enabled: true, channels: ["telegram"] },
}

/**
 * Sent to the browser in place of a saved token. Submitting it back means
 * "keep the saved one"; any other value, including an empty one, replaces it.
 */
export const TELEGRAM_BOT_TOKEN_MASK = "••••••••"

// `<bot id>:<secret>` as BotFather issues it. The token is placed in a URL
// path, so nothing that could change the path is let through.
const TELEGRAM_BOT_TOKEN_PATTERN = /^\d{5,20}:[A-Za-z0-9_-]{20,100}$/
// A numeric chat id (groups are negative) or a public channel's @username.
const TELEGRAM_CHAT_ID_PATTERN = /^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{3,63})$/

export function isTelegramBotToken(value: string): boolean {
  return TELEGRAM_BOT_TOKEN_PATTERN.test(value)
}

export function isTelegramChatId(value: string): boolean {
  return TELEGRAM_CHAT_ID_PATTERN.test(value)
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function readCategory<T extends FinanceNotifCategory>(saved: unknown, fallback: T): T {
  if (!isRecord(saved)) return fallback
  return {
    ...fallback,
    enabled: typeof saved.enabled === "boolean" ? saved.enabled : fallback.enabled,
    channels: Array.isArray(saved.channels)
      ? saved.channels.filter((channel): channel is string => typeof channel === "string")
      : fallback.channels,
  }
}

/**
 * The organization's finance notification settings out of `Organization.settings`.
 *
 * Total: whatever the JSON column holds, the result has every field in its
 * type. The nightly job reads this for every organization in one loop, and one
 * malformed row must not stop the organizations after it.
 */
export function readFinanceNotifSettings(orgSettings: unknown): FinanceNotifSettings {
  const saved = isRecord(orgSettings) ? orgSettings.financeNotifications : undefined
  if (!isRecord(saved)) return FINANCE_NOTIF_DEFAULTS
  const advance = readCategory(saved.advance, FINANCE_NOTIF_DEFAULTS.advance)
  const days = isRecord(saved.advance) ? saved.advance.daysBeforeDeadline : undefined
  return {
    recipientEmail: asString(saved.recipientEmail),
    telegramBotToken: asString(saved.telegramBotToken),
    telegramChatId: asString(saved.telegramChatId),
    overdue: readCategory(saved.overdue, FINANCE_NOTIF_DEFAULTS.overdue),
    advance: { ...advance, daysBeforeDeadline: typeof days === "number" && days >= 1 ? days : advance.daysBeforeDeadline },
    paymentOrders: readCategory(saved.paymentOrders, FINANCE_NOTIF_DEFAULTS.paymentOrders),
    billPayments: readCategory(saved.billPayments, FINANCE_NOTIF_DEFAULTS.billPayments),
  }
}

/**
 * Where this organization's Telegram notices go, or null when it has not
 * configured both a bot and a chat. Null means "send nothing" — never "use a
 * shared chat".
 */
export function financeTelegramTarget(settings: FinanceNotifSettings): FinanceTelegramTarget | null {
  const { telegramBotToken: botToken, telegramChatId: chatId } = settings
  if (!isTelegramBotToken(botToken) || !isTelegramChatId(chatId)) return null
  return { botToken, chatId }
}

export function exposeFinanceNotifSettings(settings: FinanceNotifSettings): ExposedFinanceNotifSettings {
  const configured = settings.telegramBotToken.length > 0
  return {
    ...settings,
    telegramBotToken: configured ? TELEGRAM_BOT_TOKEN_MASK : "",
    telegramBotTokenConfigured: configured,
  }
}
