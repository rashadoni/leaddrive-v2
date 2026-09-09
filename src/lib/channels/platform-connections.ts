import { prisma } from "@/lib/prisma"

export const CHANNEL_PLATFORMS = ["tiktok", "facebook", "instagram", "whatsapp", "telegram", "vkontakte"] as const
export const CHANNEL_SURFACES = ["dm", "comment", "mention", "lead_ad"] as const
export const CHANNEL_PROVIDERS = ["chatwoot", "tiktok_organic", "tiktok_business", "native", "manual", "webhook", "poller"] as const
export const CHANNEL_CAPABILITIES = ["read", "reply", "webhook", "importLead"] as const

export type ChannelPlatform = typeof CHANNEL_PLATFORMS[number] | (string & {})
export type ChannelSurface = typeof CHANNEL_SURFACES[number]
export type ChannelProvider = typeof CHANNEL_PROVIDERS[number] | (string & {})
export type ChannelCapability = typeof CHANNEL_CAPABILITIES[number]
export type ChannelConnectionStatus = "connected" | "needs_access" | "access_requested" | "error" | "disabled"

export interface ChannelConnectionLike {
  id: string
  organizationId: string
  channelConfigId?: string | null
  platform: string
  surface: string
  provider: string
  displayName: string
  status: ChannelConnectionStatus | string
  capabilities: Record<string, unknown>
  settings: Record<string, unknown>
  apiKey?: string | null
  accessToken?: string | null
  tokenExpiresAt?: Date | string | null
  lastHealthCheckAt?: Date | string | null
  lastInboundAt?: Date | string | null
  lastError?: string | null
  createdAt?: Date | string
  updatedAt?: Date | string
  synthetic?: boolean
}

export interface ChannelConfigLike {
  id: string
  organizationId: string
  channelType: string
  configName: string
  apiKey?: string | null
  isActive: boolean
  settings?: unknown
  createdAt?: Date | string
  updatedAt?: Date | string
}

export interface ResolveChannelConnectionInput {
  organizationId: string
  platform: ChannelPlatform
  surface: ChannelSurface
  provider: ChannelProvider
}

export const TIKTOK_DM_CONNECTION = {
  platform: "tiktok" as const,
  surface: "dm" as const,
  provider: "chatwoot" as const,
}

export const TIKTOK_ORGANIC_COMMENT_CONNECTION = {
  platform: "tiktok" as const,
  surface: "comment" as const,
  provider: "tiktok_organic" as const,
}

export const TIKTOK_ORGANIC_MENTION_CONNECTION = {
  platform: "tiktok" as const,
  surface: "mention" as const,
  provider: "tiktok_organic" as const,
}

export const TIKTOK_LEAD_AD_CONNECTION = {
  platform: "tiktok" as const,
  surface: "lead_ad" as const,
  provider: "tiktok_business" as const,
}

const TIKTOK_NEEDS_ACCESS_SURFACES: Array<Pick<ChannelConnectionLike, "surface" | "provider" | "displayName" | "capabilities" | "settings">> = [
  {
    surface: "comment",
    provider: "tiktok_organic",
    displayName: "TikTok Comments & Mentions",
    capabilities: { read: false, reply: false, webhook: false, importLead: false },
    settings: { requiredAccess: ["TikTok API for Business", "Organic API comments/mentions webhook"] },
  },
  {
    surface: "mention",
    provider: "tiktok_organic",
    displayName: "TikTok Mentions",
    capabilities: { read: false, reply: false, webhook: false, importLead: false },
    settings: { requiredAccess: ["TikTok API for Business", "Organic API mentions webhook"] },
  },
  {
    surface: "lead_ad",
    provider: "tiktok_business",
    displayName: "TikTok Lead Ads",
    capabilities: { read: false, reply: false, webhook: false, importLead: false },
    settings: { requiredAccess: ["TikTok Business API", "Lead Ads webhook", "selected business account and lead forms"] },
  },
]

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return null
}

function dateValue(value: unknown): Date | null {
  if (value instanceof Date) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return null
}

export function connectionCan(connection: Pick<ChannelConnectionLike, "status" | "capabilities"> | null | undefined, capability: ChannelCapability): boolean {
  if (!connection || connection.status !== "connected") return false
  return asRecord(connection.capabilities)[capability] === true
}

export function isTikTokChatwootChannelConfig(channel: Pick<ChannelConfigLike, "channelType" | "configName" | "settings">): boolean {
  if (channel.channelType !== "chatwoot") return false
  const settings = asRecord(channel.settings)
  return (
    stringValue(settings.platform) === "tiktok"
    || stringValue(settings.provider) === "tiktok"
    || /tiktok/i.test(channel.configName || "")
  )
}

export function tiktokDmMetadata(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...extra,
    platform: "tiktok",
    surface: "dm",
    provider: "chatwoot",
  }
}

export function channelConnectionFromTikTokChatwootConfig(channel: ChannelConfigLike, lastInboundAt?: Date | string | null): ChannelConnectionLike {
  const settings = asRecord(channel.settings)
  return {
    id: `legacy:${channel.id}:tiktok:dm:chatwoot`,
    organizationId: channel.organizationId,
    channelConfigId: channel.id,
    platform: "tiktok",
    surface: "dm",
    provider: "chatwoot",
    displayName: channel.configName || "TikTok DM via Chatwoot",
    status: channel.isActive ? "connected" : "disabled",
    capabilities: { read: true, reply: true, webhook: true, importLead: false },
    settings: {
      legacyChannelConfigId: channel.id,
      baseUrl: stringValue(settings.baseUrl),
      accountId: stringValue(settings.accountId),
      inboxId: stringValue(settings.inboxId),
      webhookSecretConfigured: Boolean(stringValue(settings.webhookSecret)),
      apiKeyConfigured: Boolean(channel.apiKey),
    },
    lastInboundAt: lastInboundAt ?? null,
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt,
    synthetic: true,
  }
}

export function missingTikTokAccessConnections(organizationId: string): ChannelConnectionLike[] {
  return TIKTOK_NEEDS_ACCESS_SURFACES.map((item) => ({
    id: `needs_access:tiktok:${item.surface}:${item.provider}`,
    organizationId,
    platform: "tiktok",
    surface: item.surface,
    provider: item.provider,
    displayName: item.displayName,
    status: "needs_access",
    capabilities: item.capabilities,
    settings: item.settings,
    synthetic: true,
  }))
}

function normalizeConnection(row: ChannelConnectionLike): ChannelConnectionLike {
  return {
    ...row,
    capabilities: asRecord(row.capabilities),
    settings: asRecord(row.settings),
  }
}

export async function listPlatformConnections(input: { organizationId: string; platform: ChannelPlatform }): Promise<ChannelConnectionLike[]> {
  const rows = await prisma.channelConnection.findMany({
    where: { organizationId: input.organizationId, platform: input.platform },
    orderBy: [{ surface: "asc" }, { provider: "asc" }],
  })
  const connections: ChannelConnectionLike[] = rows.map((row: unknown) => normalizeConnection(row as ChannelConnectionLike))
  const hasTikTokDm = connections.some((row: ChannelConnectionLike) => row.platform === "tiktok" && row.surface === "dm" && row.provider === "chatwoot")

  if (input.platform === "tiktok" && !hasTikTokDm) {
    const legacy = await prisma.channelConfig.findFirst({
      where: {
        organizationId: input.organizationId,
        channelType: "chatwoot",
        OR: [
          { settings: { path: ["provider"], equals: "tiktok" } },
          { settings: { path: ["platform"], equals: "tiktok" } },
          { configName: { contains: "tiktok", mode: "insensitive" } },
        ],
      },
      orderBy: { updatedAt: "desc" },
    })
    if (legacy) {
      const lastInbound = await prisma.channelMessage.findFirst({
        where: {
          organizationId: input.organizationId,
          channelConfigId: legacy.id,
          channelType: "tiktok",
          direction: "inbound",
        },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      })
      connections.push(channelConnectionFromTikTokChatwootConfig(legacy, lastInbound?.createdAt ?? null))
    }
  }

  if (input.platform !== "tiktok") return connections

  const existingKeys = new Set(connections.map((row: ChannelConnectionLike) => `${row.surface}:${row.provider}`))
  for (const missing of missingTikTokAccessConnections(input.organizationId)) {
    if (!existingKeys.has(`${missing.surface}:${missing.provider}`)) connections.push(missing)
  }
  return connections
}

export async function resolveChannelConnection(input: ResolveChannelConnectionInput): Promise<ChannelConnectionLike | null> {
  const row = await prisma.channelConnection.findFirst({
    where: {
      organizationId: input.organizationId,
      platform: input.platform,
      surface: input.surface,
      provider: input.provider,
    },
  })
  if (row) return normalizeConnection(row as unknown as ChannelConnectionLike)

  if (input.platform === "tiktok" && input.surface === "dm" && input.provider === "chatwoot") {
    const legacy = await prisma.channelConfig.findFirst({
      where: {
        organizationId: input.organizationId,
        channelType: "chatwoot",
        isActive: true,
        OR: [
          { settings: { path: ["provider"], equals: "tiktok" } },
          { settings: { path: ["platform"], equals: "tiktok" } },
          { configName: { contains: "tiktok", mode: "insensitive" } },
        ],
      },
      orderBy: { updatedAt: "desc" },
    })
    return legacy ? channelConnectionFromTikTokChatwootConfig(legacy) : null
  }

  return null
}

export function tiktokChannelConfigSettings(settings: unknown): Record<string, unknown> {
  const base = asRecord(settings)
  return {
    ...base,
    provider: "tiktok",
    platform: "tiktok",
    surface: "dm",
    routingProvider: "chatwoot",
  }
}

export async function syncTikTokDmConnectionForChannelConfig(channel: ChannelConfigLike): Promise<void> {
  if (!isTikTokChatwootChannelConfig(channel)) return
  const settings = asRecord(channel.settings)
  await prisma.channelConnection.upsert({
    where: {
      organizationId_platform_surface_provider: {
        organizationId: channel.organizationId,
        platform: "tiktok",
        surface: "dm",
        provider: "chatwoot",
      },
    },
    create: {
      organizationId: channel.organizationId,
      channelConfigId: channel.id,
      platform: "tiktok",
      surface: "dm",
      provider: "chatwoot",
      displayName: channel.configName || "TikTok DM via Chatwoot",
      status: channel.isActive ? "connected" : "disabled",
      capabilities: { read: true, reply: true, webhook: true, importLead: false },
      settings: {
        legacyChannelConfigId: channel.id,
        baseUrl: stringValue(settings.baseUrl),
        accountId: stringValue(settings.accountId),
        inboxId: stringValue(settings.inboxId),
        webhookSecretConfigured: Boolean(stringValue(settings.webhookSecret)),
        apiKeyConfigured: Boolean(channel.apiKey),
      },
    },
    update: {
      channelConfigId: channel.id,
      displayName: channel.configName || "TikTok DM via Chatwoot",
      status: channel.isActive ? "connected" : "disabled",
      capabilities: { read: true, reply: true, webhook: true, importLead: false },
      settings: {
        legacyChannelConfigId: channel.id,
        baseUrl: stringValue(settings.baseUrl),
        accountId: stringValue(settings.accountId),
        inboxId: stringValue(settings.inboxId),
        webhookSecretConfigured: Boolean(stringValue(settings.webhookSecret)),
        apiKeyConfigured: Boolean(channel.apiKey),
      },
    },
  })
}

export function replyUnavailableReason(connection: Pick<ChannelConnectionLike, "platform" | "surface" | "provider" | "status" | "capabilities"> | null | undefined): string | null {
  if (!connection) return "Reply unavailable for this TikTok surface"
  if (connection.status !== "connected") return "Reply unavailable until this TikTok surface is connected"
  if (!connectionCan(connection, "reply")) return "Reply unavailable for this TikTok surface"
  return null
}

export function connectionLastInboundDate(connection: Pick<ChannelConnectionLike, "lastInboundAt">): Date | null {
  return dateValue(connection.lastInboundAt)
}
