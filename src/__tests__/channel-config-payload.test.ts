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
