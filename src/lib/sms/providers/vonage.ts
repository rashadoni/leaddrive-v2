import type { SmsProvider, SmsProviderSettings, SmsSendParams, SmsSendResult } from "./types"

interface VonageSettings extends SmsProviderSettings {
  apiKey?: string
  apiSecret?: string
  fromName?: string
}

/**
 * Vonage (Nexmo) SMS provider — HTTP-only, no SDK dependency.
 *
 * Settings shape:
 *   { apiKey, apiSecret, fromName }
 *
 * Env fallbacks:
 *   VONAGE_API_KEY, VONAGE_API_SECRET, VONAGE_FROM_NAME
 */
export const vonageProvider: SmsProvider = {
  name: "vonage",

  isConfigured(settings: SmsProviderSettings, allowEnv = true): boolean {
    const s = settings as VonageSettings
    const key = s.apiKey || (allowEnv ? process.env.VONAGE_API_KEY : undefined)
    const secret = s.apiSecret || (allowEnv ? process.env.VONAGE_API_SECRET : undefined)
    return Boolean(key && secret)
  },

  async send(settings: SmsProviderSettings, params: SmsSendParams, allowEnv = true): Promise<SmsSendResult> {
    const s = settings as VonageSettings
    const apiKey = s.apiKey || (allowEnv ? process.env.VONAGE_API_KEY : undefined)
    const apiSecret = s.apiSecret || (allowEnv ? process.env.VONAGE_API_SECRET : undefined)
    const from = params.from || s.fromName || (allowEnv ? process.env.VONAGE_FROM_NAME : undefined) || "LeadDrive"

    if (!apiKey || !apiSecret) {
      return { success: false, error: "Vonage not configured" }
    }

    try {
      const body = new URLSearchParams({
        api_key: apiKey,
        api_secret: apiSecret,
        to: params.to.replace(/^\+/, ""), // Vonage expects no leading +
        from,
        text: params.message,
      })
      const res = await fetch("https://rest.nexmo.com/sms/json", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      })

      if (!res.ok) {
        return { success: false, error: `Vonage ${res.status}` }
      }
      const data = (await res.json().catch(() => ({}))) as { messages?: Array<{ "message-id"?: string; status?: string; "error-text"?: string }> }
      const first = data.messages?.[0]
      if (!first || first.status !== "0") {
        return { success: false, error: first?.["error-text"] || "Vonage: unknown error" }
      }
      return { success: true, messageId: first["message-id"] }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  },
}
