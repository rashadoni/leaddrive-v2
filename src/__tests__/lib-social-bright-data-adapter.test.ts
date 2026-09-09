import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import instagramPost from "./fixtures/bright-data-instagram-post.json"
import tiktokComment from "./fixtures/bright-data-tiktok-comment.json"

const findMatchedKeyword = vi.hoisted(() => vi.fn((text: string, terms: string[]) => (
  terms.find(term => text.toLocaleLowerCase().includes(term.toLocaleLowerCase())) ?? null
)))
const runWithinImportFence = vi.hoisted(() => vi.fn())

vi.mock("@/lib/secure-token", () => ({
  hmacToken: (value: string, context: string) => `hmac:${context}:${value.length}`,
}))
const findManyRevisits = vi.hoisted(() => vi.fn())
const createManyRevisits = vi.hoisted(() => vi.fn())
const findMissingRevisitEnvelopes = vi.hoisted(() => vi.fn())
const findAcceptedEnvelope = vi.hoisted(() => vi.fn())
const findActiveSubjects = vi.hoisted(() => vi.fn())
const parentMatchContextsForComments = vi.hoisted(() => vi.fn())
vi.mock("@/lib/prisma", () => ({
  prisma: {
    monitoringSubject: { findMany: findActiveSubjects },
    ingestEnvelope: {
      findMany: findMissingRevisitEnvelopes,
      findFirst: findAcceptedEnvelope,
    },
    tikTokPublicationRevisit: {
      findMany: findManyRevisits,
      createMany: createManyRevisits,
    },
    $queryRaw: findMissingRevisitEnvelopes,
  },
}))
const ingestMentionWithResult = vi.hoisted(() => vi.fn())
vi.mock("@/lib/social/ingest-mention", () => ({
  findMatchedKeyword,
  ingestMentionWithResult,
}))
vi.mock("@/lib/social/parent-match-context", () => ({
  parentMatchContextsForComments,
}))
vi.mock("@/lib/social/media-observations", () => ({ scheduleProviderMediaRecord: vi.fn() }))
const recordProviderMetricSnapshot = vi.hoisted(() => vi.fn())
vi.mock("@/lib/social/metric-snapshots", () => ({ recordProviderMetricSnapshot }))
const finalizeBrightDataProviderRunLedger = vi.hoisted(() => vi.fn())
vi.mock("@/lib/social/bright-data-run-ledger-repo", () => ({ finalizeBrightDataProviderRunLedger }))
vi.mock("@/lib/social/monitoring-import-fence", () => ({ withSocialMonitoringImportFence: runWithinImportFence }))
const tiktokGate = vi.hoisted(() => ({
  decide: vi.fn(),
  eligible: vi.fn(),
  persist: vi.fn(),
}))
vi.mock("@/lib/social/tiktok-publication-gate", () => ({
  decideTikTokPublication: tiktokGate.decide,
  isTikTokPublicationEligibleForComments: tiktokGate.eligible,
  persistTikTokPublicationDecision: tiktokGate.persist,
}))
const recordTikTokRevisitByPost = vi.hoisted(() => vi.fn())
vi.mock("@/lib/social/tiktok-publication-revisit-repo", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/social/tiktok-publication-revisit-repo")>(),
  recordTikTokPublicationRevisitByPost: recordTikTokRevisitByPost,
}))

import {
  brightDataArchiveContextForSource,
  brightDataInputsFor,
  dueTikTokRevisitTargets,
  filterBrightDataBatchesForArchive,
  brightDataProviderCapability,
  importBrightDataSnapshotRows,
  persistBrightDataBatches,
  providerRecordMatchedTerm,
  runBrightDataCollector,
  type BrightDataArchiveContext,
  type BrightDataAdapterDependencies,
  type BrightDataAdapterTarget,
} from "@/lib/social/bright-data-adapter"
import { BrightDataApiError } from "@/lib/social/bright-data-client"
import { archiveProviderCursorKey } from "@/lib/social/archive-provider-window"
import type { MonitoringCollectorResult, MonitoringSourceForRun } from "@/lib/social/monitoring-collector"
import type { ProviderBatch, ProviderCandidateRecord } from "@/lib/social/provider-capability-contract"

const priceSnapshot = {
  id: "bright-data-web-scraper-payg-2026-07-13",
  effectiveAt: "2026-07-13T00:00:00.000Z",
  usdPerThousandRecords: 1.5,
  sourceUrl: "https://brightdata.com/cp/billing/overview",
}

const readyBudget = {
  status: "READY" as const,
  schemaVersion: "bright-data-budget-cap-v1" as const,
  priceSnapshotId: priceSnapshot.id,
  hardCapUsd: 0.05,
  inputCount: 1,
  requestedLimitPerInput: 10,
  limitPerInput: 10,
  requestedMaxRecords: 10,
  maxBillableRecords: 33,
  reservedRecords: 10,
  reservedChargeUsd: 0.015,
  headroomUsd: 0.035,
  clamped: false,
}

function source(capability = "DISCOVER_POSTS"): MonitoringSourceForRun {
  return {
    id: "source-1",
    organizationId: "org-1",
    platform: "instagram",
    sourceType: "profile",
    url: "https://instagram.com/synthetic_brand",
    handle: "synthetic_brand",
    query: "synthetic brand",
    ownership: "external",
    collectionMode: "provider_api",
    status: "active",
    cadenceMinutes: 60,
    lastCheckedAt: null,
    lastSuccessfulAt: null,
    lastError: null,
    settings: {},
    keywords: ["synthetic brand"],
    routeExecution: {
      collectorRunId: "collector-1",
      routePlanId: "route-1",
      capability,
      adapterKey: "BRIGHT_DATA_SNAPSHOT",
      acquisitionMode: "LICENSED_PROVIDER",
      providerKey: "bright-data",
      providerRunId: "provider-run-1",
      maxItems: 10,
      timeoutSeconds: 60,
    },
  }
}

function dependencies(overrides: Partial<BrightDataAdapterDependencies> = {}) {
  const client = {
    trigger: vi.fn(async () => ({ snapshotId: "s_snapshot1" })),
    cancel: vi.fn(async () => undefined),
    triggerWithBudgetCap: vi.fn(async () => ({
      kind: "dispatched" as const,
      budget: readyBudget,
      result: { snapshotId: "s_snapshot1" },
    })),
    pollUntilReady: vi.fn(async () => ({
      snapshotId: "s_snapshot1",
      datasetId: "gd_lk5ns7kz21pck8jpis",
      status: "ready" as const,
    })),
    download: vi.fn(async () => [instagramPost]),
  }
  const deps: BrightDataAdapterDependencies = {
    now: () => new Date("2026-07-14T03:00:00.000Z"),
    createClient: vi.fn(() => client),
    priceSnapshot: () => ({ status: "READY", snapshot: priceSnapshot }),
    getRun: vi.fn(async () => ({ id: "provider-run-1", maxTotalChargeUsd: 0.05, reservedChargeUsd: 0.05 })),
    beginDispatch: vi.fn(async () => true),
    prepareRun: vi.fn(async () => undefined),
    setExternalRunId: vi.fn(async () => undefined),
    loadTargets: vi.fn(async () => []),
    persist: vi.fn(async () => ({ newCount: 1, duplicateCount: 0, ignoredCount: 0 })),
    finalize: vi.fn(async () => undefined),
    runWithinImportFence,
    reuseEnrichment: vi.fn(async () => null),
    ...overrides,
  }
  return { deps, client }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("SOCIAL_BRIGHT_DATA_LIVE_ROUTING", "1")
  vi.stubEnv("SOCIAL_MONITORING_ENFORCE_USD_BUDGETS", "1")
  vi.stubEnv("BRIGHT_DATA_API_TOKEN", "test-token-never-logged")
  runWithinImportFence.mockImplementation(async (
    _input: unknown,
    persist: () => Promise<unknown>,
  ) => ({ allowed: true, value: await persist() }))
  findMissingRevisitEnvelopes.mockResolvedValue([])
  createManyRevisits.mockResolvedValue({ count: 0 })
  findActiveSubjects.mockResolvedValue([{ id: "subject-1" }])
  parentMatchContextsForComments.mockResolvedValue(new Map())
  tiktokGate.decide.mockReturnValue({
    status: "MATCHED",
    reasonCode: "DETERMINISTIC_TERM_MATCH",
    matchedTerms: ["synthetic brand"],
    scenarioIds: [],
    query: "synthetic brand",
    provider: "bright-data",
    observedAt: "2026-07-14T03:00:00.000Z",
    policySnapshot: { version: "tiktok-publication-gate-v1" },
  })
  tiktokGate.eligible.mockReturnValue(true)
  tiktokGate.persist.mockResolvedValue("applied")
  recordTikTokRevisitByPost.mockResolvedValue(true)
})

afterEach(() => vi.unstubAllEnvs())

describe("Bright Data collector adapter", () => {
  it("uses the scenario start on the first archive run and its isolated cursor on repeats", () => {
    const archiveSource = source()
    const archiveStartAt = "2026-07-01T00:00:00.000Z"
    archiveSource.routeExecution = {
      ...archiveSource.routeExecution!,
      fullArchiveRun: true,
      targetScenarioId: "scenario-1",
      archiveStartAt,
    }
    // The profile API supplies the authoritative scenario boundary. Legacy
    // and shared sources are allowed to have no denormalized scenarioLinks.
    archiveSource.settings = { scenarioLinks: [] }

    expect(brightDataArchiveContextForSource(
      archiveSource,
      new Date("2026-07-14T03:00:00.000Z"),
    )).toMatchObject({
      archiveStartAt,
      cursorSince: archiveStartAt,
      since: archiveStartAt,
      until: "2026-07-14T03:00:00.000Z",
      resumedFromWatermark: false,
    })

    const cursorKey = archiveProviderCursorKey({
      routePlanId: "route-1",
      adapterKey: "BRIGHT_DATA_SNAPSHOT",
      fullArchiveRun: true,
      targetScenarioId: "scenario-1",
      archiveStartAt,
    })
    archiveSource.settings = {
      scenarioLinks: [],
      searchIndex: {
        routeProviderCursors: {
          [cursorKey]: { fetchAfter: "2026-07-14T02:00:00.000Z" },
        },
      },
    }
    expect(brightDataArchiveContextForSource(
      archiveSource,
      new Date("2026-07-14T03:00:00.000Z"),
    )).toMatchObject({
      cursorSince: "2026-07-14T02:00:00.000Z",
      since: "2026-07-14T01:55:00.000Z",
      until: "2026-07-14T03:00:00.000Z",
      resumedFromWatermark: true,
      overlapMinutes: 5,
    })
  })

  it("filters archive candidates by the frozen publication window and fails missing dates closed", () => {
    const provenance = {
      providerKey: "bright-data",
      adapterKey: "BRIGHT_DATA_TIKTOK_DISCOVERY",
      providerItemId: "post-1",
      observedAt: "2026-07-14T03:00:00.000Z",
      schemaVersion: "test-v1",
    }
    const candidate = (externalId: string, publishedAt: string | null): ProviderCandidateRecord => ({
      recordType: "CANDIDATE",
      platform: "tiktok",
      url: `https://www.tiktok.com/@brand/video/${externalId}`,
      externalId,
      query: "brand",
      publishedAt,
      provenance: { ...provenance, providerItemId: externalId },
    })
    const batch: ProviderBatch = {
      contractVersion: "social-provider-capabilities-v1",
      providerKey: "bright-data",
      capability: "DISCOVER_URLS",
      records: [
        candidate("inside", "2026-07-14T02:00:00.000Z"),
        candidate("old", "2026-07-13T23:59:59.999Z"),
        candidate("future", "2026-07-14T03:00:00.001Z"),
        candidate("unknown", null),
      ],
    }
    const context: BrightDataArchiveContext = {
      fullArchiveRun: true,
      targetScenarioId: "scenario-1",
      archiveStartAt: "2026-07-14T00:00:00.000Z",
      cursorSince: "2026-07-14T00:00:00.000Z",
      since: "2026-07-14T00:00:00.000Z",
      until: "2026-07-14T03:00:00.000Z",
      resumedFromWatermark: false,
      overlapMinutes: 0,
    }

    const filtered = filterBrightDataBatchesForArchive([batch], context)
    expect(filtered.batches[0].records.map(record => record.externalId)).toEqual(["inside"])
    expect(filtered).toMatchObject({
      outsideWindowCount: 2,
      unknownTimestampCount: 1,
    })
  })

  it("fails coalesced media and metrics closed when their parent content is outside the archive window", () => {
    const provenance = {
      providerKey: "bright-data",
      adapterKey: "BRIGHT_DATA_INSTAGRAM_POST",
      providerItemId: "post-1",
      observedAt: "2026-07-14T03:00:00.000Z",
      schemaVersion: "test-v1",
    }
    const publishedAt = new Map<string, string | null>([
      ["inside", "2026-07-14T02:00:00.000Z"],
      ["outside", "2026-07-13T23:59:59.999Z"],
      ["unknown", null],
    ])
    const batches: ProviderBatch[] = [
      {
        contractVersion: "social-provider-capabilities-v1",
        providerKey: "bright-data",
        capability: "ENRICH_CONTENT",
        records: [...publishedAt].map(([externalId, timestamp]) => ({
          recordType: "CONTENT",
          platform: "instagram",
          externalId,
          contentKind: "POST",
          url: `https://www.instagram.com/p/${externalId}/`,
          text: externalId,
          publishedAt: timestamp,
          provenance: { ...provenance, providerItemId: externalId },
        })),
      },
      {
        contractVersion: "social-provider-capabilities-v1",
        providerKey: "bright-data",
        capability: "READ_MEDIA",
        records: [...publishedAt.keys()].map(externalId => ({
          recordType: "MEDIA",
          platform: "instagram",
          externalId: `media-${externalId}`,
          parentExternalId: externalId,
          parentUrl: `https://www.instagram.com/p/${externalId}/`,
          mediaKind: "IMAGE",
          url: `https://cdn.example.com/${externalId}.jpg`,
          provenance: { ...provenance, providerItemId: `media-${externalId}` },
        })),
      },
      {
        contractVersion: "social-provider-capabilities-v1",
        providerKey: "bright-data",
        capability: "UPDATE_METRICS",
        records: [...publishedAt.keys()].map(externalId => ({
          recordType: "METRIC",
          platform: "instagram",
          externalId,
          parentUrl: `https://www.instagram.com/p/${externalId}/`,
          observedAt: "2026-07-14T03:00:00.000Z",
          likes: 1,
          provenance: { ...provenance, providerItemId: externalId },
        })),
      },
    ]
    const context: BrightDataArchiveContext = {
      fullArchiveRun: true,
      targetScenarioId: "scenario-1",
      archiveStartAt: "2026-07-14T00:00:00.000Z",
      cursorSince: "2026-07-14T00:00:00.000Z",
      since: "2026-07-14T00:00:00.000Z",
      until: "2026-07-14T03:00:00.000Z",
      resumedFromWatermark: false,
      overlapMinutes: 0,
    }

    const filtered = filterBrightDataBatchesForArchive(batches, context)

    expect(filtered.batches[0].records.map(record => record.externalId)).toEqual(["inside"])
    expect(filtered.batches[1].records.map(record => (
      record.recordType === "MEDIA" ? record.parentExternalId : null
    ))).toEqual(["inside"])
    expect(filtered.batches[2].records.map(record => record.externalId)).toEqual(["inside"])
    expect(filtered).toMatchObject({
      outsideWindowCount: 1,
      unknownTimestampCount: 1,
    })
  })

  it("marks an archive import partial when a provider row has no publication timestamp", async () => {
    const archiveContext: BrightDataArchiveContext = {
      fullArchiveRun: true,
      targetScenarioId: "scenario-1",
      archiveStartAt: "2026-07-01T00:00:00.000Z",
      cursorSince: "2026-07-01T00:00:00.000Z",
      since: "2026-07-01T00:00:00.000Z",
      until: "2026-07-14T03:00:00.000Z",
      resumedFromWatermark: false,
      overlapMinutes: 0,
    }
    const persist = vi.fn(async () => ({ newCount: 0, duplicateCount: 0, ignoredCount: 0 }))
    const finalize = vi.fn(async () => undefined)

    const result = await importBrightDataSnapshotRows({
      source: source(),
      providerRunId: "provider-run-1",
      capability: "DISCOVER_URLS",
      rows: [{ ...instagramPost, date_posted: null, timestamp: null }],
      requestedMaxRecords: 10,
      reservedChargeUsd: 0.015,
      priceSnapshot,
      now: new Date("2026-07-14T03:00:00.000Z"),
      manualPaidRun: true,
      providerRequestDispatched: false,
      archiveContext,
    }, {
      loadTargets: vi.fn(async () => []),
      persist,
      finalize,
      runWithinImportFence,
    })

    expect(persist).toHaveBeenCalledWith(expect.objectContaining({
      batches: [expect.objectContaining({ records: [] })],
    }))
    expect(finalize).toHaveBeenCalledWith(expect.objectContaining({
      finalStatus: "PARTIAL",
      driftWarnings: ["bright_data_archive:missing_published_at"],
    }))
    expect(result).toMatchObject({
      status: "partial",
      ignoredCount: 1,
      error: "bright_data_archive_timestamp_incomplete",
      rawStats: {
        coverageClass: "PARTIAL",
        archiveUnknownTimestampCount: 1,
        until: archiveContext.until,
      },
    })
  })

  it("does not persist or finalize a downloaded snapshot after clean-slate reset", async () => {
    const persist = vi.fn(async () => ({ newCount: 1, duplicateCount: 0, ignoredCount: 0 }))
    const finalize = vi.fn(async () => undefined)
    const blockedFence = vi.fn(async () => ({
      allowed: false as const,
      reason: "social_monitoring_collection_blocked" as const,
    }))

    const result = await importBrightDataSnapshotRows({
      source: source(),
      providerRunId: "provider-run-reset-race",
      capability: "DISCOVER_URLS",
      rows: [instagramPost],
      requestedMaxRecords: 10,
      reservedChargeUsd: 0.015,
      priceSnapshot,
      now: new Date("2026-07-28T12:00:00.000Z"),
      manualPaidRun: true,
      providerRequestDispatched: false,
    }, {
      loadTargets: vi.fn(async () => []),
      persist,
      finalize,
      runWithinImportFence: blockedFence,
    })

    expect(result).toMatchObject({
      status: "skipped",
      foundCount: 0,
      newCount: 0,
      error: "social_monitoring_collection_blocked",
      rawStats: {
        providerRunId: "provider-run-reset-race",
        collectionFence: true,
      },
    })
    expect(persist).not.toHaveBeenCalled()
    expect(finalize).not.toHaveBeenCalled()
  })

  it("keeps cost exposure unknown when reset blocks import after snapshot dispatch", async () => {
    const persist = vi.fn(async () => ({ newCount: 1, duplicateCount: 0, ignoredCount: 0 }))
    const finalize = vi.fn(async () => undefined)
    const blockedFence = vi.fn(async () => ({
      allowed: false as const,
      reason: "social_monitoring_collection_blocked" as const,
    }))

    const result = await importBrightDataSnapshotRows({
      source: source(),
      providerRunId: "provider-run-dispatched-reset-race",
      capability: "DISCOVER_URLS",
      rows: [instagramPost],
      requestedMaxRecords: 10,
      reservedChargeUsd: 0.015,
      priceSnapshot,
      now: new Date("2026-07-28T12:00:00.000Z"),
      manualPaidRun: false,
      providerRequestDispatched: true,
    }, {
      loadTargets: vi.fn(async () => []),
      persist,
      finalize,
      runWithinImportFence: blockedFence,
    })

    expect(result).toMatchObject({
      status: "skipped",
      rawStats: {
        providerRunId: "provider-run-dispatched-reset-race",
        providerRequestDispatched: true,
        dispatchUnknown: true,
        collectionFence: true,
      },
    })
    expect(persist).not.toHaveBeenCalled()
    expect(finalize).not.toHaveBeenCalled()
  })

  it("reconciles and loads only negative TikTok parents in the active source's subject lineage", async () => {
    const acceptedAt = new Date("2026-07-18T00:00:00Z")
    findMissingRevisitEnvelopes.mockResolvedValue([{
      id: "accepted-envelope-without-revisit",
      postExternalId: "video-1",
      externalId: "video-1",
      canonicalUrl: "https://www.tiktok.com/@brand/video/1?utm_source=x",
      url: null,
      decidedAt: acceptedAt,
      acceptedAt,
      createdAt: acceptedAt,
    }])
    createManyRevisits.mockResolvedValue({ count: 1 })
    findManyRevisits.mockResolvedValue([{
      canonicalUrl: "https://www.tiktok.com/@brand/video/1?utm_source=x",
      postExternalId: "video-1",
      ingestEnvelope: { matchedTerms: ["Araz"] },
    }])
    const tiktokSource = { ...source("READ_EXTERNAL_COMMENTS"), platform: "tiktok" }
    await expect(dueTikTokRevisitTargets(tiktokSource, 500, new Date("2026-07-20T00:00:00Z"))).resolves.toEqual([{
      url: "https://tiktok.com/@brand/video/1",
      externalId: "video-1",
      mentionId: null,
      matchedTerm: "Araz",
    }])
    expect(findManyRevisits).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: "org-1",
        status: "ACTIVE",
        nextDueAt: { lte: new Date("2026-07-20T00:00:00Z") },
        ingestEnvelope: {
          relevanceStatus: "ACCEPTED",
          deletedAtSource: null,
          purgedAt: null,
          acceptedMention: {
            sentiment: "negative",
            deletedAtSource: null,
            purgedAt: null,
            subjectMatches: {
              some: { status: "MATCHED", subjectId: { in: ["subject-1"] } },
            },
          },
        },
      },
      take: 100,
    }))
    const repairQuery = findMissingRevisitEnvelopes.mock.calls[0][0] as { strings?: readonly string[] }
    const repairSql = repairQuery.strings?.join("?") ?? ""
    expect(repairSql).toContain('e."organizationId" =')
    expect(repairSql).toContain('msm."subjectId" IN')
    expect(repairSql).toContain('NOT EXISTS')
    expect(repairSql).toContain('FROM "tiktok_publication_revisits"')
    expect(findManyRevisits.mock.calls[0][0].where.ingestEnvelope).not.toHaveProperty("sourceId")
    expect(createManyRevisits).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({
        organizationId: "org-1",
        ingestEnvelopeId: "accepted-envelope-without-revisit",
        postExternalId: "video-1",
        canonicalUrl: "https://tiktok.com/@brand/video/1",
        nextDueAt: new Date("2026-07-20T00:00:00Z"),
      })],
      skipDuplicates: true,
    }))

    // A MANUAL run ("Запустить") pulls comments for fresh publications too —
    // no nextDueAt filter, the click must not wait out the revisit cadence.
    findMissingRevisitEnvelopes.mockResolvedValue([])
    findManyRevisits.mockClear()
    await dueTikTokRevisitTargets(tiktokSource, 500, new Date("2026-07-20T00:00:00Z"), { includeNotYetDue: true })
    expect(findManyRevisits).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: "org-1",
        status: { in: ["ACTIVE", "INACTIVE"] },
        ingestEnvelope: expect.objectContaining({
          relevanceStatus: "ACCEPTED",
          acceptedMention: expect.objectContaining({
            sentiment: "negative",
            subjectMatches: {
              some: { status: "MATCHED", subjectId: { in: ["subject-1"] } },
            },
          }),
        }),
      },
    }))
  })

  it("registers an accepted Bright TikTok publication through the tenant/run fallback when ingest omits envelopeId", async () => {
    ingestMentionWithResult.mockResolvedValue({
      id: "mention-tiktok-video",
      created: true,
    })
    findAcceptedEnvelope.mockResolvedValue({ id: "accepted-envelope-fallback" })
    const tiktokSource = {
      ...source("ENRICH_CONTENT"),
      platform: "tiktok",
      sourceType: "keyword",
      url: null,
      query: "synthetic brand",
      keywords: ["synthetic brand"],
      settings: {
        negativeTerms: ["unrelated giveaway"],
        scenarioLinks: [{ scenarioId: "scenario-brand" }],
      },
      routeExecution: {
        ...source("ENRICH_CONTENT").routeExecution!,
        targetScenarioId: "scenario-brand",
      },
    }
    const batch: ProviderBatch = {
      contractVersion: "social-provider-capabilities-v1",
      providerKey: "bright-data",
      capability: "ENRICH_CONTENT",
      records: [{
        recordType: "CONTENT",
        platform: "tiktok",
        externalId: "video-fallback",
        contentKind: "VIDEO",
        url: "https://www.tiktok.com/@creator/video/video-fallback",
        text: "Synthetic brand customer review",
        publishedAt: "2026-07-13T10:30:00.000Z",
        author: { handle: "creator" },
        provenance: {
          providerKey: "bright-data",
          adapterKey: "BRIGHT_DATA_TIKTOK_POST",
          providerItemId: "video-fallback",
          observedAt: "2026-07-14T03:00:00.000Z",
          schemaVersion: "test-v1",
        },
      }],
    }

    await expect(persistBrightDataBatches({
      source: tiktokSource,
      providerRunId: "provider-run-fallback",
      batches: [batch],
      targets: [],
      now: new Date("2026-07-14T03:00:00.000Z"),
      providerCoverageClass: "COMPLETE_FOR_INPUT",
      requestedLimitPerInput: 10,
    })).resolves.toEqual({ newCount: 1, duplicateCount: 0, ignoredCount: 0 })

    expect(findAcceptedEnvelope).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        providerRunId: "provider-run-fallback",
        platform: "tiktok",
        externalId: "video-fallback",
        relevanceStatus: "ACCEPTED",
        acceptedMentionId: "mention-tiktok-video",
      },
      select: { id: true },
    })
    expect(tiktokGate.decide).toHaveBeenCalledWith(expect.objectContaining({
      scenarioIds: ["scenario-brand"],
      negativeTerms: ["unrelated giveaway"],
    }))
    expect(tiktokGate.persist).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      envelopeId: "accepted-envelope-fallback",
      decision: expect.objectContaining({ status: "MATCHED" }),
    }))
  })

  it("records TikTok comment activity and counts only on the matching target", async () => {
    const now = new Date("2026-08-01T00:00:00.000Z")
    const targetAUrl = "https://www.tiktok.com/@brand/video/post-a"
    const targetBUrl = "https://www.tiktok.com/@brand/video/post-b?utm_source=test"
    const provenance = (providerItemId: string) => ({
      providerKey: "bright-data",
      adapterKey: "BRIGHT_DATA_TIKTOK_COMMENTS",
      providerItemId,
      observedAt: now.toISOString(),
      schemaVersion: "test-v1",
    })
    const batch: ProviderBatch = {
      contractVersion: "social-provider-capabilities-v1",
      providerKey: "bright-data",
      capability: "READ_COMMENTS",
      records: [
        {
          recordType: "COMMENT",
          platform: "tiktok",
          externalId: "comment-new-a",
          contentKind: "COMMENT",
          text: "Synthetic brand complaint",
          postExternalId: "post-a",
          parentExternalId: "post-a",
          parentPostUrl: targetAUrl,
          depth: 0,
          provenance: provenance("comment-new-a"),
        },
        {
          recordType: "COMMENT",
          platform: "tiktok",
          externalId: "comment-duplicate-b",
          contentKind: "COMMENT",
          text: "Synthetic brand existing comment",
          // Exercise canonical-parent fallback when a provider-specific post
          // id does not equal the durable TikTok target id.
          postExternalId: "provider-alias-b",
          parentExternalId: "provider-alias-b",
          parentPostUrl: "https://tiktok.com/@brand/video/post-b",
          depth: 0,
          provenance: provenance("comment-duplicate-b"),
        },
        {
          recordType: "COMMENT",
          platform: "tiktok",
          externalId: "comment-ignored-b",
          contentKind: "COMMENT",
          text: "Synthetic brand rejected comment",
          postExternalId: "post-b",
          parentExternalId: "post-b",
          parentPostUrl: targetBUrl,
          depth: 0,
          provenance: provenance("comment-ignored-b"),
        },
      ],
    }
    ingestMentionWithResult.mockImplementation(async (input: { externalId: string }) => {
      if (input.externalId === "comment-new-a") return { id: "mention-a", created: true }
      if (input.externalId === "comment-duplicate-b") return { id: "mention-b", created: false }
      return { id: "mention-ignored-b", created: false, accepted: false }
    })

    await expect(persistBrightDataBatches({
      source: { ...source("READ_EXTERNAL_COMMENTS"), platform: "tiktok" },
      providerRunId: "provider-run-comments",
      batches: [batch],
      targets: [
        { url: targetAUrl, externalId: "post-a", mentionId: "parent-a", matchedTerm: "synthetic brand" },
        { url: targetBUrl, externalId: "post-b", mentionId: "parent-b", matchedTerm: "synthetic brand" },
      ],
      now,
      providerCoverageClass: "COMPLETE_FOR_INPUT",
      requestedLimitPerInput: 100,
    })).resolves.toEqual({ newCount: 1, duplicateCount: 1, ignoredCount: 1 })

    expect(recordTikTokRevisitByPost).toHaveBeenCalledTimes(2)
    expect(recordTikTokRevisitByPost).toHaveBeenNthCalledWith(1, {
      organizationId: "org-1",
      postExternalId: "post-a",
      observedCommentCount: 1,
      activityDetected: true,
      coverageClass: "COMPLETE",
      now,
    })
    expect(recordTikTokRevisitByPost).toHaveBeenNthCalledWith(2, {
      organizationId: "org-1",
      postExternalId: "post-b",
      observedCommentCount: 2,
      activityDetected: false,
      coverageClass: "PARTIAL",
      now,
    })
  })

  it("does not advance a TikTok revisit after a provider-error-only snapshot", async () => {
    const targetUrl = tiktokComment.post_url
    const finalize = vi.fn(async () => undefined)

    const result = await importBrightDataSnapshotRows({
      source: { ...source("READ_EXTERNAL_COMMENTS"), platform: "tiktok" },
      providerRunId: "provider-run-tiktok-error",
      capability: "READ_COMMENTS",
      rows: [{ error_code: "dead_page", error: "provider could not fetch target" }],
      requestedMaxRecords: 10,
      reservedChargeUsd: 0.015,
      priceSnapshot,
      now: new Date("2026-07-14T03:00:00.000Z"),
      manualPaidRun: false,
      providerRequestDispatched: true,
      targets: [{ url: targetUrl, externalId: tiktokComment.post_id, mentionId: "parent-1", matchedTerm: "synthetic" }],
    }, {
      loadTargets: vi.fn(async () => []),
      persist: persistBrightDataBatches,
      finalize,
      runWithinImportFence,
    })

    expect(result).toMatchObject({
      status: "failed",
      rawStats: { coverageClass: "BLOCKED", providerFetchFailed: true },
    })
    expect(finalize).toHaveBeenCalledWith(expect.objectContaining({ finalStatus: "PARTIAL" }))
    expect(recordTikTokRevisitByPost).not.toHaveBeenCalled()
  })

  it("keeps a TikTok revisit due when the snapshot reaches its per-input limit", async () => {
    ingestMentionWithResult.mockResolvedValue({ id: "comment-mention-1", created: true })
    const targetUrl = tiktokComment.post_url
    const finalize = vi.fn(async () => undefined)

    const result = await importBrightDataSnapshotRows({
      source: { ...source("READ_EXTERNAL_COMMENTS"), platform: "tiktok", keywords: ["synthetic"] },
      providerRunId: "provider-run-tiktok-sampled",
      capability: "READ_COMMENTS",
      rows: [tiktokComment],
      requestedMaxRecords: 1,
      reservedChargeUsd: 0.0015,
      priceSnapshot,
      now: new Date("2026-07-14T03:00:00.000Z"),
      manualPaidRun: false,
      providerRequestDispatched: true,
      targets: [{ url: targetUrl, externalId: tiktokComment.post_id, mentionId: "parent-1", matchedTerm: "synthetic" }],
    }, {
      loadTargets: vi.fn(async () => []),
      persist: persistBrightDataBatches,
      finalize,
      runWithinImportFence,
    })

    expect(result).toMatchObject({
      status: "success",
      rawStats: { coverageClass: "SAMPLED", providerStatus: "PARTIAL" },
    })
    expect(finalize).toHaveBeenCalledWith(expect.objectContaining({ finalStatus: "PARTIAL" }))
    expect(recordTikTokRevisitByPost).not.toHaveBeenCalled()
  })

  it("never inherits a parent post match into an unrelated comment", () => {
    expect(providerRecordMatchedTerm("COMMENT", "xanımın nə gözəl danışıq qabiliyyəti var", ["araz supermarket"], "araz supermarket"))
      .toBeNull()
    expect(providerRecordMatchedTerm("COMMENT", "Araz supermarket haqqında şikayət", ["araz supermarket"], null))
      .toBe("araz supermarket")
    expect(providerRecordMatchedTerm("CONTENT", "generic enriched caption", ["araz supermarket"], "araz supermarket"))
      .toBe("araz supermarket")
  })

  it("maps route capabilities and refuses unsupported actions", () => {
    expect(brightDataProviderCapability("DISCOVER_POSTS")).toBe("DISCOVER_URLS")
    expect(brightDataProviderCapability("READ_EXTERNAL_COMMENTS")).toBe("READ_COMMENTS")
    expect(brightDataProviderCapability("REPLY_EXTERNAL")).toBeNull()
  })

  it("builds platform-specific discovery input without inventing Meta keyword search", () => {
    expect(brightDataInputsFor(source(), "DISCOVER_URLS", [])).toEqual([
      { url: "https://instagram.com/synthetic_brand" },
    ])
    expect(brightDataInputsFor({ ...source(), platform: "tiktok", url: null }, "DISCOVER_URLS", []))
      .toEqual([{ search_keyword: "synthetic brand", country: "" }])
    expect(brightDataInputsFor({
      ...source(),
      platform: "tiktok",
      url: null,
      query: "Synthetic Brand|Second Alias",
      keywords: ["Synthetic Brand", "Second Alias", "synthetic brand"],
    }, "DISCOVER_URLS", [])).toEqual([
      { search_keyword: "Synthetic Brand", country: "" },
      { search_keyword: "Second Alias", country: "" },
    ])
    // Handle-only FB/IG sources derive the canonical page URL — the datasets
    // are URL-based, so a missing URL must not dead-end a named public page.
    expect(brightDataInputsFor({ ...source(), platform: "facebook", url: null }, "DISCOVER_URLS", []))
      .toEqual([{ url: "https://www.facebook.com/synthetic_brand" }])
    expect(brightDataInputsFor({ ...source(), url: null, handle: "@synthetic_brand" }, "DISCOVER_URLS", []))
      .toEqual([{ url: "https://www.instagram.com/synthetic_brand/" }])
    // No URL and no usable handle (spaces are not a page slug) → no input.
    expect(brightDataInputsFor({ ...source(), platform: "facebook", url: null, handle: "not a slug" }, "DISCOVER_URLS", []))
      .toEqual([])
    expect(brightDataInputsFor({ ...source(), platform: "facebook", url: null, handle: null }, "DISCOVER_URLS", []))
      .toEqual([])
    expect(brightDataInputsFor({
      ...source(),
      ownedIdentity: {
        authorNames: ["synthetic_brand"],
        sourceIds: ["official-instagram"],
        webHosts: [],
        profileUrls: ["https://www.instagram.com/synthetic_brand/"],
      },
    }, "DISCOVER_URLS", [])).toEqual([])
    expect(brightDataInputsFor({
      ...source(),
      platform: "facebook",
      url: null,
      ownedIdentity: {
        authorNames: ["synthetic_brand"],
        sourceIds: ["official-facebook"],
        webHosts: [],
        profileUrls: ["https://www.facebook.com/synthetic_brand"],
      },
    }, "DISCOVER_URLS", [])).toEqual([])
  })

  it("dispatches the full requested discovery window and persists only candidate records", async () => {
    const { deps, client } = dependencies()
    const parent = new AbortController()
    const discoverySource = source()
    discoverySource.providerRequestSignal = parent.signal

    const result = await runBrightDataCollector(discoverySource, deps)

    expect(result).toMatchObject({
      status: "success",
      foundCount: 1,
      newCount: 1,
      error: null,
      rawStats: { coverageClass: "COMPLETE_FOR_INPUT", providerRequestDispatched: true },
    })
    expect(deps.prepareRun).toHaveBeenCalledWith(expect.objectContaining({
      phase: "DISCOVER_CANDIDATE_POSTS",
      datasetId: "gd_lk5ns7kz21pck8jpis",
      inputCount: 1,
      requestedLimitPerInput: 10,
      estimatedChargeUsd: 0.015,
    }))
    expect(deps.createClient).toHaveBeenCalledWith(
      "test-token-never-logged",
      60_000,
      parent.signal,
    )
    expect(client.trigger).toHaveBeenCalledWith(expect.objectContaining({
      limitPerInput: 10,
      operation: "DISCOVER",
      discoverBy: "url",
    }))
    expect(client.triggerWithBudgetCap).not.toHaveBeenCalled()
    expect(deps.setExternalRunId).toHaveBeenCalledWith("org-1", "provider-run-1", "s_snapshot1")
    expect(deps.beginDispatch).toHaveBeenCalledWith("org-1", "provider-run-1")
    expect(runWithinImportFence).toHaveBeenCalledWith(expect.objectContaining({
      expectedStatuses: ["QUEUED"],
      blockOnEmergencyStop: true,
    }), expect.any(Function))
    expect(client.pollUntilReady).toHaveBeenCalledWith("s_snapshot1", expect.any(Object))
    expect(client.download).toHaveBeenCalledWith("s_snapshot1")
    const persisted = vi.mocked(deps.persist).mock.calls[0][0]
    expect(persisted.batches).toHaveLength(1)
    expect(persisted.batches[0]).toMatchObject({ capability: "DISCOVER_URLS" })
    expect(persisted.batches[0].records[0]).toMatchObject({ recordType: "CANDIDATE" })
    expect(deps.finalize).toHaveBeenCalledWith(expect.objectContaining({
      deliveredRecords: 1,
      acceptedUnique: 1,
      finalStatus: "IMPORTED",
    }))
    expect(JSON.stringify(result)).not.toContain("test-token-never-logged")
  })

  it("keeps dispatch unknown after a snapshot was accepted but polling failed", async () => {
    const { deps, client } = dependencies()
    client.pollUntilReady.mockRejectedValueOnce(new BrightDataApiError({
      message: "bright_data_poll_unauthorized",
      httpStatus: 401,
    }))

    await expect(runBrightDataCollector(source(), deps)).resolves.toMatchObject({
      status: "failed",
      error: "bright_data_auth",
      rawStats: expect.objectContaining({
        providerRequestDispatched: true,
        dispatchUnknown: true,
      }),
    })
    expect(client.download).not.toHaveBeenCalled()
  })

  it("fails before provider I/O when the queued Bright Data handoff cannot be claimed", async () => {
    const { deps, client } = dependencies({
      beginDispatch: vi.fn(async () => false),
    })

    await expect(runBrightDataCollector(source(), deps)).resolves.toMatchObject({
      status: "failed",
      error: "bright_data_adapter_failed",
      rawStats: expect.objectContaining({
        providerRequestDispatched: false,
        dispatchUnknown: false,
      }),
    })
    expect(client.trigger).not.toHaveBeenCalled()
    expect(deps.setExternalRunId).not.toHaveBeenCalled()
  })

  it("coalesces content, media and metrics from one paid enrichment payload", async () => {
    const target: BrightDataAdapterTarget = {
      url: instagramPost.url,
      externalId: instagramPost.post_id,
      mentionId: null,
      matchedTerm: null,
    }
    const { deps, client } = dependencies({
      loadTargets: vi.fn(async () => [target]),
    })

    const result = await runBrightDataCollector(source("ENRICH_CONTENT"), deps)

    expect(result).toMatchObject({ status: "success", foundCount: 1 })
    expect(client.trigger).toHaveBeenCalledOnce()
    expect(client.triggerWithBudgetCap).not.toHaveBeenCalled()
    const persisted = vi.mocked(deps.persist).mock.calls[0][0]
    expect(persisted.batches.map(batch => batch.capability)).toEqual([
      "ENRICH_CONTENT",
      "READ_MEDIA",
      "UPDATE_METRICS",
    ])
    expect(result.rawStats).toMatchObject({
      coalescedCapabilities: ["ENRICH_CONTENT", "READ_MEDIA", "UPDATE_METRICS"],
      costEstimatedOnly: true,
    })
  })

  it("skips a rejected parent's metric but preserves one for an existing mention", async () => {
    ingestMentionWithResult.mockResolvedValue({
      id: "envelope-rejected-1",
      created: false,
      accepted: false,
    })
    finalizeBrightDataProviderRunLedger.mockResolvedValue({ status: "UPDATED" })
    recordProviderMetricSnapshot.mockClear()
    const target: BrightDataAdapterTarget = {
      url: instagramPost.url,
      externalId: instagramPost.post_id,
      mentionId: null,
      matchedTerm: null,
    }
    const input = {
      source: source("ENRICH_CONTENT"),
      providerRunId: "provider-run-1",
      capability: "ENRICH_CONTENT" as const,
      rows: [instagramPost],
      requestedMaxRecords: 10,
      reservedChargeUsd: 0.015,
      priceSnapshot,
      now: new Date("2026-07-14T03:00:00.000Z"),
      manualPaidRun: true,
      providerRequestDispatched: false,
    }

    await importBrightDataSnapshotRows({
      ...input,
      targets: [target],
    })

    expect(recordProviderMetricSnapshot).not.toHaveBeenCalled()

    await importBrightDataSnapshotRows({
      ...input,
      providerRunId: "provider-run-2",
      targets: [{ ...target, mentionId: "mention-existing-1" }],
    })

    expect(recordProviderMetricSnapshot).toHaveBeenCalledOnce()
    expect(recordProviderMetricSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      mentionId: "mention-existing-1",
      providerRunId: "provider-run-2",
    }), expect.objectContaining({
      recordType: "METRIC",
      externalId: instagramPost.post_id,
    }))
  })

  it("treats enrichment without new parent targets as a successful no-op", async () => {
    const { deps, client } = dependencies({
      loadTargets: vi.fn(async () => []),
    })

    const result = await runBrightDataCollector(source("ENRICH_CONTENT"), deps)

    expect(result).toMatchObject({
      status: "success",
      foundCount: 0,
      error: null,
      rawStats: {
        coverageClass: "COMPLETE_FOR_INPUT",
        noOp: true,
        providerRequestDispatched: false,
      },
    })
    expect(client.trigger).not.toHaveBeenCalled()
    expect(deps.getRun).not.toHaveBeenCalled()
  })

  it("marks a snapshot that reaches its configured record cap as sampled", async () => {
    const { deps } = dependencies({
      createClient: () => ({
        trigger: vi.fn(async () => ({ snapshotId: "s_snapshot1" })),
        cancel: vi.fn(async () => undefined),
        triggerWithBudgetCap: vi.fn(async () => ({
          kind: "dispatched" as const,
          budget: readyBudget,
          result: { snapshotId: "s_snapshot1" },
        })),
        pollUntilReady: vi.fn(async () => ({
          snapshotId: "s_snapshot1",
          datasetId: "gd_lk5ns7kz21pck8jpis",
          status: "ready" as const,
        })),
        download: vi.fn(async () => Array.from({ length: readyBudget.requestedMaxRecords }, () => instagramPost)),
      }),
    })

    const result = await runBrightDataCollector(source(), deps)

    expect(result).toMatchObject({
      status: "success",
      foundCount: readyBudget.requestedMaxRecords,
      rawStats: { coverageClass: "SAMPLED" },
    })
  })

  it("reuses enrichment for media/metrics without a second reservation or provider call", async () => {
    const reused: MonitoringCollectorResult = {
      status: "success",
      foundCount: 1,
      newCount: 0,
      duplicateCount: 1,
      ignoredCount: 0,
      error: null,
      rawStats: { reusedEnrichment: true },
    }
    const { deps, client } = dependencies({ reuseEnrichment: vi.fn(async () => reused) })

    await expect(runBrightDataCollector(source("READ_MEDIA"), deps)).resolves.toEqual(reused)
    expect(client.trigger).not.toHaveBeenCalled()
    expect(deps.getRun).not.toHaveBeenCalled()
  })

  it("keeps the live-routing gate but does not use local USD enforcement as a coverage gate", async () => {
    const { deps, client } = dependencies()
    vi.stubEnv("SOCIAL_BRIGHT_DATA_LIVE_ROUTING", "0")
    await expect(runBrightDataCollector(source(), deps)).resolves.toMatchObject({
      status: "skipped",
      error: "bright_data_live_routing_disabled",
      rawStats: { providerRequestDispatched: false },
    })
    vi.stubEnv("SOCIAL_BRIGHT_DATA_LIVE_ROUTING", "1")
    vi.stubEnv("SOCIAL_BRIGHT_DATA_LIVE_TENANT_IDS", "org-2")
    await expect(runBrightDataCollector(source(), deps)).resolves.toMatchObject({
      status: "skipped",
      error: "bright_data_live_routing_disabled",
      rawStats: { providerRequestDispatched: false },
    })
    vi.stubEnv("SOCIAL_BRIGHT_DATA_LIVE_TENANT_IDS", "org-1")
    vi.stubEnv("SOCIAL_MONITORING_ENFORCE_USD_BUDGETS", "0")
    await expect(runBrightDataCollector(source(), deps)).resolves.toMatchObject({
      status: "success",
      rawStats: { providerRequestDispatched: true },
    })
    expect(client.trigger).toHaveBeenCalledOnce()
    expect(client.triggerWithBudgetCap).not.toHaveBeenCalled()
  })

  it("returns a manual request after recording the async snapshot without polling", async () => {
    const { deps, client } = dependencies({
      getRun: vi.fn(async () => ({ id: "provider-run-1", maxTotalChargeUsd: 0.05, reservedChargeUsd: 0.05 })),
    })
    const manualSource = source()
    manualSource.routeExecution = {
      ...manualSource.routeExecution!,
      manualPaidRun: true,
      manualMaxTotalChargeUsd: 0.05,
      fullArchiveRun: true,
      targetScenarioId: "scenario-1",
    }
    manualSource.settings = {
      scenarioLinks: [{
        scenarioId: "scenario-1",
        archiveStartAt: "2026-07-01T00:00:00.000Z",
      }],
    }

    const result = await runBrightDataCollector(manualSource, deps)

    expect(result).toMatchObject({
      status: "partial",
      error: "bright_data_snapshot_pending",
      rawStats: {
        manualPaidRun: true,
        providerRequestDispatched: true,
        asyncPending: true,
        snapshotIdRecorded: true,
        since: "2026-07-01T00:00:00.000Z",
        until: "2026-07-14T03:00:00.000Z",
        targetScenarioId: "scenario-1",
      },
    })
    expect(deps.prepareRun).toHaveBeenCalledWith(expect.objectContaining({
      archiveContext: expect.objectContaining({
        fullArchiveRun: true,
        targetScenarioId: "scenario-1",
        archiveStartAt: "2026-07-01T00:00:00.000Z",
        since: "2026-07-01T00:00:00.000Z",
        until: "2026-07-14T03:00:00.000Z",
      }),
    }))
    expect(client.trigger).toHaveBeenCalledWith(expect.objectContaining({
      limitPerInput: 10,
      operation: "DISCOVER",
      discoverBy: "url",
    }))
    expect(client.triggerWithBudgetCap).not.toHaveBeenCalled()
    expect(deps.setExternalRunId).toHaveBeenCalledWith("org-1", "provider-run-1", "s_snapshot1")
    expect(client.pollUntilReady).not.toHaveBeenCalled()
    expect(client.download).not.toHaveBeenCalled()
    expect(deps.finalize).not.toHaveBeenCalled()
  })

  it("fails closed before manual provider I/O when the price snapshot is unavailable", async () => {
    const { deps, client } = dependencies({
      priceSnapshot: () => ({ status: "BLOCKED", reason: "bright_data_price_snapshot_unconfigured" }),
      getRun: vi.fn(async () => ({ id: "provider-run-1", maxTotalChargeUsd: 0.05, reservedChargeUsd: 0.05 })),
    })
    const manualSource = source()
    manualSource.routeExecution = { ...manualSource.routeExecution!, manualPaidRun: true, manualMaxTotalChargeUsd: 0.05 }

    await expect(runBrightDataCollector(manualSource, deps)).resolves.toMatchObject({
      status: "skipped",
      error: "bright_data_price_snapshot_unconfigured",
      rawStats: { providerRequestDispatched: false },
    })
    expect(client.trigger).not.toHaveBeenCalled()
    expect(client.triggerWithBudgetCap).not.toHaveBeenCalled()
  })
  it("records aggregate schema failure without leaking provider payload", async () => {
    const target: BrightDataAdapterTarget = {
      url: "https://instagram.com/p/ONE",
      externalId: "post-1",
      mentionId: "mention-1",
      matchedTerm: "brand",
    }
    const { deps } = dependencies({
      createClient: () => ({
        trigger: vi.fn(async () => ({ snapshotId: "s_snapshot1" })),
        cancel: vi.fn(async () => undefined),
        triggerWithBudgetCap: vi.fn(async () => ({
          kind: "dispatched" as const,
          budget: readyBudget,
          result: { snapshotId: "s_snapshot1" },
        })),
        pollUntilReady: vi.fn(async () => ({
          snapshotId: "s_snapshot1",
          datasetId: "gd_ltppn085pokosxh13",
          status: "ready" as const,
        })),
        download: vi.fn(async () => [{ error_code: "dead_page", error: "Bearer sensitive-token" }]),
      }),
      loadTargets: vi.fn(async () => [target]),
      persist: vi.fn(async () => ({ newCount: 0, duplicateCount: 0, ignoredCount: 0 })),
    })

    const result = await runBrightDataCollector(source("READ_EXTERNAL_COMMENTS"), deps)

    expect(result).toMatchObject({
      status: "failed",
      // A batch made ONLY of provider error rows is a fetch failure, not
      // schema drift: the dominant provider code becomes the actionable error
      // so the classifier can quarantine dead_page instead of retrying it.
      error: "bright_data_provider_dead_page",
      rawStats: {
        schemaHealth: "FAILED",
        providerFetchFailed: true,
        warnings: ["bright_data_schema:provider_error:dead_page"],
      },
    })
    expect(deps.finalize).toHaveBeenCalledWith(expect.objectContaining({ finalStatus: "PARTIAL" }))
    expect(JSON.stringify(result)).not.toContain("sensitive-token")
  })
})
