export {}

type SocialSettingsPrincipal = {
  role: string
  scopes?: unknown
}

const MONITORING_SEARCH_SENSITIVE_KEYS = new Set([
  "enabled",
  "provider",
  "endpoint",
  "allowedHosts",
  "token",
  "clearToken",
])

const SOURCE_OUTBOUND_SENSITIVE_KEYS = new Set([
  "approved",
  "enabled",
  "provider",
  "endpoint",
  "allowedHosts",
  "replyAllowedHosts",
  "token",
  "clearToken",
  "encryptedToken",
  "tokenEnv",
])

function recordFromUnknown(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function containsSensitiveKey(value: unknown): boolean {
  const record = recordFromUnknown(value)
  for (const [key, nested] of Object.entries(record)) {
    if (SOURCE_OUTBOUND_SENSITIVE_KEYS.has(key)) return true
    if (containsSensitiveKey(nested)) return true
  }
  return false
}

/** API keys have scopes at runtime; browser Auth.js principals never do. */
export function isBrowserSessionAdmin(principal: SocialSettingsPrincipal): boolean {
  const apiKeyPrincipal = Array.isArray(principal.scopes)
  return !apiKeyPrincipal && ["admin", "superadmin"].includes(principal.role)
}

export function changesSensitiveMonitoringSettings(input: unknown): boolean {
  const settings = recordFromUnknown(input)
  const searchIndex = recordFromUnknown(settings.searchIndex)
  if (Object.keys(searchIndex).some(key => MONITORING_SEARCH_SENSITIVE_KEYS.has(key))) return true

  const provider = recordFromUnknown(settings.provider)
  return Object.keys(provider).some(key => ["allowedHosts", "replyAllowedHosts"].includes(key))
}

export function changesSensitiveSourceOutboundSettings(settings: unknown): boolean {
  const sourceSettings = recordFromUnknown(settings)
  return ["searchIndex", "provider", "notificationInbox"]
    .some(key => containsSensitiveKey(sourceSettings[key]))
}
