import {
  assertValidProviderBatch,
  canonicalProviderUrl,
  PROVIDER_CONTRACT_VERSION,
  type ProviderBatch,
  type ProviderCapability,
  type ProviderCapabilityAdapter,
  type ProviderCapabilityRequest,
  type ProviderCommentRecord,
  type ProviderMediaKind,
  type ProviderMetricRecord,
} from "@/lib/social/provider-capability-contract"

export const PROVIDER_CONTROL_CORPUS_VERSION = "social-provider-control-v2"
const DEFAULT_REQUIRED_CAPABILITIES: ProviderCapability[] = ["DISCOVER_URLS", "ENRICH_CONTENT"]

export interface ProviderControlItem {
  id: string
  platform: string
  locale: "az" | "ru" | "en" | string
  contentKind: "POST" | "VIDEO" | "COMMENT" | "REPLY" | string
  query: string
  expectedUrls: string[]
  requiredCapabilities?: ProviderCapability[]
  expectedCommentIds?: string[]
  providerVisibleCommentIds?: string[]
  expectedMediaKinds?: ProviderMediaKind[]
  providerVisibleMediaKinds?: ProviderMediaKind[]
  expectedMetricFields?: Array<"views" | "likes" | "comments" | "shares" | "reactions">
}

export interface ProviderControlCorpus {
  schemaVersion: string
  datasetVersion: string
  items: ProviderControlItem[]
}

export interface RatioMetric {
  numerator: number
  denominator: number
  value: number | null
}

export interface ProviderComparisonMetrics {
  discoveryRecall: RatioMetric
  discoveryPrecision: RatioMetric
  enrichmentCompleteness: RatioMetric
  commentRecall: RatioMetric
  visibleCommentRecall: RatioMetric
  mediaCompleteness: RatioMetric
  visibleMediaCompleteness: RatioMetric
  metricCompleteness: RatioMetric
  schemaValidity: RatioMetric
  acceptedUniqueUrls: number
  totalCostUsd: number
  costPerAcceptedUniqueUsd: number | null
}

export interface ProviderComparisonSlice {
  sliceKey: string
  platform: string
  locale: string
  contentKind: string
  itemCount: number
  requiredCapabilities: ProviderCapability[]
  metrics: ProviderComparisonMetrics
}

export interface ProviderComparisonError {
  itemId: string
  capability: ProviderCapability
  message: string
}

export interface ProviderComparisonReport {
  contractVersion: string
  corpusVersion: string
  providerKey: string
  requiredCapabilities: ProviderCapability[]
  metrics: ProviderComparisonMetrics
  slices: ProviderComparisonSlice[]
  errors: ProviderComparisonError[]
  warnings: string[]
}

export interface ProviderComparisonOptions {
  limitPerRequest?: number
  shadowMode?: boolean
  maxRequests?: number
  maxTotalCostUsd?: number
}

export interface ProviderShadowComparisonOptions {
  limitPerRequest?: number
  maxRequestsPerProvider: number
  maxTotalCostUsdPerProvider: number
}

function ratio(numerator: number, denominator: number): RatioMetric {
  return { numerator, denominator, value: denominator === 0 ? null : numerator / denominator }
}

function validateCorpus(corpus: ProviderControlCorpus): void {
  if (corpus.schemaVersion !== PROVIDER_CONTROL_CORPUS_VERSION) {
    throw new Error(`corpus.schemaVersion must be ${PROVIDER_CONTROL_CORPUS_VERSION}`)
  }
  if (!corpus.datasetVersion.trim()) throw new Error("corpus.datasetVersion is required")
  if (corpus.items.length === 0) throw new Error("corpus.items must not be empty")
  const ids = new Set<string>()
  for (const item of corpus.items) {
    if (!item.id.trim()) throw new Error("every corpus item requires an id")
    if (ids.has(item.id)) throw new Error(`duplicate corpus item id ${item.id}`)
    ids.add(item.id)
    if (!item.platform.trim()) throw new Error(`${item.id}.platform is required`)
    if (!["az", "ru", "en"].includes(item.locale)) throw new Error(`${item.id}.locale must be az, ru or en`)
    if (!item.contentKind.trim()) throw new Error(`${item.id}.contentKind is required`)
    if (!item.query.trim()) throw new Error(`${item.id}.query is required`)
    if (item.expectedUrls.length === 0) throw new Error(`${item.id}.expectedUrls must not be empty`)
    const required = item.requiredCapabilities ?? DEFAULT_REQUIRED_CAPABILITIES
    for (const capability of required) {
      if (!["DISCOVER_URLS", "ENRICH_CONTENT", "READ_COMMENTS", "READ_MEDIA", "UPDATE_METRICS"].includes(capability)) {
        throw new Error(`${item.id}.requiredCapabilities contains unknown capability ${capability}`)
      }
    }
    if (required.includes("READ_COMMENTS") && (item.expectedCommentIds?.length ?? 0) === 0) {
      throw new Error(`${item.id}.expectedCommentIds is required for READ_COMMENTS`)
    }
    if (item.providerVisibleCommentIds?.some(id => !item.expectedCommentIds?.includes(id))) {
      throw new Error(`${item.id}.providerVisibleCommentIds must be a subset of expectedCommentIds`)
    }
    if (required.includes("READ_MEDIA") && (item.expectedMediaKinds?.length ?? 0) === 0) {
      throw new Error(`${item.id}.expectedMediaKinds is required for READ_MEDIA`)
    }
    if (item.providerVisibleMediaKinds?.some(kind => !item.expectedMediaKinds?.includes(kind))) {
      throw new Error(`${item.id}.providerVisibleMediaKinds must be a subset of expectedMediaKinds`)
    }
    if (required.includes("UPDATE_METRICS") && (item.expectedMetricFields?.length ?? 0) === 0) {
      throw new Error(`${item.id}.expectedMetricFields is required for UPDATE_METRICS`)
    }
  }
}

function expectedSet(values: string[]): Set<string> {
  return new Set(values.map(canonicalProviderUrl))
}

function recordUrls(batch: ProviderBatch): string[] {
  return batch.records.flatMap(record => {
    if (record.recordType === "CANDIDATE" || record.recordType === "CONTENT") {
      return [canonicalProviderUrl(record.canonicalUrl || record.url)]
    }
    return []
  })
}

type ComparisonCounterKey = keyof ComparisonCounters

type ComparisonCounters = {
  expectedDiscovery: number
  matchedDiscovery: number
  discoveredTotal: number
  discoveredRelevant: number
  expectedEnrichment: number
  enriched: number
  expectedComments: number
  matchedComments: number
  expectedVisibleComments: number
  matchedVisibleComments: number
  expectedMedia: number
  matchedMedia: number
  expectedVisibleMedia: number
  matchedVisibleMedia: number
  expectedMetrics: number
  matchedMetrics: number
  contractAttempts: number
  validContracts: number
}

function emptyCounters(): ComparisonCounters {
  return {
    expectedDiscovery: 0,
    matchedDiscovery: 0,
    discoveredTotal: 0,
    discoveredRelevant: 0,
    expectedEnrichment: 0,
    enriched: 0,
    expectedComments: 0,
    matchedComments: 0,
    expectedVisibleComments: 0,
    matchedVisibleComments: 0,
    expectedMedia: 0,
    matchedMedia: 0,
    expectedVisibleMedia: 0,
    matchedVisibleMedia: 0,
    expectedMetrics: 0,
    matchedMetrics: 0,
    contractAttempts: 0,
    validContracts: 0,
  }
}

function addCounters(target: ComparisonCounters, source: ComparisonCounters): void {
  for (const key of Object.keys(target) as ComparisonCounterKey[]) target[key] += source[key]
}

function metricsFromCounters(
  counters: ComparisonCounters,
  acceptedUniqueUrls: number,
  totalCostUsd: number,
): ProviderComparisonMetrics {
  return {
    discoveryRecall: ratio(counters.matchedDiscovery, counters.expectedDiscovery),
    discoveryPrecision: ratio(counters.discoveredRelevant, counters.discoveredTotal),
    enrichmentCompleteness: ratio(counters.enriched, counters.expectedEnrichment),
    commentRecall: ratio(counters.matchedComments, counters.expectedComments),
    visibleCommentRecall: ratio(counters.matchedVisibleComments, counters.expectedVisibleComments),
    mediaCompleteness: ratio(counters.matchedMedia, counters.expectedMedia),
    visibleMediaCompleteness: ratio(counters.matchedVisibleMedia, counters.expectedVisibleMedia),
    metricCompleteness: ratio(counters.matchedMetrics, counters.expectedMetrics),
    schemaValidity: ratio(counters.validContracts, counters.contractAttempts),
    acceptedUniqueUrls,
    totalCostUsd,
    costPerAcceptedUniqueUsd: acceptedUniqueUrls === 0 ? null : totalCostUsd / acceptedUniqueUrls,
  }
}

async function execute(
  adapter: ProviderCapabilityAdapter,
  request: ProviderCapabilityRequest,
): Promise<ProviderBatch> {
  if (!adapter.supportedCapabilities.includes(request.capability)) {
    throw new Error(`${adapter.providerKey} does not support ${request.capability}`)
  }
  const batch = await adapter.execute(request)
  if (batch.providerKey !== adapter.providerKey) {
    throw new Error(`response providerKey ${batch.providerKey} does not match adapter ${adapter.providerKey}`)
  }
  if (batch.capability !== request.capability) {
    throw new Error(`response capability ${batch.capability} does not match request ${request.capability}`)
  }
  assertValidProviderBatch(batch)
  return batch
}

/**
 * Side-effect-free provider POC harness. It never writes to Prisma and always
 * tests enrichment/comments/media against the owner-supplied known URLs, so a
 * discovery miss does not hide the provider's extraction capability.
 */
export async function compareProviderAgainstCorpus(
  adapter: ProviderCapabilityAdapter,
  corpus: ProviderControlCorpus,
  options: ProviderComparisonOptions = {},
): Promise<ProviderComparisonReport> {
  validateCorpus(corpus)
  const limit = Math.max(1, Math.min(options.limitPerRequest ?? 100, 500))
  const shadowMode = options.shadowMode === true
  const maxRequests = options.maxRequests === undefined ? null : Math.trunc(options.maxRequests)
  const maxTotalCostUsd = options.maxTotalCostUsd ?? null
  if (shadowMode && (!maxRequests || maxRequests < 1)) {
    throw new Error("shadow maxRequests must be a positive integer")
  }
  if (shadowMode && (maxTotalCostUsd === null || !Number.isFinite(maxTotalCostUsd) || maxTotalCostUsd <= 0)) {
    throw new Error("shadow maxTotalCostUsd must be a positive number")
  }
  const errors: ProviderComparisonError[] = []
  const warnings: string[] = []
  const totals = emptyCounters()
  const countersByItem = new Map(corpus.items.map(item => [item.id, emptyCounters()]))
  const acceptedUrlsByItem = new Map(corpus.items.map(item => [item.id, new Set<string>()]))
  const costByItem = new Map(corpus.items.map(item => [item.id, 0]))
  let totalCostUsd = 0
  const acceptedUrls = new Set<string>()

  const increment = (itemId: string, key: ComparisonCounterKey, amount = 1) => {
    totals[key] += amount
    const itemCounters = countersByItem.get(itemId)
    if (!itemCounters) throw new Error(`missing comparison counters for ${itemId}`)
    itemCounters[key] += amount
  }

  const run = async (item: ProviderControlItem, request: ProviderCapabilityRequest): Promise<ProviderBatch | null> => {
    if (shadowMode && maxRequests !== null && totals.contractAttempts >= maxRequests) {
      errors.push({ itemId: item.id, capability: request.capability, message: "shadow_request_budget_exhausted" })
      return null
    }
    const remainingCostUsd = maxTotalCostUsd === null ? null : Math.max(0, maxTotalCostUsd - totalCostUsd)
    if (shadowMode && (remainingCostUsd === null || remainingCostUsd <= 0)) {
      errors.push({ itemId: item.id, capability: request.capability, message: "shadow_cost_budget_exhausted" })
      return null
    }
    increment(item.id, "contractAttempts")
    try {
      const batch = await execute(adapter, {
        ...request,
        ...(shadowMode && remainingCostUsd !== null
          ? {
              executionPolicy: {
                mode: "SHADOW" as const,
                allowPersistence: false as const,
                maxCostUsd: remainingCostUsd,
              },
            }
          : {}),
      })
      if (shadowMode) {
        const amountUsd = batch.cost?.amountUsd
        if (typeof amountUsd !== "number") {
          throw new Error("shadow response requires authoritative cost.amountUsd")
        }
        if (remainingCostUsd !== null && amountUsd > remainingCostUsd + Number.EPSILON) {
          throw new Error("shadow provider exceeded maxCostUsd")
        }
      }
      increment(item.id, "validContracts")
      totalCostUsd += batch.cost?.amountUsd ?? 0
      costByItem.set(item.id, (costByItem.get(item.id) ?? 0) + (batch.cost?.amountUsd ?? 0))
      warnings.push(...(batch.warnings ?? []).map(warning => `${item.id}:${request.capability}:${warning}`))
      return batch
    } catch (error) {
      errors.push({
        itemId: item.id,
        capability: request.capability,
        message: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  for (const item of corpus.items) {
    const expectedUrls = expectedSet(item.expectedUrls)
    increment(item.id, "expectedDiscovery", expectedUrls.size)
    const discovery = await run(item, {
      requestId: `${corpus.datasetVersion}:${item.id}:discover`,
      capability: "DISCOVER_URLS",
      platform: item.platform,
      query: item.query,
      limit,
    })
    if (discovery) {
      const uniqueDiscovered = new Set(recordUrls(discovery))
      increment(item.id, "discoveredTotal", uniqueDiscovered.size)
      for (const url of uniqueDiscovered) {
        if (!expectedUrls.has(url)) continue
        increment(item.id, "discoveredRelevant")
        increment(item.id, "matchedDiscovery")
        acceptedUrls.add(url)
        acceptedUrlsByItem.get(item.id)?.add(url)
      }
    }

    increment(item.id, "expectedEnrichment", expectedUrls.size)
    const enrichment = await run(item, {
      requestId: `${corpus.datasetVersion}:${item.id}:enrich`,
      capability: "ENRICH_CONTENT",
      platform: item.platform,
      targetUrls: Array.from(expectedUrls),
      limit,
    })
    if (enrichment) {
      const enrichedUrls = new Set(recordUrls(enrichment))
      for (const url of expectedUrls) {
        if (enrichedUrls.has(url)) increment(item.id, "enriched")
      }
    }

    if ((item.expectedCommentIds?.length ?? 0) > 0) {
      const visibleIds = new Set(item.expectedCommentIds)
      const providerVisibleIds = new Set(item.providerVisibleCommentIds ?? item.expectedCommentIds)
      increment(item.id, "expectedVisibleComments", visibleIds.size)
      increment(item.id, "expectedComments", providerVisibleIds.size)
      const comments = await run(item, {
        requestId: `${corpus.datasetVersion}:${item.id}:comments`,
        capability: "READ_COMMENTS",
        platform: item.platform,
        targetUrls: Array.from(expectedUrls),
        limit,
      })
      if (comments) {
        const actualIds = new Set(comments.records
          .filter((record): record is ProviderCommentRecord => record.recordType === "COMMENT")
          .map(record => record.externalId))
        for (const id of visibleIds) if (actualIds.has(id)) increment(item.id, "matchedVisibleComments")
        for (const id of providerVisibleIds) if (actualIds.has(id)) increment(item.id, "matchedComments")
      }
    }

    if ((item.expectedMediaKinds?.length ?? 0) > 0) {
      const visibleKinds = new Set(item.expectedMediaKinds)
      const providerVisibleKinds = new Set(item.providerVisibleMediaKinds ?? item.expectedMediaKinds)
      increment(item.id, "expectedVisibleMedia", visibleKinds.size)
      increment(item.id, "expectedMedia", providerVisibleKinds.size)
      const media = await run(item, {
        requestId: `${corpus.datasetVersion}:${item.id}:media`,
        capability: "READ_MEDIA",
        platform: item.platform,
        targetUrls: Array.from(expectedUrls),
        limit,
      })
      if (media) {
        const actualKinds = new Set(media.records.flatMap(record => record.recordType === "MEDIA" ? [record.mediaKind] : []))
        for (const kind of visibleKinds) if (actualKinds.has(kind)) increment(item.id, "matchedVisibleMedia")
        for (const kind of providerVisibleKinds) if (actualKinds.has(kind)) increment(item.id, "matchedMedia")
      }
    }

    if ((item.expectedMetricFields?.length ?? 0) > 0) {
      const expectedFields = new Set(item.expectedMetricFields)
      increment(item.id, "expectedMetrics", expectedFields.size)
      const metrics = await run(item, {
        requestId: `${corpus.datasetVersion}:${item.id}:metrics`,
        capability: "UPDATE_METRICS",
        platform: item.platform,
        targetUrls: Array.from(expectedUrls),
        limit,
      })
      if (metrics) {
        const records = metrics.records.filter((record): record is ProviderMetricRecord => record.recordType === "METRIC")
        for (const field of expectedFields) {
          if (records.some(record => typeof record[field] === "number")) increment(item.id, "matchedMetrics")
        }
      }
    }
  }

  const requiredCapabilities = Array.from(new Set(corpus.items.flatMap(item => (
    item.requiredCapabilities ?? DEFAULT_REQUIRED_CAPABILITIES
  ))))
  const sliceStates = new Map<string, {
    platform: string
    locale: string
    contentKind: string
    itemCount: number
    requiredCapabilities: Set<ProviderCapability>
    counters: ComparisonCounters
    acceptedUrls: Set<string>
    totalCostUsd: number
  }>()
  for (const item of corpus.items) {
    const sliceKey = `${item.platform}:${item.locale}:${item.contentKind}`
    const state = sliceStates.get(sliceKey) ?? {
      platform: item.platform,
      locale: item.locale,
      contentKind: item.contentKind,
      itemCount: 0,
      requiredCapabilities: new Set<ProviderCapability>(),
      counters: emptyCounters(),
      acceptedUrls: new Set<string>(),
      totalCostUsd: 0,
    }
    state.itemCount += 1
    for (const capability of item.requiredCapabilities ?? DEFAULT_REQUIRED_CAPABILITIES) {
      state.requiredCapabilities.add(capability)
    }
    addCounters(state.counters, countersByItem.get(item.id) ?? emptyCounters())
    for (const url of acceptedUrlsByItem.get(item.id) ?? []) state.acceptedUrls.add(url)
    state.totalCostUsd += costByItem.get(item.id) ?? 0
    sliceStates.set(sliceKey, state)
  }
  const slices: ProviderComparisonSlice[] = Array.from(sliceStates.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([sliceKey, state]) => ({
      sliceKey,
      platform: state.platform,
      locale: state.locale,
      contentKind: state.contentKind,
      itemCount: state.itemCount,
      requiredCapabilities: Array.from(state.requiredCapabilities),
      metrics: metricsFromCounters(state.counters, state.acceptedUrls.size, state.totalCostUsd),
    }))

  return {
    contractVersion: PROVIDER_CONTRACT_VERSION,
    corpusVersion: corpus.datasetVersion,
    providerKey: adapter.providerKey,
    requiredCapabilities,
    metrics: metricsFromCounters(totals, acceptedUrls.size, totalCostUsd),
    slices,
    errors,
    warnings,
  }
}

export async function compareProvidersInShadowMode(
  adapters: ProviderCapabilityAdapter[],
  corpus: ProviderControlCorpus,
  options: ProviderShadowComparisonOptions,
): Promise<ProviderComparisonReport[]> {
  if (adapters.length < 2) throw new Error("shadow comparison requires at least two providers")
  const providerKeys = new Set(adapters.map(adapter => adapter.providerKey))
  if (providerKeys.size !== adapters.length) throw new Error("shadow comparison provider keys must be unique")
  return Promise.all(adapters.map(adapter => compareProviderAgainstCorpus(adapter, corpus, {
    limitPerRequest: options.limitPerRequest,
    shadowMode: true,
    maxRequests: options.maxRequestsPerProvider,
    maxTotalCostUsd: options.maxTotalCostUsdPerProvider,
  })))
}

export interface ProviderComparisonGates {
  minDiscoveryRecall: number
  minDiscoveryPrecision: number
  minEnrichmentCompleteness: number
  minCommentRecall: number
  minVisibleCommentRecall: number
  minMediaCompleteness: number
  minVisibleMediaCompleteness: number
  minMetricCompleteness: number
  minSchemaValidity: number
}

export const DEFAULT_PROVIDER_COMPARISON_GATES: ProviderComparisonGates = {
  minDiscoveryRecall: 0.9,
  minDiscoveryPrecision: 0.9,
  minEnrichmentCompleteness: 0.95,
  minCommentRecall: 0.9,
  minVisibleCommentRecall: 0.9,
  minMediaCompleteness: 0.95,
  minVisibleMediaCompleteness: 0.95,
  minMetricCompleteness: 0.95,
  minSchemaValidity: 0.99,
}

export function providerComparisonPasses(
  report: ProviderComparisonReport,
  gates: ProviderComparisonGates = DEFAULT_PROVIDER_COMPARISON_GATES,
): boolean {
  const metricsPass = (
    metrics: ProviderComparisonMetrics,
    requiredCapabilities: ProviderCapability[],
  ) => {
    const passes = (metric: RatioMetric, minimum: number, capability: ProviderCapability) => (
    metric.denominator === 0
      ? !requiredCapabilities.includes(capability)
      : (metric.value ?? 0) >= minimum
    )
    return passes(metrics.discoveryRecall, gates.minDiscoveryRecall, "DISCOVER_URLS")
      && passes(metrics.discoveryPrecision, gates.minDiscoveryPrecision, "DISCOVER_URLS")
      && passes(metrics.enrichmentCompleteness, gates.minEnrichmentCompleteness, "ENRICH_CONTENT")
      && passes(metrics.commentRecall, gates.minCommentRecall, "READ_COMMENTS")
      && passes(metrics.visibleCommentRecall, gates.minVisibleCommentRecall, "READ_COMMENTS")
      && passes(metrics.mediaCompleteness, gates.minMediaCompleteness, "READ_MEDIA")
      && passes(metrics.visibleMediaCompleteness, gates.minVisibleMediaCompleteness, "READ_MEDIA")
      && passes(metrics.metricCompleteness, gates.minMetricCompleteness, "UPDATE_METRICS")
      && passes(metrics.schemaValidity, gates.minSchemaValidity, "ENRICH_CONTENT")
  }
  return report.errors.length === 0
    && metricsPass(report.metrics, report.requiredCapabilities)
    && report.slices.length > 0
    && report.slices.every(slice => metricsPass(slice.metrics, slice.requiredCapabilities))
}
