type ChannelConfigForResponse = {
  channelType?: string | null
  botToken?: string | null
  apiKey?: string | null
  appSecret?: string | null
  accessToken?: string | null
  phoneNumberId?: string | null
  businessAccountId?: string | null
  verifyToken?: string | null
  phoneNumber?: string | null
  webhookUrl?: string | null
  settings?: unknown
}

type PublicChannelConfigOptions = {
  revealVoipSettings?: boolean
}

const PUBLIC_VOIP_SETTING_KEYS = new Set([
  "provider",
  "recordCalls",
  "voiceAgentEnabled",
  "manualLeadAiCallsEnabled",
  "voiceAgentMode",
])

export function publicChannelConfig<T extends ChannelConfigForResponse>(
  channel: T,
  options: PublicChannelConfigOptions = {},
) {
  const {
    botToken,
    apiKey,
    appSecret,
    accessToken,
    phoneNumberId,
    businessAccountId,
    verifyToken,
    settings,
    ...safe
  } = channel

  return {
    ...safe,
    settings: publicChannelSettings(
      settings,
      channel.channelType === "voip" && options.revealVoipSettings !== true,
      channel.channelType === "voip" && options.revealVoipSettings === true,
    ),
    hasBotToken: Boolean(botToken),
    hasApiKey: Boolean(apiKey),
    hasAppSecret: Boolean(appSecret),
    hasAccessToken: Boolean(accessToken || apiKey),
    hasPhoneNumberId: Boolean(phoneNumberId || channel.phoneNumber),
    hasBusinessAccountId: Boolean(businessAccountId || channel.webhookUrl),
    hasVerifyToken: Boolean(verifyToken),
    hasWebhookSecret: hasStringSetting(settings, "webhookSecret"),
  }
}

function publicChannelSettings(
  settings: unknown,
  restrictVoipSettings: boolean,
  revealVoipSettings: boolean,
): unknown {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return settings
  const safeSettings = { ...(settings as Record<string, unknown>) }
  delete safeSettings.outboundCallDispatchPaused
  delete safeSettings.voiceAttemptRegistryEnabled
  if (!revealVoipSettings) delete safeSettings.webhookSecret

  // F-33: everything above is a hand-maintained deny list, and `settings` is a
  // free-form JSON blob that grows whenever a channel gains a credential. Two
  // were added the same week this was written — the VK Callback `secret` and the
  // SMS `inboundSecret` — and neither would have been removed by a list that
  // predates them. The next one would not be either.
  //
  // So names carry the rule instead: anything that reads as a credential is
  // dropped, and the UI is told the value EXISTS through a `has*` flag rather
  // than handed the value. Deliberately not matching bare "token": settings hold
  // `tokenExpiresAt` and similar non-secret metadata the UI renders.
  for (const key of Object.keys(safeSettings)) {
    if (looksLikeCredential(key)) {
      delete safeSettings[key]
      safeSettings[`has${key[0].toUpperCase()}${key.slice(1)}`] = hasStringSetting(settings, key)
    }
  }
  if (restrictVoipSettings) {
    for (const key of Object.keys(safeSettings)) {
      if (!PUBLIC_VOIP_SETTING_KEYS.has(key)) delete safeSettings[key]
    }
  }
  return safeSettings
}

/**
 * Whether a settings key names a credential rather than a setting.
 *
 * Matches on the shapes credentials actually take in this blob — `secret`,
 * `password`, `apiKey`, `accessToken`, `refreshToken`, `authToken`,
 * `clientSecret`, `atlPassword`, `inboundSecret` — while leaving metadata like
 * `tokenExpiresAt` alone. A bare "token" match would take that with it.
 */
function looksLikeCredential(key: string): boolean {
  const k = key.toLowerCase()
  if (k.endsWith("expiresat") || k.endsWith("expiry") || k.startsWith("has")) return false
  return (
    k.includes("secret") ||
    k.includes("password") ||
    k.includes("passwd") ||
    k.includes("credential") ||
    k.includes("privatekey") ||
    k === "apikey" ||
    k.endsWith("apikey") ||
    k.endsWith("accesstoken") ||
    k.endsWith("refreshtoken") ||
    k.endsWith("authtoken") ||
    k.endsWith("bottoken")
  )
}

function hasStringSetting(settings: unknown, key: string): boolean {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return false
  const value = (settings as Record<string, unknown>)[key]
  return typeof value === "string" && value.trim().length > 0
}
