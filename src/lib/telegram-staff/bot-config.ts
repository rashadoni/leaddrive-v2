/**
 * Connecting an organization's own Telegram bot for its employees: check the
 * token with Telegram, point the bot's webhook at us with a fresh secret, and
 * keep the token encrypted with the organization's key.
 *
 * A bot that already serves customer chats (a Telegram channel in the inbox)
 * is refused: Telegram gives one webhook per bot, so connecting it here would
 * silently take the customers' messages away from the inbox.
 */
import { createHash, randomBytes, timingSafeEqual } from "crypto"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { decryptForTenantBound, encryptForTenantBound } from "@/lib/crypto/tenant-pii-encryption"
import { APP_URL } from "@/lib/domains"
import { deleteWebhook, getMe, setWebhook, TelegramApiError } from "./bot-api"

const AAD_TABLE = "telegram_staff_bots"
const AAD_COLUMN = "tokenCiphertext"

export type ConnectRefusal = "INVALID_TOKEN" | "CUSTOMER_CHAT_BOT" | "BOT_IN_USE" | "UNREACHABLE"

export interface StaffBotView {
  connected: boolean
  botUsername: string | null
  linkedUsers: number
}

export const hashSecret = (secret: string) => createHash("sha256").update(secret, "utf8").digest("hex")

/** Whether the header Telegram sent is the secret given to it for this bot. */
export function secretMatches(header: string | null, storedHash: string): boolean {
  if (!header) return false
  const a = Buffer.from(hashSecret(header), "hex")
  const b = Buffer.from(storedHash, "hex")
  return a.length === b.length && timingSafeEqual(a, b)
}

export function webhookUrl(botRowId: string): string {
  return `${APP_URL.replace(/\/$/, "")}/api/v1/webhooks/telegram-staff/${botRowId}`
}

export function decryptBotToken(orgId: string, ciphertext: string): string {
  return decryptForTenantBound(orgId, AAD_TABLE, AAD_COLUMN, ciphertext)
}

export async function staffBotView(orgId: string): Promise<StaffBotView> {
  const bot = await prisma.telegramStaffBot.findFirst({ where: { organizationId: orgId, isActive: true }, select: { id: true, botUsername: true } })
  if (!bot) return { connected: false, botUsername: null, linkedUsers: 0 }
  const linkedUsers = await prisma.telegramStaffLink.count({ where: { organizationId: orgId, botId: bot.id } })
  return { connected: true, botUsername: bot.botUsername, linkedUsers }
}

export async function connectStaffBot(orgId: string, userId: string | null, rawToken: string): Promise<{ ok: true } | { ok: false; code: ConnectRefusal }> {
  const token = rawToken.trim()
  if (!/^\d{5,15}:[A-Za-z0-9_-]{30,}$/.test(token)) return { ok: false, code: "INVALID_TOKEN" }

  let identity: Awaited<ReturnType<typeof getMe>>
  try {
    identity = await getMe(token)
  } catch (error) {
    return { ok: false, code: error instanceof TelegramApiError && error.code === "network" ? "UNREACHABLE" : "INVALID_TOKEN" }
  }
  const telegramBotId = String(identity.id)

  const [customerChat, elsewhere] = await runWithRlsBypass(() => Promise.all([
    prisma.channelConfig.findFirst({ where: { channelType: "telegram", botToken: { startsWith: `${telegramBotId}:` } }, select: { id: true } }),
    prisma.telegramStaffBot.findFirst({ where: { telegramBotId, organizationId: { not: orgId } }, select: { id: true } }),
  ]))
  if (customerChat) return { ok: false, code: "CUSTOMER_CHAT_BOT" }
  if (elsewhere) return { ok: false, code: "BOT_IN_USE" }

  const existing = await prisma.telegramStaffBot.findFirst({ where: { organizationId: orgId }, select: { id: true, telegramBotId: true } })
  const rowId = existing?.id ?? `tgb_${randomBytes(12).toString("hex")}`
  const secret = randomBytes(32).toString("base64url")
  try {
    await setWebhook(token, webhookUrl(rowId), secret)
  } catch (error) {
    return { ok: false, code: error instanceof TelegramApiError && error.code === "network" ? "UNREACHABLE" : "INVALID_TOKEN" }
  }

  const data = {
    telegramBotId,
    botUsername: identity.username,
    tokenCiphertext: encryptForTenantBound(orgId, AAD_TABLE, AAD_COLUMN, token),
    webhookSecretHash: hashSecret(secret),
    isActive: true,
    lastUpdateId: BigInt(0),
    connectedById: userId,
  }
  // A different bot replacing the old one: links made with the old bot no longer reach anyone.
  if (existing && existing.telegramBotId !== telegramBotId) {
    await prisma.telegramStaffLink.deleteMany({ where: { organizationId: orgId, botId: existing.id } })
  }
  if (existing) await prisma.telegramStaffBot.update({ where: { id: existing.id }, data })
  else await prisma.telegramStaffBot.create({ data: { id: rowId, organizationId: orgId, ...data } })
  return { ok: true }
}

/** Turn the bot off: Telegram stops calling us, linked employees stay linked for a reconnect. */
export async function disconnectStaffBot(orgId: string): Promise<void> {
  const bot = await prisma.telegramStaffBot.findFirst({ where: { organizationId: orgId }, select: { id: true, tokenCiphertext: true } })
  if (!bot) return
  await deleteWebhook(decryptBotToken(orgId, bot.tokenCiphertext)).catch(() => undefined)
  await prisma.telegramStaffBot.update({ where: { id: bot.id }, data: { isActive: false } })
}
