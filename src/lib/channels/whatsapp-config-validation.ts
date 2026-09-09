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
  if (!resolvedValue(input, existing, ["verifyToken"])) missing.push("Webhook Verify Token")
  if (!resolvedValue(input, existing, ["appSecret"])) missing.push("App Secret")

  return missing.length
    ? `WhatsApp Business API requires ${missing.join(", ")}. These fields are needed for tenant-routed webhooks and WhatsApp Calling readiness.`
    : null
}
