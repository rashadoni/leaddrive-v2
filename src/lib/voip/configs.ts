import type { ChannelConfig } from "@prisma/client"
import type { VoipSettings } from "./types"

export type VoipProviderName = VoipSettings["provider"]

export const VOIP_PROVIDER_LABELS: Record<VoipProviderName, string> = {
  twilio: "Twilio",
  threecx: "3CX",
  asterisk: "Asterisk",
  "custom-sip": "Custom SIP",
}

const VOIP_PROVIDER_NAMES = new Set<VoipProviderName>(["twilio", "threecx", "asterisk", "custom-sip"])

type VoipConfigLike = Pick<ChannelConfig, "id" | "configName" | "phoneNumber" | "apiKey" | "settings" | "isActive">

function value(record: Record<string, unknown>, key: string): string {
  const raw = record[key]
  return typeof raw === "string" ? raw.trim() : ""
}

function boolValue(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true
}

function failClosedPauseValue(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key) && record[key] !== false
}

export function normalizeVoipProvider(raw: unknown): VoipProviderName | null {
  if (typeof raw !== "string") return null
  return VOIP_PROVIDER_NAMES.has(raw as VoipProviderName) ? raw as VoipProviderName : null
}

function inferLegacyProvider(settings: Record<string, unknown>): VoipProviderName | null {
  if (value(settings, "accountSid") || value(settings, "authToken") || value(settings, "twilioNumber")) return "twilio"
  if (value(settings, "serverUrl") || value(settings, "extension")) return "threecx"
  if (value(settings, "ariHost") || value(settings, "callerExtension")) return "asterisk"
  if (value(settings, "sipServer") || value(settings, "sipDomain")) return "custom-sip"
  return null
}

export function normalizeVoipSettings(
  config: VoipConfigLike,
  organizationId?: string,
): VoipSettings | null {
  const settings = (config.settings || {}) as Record<string, unknown>
  const provider = normalizeVoipProvider(settings.provider) ?? inferLegacyProvider(settings)
  if (!provider) return null

  const recordCalls = boolValue(settings, "recordCalls")
  switch (provider) {
    case "twilio":
      return {
        provider,
        accountSid: value(settings, "accountSid"),
        authToken: value(settings, "authToken") || config.apiKey || "",
        twilioNumber: value(settings, "twilioNumber") || config.phoneNumber || "",
        recordCalls,
      }
    case "threecx":
      return {
        provider,
        serverUrl: value(settings, "serverUrl"),
        extension: value(settings, "extension"),
        apiKey: value(settings, "apiKey") || config.apiKey || "",
        clientId: value(settings, "clientId") || undefined,
        deviceId: value(settings, "deviceId") || undefined,
        webhookSecret: value(settings, "webhookSecret") || undefined,
        recordCalls,
      }
    case "asterisk":
      return {
        provider,
        organizationId,
        voiceAttemptRegistryEnabled: boolValue(settings, "voiceAttemptRegistryEnabled"),
        outboundCallDispatchPaused: failClosedPauseValue(settings, "outboundCallDispatchPaused"),
        ariHost: value(settings, "ariHost"),
        ariPort: Number(settings.ariPort) || 8088,
        username: value(settings, "username"),
        password: value(settings, "password") || config.apiKey || "",
        context: value(settings, "context") || "from-internal",
        callerExtension: value(settings, "callerExtension"),
        recordCalls,
      }
    case "custom-sip":
      return {
        provider,
        sipServer: value(settings, "sipServer"),
        sipPort: Number(settings.sipPort) || 5060,
        sipDomain: value(settings, "sipDomain"),
        transport: (value(settings, "transport") as "udp" | "tcp" | "tls" | "wss") || "wss",
        username: value(settings, "username"),
        secret: value(settings, "secret") || config.apiKey || "",
        recordCalls,
      }
  }
}

export function missingVoipFields(settings: VoipSettings | null): string[] {
  if (!settings) return ["provider"]
  switch (settings.provider) {
    case "twilio":
      return [
        !settings.accountSid ? "Account SID" : "",
        !settings.authToken ? "Auth Token" : "",
        !settings.twilioNumber ? "Twilio Phone Number" : "",
      ].filter(Boolean)
    case "threecx":
      return [
        !settings.serverUrl ? "Server URL" : "",
        !settings.extension ? "Extension" : "",
        !settings.apiKey ? "API Key" : "",
      ].filter(Boolean)
    case "asterisk":
      return [
        !settings.ariHost ? "ARI Host" : "",
        !settings.username ? "Username" : "",
        !settings.password ? "Password" : "",
        !settings.callerExtension ? "Caller Extension" : "",
      ].filter(Boolean)
    case "custom-sip":
      return [
        !settings.sipServer ? "SIP Server" : "",
        !settings.sipDomain ? "SIP Domain" : "",
        !settings.username ? "Username" : "",
        !settings.secret ? "Secret" : "",
      ].filter(Boolean)
  }
}

export function voipFromNumber(settings: VoipSettings): string {
  switch (settings.provider) {
    case "twilio":
      return settings.twilioNumber || "unknown"
    case "threecx":
      return settings.extension || "unknown"
    case "asterisk":
      return settings.callerExtension || "unknown"
    case "custom-sip":
      return settings.username || "unknown"
  }
}

export type ExposedVoipProvider = {
  id: string
  provider: VoipProviderName
  label: string
  ready: boolean
  missing: string[]
  fromNumber: string
}

export function exposeVoipProvider(config: VoipConfigLike): ExposedVoipProvider | null {
  if (!config.isActive) return null
  const settings = normalizeVoipSettings(config)
  if (!settings) return null
  const missing = missingVoipFields(settings)
  return {
    id: config.id,
    provider: settings.provider,
    label: config.configName || VOIP_PROVIDER_LABELS[settings.provider],
    ready: missing.length === 0,
    missing,
    fromNumber: voipFromNumber(settings),
  }
}
