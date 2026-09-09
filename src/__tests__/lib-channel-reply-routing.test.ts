import { describe, expect, it } from "vitest"
import { resolveReplyRoute } from "@/lib/channels/reply-routing"

describe("TikTok provider-aware reply routing", () => {
  it("routes TikTok DM replies through Chatwoot only when reply capability is enabled", () => {
    expect(resolveReplyRoute({
      platform: "tiktok",
      surface: "dm",
      provider: "chatwoot",
      connection: { status: "connected", capabilities: { reply: true } },
    })).toMatchObject({ available: true, transport: "chatwoot" })

    expect(resolveReplyRoute({
      platform: "tiktok",
      surface: "dm",
      provider: "chatwoot",
      connection: { status: "needs_access", capabilities: { reply: true } },
    })).toMatchObject({ available: false, reason: "capability_disabled" })
  })

  it("does not send TikTok comments through Chatwoot", () => {
    expect(resolveReplyRoute({
      platform: "tiktok",
      surface: "comment",
      provider: "chatwoot",
      connection: { status: "connected", capabilities: { reply: true } },
    })).toMatchObject({
      available: false,
      transport: "none",
      reason: "unsupported_surface",
    })
  })

  it("keeps TikTok Organic replies fail-closed until the provider supports reply", () => {
    expect(resolveReplyRoute({
      platform: "tiktok",
      surface: "comment",
      provider: "tiktok_organic",
      connection: { status: "connected", capabilities: { read: true, reply: false, webhook: true } },
    })).toMatchObject({ available: false, reason: "capability_disabled" })

    expect(resolveReplyRoute({
      platform: "tiktok",
      surface: "mention",
      provider: "tiktok_organic",
      connection: { status: "connected", capabilities: { read: true, reply: true, webhook: true } },
    })).toMatchObject({ available: true, transport: "tiktok_organic" })
  })

  it("never exposes a public reply route for TikTok Lead Ads", () => {
    expect(resolveReplyRoute({
      platform: "tiktok",
      surface: "lead_ad",
      provider: "tiktok_business",
      connection: { status: "connected", capabilities: { importLead: true, reply: true } },
    })).toMatchObject({
      available: false,
      reason: "unsupported_surface",
    })
  })
})
