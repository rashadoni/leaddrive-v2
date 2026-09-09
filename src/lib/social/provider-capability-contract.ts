import crypto from "crypto"
import type { IngestInput } from "@/lib/social/ingest-mention"

export const PROVIDER_CONTRACT_VERSION = "social-provider-capabilities-v1"

export const PROVIDER_CAPABILITIES = [
  "DISCOVER_URLS",
  "ENRICH_CONTENT",
  "READ_COMMENTS",
  "READ_MEDIA",
  "UPDATE_METRICS",
] as const

export type ProviderCapability = (typeof PROVIDER_CAPABILITIES)[number]
export type ProviderContentKind = "POST" | "VIDEO" | "IMAGE" | "AUDIO" | "COMMENT" | "REPLY" | "ARTICLE" | "UNKNOWN"
export type ProviderMediaKind = "IMAGE" | "VIDEO" | "THUMBNAIL" | "AUDIO"

export interface ProviderProvenance {
  providerKey: string
  adapterKey: string
  providerItemId: string
  observedAt: string
  schemaVersion: string
}

export interface ProviderCandidateRecord {
  recordType: "CANDIDATE"
  platform: string
  url: string
  canonicalUrl?: string | null
  externalId?: string | null
  query?: string | null
  /** Provider publication time used to enforce archive windows before enrichment. */
  publishedAt?: string | null
  provenance: ProviderProvenance
}

export interface ProviderAuthor {
  externalId?: string | null
  name?: string | null
  handle?: string | null
  avatarUrl?: string | null
  profileUrl?: string | null
}

export interface ProviderContentRecord {
  recordType: "CONTENT"
  platform: string
  externalId: string
  contentKind: Exclude<ProviderContentKind, "COMMENT" | "REPLY">
  url: string
  canonicalUrl?: string | null
  text: string
  title?: string | null
  publishedAt?: string | null
  editedAt?: string | null
  author?: ProviderAuthor | null
  provenance: ProviderProvenance
}

export interface ProviderCommentRecord {
  recordType: "COMMENT"
  platform: string
  externalId: string
  contentKind: "COMMENT" | "REPLY"
  text: string
  url?: string | null
  canonicalUrl?: string | null
  postExternalId: string
  parentExternalId?: string | null
  threadExternalId?: string | null
  replyToExternalId?: string | null
  parentPostUrl: string
  depth: number
  publishedAt?: string | null
  editedAt?: string | null
  likes?: number | null
  replies?: number | null
  author?: ProviderAuthor | null
  provenance: ProviderProvenance
}

export interface ProviderMediaRecord {
  recordType: "MEDIA"
  platform: string
  externalId: string
  parentExternalId: string
  parentUrl: string
  mediaKind: ProviderMediaKind
  url: string
  thumbnailUrl?: string | null
  mimeType?: string | null
  width?: number | null
  height?: number | null
  durationSeconds?: number | null
  provenance: ProviderProvenance
}

export interface ProviderMetricRecord {
  recordType: "METRIC"
  platform: string
  externalId: string
  parentUrl: string
  observedAt: string
  views?: number | null
  likes?: number | null
  comments?: number | null
  shares?: number | null
  reactions?: number | null
  provenance: ProviderProvenance
}

export type ProviderRecord =
  | ProviderCandidateRecord
  | ProviderContentRecord
  | ProviderCommentRecord
  | ProviderMediaRecord
  | ProviderMetricRecord

export interface ProviderCost {
  amountUsd?: number | null
  units?: number | null
  unitName?: string | null
}

export interface ProviderBatch {
  contractVersion: string
  providerKey: string
  capability: ProviderCapability
  records: ProviderRecord[]
  nextCursor?: string | null
  cost?: ProviderCost | null
  warnings?: string[]
}

export interface ProviderCapabilityRequest {
  requestId: string
  capability: ProviderCapability
  platform: string
  query?: string | null
  targetUrls?: string[]
  cursor?: string | null
  limit: number
  executionPolicy?: {
    mode: "SHADOW"
    allowPersistence: false
    maxCostUsd: number
  }
}

export interface ProviderCapabilityAdapter {
  providerKey: string
  supportedCapabilities: readonly ProviderCapability[]
  execute(request: ProviderCapabilityRequest): Promise<ProviderBatch>
}

export interface ProviderContractValidation {
  valid: boolean
  errors: string[]
}

const RECORD_TYPE_BY_CAPABILITY: Record<ProviderCapability, ProviderRecord["recordType"]> = {
  DISCOVER_URLS: "CANDIDATE",
  ENRICH_CONTENT: "CONTENT",
  READ_COMMENTS: "COMMENT",
  READ_MEDIA: "MEDIA",
  UPDATE_METRICS: "METRIC",
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function validDateString(value: unknown): boolean {
  return nonEmptyString(value) && Number.isFinite(new Date(value).getTime())
}

function validHttpUrl(value: unknown): value is string {
  if (!nonEmptyString(value)) return false
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:"
  } catch {
    return false
  }
}

export function canonicalProviderUrl(value: string): string {
  try {
    const url = new URL(value.trim())
    url.hash = ""
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "")
    for (const parameter of [
      "fbclid",
      "gclid",
      "igshid",
      "ref",
      "ref_src",
      "utm_campaign",
      "utm_content",
      "utm_medium",
      "utm_source",
      "utm_term",
    ]) {
      url.searchParams.delete(parameter)
    }
    const parameters = Array.from(url.searchParams.entries()).sort(([left], [right]) => left.localeCompare(right))
    url.search = ""
    for (const [key, parameterValue] of parameters) url.searchParams.append(key, parameterValue)
    url.pathname = url.pathname.replace(/\/+$/, "") || "/"
    return url.toString().replace(/\/$/, "")
  } catch {
    return value.trim().toLowerCase()
  }
}

function validateProvenance(value: ProviderProvenance, path: string, errors: string[]) {
  if (!value || typeof value !== "object") {
    errors.push(`${path}.provenance is required`)
    return
  }
  if (!nonEmptyString(value.providerKey)) errors.push(`${path}.provenance.providerKey is required`)
  if (!nonEmptyString(value.adapterKey)) errors.push(`${path}.provenance.adapterKey is required`)
  if (!nonEmptyString(value.providerItemId)) errors.push(`${path}.provenance.providerItemId is required`)
  if (!validDateString(value.observedAt)) errors.push(`${path}.provenance.observedAt must be an ISO date`)
  if (!nonEmptyString(value.schemaVersion)) errors.push(`${path}.provenance.schemaVersion is required`)
}

function validateAuthor(value: ProviderAuthor | null | undefined, path: string, errors: string[]) {
  if (value?.profileUrl !== null && value?.profileUrl !== undefined && !validHttpUrl(value.profileUrl)) {
    errors.push(`${path}.profileUrl must be an http(s) URL`)
  }
}

function validateRecord(record: ProviderRecord, index: number, batch: ProviderBatch, errors: string[]) {
  const path = `records[${index}]`
  if (record.recordType !== RECORD_TYPE_BY_CAPABILITY[batch.capability]) {
    errors.push(`${path}.recordType ${record.recordType} is invalid for ${batch.capability}`)
  }
  if (!nonEmptyString(record.platform)) errors.push(`${path}.platform is required`)
  validateProvenance(record.provenance, path, errors)
  if (record.provenance?.providerKey !== batch.providerKey) {
    errors.push(`${path}.provenance.providerKey must match batch.providerKey`)
  }

  switch (record.recordType) {
    case "CANDIDATE":
      if (!validHttpUrl(record.url)) errors.push(`${path}.url must be an http(s) URL`)
      if (record.canonicalUrl && !validHttpUrl(record.canonicalUrl)) errors.push(`${path}.canonicalUrl must be an http(s) URL`)
      if (record.publishedAt && !validDateString(record.publishedAt)) errors.push(`${path}.publishedAt must be an ISO date`)
      break
    case "CONTENT":
      if (!nonEmptyString(record.externalId)) errors.push(`${path}.externalId is required`)
      if (!validHttpUrl(record.url)) errors.push(`${path}.url must be an http(s) URL`)
      if (!nonEmptyString(record.text)) errors.push(`${path}.text is required before enrichment can cross the ingest boundary`)
      if (record.publishedAt && !validDateString(record.publishedAt)) errors.push(`${path}.publishedAt must be an ISO date`)
      validateAuthor(record.author, `${path}.author`, errors)
      break
    case "COMMENT":
      if (!nonEmptyString(record.externalId)) errors.push(`${path}.externalId is required`)
      if (!nonEmptyString(record.text)) errors.push(`${path}.text is required`)
      if (!nonEmptyString(record.postExternalId)) errors.push(`${path}.postExternalId is required`)
      if (record.contentKind === "REPLY" && !nonEmptyString(record.parentExternalId)) {
        errors.push(`${path}.parentExternalId is required for replies`)
      }
      if (!validHttpUrl(record.parentPostUrl)) errors.push(`${path}.parentPostUrl must be an http(s) URL`)
      if (!Number.isInteger(record.depth) || record.depth < 0) errors.push(`${path}.depth must be a non-negative integer`)
      if (record.contentKind === "REPLY" && record.depth < 1) {
        errors.push(`${path}.depth must be at least 1 for replies`)
      }
      if (record.likes !== null && record.likes !== undefined && (!Number.isFinite(record.likes) || record.likes < 0)) {
        errors.push(`${path}.likes must be a non-negative number`)
      }
      if (record.replies !== null && record.replies !== undefined && (!Number.isFinite(record.replies) || record.replies < 0)) {
        errors.push(`${path}.replies must be a non-negative number`)
      }
      validateAuthor(record.author, `${path}.author`, errors)
      break
    case "MEDIA":
      if (!nonEmptyString(record.externalId)) errors.push(`${path}.externalId is required`)
      if (!nonEmptyString(record.parentExternalId)) errors.push(`${path}.parentExternalId is required`)
      if (!validHttpUrl(record.parentUrl)) errors.push(`${path}.parentUrl must be an http(s) URL`)
      if (!validHttpUrl(record.url)) errors.push(`${path}.url must be an http(s) URL`)
      break
    case "METRIC":
      if (!nonEmptyString(record.externalId)) errors.push(`${path}.externalId is required`)
      if (!validHttpUrl(record.parentUrl)) errors.push(`${path}.parentUrl must be an http(s) URL`)
      if (!validDateString(record.observedAt)) errors.push(`${path}.observedAt must be an ISO date`)
      break
  }
}

export function validateProviderBatch(batch: ProviderBatch): ProviderContractValidation {
  const errors: string[] = []
  if (batch.contractVersion !== PROVIDER_CONTRACT_VERSION) {
    errors.push(`contractVersion must be ${PROVIDER_CONTRACT_VERSION}`)
  }
  if (!nonEmptyString(batch.providerKey)) errors.push("providerKey is required")
  if (!PROVIDER_CAPABILITIES.includes(batch.capability)) errors.push(`unknown capability ${batch.capability}`)
  if (!Array.isArray(batch.records)) errors.push("records must be an array")
  else batch.records.forEach((record, index) => validateRecord(record, index, batch, errors))
  if (batch.cost) {
    const hasAmount = batch.cost.amountUsd !== null && batch.cost.amountUsd !== undefined
    const hasUnits = batch.cost.units !== null && batch.cost.units !== undefined
    if (!hasAmount && !hasUnits) errors.push("cost requires amountUsd or units")
    if (hasAmount && (!Number.isFinite(batch.cost.amountUsd) || Number(batch.cost.amountUsd) < 0)) {
      errors.push("cost.amountUsd must be a non-negative number")
    }
    if (hasUnits && (!Number.isFinite(batch.cost.units) || Number(batch.cost.units) < 0)) {
      errors.push("cost.units must be a non-negative number")
    }
    if (hasUnits && !nonEmptyString(batch.cost.unitName)) {
      errors.push("cost.unitName is required when units are provided")
    }
  }
  return { valid: errors.length === 0, errors }
}

export class ProviderContractError extends Error {
  readonly validationErrors: string[]

  constructor(errors: string[]) {
    super(`Provider response violates ${PROVIDER_CONTRACT_VERSION}: ${errors.join("; ")}`)
    this.name = "ProviderContractError"
    this.validationErrors = errors
  }
}

export function assertValidProviderBatch(batch: ProviderBatch): void {
  const validation = validateProviderBatch(batch)
  if (!validation.valid) throw new ProviderContractError(validation.errors)
}

export interface ProviderIngestContext {
  organizationId: string
  sourceId: string
  collectorRunId?: string | null
  routePlanId?: string | null
  providerRunId?: string | null
  acquisitionMode: "OFFICIAL_API" | "CONNECTED_ACCOUNT" | "LICENSED_PROVIDER" | "APIFY_FALLBACK" | "NEWS_INDEX" | "MANUAL_URL"
}

/**
 * Converts only fully enriched content/comment records into the existing ingest
 * boundary. Discovery candidates, media and metric snapshots are deliberately
 * rejected here: a SERP URL or snippet must never masquerade as a final mention.
 */
export function providerRecordToIngestInput(
  context: ProviderIngestContext,
  record: ProviderRecord,
): IngestInput {
  if (record.recordType !== "CONTENT" && record.recordType !== "COMMENT") {
    throw new ProviderContractError([`${record.recordType} cannot cross the mention ingest boundary`])
  }
  assertValidProviderBatch({
    contractVersion: PROVIDER_CONTRACT_VERSION,
    providerKey: record.provenance.providerKey,
    capability: record.recordType === "CONTENT" ? "ENRICH_CONTENT" : "READ_COMMENTS",
    records: [record],
  })
  const recordUrl = record.canonicalUrl
    || record.url
    || (record.recordType === "COMMENT" ? record.parentPostUrl : "")
  const canonicalUrl = canonicalProviderUrl(recordUrl)
  const author = record.author ?? null
  const publishedAt = record.publishedAt ? new Date(record.publishedAt) : null
  const editedAt = record.editedAt ? new Date(record.editedAt) : null
  const provenance = record.provenance

  return {
    organizationId: context.organizationId,
    platform: record.platform,
    externalId: record.externalId,
    sourceType: record.recordType === "COMMENT" ? (record.contentKind === "REPLY" ? "reply" : "comment") : "post",
    contentKind: record.contentKind,
    postExternalId: record.recordType === "COMMENT" ? record.postExternalId : record.externalId,
    parentExternalId: record.recordType === "COMMENT" ? record.parentExternalId ?? null : null,
    threadExternalId: record.recordType === "COMMENT" ? record.threadExternalId ?? null : record.externalId,
    replyToExternalId: record.recordType === "COMMENT" ? record.replyToExternalId ?? null : null,
    depth: record.recordType === "COMMENT" ? record.depth : 0,
    canonicalUrl,
    parentPostUrl: record.recordType === "COMMENT" ? canonicalProviderUrl(record.parentPostUrl) : null,
    editedAt: editedAt && Number.isFinite(editedAt.getTime()) ? editedAt : null,
    text: record.text,
    sentiment: null,
    matchedTerm: null,
    url: record.url || (record.recordType === "COMMENT" ? record.parentPostUrl : null),
    authorName: author?.name ?? null,
    authorHandle: author?.handle ?? null,
    authorAvatar: author?.avatarUrl ?? null,
    publishedAt: publishedAt && Number.isFinite(publishedAt.getTime()) ? publishedAt : null,
    sourceProvider: context.acquisitionMode === "APIFY_FALLBACK"
      ? "search_index"
      : context.acquisitionMode === "OFFICIAL_API" || context.acquisitionMode === "CONNECTED_ACCOUNT"
        ? "native"
        : "provider_api",
    sourceMetadata: {
      monitoringSourceId: context.sourceId,
      provider: provenance.providerKey,
      providerSchemaVersion: provenance.schemaVersion,
      providerObservedAt: provenance.observedAt,
      ...(author?.profileUrl ? { authorProfileUrl: author.profileUrl } : {}),
      ...(record.recordType === "COMMENT"
        ? { commentLikes: record.likes ?? null, commentReplies: record.replies ?? null }
        : {}),
    },
    observation: {
      sourceId: context.sourceId,
      collectorRunId: context.collectorRunId ?? null,
      routePlanId: context.routePlanId ?? null,
      providerRunId: context.providerRunId ?? null,
      adapterKey: provenance.adapterKey,
      providerKey: provenance.providerKey,
      providerItemId: provenance.providerItemId,
      idempotencyKey: `provider:${provenance.providerKey}:${record.platform}:${record.externalId}`,
      acquisitionMode: context.acquisitionMode,
      policySnapshot: {
        providerContractVersion: PROVIDER_CONTRACT_VERSION,
        providerSchemaVersion: provenance.schemaVersion,
        candidateBoundaryPassed: true,
      },
    },
  }
}

export interface ProviderCandidateBoundaryDraft {
  idempotencyKey: string
  adapterKey: string
  providerKey: string
  providerItemId: string
  platform: string
  url: string
  canonicalUrl: string
  externalId: string | null
  text: null
  contentKind: "UNKNOWN"
  relevanceStatus: "PENDING"
  policySnapshot: {
    providerContractVersion: string
    candidateOnly: true
  }
}

/** A persistence-ready identity draft, but intentionally not an IngestInput. */
export function providerCandidateBoundaryDraft(candidate: ProviderCandidateRecord): ProviderCandidateBoundaryDraft {
  const batch: ProviderBatch = {
    contractVersion: PROVIDER_CONTRACT_VERSION,
    providerKey: candidate.provenance.providerKey,
    capability: "DISCOVER_URLS",
    records: [candidate],
  }
  assertValidProviderBatch(batch)
  const canonicalUrl = canonicalProviderUrl(candidate.canonicalUrl || candidate.url)
  const identity = crypto
    .createHash("sha256")
    .update(`${candidate.provenance.providerKey}:${candidate.platform}:${canonicalUrl}`)
    .digest("hex")

  return {
    idempotencyKey: `provider-candidate:${identity}`,
    adapterKey: candidate.provenance.adapterKey,
    providerKey: candidate.provenance.providerKey,
    providerItemId: candidate.provenance.providerItemId,
    platform: candidate.platform,
    url: candidate.url,
    canonicalUrl,
    externalId: candidate.externalId ?? null,
    text: null,
    contentKind: "UNKNOWN",
    relevanceStatus: "PENDING",
    policySnapshot: {
      providerContractVersion: PROVIDER_CONTRACT_VERSION,
      candidateOnly: true,
    },
  }
}
