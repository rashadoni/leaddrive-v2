import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { validateOutboundWebhookUrl } from "@/lib/integrations/webhook-url-guard"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import crypto from "crypto"

const createWebhookSchema = z.object({
  url: z.string().url().max(2048),
  events: z.array(z.string().min(1).max(120)).min(1).max(100),
}).strict()

const WEBHOOK_MANAGEMENT_BODY_LIMIT = 32 * 1024

function publicWebhook<T extends { secret?: unknown }>(webhook: T): Omit<T, "secret"> {
  const { secret: _secret, ...safe } = webhook
  return safe
}

export const GET = withRlsSessionAuth(async (_req, { orgId, role }) => {
  if (role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const webhooks = await prisma.webhook.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json({ success: true, data: webhooks.map(publicWebhook) })
})

export const POST = withRlsSessionAuth(async (req, { orgId, role }) => {
  if (role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await readJsonRequestWithinLimit(req, WEBHOOK_MANAGEMENT_BODY_LIMIT)
  if (!body.ok) {
    return NextResponse.json(
      { error: body.reason === "too_large" ? "Request body too large" : "Invalid JSON body" },
      { status: body.reason === "too_large" ? 413 : 400 },
    )
  }
  const parsed = createWebhookSchema.safeParse(body.value)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  let normalizedUrl: string
  try {
    const target = await validateOutboundWebhookUrl(parsed.data.url)
    normalizedUrl = target.url.toString()
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unsafe webhook URL"
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const secret = crypto.randomBytes(32).toString("hex")

  const webhook = await prisma.webhook.create({
    data: {
      organizationId: orgId,
      url: normalizedUrl,
      events: parsed.data.events,
      secret,
      isActive: true,
      provenance: "generic",
    },
  })

  // Return secret only on creation
  return NextResponse.json({ success: true, data: { ...webhook, secret } }, { status: 201 })
})
