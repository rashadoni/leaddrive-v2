import { decryptToken } from "@/lib/secure-token"
import {
  isSocialOutboundSecurityError,
  requestSocialOutboundJson,
} from "@/lib/social/social-outbound-http"

export type ProviderReplyErrorCode =
  | "provider_reply_not_configured"
  | "provider_reply_not_approved"
  | "provider_reply_endpoint_missing"
  | "provider_reply_endpoint_invalid"
  | "provider_reply_https_required"
  | "provider_reply_host_not_allowed"
  | "provider_reply_target_missing"
  | "provider_reply_token_missing"
  | "provider_reply_fetch_failed"
  | "provider_reply_rate_limited"
  | "provider_reply_payload_invalid"

export interface ProviderReplyMention {
  id: string
  organizationId?: string | null
  platform: string
  externalId: string
  sourceType?: string | null
  sourceProvider?: string | null
  sourceMetadata?: unknown
}

export interface ProviderReplyCapability {
  approved: boolean
  provider: string
  endpoint: string
  targetId: string
  targetType?: string | null
  encryptedToken?: string | null
  allowedHosts?: string[]
}

export interface ProviderReplyResult {
  ok: boolean
  status: number
  code?: ProviderReplyErrorCode
  error?: string
  provider?: string
  replyId?: string | null
  raw?: unknown
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function booleanValue(value: unknown): boolean {
  return value === true
}

function allowedProviderReplyHosts(): Set<string> {
  return new Set((process.env.SOCIAL_REPLY_PROVIDER_ALLOWED_HOSTS || "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean))
}

function stringListFromUnknown(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim().toLowerCase()).filter(Boolean)))
}

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === "localhost" || host.endsWith(".localhost")) return true
  if (host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") return true
  if (/^10\./.test(host) || /^192\.168\./.test(host)) return true
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true
  return false
}

function capabilityRecord(sourceMetadata: unknown): Record<string, unknown> {
  const metadata = asRecord(sourceMetadata)
  const replyCapability = asRecord(metadata.replyCapability)
  if (Object.keys(replyCapability).length) return replyCapability
  return asRecord(metadata.providerReply)
}

function providerName(record: Record<string, unknown>): string {
  return stringValue(record.provider) || stringValue(record.name) || "provider_api"
}

export function hasApprovedProviderReplyCapability(sourceMetadata: unknown): boolean {
  const capability = capabilityRecord(sourceMetadata)
  return booleanValue(capability.approved) &&
    Boolean(stringValue(capability.endpoint)) &&
    Boolean(stringValue(capability.targetId) || stringValue(capability.replyTargetId))
}

export function resolveProviderReplyCapability(sourceMetadata: unknown): { capability?: ProviderReplyCapability; error?: ProviderReplyErrorCode } {
  const capability = capabilityRecord(sourceMetadata)
  if (!Object.keys(capability).length) return { error: "provider_reply_not_configured" }
  if (!booleanValue(capability.approved)) return { error: "provider_reply_not_approved" }

  const endpoint = stringValue(capability.endpoint)
  if (!endpoint) return { error: "provider_reply_endpoint_missing" }
  const targetId = stringValue(capability.targetId) || stringValue(capability.replyTargetId)
  if (!targetId) return { error: "provider_reply_target_missing" }

  return {
    capability: {
      approved: true,
      provider: providerName(capability),
      endpoint,
      targetId,
      targetType: stringValue(capability.targetType),
      encryptedToken: stringValue(capability.encryptedToken),
      allowedHosts: stringListFromUnknown(capability.allowedHosts),
    },
  }
}

function validateEndpoint(endpointValue: string, configuredHosts: string[] = []): { endpoint?: URL; error?: ProviderReplyErrorCode } {
  let endpoint: URL
  try {
    endpoint = new URL(endpointValue)
  } catch {
    return { error: "provider_reply_endpoint_invalid" }
  }
  if (endpoint.protocol !== "https:") return { error: "provider_reply_https_required" }
  if (isPrivateOrLocalHost(endpoint.hostname)) return { error: "provider_reply_host_not_allowed" }

  const allowedHosts = new Set([...allowedProviderReplyHosts(), ...configuredHosts])
  if (allowedHosts.size === 0 || !allowedHosts.has(endpoint.hostname.toLowerCase())) {
    return { error: "provider_reply_host_not_allowed" }
  }
  return { endpoint }
}

function resolveToken(capability: ProviderReplyCapability): { token?: string; error?: ProviderReplyErrorCode } {
  if (!capability.encryptedToken) {
    return {}
  }
  try {
    return { token: decryptToken(capability.encryptedToken, "social-provider-reply") }
  } catch {
    return { error: "provider_reply_token_missing" }
  }
}

function responseErrorStatus(code: ProviderReplyErrorCode): number {
  if (code === "provider_reply_rate_limited") return 429
  if (code === "provider_reply_fetch_failed" || code === "provider_reply_payload_invalid") return 502
  return 409
}

function replyIdFromPayload(payload: unknown): string | null {
  const body = asRecord(payload)
  const data = asRecord(body.data)
  return stringValue(body.replyId) || stringValue(body.id) || stringValue(data.replyId) || stringValue(data.id)
}

export async function sendProviderReply(
  mention: ProviderReplyMention,
  message: string,
  request?: { idempotencyKey?: string | null; providerRequestId?: string | null },
): Promise<ProviderReplyResult> {
  if (mention.sourceProvider !== "provider_api") {
    return {
      ok: false,
      status: 409,
      code: "provider_reply_not_configured",
      error: "Provider reply is only available for provider_api mentions.",
    }
  }

  const resolvedCapability = resolveProviderReplyCapability(mention.sourceMetadata)
  if (!resolvedCapability.capability) {
    const code = resolvedCapability.error ?? "provider_reply_not_configured"
    return { ok: false, status: responseErrorStatus(code), code, error: code }
  }

  const endpoint = validateEndpoint(resolvedCapability.capability.endpoint, resolvedCapability.capability.allowedHosts)
  if (!endpoint.endpoint) {
    const code = endpoint.error ?? "provider_reply_endpoint_invalid"
    return { ok: false, status: responseErrorStatus(code), code, error: code, provider: resolvedCapability.capability.provider }
  }

  const token = resolveToken(resolvedCapability.capability)
  if (token.error) {
    return {
      ok: false,
      status: responseErrorStatus(token.error),
      code: token.error,
      error: token.error,
      provider: resolvedCapability.capability.provider,
    }
  }

  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
  }
  if (request?.idempotencyKey) headers["idempotency-key"] = request.idempotencyKey
  if (request?.providerRequestId) headers["x-request-id"] = request.providerRequestId
  if (token.token) headers.authorization = `Bearer ${token.token}`

  const body = JSON.stringify({
    message,
    text: message,
    targetId: resolvedCapability.capability.targetId,
    targetType: resolvedCapability.capability.targetType,
    platform: mention.platform,
    sourceType: mention.sourceType,
    mentionId: mention.id,
    organizationId: mention.organizationId,
    externalId: mention.externalId,
    idempotencyKey: request?.idempotencyKey ?? undefined,
    requestId: request?.providerRequestId ?? undefined,
  })

  let response: Awaited<ReturnType<typeof requestSocialOutboundJson>>
  try {
    response = await requestSocialOutboundJson(endpoint.endpoint.toString(), {
      method: "POST",
      headers,
      body,
      allowedHosts: Array.from(new Set([
        ...allowedProviderReplyHosts(),
        ...(resolvedCapability.capability.allowedHosts ?? []),
      ])),
      timeoutMs: 10_000,
      maxBodyBytes: 64 * 1024,
      maxResponseBytes: 128 * 1024,
      maxRedirects: 2,
      sensitiveHeaders: ["idempotency-key", "x-request-id"],
    })
  } catch (error) {
    const code: ProviderReplyErrorCode = isSocialOutboundSecurityError(error)
      ? "provider_reply_host_not_allowed"
      : "provider_reply_fetch_failed"
    return {
      ok: false,
      status: responseErrorStatus(code),
      code,
      error: code,
      provider: resolvedCapability.capability.provider,
    }
  }

  if (!response.ok) {
    const code = response.status === 429 ? "provider_reply_rate_limited" : "provider_reply_fetch_failed"
    return {
      ok: false,
      status: responseErrorStatus(code),
      code,
      error: code,
      provider: resolvedCapability.capability.provider,
    }
  }

  return {
    ok: true,
    status: 200,
    provider: resolvedCapability.capability.provider,
    replyId: replyIdFromPayload(response.payload),
  }
}
