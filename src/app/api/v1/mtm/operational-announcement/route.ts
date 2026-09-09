import { z } from "zod"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getMtmSettings } from "@/lib/mtm-settings"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { isValidTimezone } from "@/lib/timezone"
import {
  isOperationalAnnouncementActive,
  localizedOperationalText,
  operationalLocale,
  parseOperationalAnnouncementMetadata,
} from "@/lib/mtm/operational-announcement"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { withMtmRlsAuth } from "@/lib/with-mtm-rls-auth"

const AcknowledgeSchema = z.object({ messageId: z.string().min(1).max(128) })

type AnnouncementNotification = {
  id: string
  title: string
  body: string | null
  metadata: unknown
  createdAt: Date
}

async function actorFor(auth: {
  orgId: string
  userId: string
  role: string
  agentId?: string | null
}) {
  return resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
}

async function activeAnnouncement(organizationId: string, agentId: string, now = new Date()) {
  const notifications = await prisma.mtmNotification.findMany({
    where: { organizationId, agentId, type: "announcement" },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, title: true, body: true, metadata: true, createdAt: true },
  })
  return (notifications as AnnouncementNotification[])
    .map((notification) => ({
      notification,
      metadata: parseOperationalAnnouncementMetadata(notification.metadata),
    }))
    .find((entry) => entry.metadata && isOperationalAnnouncementActive(entry.metadata, now)) ?? null
}

export const GET = withMtmRlsAuth("mtm", "read", async (req, auth) => {
  const [actor, settings] = await Promise.all([actorFor(auth), getMtmSettings(auth.orgId)])
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const support = { email: settings.supportEmail || null, phone: settings.supportPhone || null }
  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
  if (!actor.agentId) {
    return NextResponse.json({ success: true, data: { announcement: null, support, timezone } })
  }
  const active = await activeAnnouncement(auth.orgId, actor.agentId)
  if (!active?.metadata) {
    return NextResponse.json({ success: true, data: { announcement: null, support, timezone } })
  }
  const receipt = await prisma.mtmMessageReceipt.findFirst({
    where: {
      organizationId: auth.orgId,
      agentId: actor.agentId,
      messageId: active.metadata.messageId,
      type: "ACKNOWLEDGED",
    },
    select: { occurredAt: true },
  })
  const locale = operationalLocale(new URL(req.url).searchParams.get("locale") || req.headers.get("accept-language"))
  return NextResponse.json({
    success: true,
    data: {
      announcement: {
        notificationId: active.notification.id,
        messageId: active.metadata.messageId,
        threadId: active.metadata.threadId,
        title: active.notification.title,
        body: localizedOperationalText(active.metadata, active.notification.body || "", locale),
        effectiveFrom: active.metadata.effectiveFrom,
        effectiveUntil: active.metadata.effectiveUntil,
        acknowledgementRequired: true,
        acknowledgedAt: receipt?.occurredAt ?? null,
      },
      support,
      timezone,
    },
  })
})

export const POST = withMtmRlsAuth("mtm", "write", async (req, auth) => {
  const actor = await actorFor(auth)
  if (!actor?.agentId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const parsed = AcknowledgeSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid messageId" }, { status: 400 })
  const active = await activeAnnouncement(auth.orgId, actor.agentId)
  if (!active?.metadata || active.metadata.messageId !== parsed.data.messageId) {
    return NextResponse.json({
      error: "The key message is no longer active",
      code: "MTM_OPERATIONAL_ANNOUNCEMENT_EXPIRED",
    }, { status: 409 })
  }
  const occurredAt = new Date()
  const receipt = await prisma.mtmMessageReceipt.upsert({
    where: {
      messageId_agentId_type: {
        messageId: parsed.data.messageId,
        agentId: actor.agentId,
        type: "ACKNOWLEDGED",
      },
    },
    create: {
      organizationId: auth.orgId,
      messageId: parsed.data.messageId,
      agentId: actor.agentId,
      type: "ACKNOWLEDGED",
      occurredAt,
    },
    update: {},
    select: { occurredAt: true },
  })
  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: actor.agentId,
    action: "OPERATIONAL_ANNOUNCEMENT_ACKNOWLEDGE",
    entity: "message",
    entityId: parsed.data.messageId,
    metadataKind: "operational_announcement",
    newData: { acknowledgedAt: receipt.occurredAt },
    req,
  }).catch((error) => console.warn("[MTM/operational-announcement POST] audit failed", error))
  return NextResponse.json({ success: true, data: { acknowledgedAt: receipt.occurredAt } })
})
