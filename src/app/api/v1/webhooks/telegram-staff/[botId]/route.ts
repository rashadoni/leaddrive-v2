/**
 * Telegram → an organization's employee bot (src/lib/telegram-staff).
 *
 * The path names our bot row; Telegram proves the call with the secret it was
 * given at setWebhook (X-Telegram-Bot-Api-Secret-Token, compared by hash). An
 * update_id at or below the last one handled is a retry and is answered 200
 * without running again. Everything after that runs in the bot's organization.
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"
import { secretMatches } from "@/lib/telegram-staff/bot-config"
import { handleStaffUpdate, type TelegramUpdate } from "@/lib/telegram-staff/handle-update"

export async function POST(req: NextRequest, { params }: { params: Promise<{ botId: string }> }) {
  const { botId } = await params
  const bot = await runWithRlsBypass(() => prisma.telegramStaffBot.findFirst({
    where: { id: botId, isActive: true },
    select: { id: true, organizationId: true, tokenCiphertext: true, webhookSecretHash: true },
  }))
  if (!bot) return NextResponse.json({ ok: false }, { status: 404 })
  if (!secretMatches(req.headers.get("x-telegram-bot-api-secret-token"), bot.webhookSecretHash)) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  const update = (await req.json().catch(() => null)) as TelegramUpdate | null
  if (!update || !Number.isSafeInteger(update.update_id)) return NextResponse.json({ ok: true })

  return runWithTenant(bot.organizationId, async () => {
    const fresh = await prisma.telegramStaffBot.updateMany({
      where: { id: bot.id, lastUpdateId: { lt: BigInt(update.update_id) } },
      data: { lastUpdateId: BigInt(update.update_id) },
    })
    if (fresh.count !== 1) return NextResponse.json({ ok: true })
    try {
      await handleStaffUpdate(bot, update)
    } catch (error) {
      // Telegram retries a failed delivery; the update is already marked handled,
      // so a broken update cannot loop. The employee is told by the handler where it can.
      console.error("[telegram-staff] update failed", { botId: bot.id, error: error instanceof Error ? error.message : error })
    }
    return NextResponse.json({ ok: true })
  })
}
