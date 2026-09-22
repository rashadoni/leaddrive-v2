import { prisma } from "@/lib/prisma"
import { inDemoSalesOrganization } from "./sales-org"

/**
 * The Telegram bot a demo prospect proves their phone with: the sales
 * organisation's own inbox bot (LeadDrive Inc.'s, owner decision 2026-09-22 —
 * no second bot, no new secret). Its webhook already reaches this server;
 * src/lib/demo-center/phone-telegram.ts takes the demo's updates out of it
 * before the inbox sees them.
 *
 * Null when the sales organisation has no active bot, or Telegram does not
 * confirm the token: then the demo offers the SMS code only, as before.
 */
export interface DemoTelegramBot {
  readonly channelConfigId: string
  readonly organizationId: string
  readonly botToken: string
  readonly username: string
}

export const TELEGRAM_API_BASE = "https://api.telegram.org"
const USERNAME_TTL_MS = 60 * 60_000
/** A failed lookup is retried soon: one Telegram hiccup must not hide the option for an hour. */
const FAILURE_TTL_MS = 60_000
const usernames = new Map<string, { username: string | null; until: number }>()

export async function demoTelegramBot(now = Date.now()): Promise<DemoTelegramBot | null> {
  const entered = await inDemoSalesOrganization((organizationId) =>
    prisma.channelConfig.findFirst({
      where: { organizationId, channelType: "telegram", isActive: true, botToken: { not: null } },
      orderBy: { createdAt: "asc" },
      select: { id: true, organizationId: true, botToken: true },
    }),
  )
  const channel = entered?.value
  if (!channel?.botToken) return null
  const username = await botUsername(channel.botToken, now)
  if (!username) return null
  return { channelConfigId: channel.id, organizationId: channel.organizationId, botToken: channel.botToken, username }
}

/** The bot's @username from Telegram itself, cached per token. */
async function botUsername(botToken: string, now: number): Promise<string | null> {
  const cached = usernames.get(botToken)
  if (cached && now < cached.until) return cached.username
  let username: string | null = null
  try {
    const response = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/getMe`, { cache: "no-store", signal: AbortSignal.timeout(4_000) })
    const data = (await response.json()) as { ok?: boolean; result?: { username?: string } }
    username = data.ok && typeof data.result?.username === "string" && /^[A-Za-z0-9_]{5,32}$/.test(data.result.username) ? data.result.username : null
  } catch {
    username = null
  }
  usernames.set(botToken, { username, until: now + (username ? USERNAME_TTL_MS : FAILURE_TTL_MS) })
  return username
}

/** Test seam: forget cached usernames. */
export function resetDemoTelegramBotCache(): void {
  usernames.clear()
}
