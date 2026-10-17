import { NextResponse } from "next/server"
import { z } from "zod"
import { logAudit, prisma } from "@/lib/prisma"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { assertSafeWebhookUrl } from "@/lib/integrations/webhook-url-guard"
import { isAdmin } from "@/lib/constants"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"

const MAX_DELIVERY_BODY_BYTES = 16 * 1024
const SECRET_MASK = "••••••••"
type DeliverySettings = {
  telegramBotToken?: unknown
  telegramChatId?: unknown
  slackWebhookUrl?: unknown
  [key: string]: unknown
}

const patchDeliverySchema = z.object({
  telegramBotToken: z.string().trim().max(4_096).optional(),
  telegramChatId: z.string().trim().max(256).optional(),
  slackWebhookUrl: z.string().trim().max(4_096).optional(),
}).strict().refine((value) => Object.keys(value).length > 0)

function requireDeliveryAdmin(role: string): Response | null {
  return isAdmin(role)
    ? null
    : NextResponse.json({ error: "Forbidden" }, { status: 403 })
}

function exposeDeliverySettings(settings: DeliverySettings) {
  const hasTelegramToken = typeof settings.telegramBotToken === "string" && settings.telegramBotToken.length > 0
  const hasSlackWebhook = typeof settings.slackWebhookUrl === "string" && settings.slackWebhookUrl.length > 0
  return {
    // Never send reusable delivery credentials back to the browser. The stable
    // sentinel keeps the existing edit form compatible: submitting it means
    // "preserve", while replacing or clearing it is an explicit mutation.
    telegramBotToken: hasTelegramToken ? SECRET_MASK : "",
    telegramBotTokenConfigured: hasTelegramToken,
    telegramChatId: typeof settings.telegramChatId === "string" ? settings.telegramChatId : "",
    slackWebhookUrl: hasSlackWebhook ? SECRET_MASK : "",
    slackWebhookConfigured: hasSlackWebhook,
  }
}

/**
 * GET /api/v1/settings/ai-delivery — read delivery channel settings
 * PATCH /api/v1/settings/ai-delivery — update delivery channel settings
 *
 * The organization's language is not a delivery setting any more: it decides
 * what customers read and is set in Settings → Organization
 * (/api/v1/settings/organization/language).
 */
export const GET = withRlsSessionAuth(async (_req, auth) => {
  const denial = requireDeliveryAdmin(auth.role)
  if (denial) return denial

  const org = await prisma.organization.findUnique({
    where: { id: auth.orgId },
    select: { settings: true },
  })

  return NextResponse.json({
    data: exposeDeliverySettings((org?.settings as DeliverySettings) || {}),
  })
})

export const PATCH = withRlsSessionAuth(async (req, auth) => {
  const denial = requireDeliveryAdmin(auth.role)
  if (denial) return denial

  const requestBody = await readJsonRequestWithinLimit(req, MAX_DELIVERY_BODY_BYTES)
  if (!requestBody.ok) {
    return NextResponse.json(
      { error: requestBody.reason === "too_large" ? "Request body too large" : "Invalid request" },
      { status: requestBody.reason === "too_large" ? 413 : 400 },
    )
  }
  const parsed = patchDeliverySchema.safeParse(requestBody.value)
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 })

  const org = await prisma.organization.findUnique({
    where: { id: auth.orgId },
    select: { settings: true },
  })

  const current = (org?.settings as DeliverySettings) || {}
  const settings: DeliverySettings = { ...current }

  if (parsed.data.telegramBotToken !== undefined && parsed.data.telegramBotToken !== SECRET_MASK) {
    settings.telegramBotToken = parsed.data.telegramBotToken
  }
  if (parsed.data.telegramChatId !== undefined) settings.telegramChatId = parsed.data.telegramChatId
  if (parsed.data.slackWebhookUrl !== undefined && parsed.data.slackWebhookUrl !== SECRET_MASK) {
    settings.slackWebhookUrl = parsed.data.slackWebhookUrl
  }

  if (typeof settings.slackWebhookUrl === "string" && settings.slackWebhookUrl) {
    try {
      assertSafeWebhookUrl(settings.slackWebhookUrl, "slack")
    } catch (err) {
      return NextResponse.json(
        { error: (err as Error).message },
        { status: 400 },
      )
    }
  }

  await prisma.organization.update({
    where: { id: auth.orgId },
    data: { settings },
  })

  await logAudit(
    auth.orgId,
    "ai_delivery_settings_updated",
    "organization",
    auth.orgId,
    "AI delivery settings",
    {
      userId: auth.userId,
      oldValue: {
        telegramConfigured: Boolean(current.telegramBotToken),
        slackConfigured: Boolean(current.slackWebhookUrl),
      },
      newValue: {
        telegramConfigured: Boolean(settings.telegramBotToken),
        slackConfigured: Boolean(settings.slackWebhookUrl),
      },
    },
  )

  return NextResponse.json({
    data: exposeDeliverySettings(settings),
  })
})
