import { NextResponse } from "next/server"
import { z } from "zod"
import { logAudit, prisma } from "@/lib/prisma"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { isAdmin } from "@/lib/constants"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { aiTestView, startWhatsAppAiTest, stopWhatsAppAiTest } from "@/lib/inbox/whatsapp-ai-test"

const id = z.string().trim().min(1).max(128)
const channelSchema = z.object({ channelConfigId: id }).strict()
const startSchema = channelSchema.extend({ conversationId: id, phone: z.string().trim().min(7).max(32) }).strict()

export const GET = withRlsSessionAuth(async (req, auth) => {
  if (!isAdmin(auth.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const parsed = channelSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  const channel = await prisma.channelConfig.findFirst({
    where: { id: parsed.data.channelConfigId, organizationId: auth.orgId, channelType: "whatsapp", isActive: true },
    select: { settings: true },
  })
  if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 })
  return NextResponse.json({ data: { test: aiTestView(channel.settings) } })
})

export const POST = withRlsSessionAuth(async (req, auth) => {
  if (!isAdmin(auth.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const body = await readJsonRequestWithinLimit(req, 2048)
  if (!body.ok) return NextResponse.json({ error: "Invalid request" }, { status: body.reason === "too_large" ? 413 : 400 })
  const parsed = startSchema.safeParse(body.value)
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  try {
    const test = await startWhatsAppAiTest({ ...parsed.data, organizationId: auth.orgId })
    await logAudit(auth.orgId, "whatsapp_ai_test_started", "channelConfig", parsed.data.channelConfigId, "WhatsApp AI test", {
      userId: auth.userId, newValue: { test },
    })
    return NextResponse.json({ data: { test } })
  } catch {
    // Do not expose DB errors, settings or recipient information. GET resolves an uncertain outcome.
    return NextResponse.json({ error: "Could not start test; check channel state and reload" }, { status: 409 })
  }
})

export const DELETE = withRlsSessionAuth(async (req, auth) => {
  if (!isAdmin(auth.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const body = await readJsonRequestWithinLimit(req, 2048)
  if (!body.ok) return NextResponse.json({ error: "Invalid request" }, { status: body.reason === "too_large" ? 413 : 400 })
  const parsed = channelSchema.safeParse(body.value)
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  try {
    await stopWhatsAppAiTest({ ...parsed.data, organizationId: auth.orgId })
    await logAudit(auth.orgId, "whatsapp_ai_test_stopped", "channelConfig", parsed.data.channelConfigId, "WhatsApp AI test", { userId: auth.userId })
    return NextResponse.json({ data: { test: null } })
  } catch {
    return NextResponse.json({ error: "Could not stop test; reload channel state" }, { status: 409 })
  }
})
