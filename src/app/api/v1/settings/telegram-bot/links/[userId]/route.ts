/**
 * DELETE — the admin unlinks an employee's Telegram (someone who left, a lost
 * phone): the bot stops answering that chat and sends it no notices.
 */
import { NextResponse } from "next/server"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { listLinks, unlinkTelegram } from "@/lib/telegram-staff/linking"

export const DELETE = withRlsAuth("settings", "write", async (_req, { orgId }, { params }: { params: Promise<{ userId: string }> }) => {
  const { userId } = await params
  const link = await prisma.telegramStaffLink.findFirst({ where: { organizationId: orgId, userId }, select: { telegramUsername: true } })
  if (!link) return NextResponse.json({ error: "Not linked", code: "NOT_LINKED" }, { status: 404 })
  await unlinkTelegram(orgId, userId)
  logAudit(orgId, "delete", "telegram_staff_link", userId, link.telegramUsername ?? userId)
  return NextResponse.json({ success: true, data: await listLinks(orgId) })
})
