import { NextResponse } from "next/server"
import { z } from "zod"
import { withRlsAuth } from "@/lib/with-rls"
import { logAudit, prisma } from "@/lib/prisma"
import {
  TELEGRAM_BOT_TOKEN_MASK,
  exposeFinanceNotifSettings,
  financeTelegramTarget,
  isTelegramBotToken,
  isTelegramChatId,
  readFinanceNotifSettings,
  type FinanceNotifSettings,
} from "@/lib/finance/notification-settings"

const channelSchema = z.array(z.enum(["inApp", "email", "telegram"])).default(["telegram"])

const notifSettingsSchema = z.object({
  recipientEmail: z.union([z.literal(""), z.string().email().max(200)]).default(""),
  // Both optional, and absent means "leave what is saved": a tab opened before
  // these fields existed still submits the old shape, and that must not erase
  // the organization's bot. An empty string is the explicit "disconnect".
  telegramBotToken: z.string().trim().max(200).optional(),
  telegramChatId: z.string().trim().max(100).optional(),
  overdue: z.object({
    enabled: z.boolean().default(true),
    channels: channelSchema,
  }).default({ enabled: true, channels: ["telegram"] }),
  advance: z.object({
    enabled: z.boolean().default(true),
    channels: channelSchema,
    daysBeforeDeadline: z.number().min(1).max(30).default(7),
  }).default({ enabled: true, channels: ["telegram"], daysBeforeDeadline: 7 }),
  paymentOrders: z.object({
    enabled: z.boolean().default(true),
    channels: channelSchema,
  }).default({ enabled: true, channels: ["telegram"] }),
  billPayments: z.object({
    enabled: z.boolean().default(true),
    channels: channelSchema,
  }).default({ enabled: true, channels: ["telegram"] }),
})

// GET — fetch notification settings
export const GET = withRlsAuth("finance", "read", async (_req, { orgId }) => {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { settings: true },
  })

  // Finance readers include the viewer role: the bot token is masked for everyone.
  return NextResponse.json({ data: exposeFinanceNotifSettings(readFinanceNotifSettings(org?.settings)) })
})

// PUT — update notification settings
export const PUT = withRlsAuth("finance", "write", async (req, { orgId, userId }) => {
  let body
  try { body = await req.json() } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = notifSettingsSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const { telegramBotToken: submittedToken, telegramChatId: submittedChatId, ...categories } = parsed.data
  const keepsToken = submittedToken === undefined || submittedToken === TELEGRAM_BOT_TOKEN_MASK
  if (!keepsToken && submittedToken !== "" && !isTelegramBotToken(submittedToken)) {
    return NextResponse.json(
      { error: "This is not a Telegram bot token", code: "invalid_telegram_bot_token" },
      { status: 400 },
    )
  }
  if (submittedChatId !== undefined && submittedChatId !== "" && !isTelegramChatId(submittedChatId)) {
    return NextResponse.json(
      { error: "This is not a Telegram chat ID", code: "invalid_telegram_chat_id" },
      { status: 400 },
    )
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { settings: true },
  })

  const settings = (org?.settings as Record<string, any>) || {}
  const saved = readFinanceNotifSettings(settings)
  const next: FinanceNotifSettings = {
    ...categories,
    telegramBotToken: keepsToken ? saved.telegramBotToken : submittedToken,
    telegramChatId: submittedChatId === undefined ? saved.telegramChatId : submittedChatId,
  }
  settings.financeNotifications = next

  await prisma.organization.update({
    where: { id: orgId },
    data: { settings },
  })

  // Where an organization's payment notices go is worth a trail. Flags only —
  // neither the token nor the chat belongs in the audit log.
  const wasConnected = financeTelegramTarget(saved) !== null
  const isConnected = financeTelegramTarget(next) !== null
  if (wasConnected !== isConnected || saved.telegramChatId !== next.telegramChatId || !keepsToken) {
    await logAudit(orgId, "finance_notification_telegram_updated", "organization", orgId, "Finance notification settings", {
      userId,
      oldValue: { telegramConnected: wasConnected },
      newValue: { telegramConnected: isConnected, tokenReplaced: !keepsToken, chatChanged: saved.telegramChatId !== next.telegramChatId },
    })
  }

  return NextResponse.json({ data: exposeFinanceNotifSettings(next) })
})
