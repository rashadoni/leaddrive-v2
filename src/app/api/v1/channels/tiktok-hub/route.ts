import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { gateChannelsAccess } from "@/lib/channels-access"
import { runWithTenant } from "@/lib/rls-context"
import {
  connectionCan,
  listPlatformConnections,
  type ChannelConnectionLike,
  type ChannelSurface,
} from "@/lib/channels/platform-connections"

type CheckStatus = "ok" | "warning" | "error" | "needs_access"

interface HubCheck {
  key: string
  label: string
  status: CheckStatus
  message: string
}

interface DmConfigSummary {
  id: string
  configName: string
  isActive: boolean
  apiKey: string | null
  settings: unknown
  createdAt: Date
  updatedAt: Date
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return null
}

function appOrigin(req: NextRequest): string {
  return (process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin || "https://app.leaddrivecrm.org").replace(/\/+$/, "")
}

function connectionFor(connections: ChannelConnectionLike[], surface: ChannelSurface, provider: string) {
  return connections.find((row) => row.platform === "tiktok" && row.surface === surface && row.provider === provider) || null
}

function pickMostRelevantDmConfig(configs: DmConfigSummary[]) {
  return [...configs].sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
    const aSettings = asRecord(a.settings)
    const bSettings = asRecord(b.settings)
    const aScore = Number(Boolean(a.apiKey)) + Number(Boolean(stringValue(aSettings.webhookSecret))) + Number(Boolean(stringValue(aSettings.baseUrl)))
    const bScore = Number(Boolean(b.apiKey)) + Number(Boolean(stringValue(bSettings.webhookSecret))) + Number(Boolean(stringValue(bSettings.baseUrl)))
    if (aScore !== bScore) return bScore - aScore
    return b.updatedAt.getTime() - a.updatedAt.getTime()
  })[0] || null
}

function dmHealthChecks(params: {
  connection: ChannelConnectionLike | null
  dmConfig: ReturnType<typeof pickMostRelevantDmConfig>
  duplicateActiveConfigs: number
  lastInboundAt: Date | null
  origin: string
}): { checks: HubCheck[]; webhookUrl: string | null; summaryStatus: CheckStatus } {
  const { connection, dmConfig, duplicateActiveConfigs, lastInboundAt, origin } = params
  const settings = asRecord(dmConfig?.settings)
  const baseUrl = stringValue(settings.baseUrl)
  const accountId = stringValue(settings.accountId)
  const inboxId = stringValue(settings.inboxId)
  const webhookSecret = stringValue(settings.webhookSecret)
  const webhookUrl = webhookSecret ? `${origin}/api/v1/webhooks/chatwoot?token=${encodeURIComponent(webhookSecret)}` : null
  const checks: HubCheck[] = [
    {
      key: "connection",
      label: "Chatwoot DM bridge",
      status: connection?.status === "connected" && dmConfig?.isActive ? "ok" : "error",
      message: connection?.status === "connected" && dmConfig?.isActive ? "TikTok DM is mapped to Chatwoot" : "No active TikTok via Chatwoot config is saved",
    },
    {
      key: "baseUrl",
      label: "Chatwoot base URL",
      status: baseUrl ? "ok" : "error",
      message: baseUrl || "Missing Chatwoot base URL",
    },
    {
      key: "accountId",
      label: "Chatwoot account",
      status: accountId ? "ok" : "error",
      message: accountId ? `Account ${accountId}` : "Missing Chatwoot account ID",
    },
    {
      key: "token",
      label: "API access token",
      status: dmConfig?.apiKey ? "ok" : "error",
      message: dmConfig?.apiKey ? "Saved" : "Missing Chatwoot API token",
    },
    {
      key: "webhook",
      label: "Webhook URL",
      status: webhookSecret ? "ok" : "error",
      message: webhookSecret ? "Copy this URL into Chatwoot message_created webhook" : "Missing webhook secret",
    },
    {
      key: "inbox",
      label: "Inbox ID",
      status: inboxId ? "ok" : "warning",
      message: inboxId ? `Inbox ${inboxId}` : "Inbox will be learned from the first inbound Chatwoot payload",
    },
    {
      key: "lastInbound",
      label: "Last inbound DM",
      status: lastInboundAt ? "ok" : "warning",
      message: lastInboundAt ? lastInboundAt.toISOString() : "No TikTok DM received in LeadDrive yet",
    },
  ]

  if (duplicateActiveConfigs > 1) {
    checks.push({
      key: "duplicates",
      label: "Duplicate active configs",
      status: "warning",
      message: `${duplicateActiveConfigs} active Chatwoot TikTok configs found. Keep only the one with the current token after manual verification.`,
    })
  }

  const hasError = checks.some((check) => check.status === "error")
  const hasWarning = checks.some((check) => check.status === "warning")
  return {
    checks,
    webhookUrl,
    summaryStatus: hasError ? "error" : hasWarning ? "warning" : "ok",
  }
}

function needsAccessCheck(provider: string, required: unknown): HubCheck {
  const requiredAccess = Array.isArray(required) ? required.map(String).join(", ") : "provider credentials and webhook approval"
  return {
    key: `${provider}:access`,
    label: "Provider access",
    status: "needs_access",
    message: `Needs access: ${requiredAccess}`,
  }
}

const SECRET_SETTING_KEYS = new Set([
  "accesstoken",
  "apikey",
  "apitoken",
  "appsecret",
  "bearertoken",
  "bottoken",
  "businessaccesstoken",
  "clientsecret",
  "instagramaccesstoken",
  "longlivedaccesstoken",
  "pageaccesstoken",
  "password",
  "privatekey",
  "refreshtoken",
  "secret",
  "signingsecret",
  "token",
  "verificationtoken",
  "verifytoken",
  "webhooksecret",
])

function publicConnectionSettings(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicConnectionSettings)
  if (!value || typeof value !== "object") return value

  const safeSettings: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_SETTING_KEYS.has(key.toLowerCase())) continue
    safeSettings[key] = publicConnectionSettings(entry)
  }
  return safeSettings
}

function publicConnection(connection: ChannelConnectionLike | null) {
  if (!connection) return null
  return {
    id: connection.id,
    channelConfigId: connection.channelConfigId ?? null,
    platform: connection.platform,
    surface: connection.surface,
    provider: connection.provider,
    displayName: connection.displayName,
    status: connection.status,
    capabilities: connection.capabilities,
    settings: publicConnectionSettings(connection.settings),
    lastHealthCheckAt: connection.lastHealthCheckAt ?? null,
    lastInboundAt: connection.lastInboundAt ?? null,
    lastError: connection.lastError ?? null,
    synthetic: connection.synthetic === true,
  }
}

export async function GET(req: NextRequest) {
  const gate = await gateChannelsAccess(req)
  if (gate instanceof NextResponse) return gate
  const { orgId } = gate

  return runWithTenant(orgId, async () => {
    const [connections, dmConfigsRaw, latestDm] = await Promise.all([
      listPlatformConnections({ organizationId: orgId, platform: "tiktok" }),
      prisma.channelConfig.findMany({
        where: {
          organizationId: orgId,
          channelType: "chatwoot",
          OR: [
            { settings: { path: ["provider"], equals: "tiktok" } },
            { settings: { path: ["platform"], equals: "tiktok" } },
            { configName: { contains: "tiktok", mode: "insensitive" } },
          ],
        },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          configName: true,
          isActive: true,
          apiKey: true,
          settings: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.channelMessage.findFirst({
        where: {
          organizationId: orgId,
          channelType: "tiktok",
          direction: "inbound",
        },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
    ])

    const dmConfigs = dmConfigsRaw as DmConfigSummary[]
    const dmConnection = connectionFor(connections, "dm", "chatwoot")
    const commentConnection = connectionFor(connections, "comment", "tiktok_organic")
    const mentionConnection = connectionFor(connections, "mention", "tiktok_organic")
    const leadAdConnection = connectionFor(connections, "lead_ad", "tiktok_business")
    const dmConfig = pickMostRelevantDmConfig(dmConfigs)
    const activeDmConfigs = dmConfigs.filter((row: DmConfigSummary) => row.isActive).length
    const dmHealth = dmHealthChecks({
      connection: dmConnection,
      dmConfig,
      duplicateActiveConfigs: activeDmConfigs,
      lastInboundAt: latestDm?.createdAt ?? null,
      origin: appOrigin(req),
    })
    const { webhookUrl: dmWebhookUrl, ...publicDmHealth } = dmHealth

    const commentSettings = asRecord(commentConnection?.settings)
    const mentionSettings = asRecord(mentionConnection?.settings)
    const leadSettings = asRecord(leadAdConnection?.settings)
    const commentsConnected = Boolean(commentConnection && commentConnection.status === "connected")
    const mentionsConnected = Boolean(mentionConnection && mentionConnection.status === "connected")
    const leadConnected = Boolean(leadAdConnection && leadAdConnection.status === "connected")

    return NextResponse.json({
      success: true,
      data: {
        platform: "tiktok",
        generatedAt: new Date().toISOString(),
        cards: [
          {
            key: "dm",
            title: "DM Inbox",
            surfaces: ["dm"],
            provider: "chatwoot",
            status: dmConnection?.status ?? "needs_access",
            connection: publicConnection(dmConnection),
            capabilities: {
              read: connectionCan(dmConnection, "read"),
              reply: connectionCan(dmConnection, "reply"),
              webhook: connectionCan(dmConnection, "webhook"),
              importLead: connectionCan(dmConnection, "importLead"),
            },
            health: publicDmHealth,
            webhookUrl: null,
            webhookUrlAvailable: Boolean(dmWebhookUrl),
            primaryAction: dmConnection?.status === "connected" ? "reconnect" : "connect",
            secondaryAction: "test",
          },
          {
            key: "comments_mentions",
            title: "Comments & Mentions",
            surfaces: ["comment", "mention"],
            provider: "tiktok_organic",
            status: commentsConnected || mentionsConnected ? "connected" : "needs_access",
            connection: {
              comment: publicConnection(commentConnection),
              mention: publicConnection(mentionConnection),
            },
            capabilities: {
              read: connectionCan(commentConnection, "read") || connectionCan(mentionConnection, "read"),
              reply: connectionCan(commentConnection, "reply") || connectionCan(mentionConnection, "reply"),
              webhook: connectionCan(commentConnection, "webhook") || connectionCan(mentionConnection, "webhook"),
              importLead: false,
            },
            health: {
              summaryStatus: commentsConnected || mentionsConnected ? "ok" : "needs_access",
              checks: [
                commentsConnected || mentionsConnected
                  ? { key: "organic:connected", label: "Organic API", status: "ok", message: "TikTok Organic API connection is saved" }
                  : needsAccessCheck("tiktok_organic", commentSettings.requiredAccess || mentionSettings.requiredAccess),
                {
                  key: "organic:reply",
                  label: "Comment reply",
                  status: connectionCan(commentConnection, "reply") || connectionCan(mentionConnection, "reply") ? "ok" : "warning",
                  message: connectionCan(commentConnection, "reply") || connectionCan(mentionConnection, "reply")
                    ? "Provider allows replies"
                    : "Replies stay blocked until provider capability is proven",
                },
              ],
            },
            primaryAction: commentsConnected || mentionsConnected ? "reconnect" : "connect",
            secondaryAction: "test",
          },
          {
            key: "lead_ads",
            title: "Lead Ads",
            surfaces: ["lead_ad"],
            provider: "tiktok_business",
            status: leadConnected ? "connected" : "needs_access",
            connection: publicConnection(leadAdConnection),
            capabilities: {
              read: connectionCan(leadAdConnection, "read"),
              reply: false,
              webhook: connectionCan(leadAdConnection, "webhook"),
              importLead: connectionCan(leadAdConnection, "importLead"),
            },
            health: {
              summaryStatus: leadConnected ? "ok" : "needs_access",
              checks: [
                leadConnected
                  ? { key: "business:connected", label: "Business API", status: "ok", message: "TikTok Business API connection is saved" }
                  : needsAccessCheck("tiktok_business", leadSettings.requiredAccess),
                {
                  key: "business:dedupe",
                  label: "Lead dedupe",
                  status: "ok",
                  message: "Lead webhook boundary dedupes by TikTok lead id, phone, and email",
                },
              ],
            },
            primaryAction: leadConnected ? "reconnect" : "connect",
            secondaryAction: "test",
          },
        ],
        diagnostics: {
          activeDmConfigs,
          dmConfigIds: dmConfigs.map((row: DmConfigSummary) => ({ id: row.id, active: row.isActive, name: row.configName })),
        },
      },
    })
  })
}
