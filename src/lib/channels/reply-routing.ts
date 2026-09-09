import {
  connectionCan,
  type ChannelCapability,
  type ChannelConnectionLike,
  type ChannelPlatform,
  type ChannelProvider,
  type ChannelSurface,
} from "@/lib/channels/platform-connections"

export type ReplyTransport = "chatwoot" | "tiktok_organic" | "none"

export interface ReplyRouteInput {
  platform: ChannelPlatform
  surface: ChannelSurface
  provider: ChannelProvider
  connection?: Pick<ChannelConnectionLike, "status" | "capabilities"> | null
}

export type ReplyRoute =
  | {
      available: true
      transport: Exclude<ReplyTransport, "none">
      requiredCapability: ChannelCapability
    }
  | {
      available: false
      transport: "none"
      reason: "missing_connection" | "capability_disabled" | "unsupported_surface"
      message: string
    }

export function resolveReplyRoute(input: ReplyRouteInput): ReplyRoute {
  const key = `${input.platform}:${input.surface}:${input.provider}`

  if (key === "tiktok:dm:chatwoot") {
    if (!input.connection) {
      return {
        available: false,
        transport: "none",
        reason: "missing_connection",
        message: "Reply unavailable until TikTok DM via Chatwoot is connected",
      }
    }
    if (!connectionCan(input.connection, "reply")) {
      return {
        available: false,
        transport: "none",
        reason: "capability_disabled",
        message: "Reply unavailable for this TikTok surface",
      }
    }
    return { available: true, transport: "chatwoot", requiredCapability: "reply" }
  }

  if (key === "tiktok:comment:tiktok_organic" || key === "tiktok:mention:tiktok_organic") {
    if (!input.connection || !connectionCan(input.connection, "reply")) {
      return {
        available: false,
        transport: "none",
        reason: input.connection ? "capability_disabled" : "missing_connection",
        message: "Reply unavailable for this TikTok surface",
      }
    }
    return { available: true, transport: "tiktok_organic", requiredCapability: "reply" }
  }

  if (key === "tiktok:lead_ad:tiktok_business") {
    return {
      available: false,
      transport: "none",
      reason: "unsupported_surface",
      message: "TikTok Lead Ads are imported to CRM leads and do not support public replies",
    }
  }

  return {
    available: false,
    transport: "none",
    reason: "unsupported_surface",
    message: "Reply unavailable for this TikTok surface",
  }
}
