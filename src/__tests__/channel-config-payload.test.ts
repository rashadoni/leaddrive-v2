import { describe, expect, it } from "vitest"
import { buildChannelPayload, type ChannelConfigFormData } from "@/lib/channels/channel-config-payload"

function baseForm(overrides: Partial<ChannelConfigFormData>): ChannelConfigFormData {
  return {
    configName: "Channel",
    channelType: "email",
    botToken: "",
    webhookUrl: "",
    apiKey: "",
    phoneNumber: "",
    chatId: "",
    accountSid: "",
    appId: "",
    appSecret: "",
    pageId: "",
    confirmationCode: "",
    isActive: true,
    smsProvider: "atl",
    atlLogin: "",
    atlTitle: "",
    twilioAccountSid: "",
    twilioNumber: "",
    vonageApiKey: "",
    vonageFromName: "",
    smsSecret: "",
    smsEditing: false,
    verifyToken: "",
    displayName: "",
    igLogin: false,
    appReviewOnly: false,
    loginConfigId: "",
    chatwootBaseUrl: "",
    chatwootAccountId: "",
    chatwootWebhookSecret: "",
    emailTicketIntakeAddress: "",
    emailComplaintIntakeAddress: "",
    ...overrides,
  }
}

describe("channel config payload builder", () => {
  it("omits blank TikTok/Chatwoot webhook secrets so edit preserves the stored value", () => {
    const payload = buildChannelPayload(baseForm({
      configName: "TikTok via Chatwoot",
      channelType: "chatwoot",
      apiKey: "",
      chatwootBaseUrl: " https://chatwoot.example ",
      chatwootAccountId: " 42 ",
      chatwootWebhookSecret: " ",
    }))

    expect(payload).toMatchObject({
      channelType: "chatwoot",
      settings: {
        provider: "tiktok",
        platform: "tiktok",
        surface: "dm",
        routingProvider: "chatwoot",
        baseUrl: "https://chatwoot.example",
        accountId: "42",
      },
    })
    expect((payload.settings as Record<string, unknown>)).not.toHaveProperty("webhookSecret")
    expect(JSON.stringify(payload)).not.toContain("webhookSecret")
  })

  it("includes a new TikTok/Chatwoot webhook secret when the operator enters one", () => {
    const payload = buildChannelPayload(baseForm({
      configName: "TikTok via Chatwoot",
      channelType: "chatwoot",
      apiKey: "new-chatwoot-token",
      chatwootBaseUrl: "https://chatwoot.example",
      chatwootAccountId: "42",
      chatwootWebhookSecret: " new-secret ",
    }))

    expect(payload).toMatchObject({
      apiKey: "new-chatwoot-token",
      settings: { webhookSecret: "new-secret" },
    })
  })

  it("omits blank Meta app and verify secrets so Facebook/Instagram edits keep stored values", () => {
    const payload = buildChannelPayload(baseForm({
      configName: "Instagram",
      channelType: "instagram",
      appId: "meta-app-id",
      appSecret: "",
      verifyToken: "",
      igLogin: true,
    }))

    expect(payload).toMatchObject({
      channelType: "instagram",
      appId: "meta-app-id",
      settings: { igLogin: true },
    })
    expect(JSON.stringify(payload)).not.toContain("appSecret")
    expect(JSON.stringify(payload)).not.toContain("verifyToken")
  })

  it("omits blank WhatsApp credential mirrors so edits keep stored values", () => {
    const payload = buildChannelPayload(baseForm({
      configName: "WhatsApp Business",
      channelType: "whatsapp",
      apiKey: "",
      phoneNumber: "",
      webhookUrl: "",
      verifyToken: "",
      appSecret: "",
      displayName: "Main WA",
    }))
    const serialized = JSON.stringify(payload)

    expect(payload).toMatchObject({
      channelType: "whatsapp",
      displayName: "Main WA",
    })
    expect(serialized).not.toContain("accessToken")
    expect(serialized).not.toContain("phoneNumberId")
    expect(serialized).not.toContain("businessAccountId")
    expect(serialized).not.toContain("verifyToken")
    expect(serialized).not.toContain("appSecret")
  })
})

describe("staged Meta app marker", () => {
  // The builder rebuilds `settings` from scratch on every save, so a flag it does not re-emit is a
  // flag that disappears on the next edit. For this one that is not cosmetic: losing it promotes the
  // app under review to the tenant-wide default, which is exactly what it exists to prevent.
  it("re-emits appReviewOnly so an edit cannot silently clear it", () => {
    for (const channelType of ["facebook", "instagram"]) {
      const payload = buildChannelPayload(baseForm({
        channelType,
        appId: "2414060595720618",
        appSecret: "s",
        verifyToken: "v",
        appReviewOnly: true,
      })) as { settings: Record<string, unknown> }
      expect(payload.settings.appReviewOnly).toBe(true)
    }
  })

  it("omits the marker entirely when the app is not staged", () => {
    const payload = buildChannelPayload(baseForm({
      channelType: "facebook",
      appId: "1276226757359622",
      appReviewOnly: false,
    })) as { settings: Record<string, unknown> }
    expect(payload.settings).not.toHaveProperty("appReviewOnly")
  })

  it("does not leak the marker onto non-Meta channels", () => {
    const payload = buildChannelPayload(baseForm({
      channelType: "whatsapp",
      appReviewOnly: true,
    })) as { settings: Record<string, unknown> }
    expect(payload.settings).not.toHaveProperty("appReviewOnly")
  })
})
