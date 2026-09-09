import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { isAdmin } from "@/lib/constants"
import { prisma } from "@/lib/prisma"
import { DIGEST_TYPES, type DigestType } from "@/lib/digest/subscriptions"

type AiDeliverySettings = {
  telegramBotToken?: unknown
  telegramChatId?: unknown
  slackWebhookUrl?: unknown
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown_error"
}

// POST /api/v1/digest-subscriptions/test
// Body: { userId: string, type: DigestType }
// Fires a sample digest to the given user across their configured channels.
// Useful to confirm that Telegram bot token, Slack webhook, or email sender
// all work before relying on the real cron.
export const POST = withRlsAuth("core", "write", async (req, auth) => {
  if (!isAdmin(auth.role)) {
    return NextResponse.json(
      { success: false, error: "Only admins can trigger test digests" },
      { status: 403 },
    )
  }

  const body = await req.json().catch(() => ({})) as {
    userId?: string
    type?: DigestType
  }
  if (!body.userId || !body.type || !DIGEST_TYPES.includes(body.type)) {
    return NextResponse.json(
      { success: false, error: "userId + valid type required" },
      { status: 400 },
    )
  }

  const user = await prisma.user.findFirst({
    where: { id: body.userId, organizationId: auth.orgId, isActive: true },
    select: { id: true, email: true, name: true },
  })
  if (!user) {
    return NextResponse.json(
      { success: false, error: "user not found in this organization" },
      { status: 404 },
    )
  }

  const org = await prisma.organization.findUnique({
    where: { id: auth.orgId },
    select: { name: true, settings: true },
  })

  const subject = `🧪 Test: ${labelFor(body.type)} — ${org?.name || ""}`
  const bodyText = sampleMessage(body.type)
  const deliveries: Array<{ channel: string; ok: boolean; error?: string }> = []

  // In-app notification
  try {
    await prisma.notification.create({
      data: {
        organizationId: auth.orgId,
        userId: user.id,
        type: "info",
        title: subject,
        message: bodyText,
        entityType: "digest_test",
      },
    })
    deliveries.push({ channel: "in_app", ok: true })
  } catch (e: unknown) {
    deliveries.push({ channel: "in_app", ok: false, error: errorMessage(e) })
  }

  // Email
  if (user.email) {
    try {
      const { sendEmail } = await import("@/lib/email")
      await sendEmail({
        to: user.email,
        subject,
        html: `<h2>${subject}</h2><p>Это тестовое сообщение для проверки канала доставки.</p><pre style="background:#f5f5f5;padding:12px;border-radius:6px;white-space:pre-wrap;">${bodyText}</pre>`,
        organizationId: auth.orgId,
        transactional: true,
      })
      deliveries.push({ channel: "email", ok: true })
    } catch (e: unknown) {
      deliveries.push({ channel: "email", ok: false, error: errorMessage(e) })
    }
  }

  // Telegram / Slack — read the existing org AI-automation delivery config
  const settings = (org?.settings as { aiDelivery?: AiDeliverySettings } | null) || {}
  const d = settings.aiDelivery || {}
  if (typeof d.telegramBotToken === "string" && typeof d.telegramChatId === "string") {
    try {
      const tgRes = await fetch(
        `https://api.telegram.org/bot${d.telegramBotToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: d.telegramChatId,
            text: `${subject}\n\n${bodyText}`,
            parse_mode: "HTML",
          }),
        },
      )
      deliveries.push({ channel: "telegram", ok: tgRes.ok })
    } catch (e: unknown) {
      deliveries.push({ channel: "telegram", ok: false, error: errorMessage(e) })
    }
  }
  if (typeof d.slackWebhookUrl === "string" && d.slackWebhookUrl) {
    try {
      const { sendSlackNotification } = await import("@/lib/slack")
      const ok = await sendSlackNotification(d.slackWebhookUrl, {
        text: `*${subject}*\n${bodyText}`,
      })
      deliveries.push({ channel: "slack", ok })
    } catch (e: unknown) {
      deliveries.push({ channel: "slack", ok: false, error: errorMessage(e) })
    }
  }

  return NextResponse.json({ success: true, user: { email: user.email, name: user.name }, deliveries })
})

function labelFor(type: DigestType): string {
  switch (type) {
    case "daily_briefing": return "Daily AI Briefing"
    case "anomaly_alert":  return "Anomaly Alert"
    case "renewal":        return "Renewal Reminder"
  }
}

function sampleMessage(type: DigestType): string {
  switch (type) {
    case "daily_briefing":
      return "📊 Daily briefing (sample)\n• 3 new leads yesterday (+2 vs avg)\n• $125K in pipeline advanced to Proposal\n• 2 tickets approaching SLA\n• AI recommends: follow up with Metro Moscow today"
    case "anomaly_alert":
      return "⚠️ Anomaly detected (sample)\n• Pipeline drop of 30% in last 3 days\n• Win-rate fell below 12% (vs baseline 24%)\n• Suggested action: review conversion stage bottlenecks"
    case "renewal":
      return "📅 Renewal reminder (sample)\n• Contract «Metro RU — Q2 almonds» ends in 30 days\n• Value: $480K\n• Suggested action: schedule renewal call this week"
  }
}
