import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"
import { financeTelegramTarget, readFinanceNotifSettings } from "@/lib/finance/notification-settings"
import { sendFinanceTelegram } from "@/lib/finance/telegram-send"

// POST — send a test message through the organization's saved bot into its saved chat.
// The notifier never reports a failure to anyone (a notice must not fail a
// payment), so without this a wrong token or chat would only be discovered by
// the notices that never arrived.
export const POST = withRlsAuth("finance", "write", async (_req, { orgId }) => {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { settings: true },
  })

  const target = financeTelegramTarget(readFinanceNotifSettings(org?.settings))
  if (!target) {
    return NextResponse.json(
      { error: "Telegram is not configured", code: "telegram_not_configured" },
      { status: 409 },
    )
  }

  const result = await sendFinanceTelegram(
    target,
    "✅ <b>LeadDrive</b>\n\nFinance notifications are connected to this chat.",
  )
  if (!result.ok) {
    return NextResponse.json(
      { error: "Telegram did not accept the message", code: `telegram_${result.reason}`, detail: result.detail },
      { status: 502 },
    )
  }

  return NextResponse.json({ data: { sent: true } })
})
