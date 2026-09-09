import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { validateOutboundWebhookUrl } from "@/lib/integrations/webhook-url-guard"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"

const updateWebhookSchema = z.object({
  url: z.string().url().max(2048).optional(),
  events: z.array(z.string().min(1).max(120)).min(1).max(100).optional(),
  isActive: z.boolean().optional(),
}).strict()

const WEBHOOK_MANAGEMENT_BODY_LIMIT = 32 * 1024

function publicWebhook<T extends { secret?: unknown }>(webhook: T): Omit<T, "secret"> {
  const { secret: _secret, ...safe } = webhook
  return safe
}

export const GET = withRlsSessionAuth(async (_req, { orgId, role }, { params }: { params: Promise<{ id: string }> }) => {
  if (role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const { id } = await params

  const webhook = await prisma.webhook.findFirst({
    where: { id, organizationId: orgId },
  })
  if (!webhook) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return NextResponse.json({ success: true, data: publicWebhook(webhook) })
})

export const PUT = withRlsSessionAuth(async (req, { orgId, role }, { params }: { params: Promise<{ id: string }> }) => {
  if (role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const { id } = await params

  const current = await prisma.webhook.findFirst({
    where: { id, organizationId: orgId },
    select: { provenance: true },
  })
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (current.provenance === "zapier") {
    return NextResponse.json(
      { error: "Zapier subscriptions must be managed through the Zapier connection" },
      { status: 409 },
    )
  }

  const body = await readJsonRequestWithinLimit(req, WEBHOOK_MANAGEMENT_BODY_LIMIT)
  if (!body.ok) {
    return NextResponse.json(
      { error: body.reason === "too_large" ? "Request body too large" : "Invalid JSON body" },
      { status: body.reason === "too_large" ? 413 : 400 },
    )
  }
  const parsed = updateWebhookSchema.safeParse(body.value)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const data = {
    ...parsed.data,
    // An administrator updating a quarantined pre-provenance row is the
    // explicit review step that upgrades it into the trusted generic class.
    ...(current.provenance === "legacy_unclassified" ? { provenance: "generic" } : {}),
  }
  if (data.url !== undefined) {
    try {
      const target = await validateOutboundWebhookUrl(data.url)
      data.url = target.url.toString()
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unsafe webhook URL"
      return NextResponse.json({ error: message }, { status: 400 })
    }
  }

  const result = await prisma.webhook.updateMany({
    where: { id, organizationId: orgId },
    data,
  })
  if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const updated = await prisma.webhook.findFirst({ where: { id, organizationId: orgId } })
  return NextResponse.json({ success: true, data: updated ? publicWebhook(updated) : null })
})

export const DELETE = withRlsSessionAuth(async (_req, { orgId, role }, { params }: { params: Promise<{ id: string }> }) => {
  if (role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const { id } = await params

  const current = await prisma.webhook.findFirst({
    where: { id, organizationId: orgId },
    select: { provenance: true },
  })
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (current.provenance === "zapier") {
    return NextResponse.json(
      { error: "Zapier subscriptions must be managed through the Zapier connection" },
      { status: 409 },
    )
  }

  const result = await prisma.webhook.deleteMany({ where: { id, organizationId: orgId } })
  if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return NextResponse.json({ success: true, data: { deleted: id } })
})
