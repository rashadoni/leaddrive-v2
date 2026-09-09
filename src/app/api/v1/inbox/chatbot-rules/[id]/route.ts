import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withInboxSessionWrite } from "@/lib/inbox/route-auth"
import {
  isChatbotTriggerType, isChatbotStatus, isChatbotChannel, triggerNeedsValue,
} from "@/lib/chatbot-engine"

/** Phase 7 slice-1 — update/delete an inbound auto-reply rule (org-scoped). */
export const PATCH = withInboxSessionWrite(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  // Cross-tenant guard + source for the trigger coherence check below.
  const existing = await prisma.chatbotRule.findFirst({
    where: { id, organizationId: orgId },
  })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const data: {
    name?: string; responseText?: string; status?: string; triggerType?: string;
    triggerValue?: string | null; channelTypes?: string[]; priority?: number;
  } = {}

  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : ""
    if (!name) return NextResponse.json({ error: "name cannot be empty" }, { status: 400 })
    data.name = name
  }
  if (body.responseText !== undefined) {
    const rt = typeof body.responseText === "string" ? body.responseText.trim() : ""
    if (!rt) return NextResponse.json({ error: "responseText cannot be empty" }, { status: 400 })
    data.responseText = rt
  }
  if (body.status !== undefined) {
    if (!isChatbotStatus(body.status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 })
    data.status = body.status
  }
  if (body.triggerType !== undefined) {
    if (!isChatbotTriggerType(body.triggerType)) return NextResponse.json({ error: "Invalid triggerType" }, { status: 400 })
    data.triggerType = body.triggerType
  }
  if (body.channelTypes !== undefined) {
    if (!Array.isArray(body.channelTypes) || !body.channelTypes.every(isChatbotChannel)) {
      return NextResponse.json({ error: "Invalid channelTypes" }, { status: 400 })
    }
    data.channelTypes = body.channelTypes
  }
  if (body.priority !== undefined) {
    if (!Number.isInteger(body.priority)) return NextResponse.json({ error: "Invalid priority" }, { status: 400 })
    data.priority = body.priority
  }
  if (body.triggerValue !== undefined) {
    data.triggerValue = typeof body.triggerValue === "string" && body.triggerValue.trim()
      ? body.triggerValue.trim() : null
  }

  // Coherence on the EFFECTIVE (incoming-or-existing) trigger: a non-"always" type
  // must end up with a value; "always" is forced to null so a stale term can't linger.
  const effType = data.triggerType ?? existing.triggerType
  const effValue = data.triggerValue !== undefined ? data.triggerValue : existing.triggerValue
  if (triggerNeedsValue(effType) && !effValue) {
    return NextResponse.json({ error: "triggerValue is required for this triggerType" }, { status: 400 })
  }
  if (!triggerNeedsValue(effType)) data.triggerValue = null

  const updated = await prisma.chatbotRule.updateMany({
    where: { id, organizationId: orgId },
    data,
  })
  return NextResponse.json({ success: true, data: { updated: updated.count } })
})

export const DELETE = withInboxSessionWrite(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const deleted = await prisma.chatbotRule.deleteMany({
    where: { id, organizationId: orgId },
  })
  if (deleted.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ success: true, data: { deleted: deleted.count } })
})
