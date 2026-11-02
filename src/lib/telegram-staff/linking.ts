/**
 * Linking an employee's Telegram to the organization's bot: the profile issues
 * a one-time t.me/<bot>?start=<token> link (15 minutes, hash kept), and the
 * bot's /start with that token links whoever pressed «Start» in a private chat.
 * A Telegram account serves one employee per bot, an employee has one account.
 */
import { generateOneTimeToken, hashOneTimeToken } from "@/lib/one-time-token"
import { prisma } from "@/lib/prisma"

export const LINK_TOKEN_TTL_MS = 15 * 60_000

export async function issueLinkToken(orgId: string, userId: string, now = new Date()): Promise<{ url: string; expiresAt: Date } | null> {
  const bot = await prisma.telegramStaffBot.findFirst({ where: { organizationId: orgId, isActive: true }, select: { botUsername: true } })
  if (!bot) return null
  const { token, tokenHash } = generateOneTimeToken()
  const expiresAt = new Date(now.getTime() + LINK_TOKEN_TTL_MS)
  // Only the newest link works: an older one left in a chat or a screenshot is void.
  await prisma.telegramStaffLinkToken.deleteMany({ where: { organizationId: orgId, userId, usedAt: null } })
  await prisma.telegramStaffLinkToken.create({ data: { organizationId: orgId, userId, tokenHash, expiresAt } })
  return { url: `https://t.me/${bot.botUsername}?start=${token}`, expiresAt }
}

export type LinkOutcome = "linked" | "invalid" | "taken"

/** /start <token> from a private chat. Runs inside the bot's organization scope. */
export async function consumeLinkToken(input: {
  orgId: string
  botId: string
  token: string
  telegramUserId: string
  telegramUsername: string | null
  chatId: string
  now?: Date
}): Promise<{ outcome: LinkOutcome; userName?: string }> {
  const now = input.now ?? new Date()
  if (!/^[a-f0-9]{64}$/.test(input.token)) return { outcome: "invalid" }
  const row = await prisma.telegramStaffLinkToken.findFirst({
    where: { organizationId: input.orgId, tokenHash: hashOneTimeToken(input.token) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  })
  if (!row || row.usedAt || row.expiresAt <= now) return { outcome: "invalid" }
  const claimed = await prisma.telegramStaffLinkToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } })
  if (claimed.count !== 1) return { outcome: "invalid" }

  const user = await prisma.user.findFirst({ where: { id: row.userId, organizationId: input.orgId, isActive: true }, select: { id: true, name: true } })
  if (!user) return { outcome: "invalid" }
  const other = await prisma.telegramStaffLink.findFirst({
    where: { organizationId: input.orgId, botId: input.botId, telegramUserId: input.telegramUserId, userId: { not: user.id } },
    select: { id: true },
  })
  if (other) return { outcome: "taken" }

  await prisma.telegramStaffLink.upsert({
    where: { userId: user.id },
    create: {
      organizationId: input.orgId,
      botId: input.botId,
      userId: user.id,
      telegramUserId: input.telegramUserId,
      telegramUsername: input.telegramUsername,
      chatId: input.chatId,
    },
    update: {
      botId: input.botId,
      telegramUserId: input.telegramUserId,
      telegramUsername: input.telegramUsername,
      chatId: input.chatId,
      recentTurns: [],
      linkedAt: now,
    },
  })
  return { outcome: "linked", userName: user.name ?? undefined }
}

export async function linkView(orgId: string, userId: string) {
  const [bot, link] = await Promise.all([
    prisma.telegramStaffBot.findFirst({ where: { organizationId: orgId, isActive: true }, select: { botUsername: true } }),
    prisma.telegramStaffLink.findFirst({ where: { organizationId: orgId, userId }, select: { telegramUsername: true, linkedAt: true } }),
  ])
  return {
    botConnected: Boolean(bot),
    botUsername: bot?.botUsername ?? null,
    linked: Boolean(link),
    telegramUsername: link?.telegramUsername ?? null,
    linkedAt: link?.linkedAt.toISOString() ?? null,
  }
}

export async function unlinkTelegram(orgId: string, userId: string): Promise<void> {
  await prisma.telegramStaffLink.deleteMany({ where: { organizationId: orgId, userId } })
  await prisma.telegramStaffLinkToken.deleteMany({ where: { organizationId: orgId, userId, usedAt: null } })
}

/** Settings → «Telegram-bot»: who is linked to the organization's bot. */
export async function listLinks(orgId: string) {
  const links = await prisma.telegramStaffLink.findMany({
    where: { organizationId: orgId },
    select: { userId: true, telegramUsername: true, linkedAt: true, user: { select: { name: true, email: true } } },
    orderBy: { linkedAt: "asc" },
  })
  return links.map((link) => ({
    userId: link.userId,
    name: link.user.name || link.user.email,
    telegramUsername: link.telegramUsername,
    linkedAt: link.linkedAt.toISOString(),
  }))
}
