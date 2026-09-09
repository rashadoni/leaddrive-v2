import { describe, expect, it } from "vitest"
import {
  compareProviderAgainstCorpus,
  compareProvidersInShadowMode,
  PROVIDER_CONTROL_CORPUS_VERSION,
  providerComparisonPasses,
  type ProviderControlCorpus,
} from "@/lib/social/provider-comparison"
import {
  PROVIDER_CONTRACT_VERSION,
  type ProviderBatch,
  type ProviderCapabilityAdapter,
  type ProviderCapabilityRequest,
  type ProviderProvenance,
} from "@/lib/social/provider-capability-contract"

const corpus: ProviderControlCorpus = {
  schemaVersion: PROVIDER_CONTROL_CORPUS_VERSION,
  datasetVersion: "fixture-2026-07-13",
  items: [{
    id: "ig-acme",
    platform: "instagram",
    locale: "en",
    contentKind: "POST",
    query: "Acme Robotics",
    expectedUrls: ["https://instagram.com/p/ONE", "https://instagram.com/p/TWO"],
    requiredCapabilities: ["DISCOVER_URLS", "ENRICH_CONTENT", "READ_COMMENTS", "READ_MEDIA", "UPDATE_METRICS"],
    expectedCommentIds: ["comment-1", "comment-2"],
    expectedMediaKinds: ["VIDEO", "THUMBNAIL"],
    expectedMetricFields: ["views", "likes", "comments"],
  }],
}

function provenance(providerItemId: string): ProviderProvenance {
  return {
    providerKey: "fixture-provider",
    adapterKey: "FIXTURE",
    providerItemId,
    observedAt: "2026-07-13T12:00:00.000Z",
    schemaVersion: "fixture-v1",
  }
}

function batch(request: ProviderCapabilityRequest): ProviderBatch {
  const base = {
    contractVersion: PROVIDER_CONTRACT_VERSION,
    providerKey: "fixture-provider",
    capability: request.capability,
    cost: { amountUsd: 0.25 },
  }
  if (request.capability === "DISCOVER_URLS") return {
    ...base,
    records: [
      { recordType: "CANDIDATE", platform: "instagram", url: "https://instagram.com/p/ONE?utm_source=fixture", provenance: provenance("one") },
      { recordType: "CANDIDATE", platform: "instagram", url: "https://instagram.com/p/TWO", provenance: provenance("two") },
      { recordType: "CANDIDATE", platform: "instagram", url: "https://instagram.com/p/NOISE", provenance: provenance("noise") },
    ],
  }
  if (request.capability === "ENRICH_CONTENT") return {
    ...base,
    records: request.targetUrls!.map((url, index) => ({
      recordType: "CONTENT" as const,
      platform: "instagram",
      externalId: `post-${index}`,
      contentKind: "POST" as const,
      url,
      text: `Acme post ${index}`,
      provenance: provenance(`post-${index}`),
    })),
  }
  if (request.capability === "READ_COMMENTS") return {
    ...base,
    records: ["comment-1", "comment-2"].map(id => ({
      recordType: "COMMENT" as const,
      platform: "instagram",
      externalId: id,
      contentKind: "COMMENT" as const,
      text: `comment ${id}`,
      postExternalId: "post-0",
      parentPostUrl: request.targetUrls![0],
      depth: 0,
      provenance: provenance(id),
    })),
  }
  if (request.capability === "READ_MEDIA") return {
    ...base,
    records: ["VIDEO", "THUMBNAIL"].map((mediaKind, index) => ({
      recordType: "MEDIA" as const,
      platform: "instagram",
      externalId: `media-${index}`,
      parentExternalId: "post-0",
      parentUrl: request.targetUrls![0],
      mediaKind: mediaKind as "VIDEO" | "THUMBNAIL",
      url: `https://cdn.example/${index}.jpg`,
      provenance: provenance(`media-${index}`),
    })),
  }
  if (request.capability === "UPDATE_METRICS") return {
    ...base,
    records: [{
      recordType: "METRIC",
      platform: "instagram",
      externalId: "post-0",
      parentUrl: request.targetUrls![0],
      observedAt: "2026-07-13T12:00:00.000Z",
      views: 100,
      likes: 10,
      comments: 2,
      provenance: provenance("metrics-post-0"),
    }],
  }
  return { ...base, records: [] }
}

function adapter(execute = async (request: ProviderCapabilityRequest) => batch(request)): ProviderCapabilityAdapter {
  return {
    providerKey: "fixture-provider",
    supportedCapabilities: ["DISCOVER_URLS", "ENRICH_CONTENT", "READ_COMMENTS", "READ_MEDIA", "UPDATE_METRICS"],
    execute,
  }
}

describe("provider comparison harness", () => {
  it("measures discovery, enrichment, comments, media and cost without persistence", async () => {
    const report = await compareProviderAgainstCorpus(adapter(), corpus)

    expect(report.errors).toEqual([])
    expect(report.metrics.discoveryRecall).toEqual({ numerator: 2, denominator: 2, value: 1 })
    expect(report.metrics.discoveryPrecision).toEqual({ numerator: 2, denominator: 3, value: 2 / 3 })
    expect(report.metrics.enrichmentCompleteness.value).toBe(1)
    expect(report.metrics.commentRecall.value).toBe(1)
    expect(report.metrics.visibleCommentRecall.value).toBe(1)
    expect(report.metrics.mediaCompleteness.value).toBe(1)
    expect(report.metrics.visibleMediaCompleteness.value).toBe(1)
    expect(report.metrics.metricCompleteness.value).toBe(1)
    expect(report.metrics.schemaValidity.value).toBe(1)
    expect(report.metrics.totalCostUsd).toBe(1.25)
    expect(report.metrics.costPerAcceptedUniqueUsd).toBe(0.625)
    expect(report.slices).toEqual([
      expect.objectContaining({
        sliceKey: "instagram:en:POST",
        platform: "instagram",
        locale: "en",
        contentKind: "POST",
        itemCount: 1,
      }),
    ])
    expect(providerComparisonPasses(report)).toBe(false)
  })

  it("treats a valid zero-result response as coverage evidence, not a provider failure", async () => {
    const zeroAdapter = adapter(async request => ({
      contractVersion: PROVIDER_CONTRACT_VERSION,
      providerKey: "fixture-provider",
      capability: request.capability,
      records: [],
    }))
    const report = await compareProviderAgainstCorpus(zeroAdapter, corpus)

    expect(report.errors).toEqual([])
    expect(report.metrics.schemaValidity.value).toBe(1)
    expect(report.metrics.discoveryRecall.value).toBe(0)
    expect(report.metrics.discoveryPrecision.value).toBeNull()
    expect(report.metrics.costPerAcceptedUniqueUsd).toBeNull()
    expect(providerComparisonPasses(report)).toBe(false)
  })

  it("records contract drift as an error instead of importing malformed data", async () => {
    const drifting = adapter(async request => request.capability === "DISCOVER_URLS"
      ? {
          contractVersion: "vendor-broke-the-schema",
          providerKey: "fixture-provider",
          capability: request.capability,
          records: [],
        }
      : batch(request))
    const report = await compareProviderAgainstCorpus(drifting, corpus)

    expect(report.errors).toHaveLength(1)
    expect(report.errors[0]).toMatchObject({ itemId: "ig-acme", capability: "DISCOVER_URLS" })
    expect(report.metrics.schemaValidity).toEqual({ numerator: 4, denominator: 5, value: 0.8 })
    expect(providerComparisonPasses(report)).toBe(false)
  })

  it("rejects an unversioned or empty control corpus before spending provider units", async () => {
    let calls = 0
    const tracked = adapter(async request => {
      calls += 1
      return batch(request)
    })

    await expect(compareProviderAgainstCorpus(tracked, { ...corpus, schemaVersion: "old" }))
      .rejects.toThrow(`corpus.schemaVersion must be ${PROVIDER_CONTROL_CORPUS_VERSION}`)
    await expect(compareProviderAgainstCorpus(tracked, { ...corpus, items: [] }))
      .rejects.toThrow("corpus.items must not be empty")
    expect(calls).toBe(0)
  })

  it("rejects ambiguous provider-visible denominators before provider execution", async () => {
    let calls = 0
    const tracked = adapter(async request => {
      calls += 1
      return batch(request)
    })
    const invalid = {
      ...corpus,
      items: [{
        ...corpus.items[0],
        providerVisibleCommentIds: ["not-visible-to-owner"],
      }],
    }

    await expect(compareProviderAgainstCorpus(tracked, invalid))
      .rejects.toThrow("providerVisibleCommentIds must be a subset")
    expect(calls).toBe(0)
  })

  it("fails when one platform-locale-content slice misses the gate despite a passing aggregate", async () => {
    const items: ProviderControlCorpus["items"] = Array.from({ length: 10 }, (_, index) => ({
      id: `ig-en-${index}`,
      platform: "instagram",
      locale: "en" as const,
      contentKind: "POST",
      query: `https://instagram.com/p/${index}`,
      expectedUrls: [`https://instagram.com/p/${index}`],
    }))
    items.push({
      id: "tt-ru-gap",
      platform: "tiktok",
      locale: "ru",
      contentKind: "VIDEO",
      query: "https://tiktok.com/@brand/video/gap",
      expectedUrls: ["https://tiktok.com/@brand/video/gap"],
    })
    const segmentedCorpus: ProviderControlCorpus = {
      schemaVersion: PROVIDER_CONTROL_CORPUS_VERSION,
      datasetVersion: "segmented-fixture",
      items,
    }
    const segmentedAdapter = adapter(async request => {
      const records = request.capability === "DISCOVER_URLS"
        ? request.platform === "tiktok"
          ? []
          : [{
              recordType: "CANDIDATE" as const,
              platform: request.platform,
              url: request.query!,
              provenance: provenance(request.requestId),
            }]
        : request.targetUrls!.map(url => ({
            recordType: "CONTENT" as const,
            platform: request.platform,
            externalId: request.requestId,
            contentKind: "POST" as const,
            url,
            text: "fixture",
            provenance: provenance(request.requestId),
          }))
      return {
        contractVersion: PROVIDER_CONTRACT_VERSION,
        providerKey: "fixture-provider",
        capability: request.capability,
        records,
      } as ProviderBatch
    })

    const report = await compareProviderAgainstCorpus(segmentedAdapter, segmentedCorpus)

    expect(report.metrics.discoveryRecall.value).toBeCloseTo(10 / 11)
    expect(report.metrics.discoveryPrecision.value).toBe(1)
    expect(report.slices).toHaveLength(2)
    expect(report.slices.find(slice => slice.platform === "tiktok")?.metrics.discoveryRecall.value).toBe(0)
    expect(providerComparisonPasses(report)).toBe(false)
  })

  it("runs two isolated shadow providers with per-provider hard caps and no persistence permission", async () => {
    const requests: ProviderCapabilityRequest[] = []
    const tracked = (providerKey: string): ProviderCapabilityAdapter => ({
      ...adapter(async request => {
        requests.push(request)
        return { ...batch(request), providerKey, records: batch(request).records.map(record => ({
          ...record,
          provenance: { ...record.provenance, providerKey },
        })) } as ProviderBatch
      }),
      providerKey,
    })

    const reports = await compareProvidersInShadowMode([
      tracked("primary-fixture"),
      tracked("shadow-fixture"),
    ], corpus, {
      maxRequestsPerProvider: 5,
      maxTotalCostUsdPerProvider: 1.25,
    })

    expect(reports).toHaveLength(2)
    expect(reports.map(report => report.providerKey)).toEqual(["primary-fixture", "shadow-fixture"])
    expect(requests).toHaveLength(10)
    expect(requests.every(request => request.executionPolicy?.mode === "SHADOW")).toBe(true)
    expect(requests.every(request => request.executionPolicy?.allowPersistence === false)).toBe(true)
    expect(requests.every(request => (request.executionPolicy?.maxCostUsd ?? 0) > 0)).toBe(true)
  })

  it("stops shadow calls at the request budget instead of silently overspending", async () => {
    let calls = 0
    const tracked = adapter(async request => {
      calls += 1
      return batch(request)
    })

    const report = await compareProviderAgainstCorpus(tracked, corpus, {
      shadowMode: true,
      maxRequests: 2,
      maxTotalCostUsd: 0.5,
    })

    expect(calls).toBe(2)
    expect(report.metrics.totalCostUsd).toBe(0.5)
    expect(report.errors.map(error => error.message)).toContain("shadow_request_budget_exhausted")
  })

  it("rejects shadow mode without both request and cost hard caps before dispatch", async () => {
    let calls = 0
    const tracked = adapter(async request => {
      calls += 1
      return batch(request)
    })

    await expect(compareProviderAgainstCorpus(tracked, corpus, { shadowMode: true, maxRequests: 5 }))
      .rejects.toThrow("maxTotalCostUsd")
    await expect(compareProviderAgainstCorpus(tracked, corpus, { shadowMode: true, maxTotalCostUsd: 1 }))
      .rejects.toThrow("maxRequests")
    expect(calls).toBe(0)
  })
})
