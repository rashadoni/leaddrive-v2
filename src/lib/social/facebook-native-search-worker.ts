import crypto from "node:crypto"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { findMatchedKeyword, ingestMentionWithResult, type IngestInput } from "@/lib/social/ingest-mention"
import { isMetaGlobalSearchSource } from "@/lib/social/meta-global-search-source"
import {
  getMonitoringScenariosUncached,
  monitoringSourceMatchesCurrentScenarioTarget,
  SOCIAL_SCENARIO_SOURCE_MANAGER,
  type MonitoringScenario,
} from "@/lib/social/monitoring-scenarios"

export const FACEBOOK_NATIVE_SEARCH_JOBS_SCHEMA_VERSION = "facebook-native-search-jobs-v2"
export const FACEBOOK_NATIVE_SEARCH_RESULTS_SCHEMA_VERSION = "facebook-native-search-results-v2"
export const FACEBOOK_NATIVE_SEARCH_MAX_SUBJECTS = 25
export const FACEBOOK_NATIVE_SEARCH_MAX_QUERIES = 50
export const FACEBOOK_NATIVE_SEARCH_MAX_TARGETS_PER_JOB = 25
export const FACEBOOK_NATIVE_SEARCH_MAX_BATCH_ITEMS = 25
export const FACEBOOK_NATIVE_SEARCH_MAX_BODY_BYTES = 256 * 1024
export const FACEBOOK_NATIVE_SEARCH_TARGET_BINDING_VERSION = "facebook-native-search-targets-v1"

const MAX_QUERY_LENGTH = 160
const MAX_TEXT_LENGTH = 12_000
const MAX_URL_LENGTH = 2_048
const WORKER_ADAPTER_KEY = "BROWSER_CAPTURE_READ_ONLY"
const WORKER_SOURCE_PROVIDER = "browser_capture"
const FACEBOOK_HOSTS = new Set([
  "facebook.com",
  "www.facebook.com",
  "m.facebook.com",
  "mbasic.facebook.com",
])
const FACEBOOK_PERMALINK_QUERY_KEYS = new Set([
  "comment_id",
  "fbid",
  "id",
  "reply_comment_id",
  "set",
  "story_fbid",
  "v",
])
const FACEBOOK_CONTENT_PATH = /(?:^|\/)(?:groups\/[^/]+\/posts|permalink|posts|photos|reel|share|videos|watch)(?:\/|$)/i
const CANONICAL_FACEBOOK_ID = /^facebook:(post|reel|video|photo):[A-Za-z0-9._-]{1,240}$/
const JOB_ID = /^fbns_[a-f0-9]{32}$/
const RUN_ID = /^[A-Za-z0-9._:-]{1,191}$/
const SHA256_HEX = /^[a-f0-9]{64}$/i
const PARSER_VERSION = /^[A-Za-z0-9._-]{1,80}$/
const QUERY_CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/

const audienceSchema = z.object({
  kind: z.literal("PUBLIC"),
  evidenceLabel: z.string().trim().min(1).max(300),
}).strict()

const evidenceSchema = z.object({
  articleHtmlSha256: z.string().regex(SHA256_HEX),
  screenshotSha256: z.string().regex(SHA256_HEX).nullable(),
  parserVersion: z.string().regex(PARSER_VERSION),
  discoveredAtScroll: z.number().int().min(0).max(100_000),
  dateRaw: z.string().trim().min(1).max(160).nullable(),
  datePrecision: z.enum(["EXACT", "DATE", "RELATIVE", "UNKNOWN"]),
  mediaKinds: z.array(z.enum(["IMAGE", "VIDEO", "REEL", "LINK"])).max(8),
  outboundLinks: z.array(z.string().trim().min(1).max(MAX_URL_LENGTH)).max(20),
}).strict().superRefine((evidence, context) => {
  if (new Set(evidence.mediaKinds).size !== evidence.mediaKinds.length) {
    context.addIssue({ code: "custom", message: "mediaKinds must be unique" })
  }
  for (const [index, value] of evidence.outboundLinks.entries()) {
    try {
      const url = new URL(value)
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
        throw new Error("invalid outbound URL")
      }
    } catch {
      context.addIssue({
        code: "custom",
        path: ["outboundLinks", index],
        message: "outboundLinks must contain public HTTP(S) URLs",
      })
    }
  }
})

const resultItemSchema = z.object({
  kind: z.enum(["POST", "REEL", "VIDEO", "PHOTO"]),
  externalId: z.string().trim().regex(CANONICAL_FACEBOOK_ID),
  permalink: z.string().trim().min(1).max(MAX_URL_LENGTH),
  authorName: z.string().trim().min(1).max(300).nullable(),
  authorUrl: z.string().trim().min(1).max(MAX_URL_LENGTH).nullable(),
  text: z.string()
    .trim()
    .min(1)
    .max(MAX_TEXT_LENGTH)
    .refine(value => !/(?:<!doctype\s+html|<html(?:\s|>))/i.test(value), {
      message: "full DOM payloads are not allowed",
    })
    .refine(value => !/<\/?[a-z][^>]{0,200}>/i.test(value), {
      message: "HTML payloads are not allowed",
    })
    .refine(value => !/\bdata:[^,\s]+;base64,/i.test(value), {
      message: "base64 payloads are not allowed",
    }),
  capturedAt: z.string().datetime({ offset: true }),
  audience: audienceSchema,
  evidence: evidenceSchema,
}).strict().superRefine((item, context) => {
  const externalKind = CANONICAL_FACEBOOK_ID.exec(item.externalId)?.[1]?.toUpperCase()
  if (externalKind !== item.kind) {
    context.addIssue({
      code: "custom",
      path: ["externalId"],
      message: "externalId kind must match publication kind",
    })
  }
})

const coverageSchema = z.object({
  status: z.enum(["COMPLETE", "PARTIAL", "BLOCKED"]),
  searchedResultCount: z.number().int().min(0).max(1_000),
  recentPostsVerified: z.boolean(),
  reason: z.string().trim().min(1).max(500).nullable(),
}).strict()

const targetSchema = z.object({
  scenarioId: z.string().trim().min(1).max(191),
  subjectId: z.string().trim().min(1).max(191),
  sourceId: z.string().trim().min(1).max(191),
}).strict()

const resultBatchSchema = z.object({
  schemaVersion: z.literal(FACEBOOK_NATIVE_SEARCH_RESULTS_SCHEMA_VERSION),
  jobId: z.string().regex(JOB_ID),
  runId: z.string().regex(RUN_ID),
  startedAt: z.string().datetime({ offset: true }),
  finishedAt: z.string().datetime({ offset: true }),
  targetBindingVersion: z.literal(FACEBOOK_NATIVE_SEARCH_TARGET_BINDING_VERSION),
  targets: z.array(targetSchema)
    .min(1)
    .max(FACEBOOK_NATIVE_SEARCH_MAX_TARGETS_PER_JOB),
  query: z.string()
    .trim()
    .min(1)
    .max(MAX_QUERY_LENGTH)
    .refine(value => normalizedQuery(value) === value, {
      message: "query must be canonical and contain no control characters",
    }),
  coverage: coverageSchema,
  items: z.array(resultItemSchema).max(FACEBOOK_NATIVE_SEARCH_MAX_BATCH_ITEMS),
}).strict().superRefine((batch, context) => {
  if (new Date(batch.finishedAt).getTime() < new Date(batch.startedAt).getTime()) {
    context.addIssue({
      code: "custom",
      path: ["finishedAt"],
      message: "finishedAt must not precede startedAt",
    })
  }
  if (batch.coverage.searchedResultCount < batch.items.length) {
    context.addIssue({
      code: "custom",
      path: ["coverage", "searchedResultCount"],
      message: "searchedResultCount must cover every delivered item",
    })
  }
  if (batch.coverage.status !== "COMPLETE" && !batch.coverage.reason) {
    context.addIssue({
      code: "custom",
      path: ["coverage", "reason"],
      message: "partial and blocked coverage require a reason",
    })
  }
  if (batch.coverage.status !== "BLOCKED" && !batch.coverage.recentPostsVerified) {
    context.addIssue({
      code: "custom",
      path: ["coverage", "recentPostsVerified"],
      message: "complete and partial coverage require recent-post verification",
    })
  }
  if (batch.coverage.status === "BLOCKED" && batch.items.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["items"],
      message: "blocked coverage cannot include items",
    })
  }
  const targetKeys = batch.targets.map(target => targetKey(target))
  const sortedTargetKeys = [...targetKeys].sort(stableCompare)
  if (
    new Set(targetKeys).size !== targetKeys.length
    || targetKeys.some((key, index) => key !== sortedTargetKeys[index])
  ) {
    context.addIssue({
      code: "custom",
      path: ["targets"],
      message: "targets must be unique and sorted",
    })
  }
})

export type FacebookNativeSearchResultBatch = z.infer<typeof resultBatchSchema>
export type FacebookNativeSearchResultItem = z.infer<typeof resultItemSchema>

export interface FacebookNativeSearchTarget {
  scenarioId: string
  subjectId: string
  sourceId: string
}

export interface FacebookNativeSearchJob {
  jobId: string
  targetBindingVersion: typeof FACEBOOK_NATIVE_SEARCH_TARGET_BINDING_VERSION
  targets: FacebookNativeSearchTarget[]
  query: string
}

type FacebookNativeSearchSourceLink = {
  scenarioId: string | null
  subjectId: string
  sourceId: string
  source: {
    id: string
    platform: string
    sourceType: string
    collectionMode: string
    url: string | null
    handle: string | null
    query: string | null
    keywords: string[]
    ownership: string
    status: string
    settings: unknown
  }
}

const ACTIVE_SOURCE_STATUSES = ["active", "limited", "needs_setup"] as const

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex")
}

function bearerToken(authorizationHeader: string | null | undefined): string {
  if (!authorizationHeader) return ""
  const match = /^Bearer ([^\s]{1,1024})$/.exec(authorizationHeader.trim())
  return match?.[1] ?? ""
}

export function facebookNativeWorkerConfiguration(): {
  enabled: boolean
  configured: boolean
  organizationSlug: string
} {
  const enabled = process.env.SOCIAL_FACEBOOK_NATIVE_WORKER_ENABLED === "1"
  const expectedHash = process.env.SOCIAL_FACEBOOK_NATIVE_WORKER_TOKEN_SHA256?.trim() ?? ""
  const organizationSlug = process.env.SOCIAL_FACEBOOK_NATIVE_WORKER_ORG_SLUG?.trim() ?? ""
  return {
    enabled,
    configured: /^[a-f0-9]{64}$/i.test(expectedHash) && organizationSlug.length > 0,
    organizationSlug,
  }
}

/**
 * Verify the dedicated worker bearer without ever loading a generic tenant
 * ApiKey. Both sides are fixed-length SHA-256 digests before comparison.
 */
export function verifyFacebookNativeWorkerAuthorization(
  authorizationHeader: string | null | undefined,
): boolean {
  const expectedHex = process.env.SOCIAL_FACEBOOK_NATIVE_WORKER_TOKEN_SHA256?.trim().toLowerCase() ?? ""
  const expectedValid = /^[a-f0-9]{64}$/.test(expectedHex)
  const received = Buffer.from(sha256(bearerToken(authorizationHeader)), "hex")
  const expected = Buffer.from(expectedValid ? expectedHex : "0".repeat(64), "hex")
  return expectedValid && crypto.timingSafeEqual(received, expected)
}

export async function resolveFacebookNativeWorkerOrganization(): Promise<{ id: string } | null> {
  const slug = process.env.SOCIAL_FACEBOOK_NATIVE_WORKER_ORG_SLUG?.trim() ?? ""
  if (!slug) return null
  return runWithRlsBypass(() => prisma.organization.findUnique({
    where: { slug },
    select: { id: true, isActive: true },
  })).then(organization => organization?.isActive ? { id: organization.id } : null)
}

function normalizedQuery(value: string): string | null {
  const query = value.replace(/\s+/g, " ").trim()
  if (
    !query
    || query.length > MAX_QUERY_LENGTH
    || QUERY_CONTROL_CHARACTER.test(query)
  ) return null
  return query
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function scenarioOwnsManagedSource(settings: unknown, scenarioId: string): boolean {
  const sourceSettings = record(settings)
  if (sourceSettings.managedBy !== SOCIAL_SCENARIO_SOURCE_MANAGER) return false
  if (sourceSettings.scenarioId === scenarioId) return true
  const links = Array.isArray(sourceSettings.scenarioLinks)
    ? sourceSettings.scenarioLinks
    : []
  return links.some(link => record(link).scenarioId === scenarioId)
}

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function normalizedQueryKey(query: string): string {
  return query.normalize("NFKC").toLocaleLowerCase("en-US")
}

function targetKey(target: FacebookNativeSearchTarget): string {
  return JSON.stringify([target.scenarioId, target.subjectId, target.sourceId])
}

function sameTargetBinding(
  left: FacebookNativeSearchTarget[],
  right: FacebookNativeSearchTarget[],
): boolean {
  return left.length === right.length
    && left.every((target, index) => {
      const other = right[index]
      return Boolean(other && targetKey(target) === targetKey(other))
    })
}

function sourceTargetFromLink(
  scenario: MonitoringScenario,
  link: FacebookNativeSearchSourceLink,
): {
  query: string
  queryKey: string
  target: FacebookNativeSearchTarget
} | null {
  const source = link.source
  const query = normalizedQuery(source.query ?? "")
  if (
    !scenario.subjectId
    || scenario.subjectId !== link.subjectId
    || link.scenarioId !== scenario.id
    || link.sourceId !== source.id
    || source.platform !== "facebook"
    || source.ownership !== "external"
    || !ACTIVE_SOURCE_STATUSES.includes(source.status as typeof ACTIVE_SOURCE_STATUSES[number])
    || !query
    || !isMetaGlobalSearchSource(source)
    || !scenarioOwnsManagedSource(source.settings, scenario.id)
    || !monitoringSourceMatchesCurrentScenarioTarget(scenario, source)
  ) return null

  return {
    query,
    queryKey: normalizedQueryKey(query),
    target: {
      scenarioId: scenario.id,
      subjectId: link.subjectId,
      sourceId: source.id,
    },
  }
}

function groupedJobId(queryKey: string, targets: FacebookNativeSearchTarget[]): string {
  return `fbns_${sha256([
    FACEBOOK_NATIVE_SEARCH_TARGET_BINDING_VERSION,
    queryKey,
    ...targets.map(targetKey),
  ].join("\u0000")).slice(0, 32)}`
}

async function activeFacebookScenarios(
  organizationId: string,
): Promise<MonitoringScenario[]> {
  return (await getMonitoringScenariosUncached(organizationId)).filter(scenario => (
    scenario.status === "active"
    && scenario.platforms.includes("facebook")
    && Boolean(scenario.subjectId)
  ))
}

async function activeSourceLinks(
  organizationId: string,
  scenarioIds: string[],
): Promise<FacebookNativeSearchSourceLink[]> {
  if (scenarioIds.length === 0) return []
  return prisma.monitoringSubjectSource.findMany({
    where: {
      organizationId,
      scenarioId: { in: scenarioIds },
      relationType: "MONITORS",
      subject: { status: "active" },
      source: {
        platform: "facebook",
        ownership: "external",
        status: { in: [...ACTIVE_SOURCE_STATUSES] },
      },
    },
    select: {
      scenarioId: true,
      subjectId: true,
      sourceId: true,
      source: {
        select: {
          id: true,
          platform: true,
          sourceType: true,
          collectionMode: true,
          url: true,
          handle: true,
          query: true,
          keywords: true,
          ownership: true,
          status: true,
          settings: true,
        },
      },
    },
    orderBy: [{ scenarioId: "asc" }, { subjectId: "asc" }, { sourceId: "asc" }],
    take: FACEBOOK_NATIVE_SEARCH_MAX_QUERIES * FACEBOOK_NATIVE_SEARCH_MAX_TARGETS_PER_JOB + 1,
  })
}

export async function listFacebookNativeSearchJobs(
  organizationId: string,
): Promise<FacebookNativeSearchJob[]> {
  const scenarios = await activeFacebookScenarios(organizationId)
  const scenarioById = new Map(scenarios.map(scenario => [scenario.id, scenario]))
  const links = await activeSourceLinks(organizationId, Array.from(scenarioById.keys()))
  if (links.length > FACEBOOK_NATIVE_SEARCH_MAX_QUERIES * FACEBOOK_NATIVE_SEARCH_MAX_TARGETS_PER_JOB) {
    throw new Error("facebook_native_worker_job_capacity_exceeded")
  }
  const subjectIds = new Set<string>()
  const groups = new Map<string, {
    queries: Set<string>
    targets: Map<string, FacebookNativeSearchTarget>
  }>()
  for (const link of links) {
    const scenario = link.scenarioId ? scenarioById.get(link.scenarioId) : null
    if (!scenario) continue
    const candidate = sourceTargetFromLink(scenario, link)
    if (!candidate) continue
    if (!subjectIds.has(link.subjectId) && subjectIds.size >= FACEBOOK_NATIVE_SEARCH_MAX_SUBJECTS) {
      throw new Error("facebook_native_worker_subject_capacity_exceeded")
    }
    subjectIds.add(link.subjectId)
    const group = groups.get(candidate.queryKey) ?? {
      queries: new Set<string>(),
      targets: new Map<string, FacebookNativeSearchTarget>(),
    }
    group.queries.add(candidate.query)
    group.targets.set(targetKey(candidate.target), candidate.target)
    groups.set(candidate.queryKey, group)
  }
  if (groups.size > FACEBOOK_NATIVE_SEARCH_MAX_QUERIES) {
    throw new Error("facebook_native_worker_query_capacity_exceeded")
  }
  return Array.from(groups.entries())
    .sort(([left], [right]) => stableCompare(left, right))
    .map(([queryKey, group]) => {
      const targets = Array.from(group.targets.values())
        .sort((left, right) => stableCompare(targetKey(left), targetKey(right)))
      if (targets.length > FACEBOOK_NATIVE_SEARCH_MAX_TARGETS_PER_JOB) {
        throw new Error("facebook_native_worker_target_group_too_large")
      }
      const query = Array.from(group.queries).sort(stableCompare)[0] ?? queryKey
      return {
        jobId: groupedJobId(queryKey, targets),
        targetBindingVersion: FACEBOOK_NATIVE_SEARCH_TARGET_BINDING_VERSION,
        targets,
        query,
      }
    })
}

async function resolveActiveJob(
  organizationId: string,
  expectedJobId: string,
): Promise<FacebookNativeSearchJob | null> {
  return (await listFacebookNativeSearchJobs(organizationId))
    .find(job => job.jobId === expectedJobId) ?? null
}

export function validateFacebookNativeSearchTransport(
  headers: Headers,
): { valid: true } | { valid: false; status: 400 | 413 | 415; reason: string } {
  const encoding = headers.get("content-encoding")?.trim().toLowerCase()
  if (encoding && encoding !== "identity") {
    return { valid: false, status: 400, reason: "facebook_native_worker_compression_not_allowed" }
  }
  const contentType = headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
  if (contentType !== "application/json") {
    return { valid: false, status: 415, reason: "facebook_native_worker_content_type_invalid" }
  }
  const lengthHeader = headers.get("content-length")
  if (lengthHeader) {
    const length = Number(lengthHeader)
    if (!Number.isInteger(length) || length < 0) {
      return { valid: false, status: 400, reason: "facebook_native_worker_content_length_invalid" }
    }
    if (length > FACEBOOK_NATIVE_SEARCH_MAX_BODY_BYTES) {
      return { valid: false, status: 413, reason: "facebook_native_worker_payload_too_large" }
    }
  }
  return { valid: true }
}

export function decodeFacebookNativeSearchBody(bytes: Uint8Array): unknown {
  if (bytes.byteLength > FACEBOOK_NATIVE_SEARCH_MAX_BODY_BYTES) {
    throw new Error("facebook_native_worker_payload_too_large")
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  } catch (error) {
    if (error instanceof Error && error.message === "facebook_native_worker_payload_too_large") throw error
    throw new Error("facebook_native_worker_json_invalid")
  }
}

/**
 * Stop consuming the request stream as soon as the hard body limit is
 * exceeded. Content-Length remains an early rejection hint, not the
 * enforcement boundary.
 */
export async function readFacebookNativeSearchBody(request: Request): Promise<Uint8Array> {
  const reader = request.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > FACEBOOK_NATIVE_SEARCH_MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {})
        throw new Error("facebook_native_worker_payload_too_large")
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export function parseFacebookNativeSearchResultBatch(value: unknown): FacebookNativeSearchResultBatch {
  const parsed = resultBatchSchema.safeParse(value)
  if (!parsed.success) throw new Error("facebook_native_worker_payload_invalid")
  return parsed.data
}

function normalizeFacebookUrl(value: string, requirePermalink: boolean): string | null {
  try {
    const url = new URL(value)
    const hostname = url.hostname.toLowerCase()
    if (
      url.protocol !== "https:"
      || !FACEBOOK_HOSTS.has(hostname)
      || url.username
      || url.password
      || url.port
    ) return null
    if (requirePermalink) {
      const hasContentQuery = Array.from(FACEBOOK_PERMALINK_QUERY_KEYS).some(key => url.searchParams.has(key))
      if (!FACEBOOK_CONTENT_PATH.test(url.pathname) && !hasContentQuery) return null
    }
    url.hostname = "www.facebook.com"
    url.hash = ""
    for (const key of Array.from(url.searchParams.keys())) {
      if (!FACEBOOK_PERMALINK_QUERY_KEYS.has(key)) url.searchParams.delete(key)
    }
    url.searchParams.sort()
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "")
    return url.toString()
  } catch {
    return null
  }
}

export function normalizeFacebookPublicPermalink(value: string): string | null {
  return normalizeFacebookUrl(value, true)
}

function authorHandleFromUrl(value: string | null): string | null {
  if (!value) return null
  const url = new URL(value)
  const path = url.pathname.replace(/^\/+|\/+$/g, "")
  if (!path || path.includes("/") || path.toLowerCase() === "profile.php") return null
  return path
}

function itemIdempotencyKey(
  job: FacebookNativeSearchJob,
  target: FacebookNativeSearchTarget,
  item: FacebookNativeSearchResultItem,
  permalink: string,
): string {
  return `facebook-native-search-v2:${sha256([
    job.targetBindingVersion,
    target.scenarioId,
    target.subjectId,
    target.sourceId,
    job.query,
    item.kind,
    item.externalId,
    permalink,
    item.text,
    item.evidence.articleHtmlSha256,
  ].join("\u0000"))}`
}

function normalizeResultItem(
  organizationId: string,
  job: FacebookNativeSearchJob,
  target: FacebookNativeSearchTarget,
  item: FacebookNativeSearchResultItem,
): { ingest: IngestInput; evidencePayload: Record<string, unknown>; capturedAt: Date } {
  const permalink = normalizeFacebookPublicPermalink(item.permalink)
  if (!permalink) throw new Error("facebook_native_worker_permalink_invalid")
  const authorProfileUrl = item.authorUrl
    ? normalizeFacebookUrl(item.authorUrl, false)
    : null
  if (item.authorUrl && !authorProfileUrl) {
    throw new Error("facebook_native_worker_author_url_invalid")
  }
  const authorHandle = authorHandleFromUrl(authorProfileUrl)

  const externalId = item.externalId
  const sourceMetadata = {
    monitoringSourceId: target.sourceId,
    targetScenarioId: target.scenarioId,
    targetSubjectId: target.subjectId,
    collector: "facebook_native_search_worker",
    routeAdapter: WORKER_ADAPTER_KEY,
    acquisitionMode: "MANUAL_URL",
    query: job.query,
    authorProfileUrl,
    authorUrl: authorProfileUrl,
    profileUrl: authorProfileUrl,
    publicationKind: item.kind,
    sourceTrustTier: "T5",
    audience: "PUBLIC",
    publicEvidenceLabel: item.audience.evidenceLabel,
    manualOnly: true,
    noAutomation: true,
    noAutomationBypass: true,
    replyPolicy: "manual_only",
  }
  const evidencePayload = {
    schemaVersion: FACEBOOK_NATIVE_SEARCH_RESULTS_SCHEMA_VERSION,
    capturedAt: item.capturedAt,
    publicationKind: item.kind,
    externalId,
    permalink,
    authorName: item.authorName,
    authorProfileUrl,
    audience: item.audience,
    evidence: item.evidence,
    targetBindingVersion: job.targetBindingVersion,
    scenarioId: target.scenarioId,
    subjectId: target.subjectId,
    sourceId: target.sourceId,
    query: job.query,
    manualOnly: true,
    noAutomation: true,
  }

  return {
    ingest: {
      organizationId,
      accountId: null,
      platform: "facebook",
      externalId,
      sourceType: "post",
      contentKind: "POST",
      postExternalId: externalId,
      parentExternalId: null,
      threadExternalId: externalId,
      replyToExternalId: null,
      depth: 0,
      canonicalUrl: permalink,
      parentPostUrl: null,
      sourceProvider: WORKER_SOURCE_PROVIDER,
      sourceMetadata,
      text: item.text,
      sentiment: null,
      matchedTerm: findMatchedKeyword(item.text, [job.query]),
      url: permalink,
      authorName: item.authorName,
      authorHandle,
      publishedAt: null,
      observation: {
        sourceId: target.sourceId,
        adapterKey: WORKER_ADAPTER_KEY,
        providerKey: null,
        providerItemId: externalId,
        idempotencyKey: itemIdempotencyKey(job, target, item, permalink),
        acquisitionMode: "MANUAL_URL",
        rawPayload: evidencePayload,
        policySnapshot: {
          version: "facebook-native-search-worker-v2",
          sourceProvider: WORKER_SOURCE_PROVIDER,
          adapterKey: WORKER_ADAPTER_KEY,
          sourceTrustTier: "T5",
          manualOnly: true,
          noAutomation: true,
          audience: "PUBLIC",
        },
      },
    },
    evidencePayload,
    capturedAt: new Date(item.capturedAt),
  }
}

async function persistEvidenceForEnvelope(input: {
  organizationId: string
  target: FacebookNativeSearchTarget
  envelopeId: string | undefined
  permalink: string
  text: string
  rawPayload: Record<string, unknown>
  capturedAt: Date
}): Promise<{ mentionId: string | null; created: boolean }> {
  if (!input.envelopeId) return { mentionId: null, created: false }
  const envelope = await prisma.ingestEnvelope.findFirst({
    where: {
      id: input.envelopeId,
      organizationId: input.organizationId,
    },
    select: { acceptedMentionId: true },
  })
  if (!envelope?.acceptedMentionId) return { mentionId: null, created: false }
  const evidenceId = `fbnme_${sha256(JSON.stringify([
    input.organizationId,
    envelope.acceptedMentionId,
    input.target.scenarioId,
    input.target.subjectId,
    input.target.sourceId,
    input.permalink,
  ])).slice(0, 32)}`
  const existing = await prisma.mentionEvidence.findUnique({
    where: { id: evidenceId },
    select: { id: true },
  })
  await prisma.mentionEvidence.upsert({
    where: { id: evidenceId },
    create: {
      id: evidenceId,
      organizationId: input.organizationId,
      mentionId: envelope.acceptedMentionId,
      sourceId: input.target.sourceId,
      permalink: input.permalink,
      screenshotUrl: null,
      rawSnippet: input.text,
      rawPayload: input.rawPayload,
      capturedAt: input.capturedAt,
      confidence: 0.6,
      sourceTrustTier: "T5",
    },
    update: {
      rawSnippet: input.text,
      rawPayload: input.rawPayload,
      capturedAt: input.capturedAt,
      confidence: 0.6,
      sourceTrustTier: "T5",
    },
  })
  return { mentionId: envelope.acceptedMentionId, created: !existing }
}

type FacebookNativeTargetRunStats = {
  persistedCount: number
  newCount: number
  duplicateCount: number
  officialArchiveCount: number
  rejectedCount: number
  evidenceCreatedCount: number
}

async function persistFacebookNativeCollectorRun(
  organizationId: string,
  batch: FacebookNativeSearchResultBatch,
  target: FacebookNativeSearchTarget,
  stats: FacebookNativeTargetRunStats,
): Promise<void> {
  const identityMaterial = JSON.stringify([
    organizationId,
    batch.jobId,
    batch.runId,
    target.scenarioId,
    target.subjectId,
    target.sourceId,
  ])
  const collectorRunId = `fbncr_${sha256(identityMaterial).slice(0, 32)}`
  const claimToken = `fbnclaim_${sha256(`claim:${identityMaterial}`).slice(0, 32)}`
  const startedAt = new Date(batch.startedAt)
  const finishedAt = new Date(batch.finishedAt)
  const status = batch.coverage.status === "COMPLETE"
    ? "success"
    : batch.coverage.status === "PARTIAL"
      ? "partial"
      : "failed"
  const coverageClass = batch.coverage.status === "COMPLETE"
    ? "COMPLETE_FOR_QUERY_WINDOW"
    : batch.coverage.status
  const error = batch.coverage.status === "COMPLETE"
    ? null
    : batch.coverage.reason
  const rawStats = {
    schemaVersion: FACEBOOK_NATIVE_SEARCH_RESULTS_SCHEMA_VERSION,
    collector: "facebook_native_search_worker",
    adapterKey: WORKER_ADAPTER_KEY,
    sourceProvider: WORKER_SOURCE_PROVIDER,
    providerRunCreated: false,
    jobId: batch.jobId,
    workerRunId: batch.runId,
    targetBindingVersion: batch.targetBindingVersion,
    targetScenarioId: target.scenarioId,
    targetSubjectId: target.subjectId,
    monitoringSourceId: target.sourceId,
    query: batch.query,
    coverageClass,
    coverage: batch.coverage,
    receivedCount: batch.items.length,
    ...stats,
    manualOnly: true,
    noAutomation: true,
  }
  const terminalData = {
    finishedAt,
    status,
    foundCount: batch.coverage.searchedResultCount,
    newCount: stats.newCount,
    duplicateCount: stats.duplicateCount,
    ignoredCount: stats.rejectedCount,
    error,
    rawStats,
  }

  await prisma.collectorRun.upsert({
    where: { id: collectorRunId },
    create: {
      id: collectorRunId,
      organizationId,
      sourceId: target.sourceId,
      claimToken,
      claimVersion: 0,
      leaseExpiresAt: finishedAt,
      startedAt,
      ...terminalData,
    },
    update: terminalData,
  })
}

export async function applyFacebookNativeSearchResultBatch(
  organizationId: string,
  batch: FacebookNativeSearchResultBatch,
): Promise<{
  receivedCount: number
  persistedCount: number
  newCount: number
  duplicateCount: number
  officialArchiveCount: number
  rejectedCount: number
  evidenceCreatedCount: number
}> {
  const job = await resolveActiveJob(organizationId, batch.jobId)
  if (
    !job
    || job.targetBindingVersion !== batch.targetBindingVersion
    || !sameTargetBinding(job.targets, batch.targets)
    || job.query !== batch.query
  ) throw new Error("facebook_native_worker_job_inactive")

  const normalized = batch.items.flatMap(item =>
    job.targets.map(target => {
      const normalizedItem = normalizeResultItem(organizationId, job, target, item)
      normalizedItem.ingest.sourceMetadata = {
        ...(normalizedItem.ingest.sourceMetadata ?? {}),
        workerRunId: batch.runId,
        workerStartedAt: batch.startedAt,
        workerFinishedAt: batch.finishedAt,
        coverage: batch.coverage,
      }
      normalizedItem.ingest.observation = {
        ...(normalizedItem.ingest.observation ?? {}),
        rawPayload: {
          ...normalizedItem.evidencePayload,
          workerRunId: batch.runId,
          coverage: batch.coverage,
        },
      }
      normalizedItem.evidencePayload = {
        ...normalizedItem.evidencePayload,
        workerRunId: batch.runId,
        coverage: batch.coverage,
      }
      return { ...normalizedItem, target }
    }),
  )
  const targetStats = new Map(job.targets.map(target => [
    targetKey(target),
    {
      persistedCount: 0,
      newCount: 0,
      duplicateCount: 0,
      officialArchiveCount: 0,
      rejectedCount: 0,
      evidenceCreatedCount: 0,
    } satisfies FacebookNativeTargetRunStats,
  ]))
  let persistedCount = 0
  let newCount = 0
  let duplicateCount = 0
  let officialArchiveCount = 0
  let rejectedCount = 0
  let evidenceCreatedCount = 0

  for (const item of normalized) {
    const stats = targetStats.get(targetKey(item.target))
    if (!stats) throw new Error("facebook_native_worker_target_stats_missing")
    const result = await ingestMentionWithResult(item.ingest)
    const evidence = await persistEvidenceForEnvelope({
      organizationId,
      target: item.target,
      envelopeId: result.envelopeId,
      permalink: item.ingest.url as string,
      text: item.ingest.text,
      rawPayload: item.evidencePayload,
      capturedAt: item.capturedAt,
    })
    if (!evidence.mentionId) {
      rejectedCount++
      stats.rejectedCount++
      continue
    }
    persistedCount++
    stats.persistedCount++
    if (result.accepted === false) {
      officialArchiveCount++
      stats.officialArchiveCount++
    } else if (result.created) {
      newCount++
      stats.newCount++
    } else {
      duplicateCount++
      stats.duplicateCount++
    }
    if (evidence.created) {
      evidenceCreatedCount++
      stats.evidenceCreatedCount++
    }
  }

  for (const target of job.targets) {
    const stats = targetStats.get(targetKey(target))
    if (!stats) throw new Error("facebook_native_worker_target_stats_missing")
    await persistFacebookNativeCollectorRun(organizationId, batch, target, stats)
  }

  return {
    receivedCount: batch.items.length,
    persistedCount,
    newCount,
    duplicateCount,
    officialArchiveCount,
    rejectedCount,
    evidenceCreatedCount,
  }
}
