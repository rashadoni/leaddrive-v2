import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { withInboxSessionWrite } from "@/lib/inbox/route-auth"
import {
  isChatbotTriggerType, isChatbotStatus, isChatbotChannel, triggerNeedsValue,
} from "@/lib/chatbot-engine"

/**
 * Phase 7 slice-1 — inbound auto-reply rule management (store + CRUD only; the
 * matcher runs in chatbot-engine.ts and is NOT yet wired into the webhook ingest —
 * that's slice-2). Org-scoped via the session, never the x-organization-id header.
 */
export const GET = withRlsAuth("inbox", "read", async (_req, { orgId }) => {
  const rules = await prisma.chatbotRule.findMany({
    where: { organizationId: orgId },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
  })
  return NextResponse.json({ success: true, data: rules })
})

export const POST = withInboxSessionWrite(async (req, { orgId, userId }) => {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  const name = typeof body.name === "string" ? body.name.trim() : ""
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 })

  const responseText = typeof body.responseText === "string" ? body.responseText.trim() : ""
  if (!responseText) return NextResponse.json({ error: "responseText is required" }, { status: 400 })

  const triggerType = body.triggerType ?? "contains"
  if (!isChatbotTriggerType(triggerType)) {
    return NextResponse.json({ error: "Invalid triggerType" }, { status: 400 })
  }

  const status = body.status ?? "draft"
  if (!isChatbotStatus(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 })
  }

  const triggerValue = typeof body.triggerValue === "string" ? body.triggerValue.trim() : null
  if (triggerNeedsValue(triggerType) && !triggerValue) {
    return NextResponse.json({ error: "triggerValue is required for this triggerType" }, { status: 400 })
  }

  const channelTypes: unknown = Array.isArray(body.channelTypes) ? body.channelTypes : []
  if (!(channelTypes as unknown[]).every(isChatbotChannel)) {
    return NextResponse.json({ error: "Invalid channelTypes" }, { status: 400 })
  }

  // Reject a non-integer priority instead of silently coercing to 0 (which would
  // drop the rule to the bottom of the eval order) — mirrors the PATCH route. A
  // stringified "3" from a number input or a 2.5 is a 400, an omitted value is 0.
  if (body.priority !== undefined && !Number.isInteger(body.priority)) {
    return NextResponse.json({ error: "Invalid priority" }, { status: 400 })
  }
  const priority = Number.isInteger(body.priority) ? body.priority : 0

  const rule = await prisma.chatbotRule.create({
    data: {
      organizationId: orgId,
      name,
      status,
      channelTypes: channelTypes as string[],
      triggerType,
      // "always" ignores its value — store null so it can't drift into a stale term.
      triggerValue: triggerNeedsValue(triggerType) ? triggerValue : null,
      responseText,
      priority,
      createdBy: userId,
    },
  })
  return NextResponse.json({ success: true, data: rule }, { status: 201 })
})
