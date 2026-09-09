import { prisma } from "@/lib/prisma"
import { findMatchedKeyword, ingestMentionWithResult, type IngestInput } from "@/lib/social/ingest-mention"
import { observationContextForCollector, routeExecutionMetadata } from "@/lib/social/collector-observation-context"
import type { CollectorEvidenceDraft, MonitoringCollectorResult, MonitoringSourceForRun } from "@/lib/social/monitoring-collector"

type CaptureItem = Record<string, unknown>

function recordFromUnknown(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function captureSettings(source: MonitoringSourceForRun): Record<string, unknown> {
  return recordFromUnknown(recordFromUnknown(source.settings).browserCapture)
}

function captureItems(source: MonitoringSourceForRun): CaptureItem[] {
  const captures = captureSettings(source).captures
  if (!Array.isArray(captures)) return []
  return captures.filter((item): item is CaptureItem => Boolean(item) && typeof item === "object" && !Array.isArray(item))
}

function normalizeCapture(source: MonitoringSourceForRun, item: CaptureItem): IngestInput | null {
  if (item.operatorApproved !== true) return null
  const text = stringValue(item.text) || stringValue(item.snippet)
  const permalink = stringValue(item.permalink) || stringValue(item.url)
  if (!text || !permalink) return null
  return {
    organizationId: source.organizationId,
    accountId: null,
    platform: stringValue(item.platform) || source.platform,
    externalId: `browser:${permalink}`,
    sourceType: stringValue(item.sourceType) || "mention",
    sourceProvider: "browser_capture",
    sourceMetadata: {
      monitoringSourceId: source.id,
      collector: "browser_capture",
      ...routeExecutionMetadata(source),
      operatorApproved: true,
      replyPolicy: "manual_only",
      noAutomationBypass: true,
    },
    text,
    sentiment: null,
    matchedTerm: findMatchedKeyword(text, source.keywords ?? []),
    url: permalink,
    authorName: stringValue(item.authorName),
    authorHandle: stringValue(item.authorHandle),
    publishedAt: stringValue(item.publishedAt) ? new Date(stringValue(item.publishedAt) as string) : null,
  }
}

async function ingestCapture(source: MonitoringSourceForRun, input: IngestInput, item: CaptureItem, evidence: CollectorEvidenceDraft) {
  const result = await ingestMentionWithResult({
    ...input,
    sentiment: input.sentiment ?? null,
    observation: observationContextForCollector(source, {
      providerItemId: stringValue(item.id) || input.externalId,
      rawPayload: evidence.rawPayload ?? item,
    }),
  })
  if (result.accepted === false) return result
  const existing = await prisma.mentionEvidence.findFirst({
    where: {
      organizationId: source.organizationId,
      mentionId: result.id,
      sourceId: source.id,
      permalink: input.url ?? undefined,
    },
    select: { id: true },
  })
  if (!existing) {
    await prisma.mentionEvidence.create({
      data: {
        organizationId: source.organizationId,
        mentionId: result.id,
        sourceId: source.id,
        permalink: input.url ?? null,
        screenshotUrl: evidence.screenshotUrl ?? null,
        rawSnippet: evidence.rawSnippet ?? input.text,
        rawPayload: evidence.rawPayload ?? item,
        confidence: evidence.confidence,
        sourceTrustTier: "T5",
      },
    })
  }
  return result
}

export async function runBrowserCaptureCollector(source: MonitoringSourceForRun): Promise<MonitoringCollectorResult> {
  if (process.env.SOCIAL_BROWSER_CAPTURE_ENABLED !== "1") {
    return {
      status: "skipped",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: "browser_capture_feature_disabled",
      rawStats: { manualActionOnly: true, noAutomationBypass: true },
    }
  }
  const settings = captureSettings(source)
  if (settings.approved !== true) {
    return {
      status: "skipped",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: "browser_capture_not_approved",
      rawStats: { manualActionOnly: true, noAutomationBypass: true },
    }
  }

  let foundCount = 0
  let newCount = 0
  let duplicateCount = 0
  let ignoredCount = 0
  for (const item of captureItems(source)) {
    const normalized = normalizeCapture(source, item)
    if (!normalized) {
      ignoredCount++
      continue
    }
    foundCount++
    const result = await ingestCapture(source, normalized, item, {
      permalink: normalized.url,
      screenshotUrl: stringValue(item.screenshotUrl),
      rawSnippet: normalized.text,
      rawPayload: item,
      confidence: 0.6,
      sourceTrustTier: "T5",
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
    rawStats: { manualActionOnly: true, noAutomationBypass: true },
  }
}
