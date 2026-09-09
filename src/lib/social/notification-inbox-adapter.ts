import { prisma } from "@/lib/prisma"
import { findMatchedKeyword, ingestMentionWithResult, type IngestInput } from "@/lib/social/ingest-mention"
import { observationContextForCollector, routeExecutionMetadata } from "@/lib/social/collector-observation-context"
import { withSocialProviderTimeout } from "@/lib/social/provider-request-timeout"
import type { CollectorEvidenceDraft, MonitoringCollectorResult, MonitoringSourceForRun } from "@/lib/social/monitoring-collector"
import {
  isSocialOutboundSecurityError,
  requestSocialOutboundJson,
} from "@/lib/social/social-outbound-http"

type NotificationEmail = {
  id?: string
  from?: string
  subject?: string
  text?: string
  html?: string
  receivedAt?: string
  raw?: Record<string, unknown>
}

export interface ParsedSocialNotification {
  platform: string
  externalId: string
  text: string
  permalink: string | null
  authorName: string | null
  confidence: number
  reviewRequired: boolean
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function stripHtml(value: string): string {
  return value.replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function allowedHosts(): Set<string> {
  return new Set((process.env.SOCIAL_NOTIFICATION_INBOX_ALLOWED_HOSTS || "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean))
}

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === "localhost" || host.endsWith(".localhost")) return true
  if (host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") return true
  if (/^10\./.test(host) || /^192\.168\./.test(host)) return true
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true
  return false
}

function settings(source: MonitoringSourceForRun): Record<string, unknown> {
  return recordFromUnknown(recordFromUnknown(source.settings).notificationInbox)
}

function resolveEndpoint(source: MonitoringSourceForRun): { endpoint?: URL; error?: string } {
  const inbox = settings(source)
  if (inbox.approved !== true) return { error: "notification_inbox_not_approved" }
  const endpointValue = stringValue(inbox.endpoint)
  if (!endpointValue) return { error: "notification_inbox_endpoint_missing" }
  let endpoint: URL
  try {
    endpoint = new URL(endpointValue)
  } catch {
    return { error: "notification_inbox_endpoint_invalid" }
  }
  if (endpoint.protocol !== "https:") return { error: "notification_inbox_https_required" }
  if (isPrivateOrLocalHost(endpoint.hostname)) return { error: "notification_inbox_host_not_allowed" }
  const allowed = allowedHosts()
  if (allowed.size === 0 || !allowed.has(endpoint.hostname.toLowerCase())) return { error: "notification_inbox_host_not_allowed" }
  const address = stringValue(inbox.address)
  if (address) endpoint.searchParams.set("address", address)
  endpoint.searchParams.set("limit", "25")
  return { endpoint }
}

function detectPlatform(text: string): string | null {
  const lower = text.toLowerCase()
  if (lower.includes("instagram")) return "instagram"
  if (lower.includes("facebook")) return "facebook"
  if (lower.includes("tiktok")) return "tiktok"
  if (lower.includes("twitter") || lower.includes("x.com")) return "twitter"
  return null
}

function firstUrl(text: string): string | null {
  return text.match(/https?:\/\/[^\s"'<>]+/i)?.[0]?.replace(/[),.]+$/, "") ?? null
}

export function parseSocialNotificationEmail(email: NotificationEmail): ParsedSocialNotification | null {
  const subject = email.subject || ""
  const body = email.text || (email.html ? stripHtml(email.html) : "")
  const combined = [email.from, subject, body].filter(Boolean).join("\n")
  const platform = detectPlatform(combined)
  if (!platform) return null
  const permalink = firstUrl(combined)
  const quoted = body.match(/[“"]([^”"]{8,500})[”"]/)
  const text = (quoted?.[1] || body || subject).replace(/\s+/g, " ").trim()
  if (!text) return null
  const author = subject.match(/from\s+([^:]+):/i)?.[1]?.trim() || body.match(/@([A-Za-z0-9_.-]+)/)?.[1] || null
  const confidence = (permalink ? 0.35 : 0) + (quoted ? 0.25 : 0) + (author ? 0.15 : 0) + 0.2
  return {
    platform,
    externalId: `notification:${email.id || permalink || `${platform}:${subject}:${text.slice(0, 48)}`}`,
    text,
    permalink,
    authorName: author,
    confidence: Math.min(0.95, confidence),
    reviewRequired: confidence < 0.7,
  }
}

function notificationEmails(payload: unknown): NotificationEmail[] | null {
  const body = recordFromUnknown(payload)
  const items = Array.isArray(body.messages) ? body.messages : Array.isArray(body.items) ? body.items : Array.isArray(body.data) ? body.data : null
  if (!items) return null
  return items
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      id: stringValue(item.id) ?? undefined,
      from: stringValue(item.from) ?? undefined,
      subject: stringValue(item.subject) ?? undefined,
      text: stringValue(item.text) ?? undefined,
      html: stringValue(item.html) ?? undefined,
      receivedAt: stringValue(item.receivedAt) ?? undefined,
      raw: item,
    }))
}

async function ingestNotification(source: MonitoringSourceForRun, email: NotificationEmail, parsed: ParsedSocialNotification, evidence: CollectorEvidenceDraft) {
  const input: IngestInput = {
    organizationId: source.organizationId,
    accountId: null,
    platform: parsed.platform,
    externalId: parsed.externalId,
    sourceType: "mention",
    sourceProvider: "notification_inbox",
    sourceMetadata: {
      monitoringSourceId: source.id,
      collector: "notification_inbox",
      reviewRequired: parsed.reviewRequired,
      replyPolicy: "manual_only",
      notificationEmailId: email.id ?? null,
      ...routeExecutionMetadata(source),
    },
    text: parsed.text,
    sentiment: null,
    matchedTerm: findMatchedKeyword(parsed.text, source.keywords ?? []),
    url: parsed.permalink,
    authorName: parsed.authorName,
    publishedAt: email.receivedAt ? new Date(email.receivedAt) : null,
    observation: observationContextForCollector(source, {
      providerItemId: email.id ?? parsed.externalId,
      rawPayload: evidence.rawPayload ?? email.raw ?? {},
    }),
  }
  const result = await ingestMentionWithResult(input)
  if (result.accepted === false) return result
  const existing = await prisma.mentionEvidence.findFirst({
    where: {
      organizationId: source.organizationId,
      mentionId: result.id,
      sourceId: source.id,
      ...(parsed.permalink ? { permalink: parsed.permalink } : {}),
    },
    select: { id: true },
  })
  if (!existing) {
    await prisma.mentionEvidence.create({
      data: {
        organizationId: source.organizationId,
        mentionId: result.id,
        sourceId: source.id,
        permalink: evidence.permalink ?? null,
        screenshotUrl: null,
        rawSnippet: evidence.rawSnippet ?? parsed.text,
        rawPayload: evidence.rawPayload ?? email.raw ?? {},
        confidence: parsed.confidence,
        sourceTrustTier: "T4",
      },
    })
  }
  return result
}

export async function runNotificationInboxCollector(source: MonitoringSourceForRun): Promise<MonitoringCollectorResult> {
  const resolved = resolveEndpoint(source)
  if (!resolved.endpoint) return {
    status: "skipped",
    foundCount: 0,
    newCount: 0,
    duplicateCount: 0,
    ignoredCount: 0,
    error: resolved.error ?? "notification_inbox_not_configured",
    rawStats: { manualActionOnly: true },
  }
  const endpoint = resolved.endpoint

  let inboxResponse: Awaited<ReturnType<typeof requestSocialOutboundJson>>
  try {
    inboxResponse = await withSocialProviderTimeout("notification_inbox", async () => requestSocialOutboundJson(
      endpoint.toString(),
      {
        method: "GET",
        headers: { accept: "application/json" },
        allowedHosts: Array.from(allowedHosts()),
      },
    ), { signal: source.providerRequestSignal })
  } catch (error) {
    const outboundBlocked = isSocialOutboundSecurityError(error)
    return {
      status: outboundBlocked ? "skipped" : "failed",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: outboundBlocked
        ? "notification_inbox_outbound_blocked"
        : "notification_inbox_fetch_failed",
      rawStats: { manualActionOnly: true, outboundSafeTransport: true },
    }
  }
  if (!inboxResponse.ok) return {
    status: inboxResponse.status === 429 ? "partial" : "failed",
    foundCount: 0,
    newCount: 0,
    duplicateCount: 0,
    ignoredCount: 0,
    error: inboxResponse.status === 429 ? "notification_inbox_rate_limited" : "notification_inbox_fetch_failed",
    rawStats: { status: inboxResponse.status, outboundSafeTransport: true },
  }

  const emails = notificationEmails(inboxResponse.payload)
  if (!emails) return {
    status: "failed",
    foundCount: 0,
    newCount: 0,
    duplicateCount: 0,
    ignoredCount: 0,
    error: "notification_inbox_payload_invalid",
    rawStats: { manualActionOnly: true },
  }

  let foundCount = 0
  let newCount = 0
  let duplicateCount = 0
  let ignoredCount = 0
  for (const email of emails) {
    const parsed = parseSocialNotificationEmail(email)
    if (!parsed) {
      ignoredCount++
      continue
    }
    foundCount++
    const result = await ingestNotification(source, email, parsed, {
      permalink: parsed.permalink,
      rawSnippet: parsed.text,
      rawPayload: email.raw,
      confidence: parsed.confidence,
      sourceTrustTier: "T4",
    })
    if (result.accepted === false) ignoredCount++
    else if (result.created) newCount++
    else duplicateCount++
  }

  return {
    status: "success",
    foundCount,
    newCount,
    duplicateCount,
    ignoredCount,
    error: null,
    rawStats: { manualActionOnly: true, externalReadOnly: true },
  }
}
