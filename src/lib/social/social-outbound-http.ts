import {
  OutboundWebhookSecurityError,
  requestOutboundWebhook,
  validateOutboundWebhookUrl,
} from "@/lib/integrations/webhook-url-guard"

const SOCIAL_OUTBOUND_TIMEOUT_MS = 20_000
const SOCIAL_OUTBOUND_MAX_RESPONSE_BYTES = 1024 * 1024
const SOCIAL_OUTBOUND_MAX_REDIRECTS = 2

export class SocialOutboundConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SocialOutboundConfigurationError"
  }
}

export function isSocialOutboundSecurityError(error: unknown): boolean {
  return error instanceof SocialOutboundConfigurationError || error instanceof OutboundWebhookSecurityError
}

export type SocialOutboundJsonResponse = {
  ok: boolean
  status: number
  payload: unknown
  finalUrl: string
  redirects: number
}

type SocialOutboundJsonRequest = {
  method?: "GET" | "POST"
  headers?: Record<string, string>
  body?: string
  allowedHosts: readonly string[]
  timeoutMs?: number
  maxBodyBytes?: number
  maxResponseBytes?: number
  maxRedirects?: number
  sensitiveHeaders?: readonly string[]
}

function normalizedHostname(value: string): string {
  const hostname = value.trim().toLowerCase().replace(/^\[|\]$/g, "")
  return hostname.endsWith(".") ? hostname.slice(0, -1) : hostname
}

export function normalizeSocialOutboundHosts(values: readonly string[]): string[] {
  return Array.from(new Set(values.map(normalizedHostname).filter(Boolean)))
}

function parseSocialOutboundEndpoint(rawUrl: string, label: string): URL {
  let endpoint: URL
  try {
    endpoint = new URL(rawUrl)
  } catch {
    throw new SocialOutboundConfigurationError(`${label} is invalid`)
  }
  if (endpoint.protocol !== "https:") {
    throw new SocialOutboundConfigurationError(`${label} must use HTTPS`)
  }
  if (endpoint.username || endpoint.password) {
    throw new SocialOutboundConfigurationError(`${label} must not contain credentials`)
  }
  endpoint.hash = ""
  return endpoint
}

/**
 * Validate a tenant-controlled endpoint before it is persisted. DNS is
 * resolved here as well as at execution time; execution remains authoritative
 * because DNS can change after the settings write.
 */
export async function validateSocialOutboundEndpointForWrite(
  rawUrl: string,
  label: string,
): Promise<string> {
  const endpoint = parseSocialOutboundEndpoint(rawUrl, label)
  try {
    const validated = await validateOutboundWebhookUrl(endpoint.toString(), {
      allowHttp: false,
    })
    return validated.url.toString()
  } catch (error) {
    if (error instanceof OutboundWebhookSecurityError) {
      throw new SocialOutboundConfigurationError(
        `${label} must resolve only to public internet addresses`,
      )
    }
    throw new SocialOutboundConfigurationError(
      `${label} hostname could not be resolved`,
    )
  }
}

/** Validate every executable endpoint embedded in MonitoringSource.settings. */
export async function validateMonitoringSourceOutboundEndpoints(
  settingsValue: unknown,
): Promise<void> {
  if (!settingsValue || typeof settingsValue !== "object" || Array.isArray(settingsValue)) return
  const settings = settingsValue as Record<string, unknown>
  const searchIndex = settings.searchIndex && typeof settings.searchIndex === "object" && !Array.isArray(settings.searchIndex)
    ? settings.searchIndex as Record<string, unknown>
    : {}
  const notificationInbox = settings.notificationInbox && typeof settings.notificationInbox === "object" && !Array.isArray(settings.notificationInbox)
    ? settings.notificationInbox as Record<string, unknown>
    : {}
  const provider = settings.provider && typeof settings.provider === "object" && !Array.isArray(settings.provider)
    ? settings.provider as Record<string, unknown>
    : {}
  const reply = provider.reply && typeof provider.reply === "object" && !Array.isArray(provider.reply)
    ? provider.reply as Record<string, unknown>
    : {}

  const endpoints: Array<Promise<unknown>> = []
  if (typeof searchIndex.endpoint === "string" && searchIndex.endpoint.trim()) {
    endpoints.push(validateSocialOutboundEndpointForWrite(searchIndex.endpoint, "Search-index endpoint"))
  }
  if (typeof notificationInbox.endpoint === "string" && notificationInbox.endpoint.trim()) {
    endpoints.push(validateSocialOutboundEndpointForWrite(notificationInbox.endpoint, "Notification-inbox endpoint"))
  }
  if (typeof provider.endpoint === "string" && provider.endpoint.trim()) {
    endpoints.push(validateSocialOutboundEndpointForWrite(provider.endpoint, "Provider endpoint"))
  }
  if (typeof reply.endpoint === "string" && reply.endpoint.trim()) {
    endpoints.push(validateSocialOutboundEndpointForWrite(reply.endpoint, "Provider reply endpoint"))
  }
  await Promise.all(endpoints)
}

/**
 * Read a bounded JSON response through the DNS-validated, IP-pinned transport.
 * The exact host allowlist is passed into the transport so every redirect hop
 * is constrained as well as independently DNS-validated.
 */
export async function requestSocialOutboundJson(
  rawUrl: string,
  options: SocialOutboundJsonRequest,
): Promise<SocialOutboundJsonResponse> {
  const endpoint = parseSocialOutboundEndpoint(rawUrl, "Social provider endpoint")
  const allowedHosts = normalizeSocialOutboundHosts(options.allowedHosts)
  const endpointHost = normalizedHostname(endpoint.hostname)
  if (allowedHosts.length === 0 || !allowedHosts.includes(endpointHost)) {
    throw new SocialOutboundConfigurationError("Social provider endpoint host is not allowlisted")
  }

  const response = await requestOutboundWebhook(endpoint.toString(), {
    method: options.method ?? "GET",
    headers: options.headers,
    body: options.body,
    allowHttp: false,
    allowedHosts,
    timeoutMs: options.timeoutMs ?? SOCIAL_OUTBOUND_TIMEOUT_MS,
    maxBodyBytes: options.maxBodyBytes,
    maxResponseBytes: options.maxResponseBytes ?? SOCIAL_OUTBOUND_MAX_RESPONSE_BYTES,
    maxRedirects: options.maxRedirects ?? SOCIAL_OUTBOUND_MAX_REDIRECTS,
    sensitiveHeaders: options.sensitiveHeaders,
  })

  let payload: unknown = null
  // Error bodies are provider-controlled and may contain stack traces,
  // credentials, or reflected input. Keep only status outside this boundary.
  if (response.ok && response.bodyText) {
    try {
      payload = JSON.parse(response.bodyText)
    } catch {
      payload = null
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    payload,
    finalUrl: response.url,
    redirects: response.redirects,
  }
}
