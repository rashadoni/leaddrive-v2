import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { sendSlackNotification } from "@/lib/slack"
import { assertSafeWebhookUrl } from "@/lib/integrations/webhook-url-guard"
import { withRlsAuth } from "@/lib/with-rls"

// ─── Schema for strict PUT (only mutable fields; no organizationId / channelType) ─
const slackPutSchema = z.object({
  configName: z.string().min(1).max(255).optional(),
  webhookUrl: z.string().url().optional(),
  settings: z
    .object({
      channels: z.array(z.string()).optional(),
      contractAlerts: z.boolean().optional(),
      includeContractTitle: z.boolean().optional(),
    })
    .optional(),
  isActive: z.boolean().optional(),
})

// ─── Schema for POST (create) ─────────────────────────────────────────────────
const slackConfigSchema = z.object({
  configName: z.string().min(1).max(255),
  webhookUrl: z.string().url(),
  settings: z
    .object({
      channels: z.array(z.string()).optional(),
      contractAlerts: z.boolean().optional(),
      includeContractTitle: z.boolean().optional(),
    })
    .optional(),
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Admin-gate: integration config is an admin concern. */
function requireAdminRole(role: string): NextResponse | null {
  if (role === "admin" || role === "superadmin" || role === "manager") return null
  return NextResponse.json(
    { error: "Forbidden", message: "Integration configuration requires admin or manager role" },
    { status: 403 },
  )
}

// ─── GET — list ───────────────────────────────────────────────────────────────

export const GET = withRlsAuth("contracts", "read", async (_req, session) => {
  // Webhook URLs are bearer secrets (a holder can post to the org's channel), so
  // listing them is admin-only — same gate as create/update/delete (P1 fix 2026-06-08).
  const adminCheck = requireAdminRole(session.role)
  if (adminCheck) return adminCheck

  const { orgId } = session

  const configs = await prisma.channelConfig.findMany({
    where: { organizationId: orgId, channelType: "slack" },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json({ success: true, data: configs })
})

// ─── POST — create or test ────────────────────────────────────────────────────

export const POST = withRlsAuth("contracts", "write", async (req, session) => {
  const { orgId, role } = session
  const adminCheck = requireAdminRole(role)
  if (adminCheck) return adminCheck

  const body = await req.json()

  // Test action — validate URL first, then send
  if (body.action === "test" && body.webhookUrl) {
    try {
      assertSafeWebhookUrl(body.webhookUrl, "slack")
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 })
    }
    const success = await sendSlackNotification(body.webhookUrl, {
      text: "LeadDrive CRM test message - integration is working!",
    })
    return NextResponse.json({
      success,
      message: success ? "Test message sent" : "Failed to send test message",
    })
  }

  const parsed = slackConfigSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  // FIX 1: validate webhook URL (SSRF guard)
  try {
    assertSafeWebhookUrl(parsed.data.webhookUrl, "slack")
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }

  const config = await prisma.channelConfig.create({
    data: {
      organizationId: orgId,
      channelType: "slack",
      configName: parsed.data.configName,
      webhookUrl: parsed.data.webhookUrl,
      settings: parsed.data.settings ?? {},
      isActive: true,
    },
  })

  return NextResponse.json({ success: true, data: config }, { status: 201 })
})

// ─── PUT — update ─────────────────────────────────────────────────────────────

export const PUT = withRlsAuth("contracts", "write", async (req, session) => {
  const { orgId, role } = session
  const adminCheck = requireAdminRole(role)
  if (adminCheck) return adminCheck

  const body = await req.json()
  const { id } = body

  if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 })

  // FIX 2: strict PUT schema — NEVER accept organizationId / channelType
  const parsed = slackPutSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const { webhookUrl, ...rest } = parsed.data

  // FIX 1: re-validate webhookUrl if provided in PUT
  if (webhookUrl !== undefined) {
    try {
      assertSafeWebhookUrl(webhookUrl, "slack")
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 })
    }
  }

  // Build data object from validated fields only (no raw spread of body)
  const data: Record<string, unknown> = { ...rest }
  if (webhookUrl !== undefined) data.webhookUrl = webhookUrl

  // FIX 2: org+channel-scoped updateMany
  const result = await prisma.channelConfig.updateMany({
    where: { id, organizationId: orgId, channelType: "slack" },
    data,
  })

  if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // FIX 2: org+channel-scoped post-update read
  const updated = await prisma.channelConfig.findFirst({
    where: { id, organizationId: orgId, channelType: "slack" },
  })
  return NextResponse.json({ success: true, data: updated })
})

// ─── DELETE ───────────────────────────────────────────────────────────────────

export const DELETE = withRlsAuth("contracts", "write", async (req, session) => {
  const { orgId, role } = session
  const adminCheck = requireAdminRole(role)
  if (adminCheck) return adminCheck

  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")
  if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 })

  const result = await prisma.channelConfig.deleteMany({
    where: { id, organizationId: orgId, channelType: "slack" },
  })

  if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ success: true, data: { deleted: id } })
})
