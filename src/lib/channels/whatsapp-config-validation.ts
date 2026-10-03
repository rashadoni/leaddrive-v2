type WhatsAppChannelLike = {
  channelType?: string | null
  apiKey?: string | null
  accessToken?: string | null
  phoneNumber?: string | null
  phoneNumberId?: string | null
  webhookUrl?: string | null
  businessAccountId?: string | null
  verifyToken?: string | null
  appSecret?: string | null
  settings?: unknown
}

/** True when a whatsapp ChannelConfig.settings was written by Embedded Signup (lib/whatsapp-embedded-signup). */
export function isEmbeddedSignupRow(settings: unknown): boolean {
  return !!settings && typeof settings === "object" && !Array.isArray(settings)
    && (settings as { embeddedSignup?: unknown }).embeddedSignup === true
}

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function resolvedValue(
  input: WhatsAppChannelLike,
  existing: WhatsAppChannelLike | null | undefined,
  keys: Array<keyof WhatsAppChannelLike>,
): string | null {
  const inputHasKey = keys.some((key) => Object.prototype.hasOwnProperty.call(input, key))
  const source = inputHasKey ? input : existing
  if (!source) return null

  for (const key of keys) {
    const value = clean(source[key])
    if (value) return value
  }
  return null
}

export function whatsappChannelCredentialsError(
  input: WhatsAppChannelLike,
  existing?: WhatsAppChannelLike | null,
): string | null {
  const channelType = clean(input.channelType) || clean(existing?.channelType)
  if (channelType !== "whatsapp") return null

  const missing: string[] = []
  if (!resolvedValue(input, existing, ["accessToken", "apiKey"])) missing.push("Access Token")
  if (!resolvedValue(input, existing, ["phoneNumberId", "phoneNumber"])) missing.push("Phone Number ID")
  if (!resolvedValue(input, existing, ["businessAccountId", "webhookUrl"])) missing.push("Business Account ID")
  // A number connected through Embedded Signup has no webhook of its own to verify: Meta posts it to the shared
  // app's callback, signed with the shared app's secret (webhooks/whatsapp). Only the STORED row can say so —
  // `embeddedSignup` is server-owned (lib/channels/server-owned-settings), a request cannot claim it.
  if (!isEmbeddedSignupRow(existing?.settings)) {
    if (!resolvedValue(input, existing, ["verifyToken"])) missing.push("Webhook Verify Token")
    if (!resolvedValue(input, existing, ["appSecret"])) missing.push("App Secret")
  }

  return missing.length
    ? `WhatsApp Business API requires ${missing.join(", ")}. These fields are needed for tenant-routed webhooks and WhatsApp Calling readiness.`
    : null
}
