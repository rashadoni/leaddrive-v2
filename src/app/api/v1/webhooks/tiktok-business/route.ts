import { NextRequest, NextResponse } from "next/server"
import { prisma, logAudit } from "@/lib/prisma"
import { runWithTenant, runWithRlsBypass } from "@/lib/rls-context"
import { parseTikTokLeadAdWebhook, type ParsedTikTokLeadAdEvent } from "@/lib/channels/tiktok-webhook-events"
import { connectionCan, type ChannelConnectionLike } from "@/lib/channels/platform-connections"
import { ingestMentionWithResult } from "@/lib/social/ingest-mention"
import { matchInboundLeadId } from "@/lib/inbound-lead-match"
import { CONVERTED_STATUS } from "@/lib/social/mention-status"
import { executeWorkflows } from "@/lib/workflow-engine"
import { createNotification } from "@/lib/notifications"
import { fireWebhooks } from "@/lib/webhooks"
import { refreshProfileForSource } from "@/lib/unified-profile/profile-builder"
import { withSocialMonitoringTenantCollectionFence } from "@/lib/social/monitoring-import-fence"

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

async function resolveBusinessConnection(token: string): Promise<ChannelConnectionLike | null> {
  const row = await runWithRlsBypass(() =>
    prisma.channelConnection.findFirst({
      where: {
        platform: "tiktok",
        surface: "lead_ad",
        provider: "tiktok_business",
        status: "connected",
        OR: [
          { apiKey: token },
          { settings: { path: ["webhookSecret"], equals: token } },
        ],
      },
      orderBy: { updatedAt: "desc" },
    })
  )
  return row ? {
    ...(row as unknown as ChannelConnectionLike),
    capabilities: asRecord(row.capabilities),
    settings: asRecord(row.settings),
  } : null
}

function leadNotes(event: ParsedTikTokLeadAdEvent): string {
  return [
    "Source: TikTok Lead Ads",
    `TikTok lead id: ${event.tiktokLeadId}`,
    event.formId ? `Form: ${event.formId}` : null,
    event.campaignId ? `Campaign: ${event.campaignId}` : null,
    event.adGroupId ? `Ad group: ${event.adGroupId}` : null,
    event.adId ? `Ad: ${event.adId}` : null,
  ].filter(Boolean).join("\n")
}

async function linkMentionToLead(params: {
  organizationId: string
  mentionId: string
  leadId: string
  metadata: Record<string, unknown>
  status: "lead_created" | "duplicate_linked"
}) {
  await prisma.socialMention.updateMany({
    where: { id: params.mentionId, organizationId: params.organizationId, leadId: null },
    data: {
      leadId: params.leadId,
      status: CONVERTED_STATUS.leadId,
      handledAt: new Date(),
      sourceMetadata: {
        ...params.metadata,
        leadAd: {
          tiktokLeadId: params.metadata.tiktokLeadId,
          leadId: params.leadId,
          status: params.status,
          processedAt: new Date().toISOString(),
        },
      },
    },
  })
}

async function findTikTokLeadAdLead(
  organizationId: string,
  tiktokLeadId: string,
): Promise<{ id: string } | null> {
  const createdFromTikTok = await prisma.lead.findFirst({
    where: {
      organizationId,
      source: "tiktok:lead_ad",
      scoreDetails: {
        path: ["tiktokLeadId"],
        equals: tiktokLeadId,
      },
    },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  })
  if (createdFromTikTok) return createdFromTikTok

  // A TikTok delivery can match a pre-existing CRM lead by phone/email. Keep
  // the provider event id on the duplicate-note audit so retries remain
  // idempotent without mutating that lead's own source metadata.
  const duplicateMarker = await prisma.activity.findFirst({
    where: {
      organizationId,
      type: "note",
      subject: `TikTok Lead Ads duplicate · ${tiktokLeadId}`,
      relatedType: "lead",
      relatedId: { not: null },
    },
    select: { relatedId: true },
    orderBy: { createdAt: "desc" },
  })
  if (!duplicateMarker?.relatedId) return null
  return prisma.lead.findFirst({
    where: { id: duplicateMarker.relatedId, organizationId },
    select: { id: true },
  })
}

async function withTikTokLeadAdEventLock<T>(
  organizationId: string,
  tiktokLeadId: string,
  process: () => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      `tiktok-business-lead-ad:${organizationId}:${tiktokLeadId}`,
    )
    // The advisory transaction owns only the lock. Clear its ALS inTx marker
    // before global Prisma calls so each CRM operation establishes tenant RLS
    // on the pooled connection it actually uses.
    return runWithTenant(organizationId, process)
  }, {
    maxWait: 30_000,
    timeout: 5 * 60_000,
  })
}

async function processLeadAdEvent(
  organizationId: string,
  event: ParsedTikTokLeadAdEvent,
  options: { includeSocialMention: boolean },
) {
  const mentionResult = options.includeSocialMention
    ? await ingestMentionWithResult({
        organizationId,
        accountId: null,
        platform: "tiktok",
        externalId: event.externalId,
        sourceType: "lead_ad",
        sourceProvider: "tiktok_business",
        sourceMetadata: event.sourceMetadata,
        text: `${event.contactName}${event.phone ? ` · ${event.phone}` : ""}${event.email ? ` · ${event.email}` : ""}`,
        sentiment: "neutral",
        matchedTerm: null,
        engagement: 0,
        reach: 0,
        url: null,
        authorName: event.contactName,
        authorHandle: null,
        authorAvatar: null,
        publishedAt: event.createdAt,
      })
    : null

  const mention = options.includeSocialMention
    ? await prisma.socialMention.findUnique({
        where: {
          organizationId_platform_externalId: {
            organizationId,
            platform: "tiktok",
            externalId: event.externalId,
          },
        },
        select: { id: true, leadId: true, sourceMetadata: true },
      })
    : null
  if (mention?.leadId) {
    return { mentionId: mention.id, leadId: mention.leadId, status: "already_linked" as const }
  }

  const existingTikTokLead = await findTikTokLeadAdLead(organizationId, event.tiktokLeadId)
  if (existingTikTokLead) {
    if (mention) {
      await linkMentionToLead({
        organizationId,
        mentionId: mention.id,
        leadId: existingTikTokLead.id,
        metadata: event.sourceMetadata,
        status: "duplicate_linked",
      })
    }
    return {
      mentionId: mention?.id ?? null,
      leadId: existingTikTokLead.id,
      status: "already_linked" as const,
    }
  }

  const existingLeadId = await matchInboundLeadId(organizationId, { phone: event.phone, email: event.email })
  if (existingLeadId) {
    if (mention) {
      await linkMentionToLead({
        organizationId,
        mentionId: mention.id,
        leadId: existingLeadId,
        metadata: event.sourceMetadata,
        status: "duplicate_linked",
      })
    }
    await prisma.activity.create({
      data: {
        organizationId,
        type: "note",
        subject: `TikTok Lead Ads duplicate · ${event.tiktokLeadId}`,
        description: leadNotes(event),
        relatedType: "lead",
        relatedId: existingLeadId,
        completedAt: new Date(),
      },
    }).catch(() => {})
    return { mentionId: mention?.id ?? null, leadId: existingLeadId, status: "duplicate_linked" as const }
  }

  const lead = await prisma.lead.create({
    data: {
      organizationId,
      contactName: event.contactName,
      email: event.email,
      phone: event.phone,
      phoneWhatsApp: event.phone,
      source: "tiktok:lead_ad",
      status: "new",
      priority: "medium",
      notes: leadNotes(event),
      scoreDetails: {
        tiktokLeadId: event.tiktokLeadId,
        formId: event.formId,
        campaignId: event.campaignId,
        adGroupId: event.adGroupId,
        adId: event.adId,
      },
    },
  })

  if (mention) {
    await linkMentionToLead({
      organizationId,
      mentionId: mention.id,
      leadId: lead.id,
      metadata: event.sourceMetadata,
      status: "lead_created",
    })
  }

  await logAudit(organizationId, "create", "lead", lead.id, lead.contactName)
  await executeWorkflows(
    organizationId,
    "lead",
    "created",
    lead,
    { awaitExternalSideEffects: true },
  ).catch((error) => {
    console.error("[tiktok-business-webhook] workflow execution failed", error)
  })
  await refreshProfileForSource(prisma, organizationId, "lead", lead.id).catch((error) => {
    console.error("[tiktok-business-webhook] profile refresh failed", error)
  })
  await createNotification({
    organizationId,
    type: "info",
    title: "Новый лид",
    message: `Создан лид «${lead.contactName}» из TikTok Lead Ads`,
    entityType: "lead",
    entityId: lead.id,
  }).catch((error) => {
    console.error("[tiktok-business-webhook] notification failed", error)
  })
  await fireWebhooks(organizationId, "lead.created", {
    id: lead.id,
    contactName: lead.contactName,
    companyName: lead.companyName,
  }, {
    awaitDelivery: true,
  }).catch((error) => {
    console.error("[tiktok-business-webhook] outbound webhook failed", error)
  })

  return { mentionId: mentionResult?.id ?? null, leadId: lead.id, status: "lead_created" as const }
}

export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 })

  const connection = await resolveBusinessConnection(token)
  if (!connection || !connectionCan(connection, "webhook") || !connectionCan(connection, "importLead")) {
    return NextResponse.json({ ok: true, ignored: "no-connected-tiktok-business-lead-ads-connection" })
  }

  const body = await req.json().catch(() => null)
  const events = parseTikTokLeadAdWebhook(body)
  if (events.length === 0) return NextResponse.json({ ok: true, ignored: "no-valid-events" })

  return runWithTenant(connection.organizationId, async () => {
    const fenced = await withSocialMonitoringTenantCollectionFence(
      connection.organizationId,
      async () => {
        const results = []
        for (const event of events) {
          results.push(await withTikTokLeadAdEventLock(
            connection.organizationId,
            event.tiktokLeadId,
            () => processLeadAdEvent(
              connection.organizationId,
              event,
              { includeSocialMention: true },
            ),
          ))
        }
        return results
      },
    )

    const results = fenced.allowed ? fenced.value : []
    if (!fenced.allowed) {
      // Lead Ads are CRM intake first. A clean-slate pause suppresses only the
      // SocialMention mirror; lead matching, creation and CRM side effects stay live.
      for (const event of events) {
        results.push(await withTikTokLeadAdEventLock(
          connection.organizationId,
          event.tiktokLeadId,
          () => processLeadAdEvent(
            connection.organizationId,
            event,
            { includeSocialMention: false },
          ),
        ))
      }
    }

    await prisma.channelConnection.updateMany({
      where: { id: connection.id, organizationId: connection.organizationId },
      data: {
        lastInboundAt: new Date(),
        lastHealthCheckAt: new Date(),
        lastError: null,
      },
    }).catch(() => {})

    return NextResponse.json({
      ok: true,
      data: {
        ingested: results.length,
        results,
        ...(!fenced.allowed ? { monitoringSkipped: fenced.reason } : {}),
      },
    })
  })
}

export async function GET() {
  return NextResponse.json({ status: "ok", service: "tiktok-business-webhook", liveReplies: false })
}
