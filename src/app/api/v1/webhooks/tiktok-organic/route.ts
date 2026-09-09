import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"
import { crudeSentiment } from "@/lib/sentiment"
import { ingestMentionWithResult } from "@/lib/social/ingest-mention"
import { parseTikTokOrganicWebhook } from "@/lib/channels/tiktok-webhook-events"
import { connectionCan, type ChannelConnectionLike } from "@/lib/channels/platform-connections"
import { withSocialMonitoringTenantCollectionFence } from "@/lib/social/monitoring-import-fence"

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

async function resolveOrganicConnection(token: string): Promise<ChannelConnectionLike | null> {
  const row = await runWithRlsBypass(() =>
    prisma.channelConnection.findFirst({
      where: {
        platform: "tiktok",
        provider: "tiktok_organic",
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

export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 })

  const connection = await resolveOrganicConnection(token)
  if (!connection || !connectionCan(connection, "webhook")) {
    return NextResponse.json({ ok: true, ignored: "no-connected-tiktok-organic-connection" })
  }

  const body = await req.json().catch(() => null)
  const events = parseTikTokOrganicWebhook(body)
  if (events.length === 0) return NextResponse.json({ ok: true, ignored: "no-valid-events" })

  const fenced = await runWithTenant(connection.organizationId, () =>
    withSocialMonitoringTenantCollectionFence(connection.organizationId, async () => {
      const results = []
      for (const event of events) {
        const result = await ingestMentionWithResult({
          organizationId: connection.organizationId,
          accountId: null,
          platform: "tiktok",
          externalId: event.externalId,
          sourceType: event.surface,
          sourceProvider: "tiktok_organic",
          sourceMetadata: event.sourceMetadata,
          text: event.text,
          sentiment: crudeSentiment(event.text),
          matchedTerm: null,
          engagement: 0,
          reach: 0,
          url: event.url,
          authorName: event.authorName,
          authorHandle: event.authorHandle,
          authorAvatar: event.authorAvatar,
          publishedAt: event.publishedAt,
        })
        results.push({ externalId: event.externalId, id: result.id, created: result.created, surface: event.surface })
      }

      await prisma.channelConnection.updateMany({
        where: { id: connection.id, organizationId: connection.organizationId },
        data: {
          lastInboundAt: new Date(),
          lastHealthCheckAt: new Date(),
          lastError: null,
        },
      }).catch(() => {})

      return NextResponse.json({ ok: true, data: { ingested: results.length, results } })
    }),
  )
  if (!fenced.allowed) {
    // Acknowledge signed provider delivery so TikTok does not retry while an
    // operator intentionally keeps Social Monitoring paused after clean-slate.
    return NextResponse.json({ ok: true, ignored: fenced.reason })
  }
  return fenced.value
}

export async function GET() {
  return NextResponse.json({ status: "ok", service: "tiktok-organic-webhook", liveReplies: false })
}
