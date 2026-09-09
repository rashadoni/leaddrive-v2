import crypto from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  organizationFindUnique: vi.fn(),
  sourceLinksFindMany: vi.fn(),
  envelopeFindFirst: vi.fn(),
  evidenceFindUnique: vi.fn(),
  evidenceUpsert: vi.fn(),
  collectorRunUpsert: vi.fn(),
  ingestMentionWithResult: vi.fn(),
  getMonitoringScenariosUncached: vi.fn(),
  runWithRlsBypass: vi.fn((callback: () => unknown) => callback()),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: mocks.organizationFindUnique },
    monitoringSubjectSource: {
      findMany: mocks.sourceLinksFindMany,
    },
    ingestEnvelope: { findFirst: mocks.envelopeFindFirst },
    mentionEvidence: {
      findUnique: mocks.evidenceFindUnique,
      upsert: mocks.evidenceUpsert,
    },
    collectorRun: { upsert: mocks.collectorRunUpsert },
  },
}))

vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: mocks.runWithRlsBypass,
}))

vi.mock("@/lib/social/ingest-mention", () => ({
  findMatchedKeyword: (text: string, terms: string[]) =>
    terms.find(term => text.toLocaleLowerCase("en-US").includes(term.toLocaleLowerCase("en-US"))) ?? null,
  ingestMentionWithResult: mocks.ingestMentionWithResult,
}))

vi.mock("@/lib/social/monitoring-scenarios", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/social/monitoring-scenarios")>(),
  getMonitoringScenariosUncached: mocks.getMonitoringScenariosUncached,
}))

import {
  FACEBOOK_NATIVE_SEARCH_MAX_BODY_BYTES,
  FACEBOOK_NATIVE_SEARCH_RESULTS_SCHEMA_VERSION,
  applyFacebookNativeSearchResultBatch,
  listFacebookNativeSearchJobs,
  normalizeFacebookPublicPermalink,
  parseFacebookNativeSearchResultBatch,
  readFacebookNativeSearchBody,
  resolveFacebookNativeWorkerOrganization,
  verifyFacebookNativeWorkerAuthorization,
} from "@/lib/social/facebook-native-search-worker"

const activeScenario = {
  id: "scenario-1",
  subjectId: "subject-1",
  subjectName: "LeadDrive",
  name: "LeadDrive monitoring",
  description: null,
  status: "active",
  platforms: ["facebook"],
  search: {
    topics: ["LeadDrive"],
    keywords: ["Lead Drive"],
    hashtags: [],
    handles: [],
    urls: [],
    useHashtagFallback: true,
    includeOwnedComments: false,
    includeExternalComments: true,
  },
  ai: {
    sentiments: ["negative"],
    minConfidence: 0.7,
    action: "show_only",
    directions: [],
  },
  reply: {
    identityId: null,
    identityLabel: null,
    mode: "manual",
    autoReplyEnabled: false,
    liveSendAllowed: false,
  },
  archive: {
    startAt: null,
    lastBackfilledAt: null,
    scannedCount: 0,
    matchedCount: 0,
    status: "pending",
  },
  createdAt: "2026-07-29T00:00:00.000Z",
  updatedAt: "2026-07-29T00:00:00.000Z",
}

function managedSourceLink(
  sourceId: string,
  query: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    scenarioId: "scenario-1",
    subjectId: "subject-1",
    sourceId,
    source: {
      id: sourceId,
      platform: "facebook",
      sourceType: "keyword",
      collectionMode: "search_index",
      url: null,
      handle: null,
      query,
      keywords: [query],
      ownership: "external",
      status: "needs_setup",
      settings: {
        managedBy: "monitoring_scenario",
        scenarioId: "scenario-1",
        scenarioLinks: [{ scenarioId: "scenario-1" }],
      },
      ...overrides,
    },
  }
}

const activeSourceLinks = [
  managedSourceLink("source-1", "Lead Drive"),
  managedSourceLink("source-2", "LeadDrive"),
]

function resultItem(overrides: Record<string, unknown> = {}) {
  return {
    kind: "POST",
    externalId: "facebook:post:post_123",
    permalink: "https://m.facebook.com/leaddrive/posts/post_123?fbclid=tracking",
    authorName: "LeadDrive",
    authorUrl: "https://facebook.com/leaddrive?ref=page_internal",
    text: "LeadDrive public post",
    capturedAt: "2026-07-29T10:05:00.000Z",
    audience: {
      kind: "PUBLIC",
      evidenceLabel: "Public",
    },
    evidence: {
      articleHtmlSha256: "a".repeat(64),
      screenshotSha256: null,
      parserVersion: "facebook-native-v1",
      discoveredAtScroll: 2,
      dateRaw: "1 h",
      datePrecision: "RELATIVE",
      mediaKinds: ["IMAGE"],
      outboundLinks: ["https://example.com/public"],
    },
    ...overrides,
  }
}

function resultBatch(job: {
  jobId: string
  targetBindingVersion: "facebook-native-search-targets-v1"
  targets: Array<{
    scenarioId: string
    subjectId: string
    sourceId: string
  }>
  query: string
}, items: unknown[]) {
  return {
    schemaVersion: FACEBOOK_NATIVE_SEARCH_RESULTS_SCHEMA_VERSION,
    jobId: job.jobId,
    runId: "run-20260729-1",
    startedAt: "2026-07-29T10:00:00.000Z",
    finishedAt: "2026-07-29T10:05:00.000Z",
    targetBindingVersion: job.targetBindingVersion,
    targets: job.targets,
    query: job.query,
    coverage: {
      status: "COMPLETE",
      searchedResultCount: items.length,
      recentPostsVerified: true,
      reason: null,
    },
    items,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.SOCIAL_FACEBOOK_NATIVE_WORKER_ENABLED
  delete process.env.SOCIAL_FACEBOOK_NATIVE_WORKER_TOKEN_SHA256
  delete process.env.SOCIAL_FACEBOOK_NATIVE_WORKER_ORG_SLUG
  mocks.getMonitoringScenariosUncached.mockResolvedValue([activeScenario])
  mocks.sourceLinksFindMany.mockResolvedValue(activeSourceLinks)
  mocks.evidenceFindUnique.mockResolvedValue(null)
  mocks.evidenceUpsert.mockResolvedValue({ id: "evidence-1" })
  mocks.collectorRunUpsert.mockResolvedValue({ id: "collector-run-1" })
})

describe("Facebook native-search worker contract", () => {
  it("verifies only the dedicated SHA-256 bearer in constant-size form", () => {
    const token = "facebook-worker-secret"
    process.env.SOCIAL_FACEBOOK_NATIVE_WORKER_TOKEN_SHA256 =
      crypto.createHash("sha256").update(token).digest("hex")

    expect(verifyFacebookNativeWorkerAuthorization(`Bearer ${token}`)).toBe(true)
    expect(verifyFacebookNativeWorkerAuthorization("Bearer wrong-secret")).toBe(false)
    expect(verifyFacebookNativeWorkerAuthorization(null)).toBe(false)

    process.env.SOCIAL_FACEBOOK_NATIVE_WORKER_TOKEN_SHA256 = "not-a-sha256"
    expect(verifyFacebookNativeWorkerAuthorization(`Bearer ${token}`)).toBe(false)
  })

  it("resolves the tenant only from the configured active organization slug", async () => {
    process.env.SOCIAL_FACEBOOK_NATIVE_WORKER_ORG_SLUG = "tenant-from-env"
    mocks.organizationFindUnique.mockResolvedValue({ id: "org-1", isActive: true })

    await expect(resolveFacebookNativeWorkerOrganization()).resolves.toEqual({ id: "org-1" })
    expect(mocks.runWithRlsBypass).toHaveBeenCalledOnce()
    expect(mocks.organizationFindUnique).toHaveBeenCalledWith({
      where: { slug: "tenant-from-env" },
      select: { id: true, isActive: true },
    })

    mocks.organizationFindUnique.mockResolvedValue({ id: "org-1", isActive: false })
    await expect(resolveFacebookNativeWorkerOrganization()).resolves.toBeNull()
  })

  it("returns deterministic bounded jobs only for exact active scenario-managed sources", async () => {
    const first = await listFacebookNativeSearchJobs("org-1")
    const second = await listFacebookNativeSearchJobs("org-1")

    expect(first).toEqual(second)
    expect(first).toHaveLength(1)
    expect(first.map(job => job.query)).toEqual(["LeadDrive"])
    expect(first).toEqual([
      expect.objectContaining({
        targetBindingVersion: "facebook-native-search-targets-v1",
        targets: [{
          scenarioId: "scenario-1",
          subjectId: "subject-1",
          sourceId: "source-2",
        }],
      }),
    ])
    expect(first.every(job => /^fbns_[a-f0-9]{32}$/.test(job.jobId))).toBe(true)
    expect(mocks.sourceLinksFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        scenarioId: { in: ["scenario-1"] },
        relationType: "MONITORS",
      }),
    }))
  })

  it("returns jobs only for sources referenced by an active Facebook scenario", async () => {
    mocks.getMonitoringScenariosUncached.mockResolvedValue([
      { ...activeScenario, id: "paused-fb", status: "paused" },
      { ...activeScenario, id: "active-instagram", platforms: ["instagram"] },
      { ...activeScenario, id: "active-orphan", subjectId: null },
    ])

    await expect(listFacebookNativeSearchJobs("org-1")).resolves.toEqual([])
    expect(mocks.sourceLinksFindMany).not.toHaveBeenCalled()
  })

  it("rejects stale, unmanaged, and old page sources even when a relation row remains", async () => {
    mocks.sourceLinksFindMany.mockResolvedValue([
      managedSourceLink("page-source", "LeadDrive", {
        sourceType: "page",
        url: "https://www.facebook.com/leaddrive",
      }),
      managedSourceLink("paused-source", "LeadDrive", { status: "paused" }),
      managedSourceLink("unmanaged-source", "LeadDrive", { settings: {} }),
    ])

    await expect(listFacebookNativeSearchJobs("org-1")).resolves.toEqual([])
  })

  it("groups one physical job by normalized query and binds every sorted target tuple", async () => {
    mocks.sourceLinksFindMany.mockResolvedValue([
      managedSourceLink("source-1", "LeadDrive"),
      managedSourceLink("source-other", "leaddrive"),
    ])

    const jobs = await listFacebookNativeSearchJobs("org-1")
    expect(jobs).toEqual([expect.objectContaining({
      jobId: "fbns_30bfd77ddfaa01f19ad2226ba981fc00",
      query: "LeadDrive",
      targets: [
        {
          scenarioId: "scenario-1",
          subjectId: "subject-1",
          sourceId: "source-1",
        },
        {
          scenarioId: "scenario-1",
          subjectId: "subject-1",
          sourceId: "source-other",
        },
      ],
    })])
  })

  it("rejects source queries with non-whitespace control characters", async () => {
    mocks.sourceLinksFindMany.mockResolvedValue([
      managedSourceLink("source-1", "Lead\u0000Drive"),
    ])

    await expect(listFacebookNativeSearchJobs("org-1")).resolves.toEqual([])
  })

  it("accepts only canonical public Facebook content links", () => {
    expect(normalizeFacebookPublicPermalink(
      "https://m.facebook.com/leaddrive/posts/post_123?utm_source=x&comment_id=456#fragment",
    )).toBe("https://www.facebook.com/leaddrive/posts/post_123?comment_id=456")
    expect(normalizeFacebookPublicPermalink("https://facebook.example/leaddrive/posts/123")).toBeNull()
    expect(normalizeFacebookPublicPermalink("http://facebook.com/leaddrive/posts/123")).toBeNull()
    expect(normalizeFacebookPublicPermalink("https://facebook.com/login")).toBeNull()
  })

  it("rejects undeclared capture material, full DOM and base64 payloads", () => {
    const base = {
      schemaVersion: FACEBOOK_NATIVE_SEARCH_RESULTS_SCHEMA_VERSION,
      jobId: "fbns_0123456789abcdef0123456789abcdef",
      runId: "run-1",
      startedAt: "2026-07-29T10:00:00.000Z",
      finishedAt: "2026-07-29T10:01:00.000Z",
      targetBindingVersion: "facebook-native-search-targets-v1",
      targets: [{
        scenarioId: "scenario-1",
        subjectId: "subject-1",
        sourceId: "source-1",
      }],
      query: "LeadDrive",
      coverage: {
        status: "COMPLETE",
        searchedResultCount: 1,
        recentPostsVerified: true,
        reason: null,
      },
    }
    expect(() => parseFacebookNativeSearchResultBatch({
      ...base,
      items: [{ ...resultItem(), cookies: "session=secret" }],
    })).toThrow("payload_invalid")
    expect(() => parseFacebookNativeSearchResultBatch({
      ...base,
      query: "Lead\u0000Drive",
      items: [],
    })).toThrow("payload_invalid")
    expect(() => parseFacebookNativeSearchResultBatch({
      ...base,
      items: [{ ...resultItem(), text: "<!doctype html><html>full DOM</html>" }],
    })).toThrow("payload_invalid")
    expect(() => parseFacebookNativeSearchResultBatch({
      ...base,
      items: [{ ...resultItem(), text: "data:image/png;base64,AAAA" }],
    })).toThrow("payload_invalid")
    expect(() => parseFacebookNativeSearchResultBatch({
      ...base,
      coverage: {
        status: "PARTIAL",
        searchedResultCount: 1,
        recentPostsVerified: false,
        reason: "Facebook returned a bounded subset",
      },
      items: [resultItem()],
    })).toThrow("payload_invalid")
    expect(() => parseFacebookNativeSearchResultBatch({
      ...base,
      targets: [
        { scenarioId: "scenario-1", subjectId: "subject-1", sourceId: "source-z" },
        { scenarioId: "scenario-1", subjectId: "subject-1", sourceId: "source-a" },
      ],
      items: [resultItem()],
    })).toThrow("payload_invalid")
  })

  it("stops reading an undeclared oversized request body at the streaming limit", async () => {
    const request = new Request("https://app.example.test/results", {
      method: "POST",
      body: "x".repeat(FACEBOOK_NATIVE_SEARCH_MAX_BODY_BYTES + 1),
    })
    expect(request.headers.get("content-length")).toBeNull()
    await expect(readFacebookNativeSearchBody(request)).rejects.toThrow("payload_too_large")
  })

  it("persists T5 evidence for both accepted mentions and official-author archives", async () => {
    const [job] = await listFacebookNativeSearchJobs("org-1")
    mocks.ingestMentionWithResult
      .mockResolvedValueOnce({ id: "mention-1", created: true, envelopeId: "envelope-1" })
      .mockResolvedValueOnce({
        id: "mention-2",
        created: true,
        accepted: false,
        envelopeId: "envelope-2",
        relevanceStatus: "REJECTED",
      })
    mocks.envelopeFindFirst
      .mockResolvedValueOnce({ acceptedMentionId: "mention-1" })
      .mockResolvedValueOnce({ acceptedMentionId: "mention-2" })

    const batch = parseFacebookNativeSearchResultBatch(resultBatch(job, [
        resultItem(),
        resultItem({
          externalId: "facebook:post:post_124",
          permalink: "https://facebook.com/leaddrive/posts/post_124",
        }),
      ]))

    await expect(applyFacebookNativeSearchResultBatch("org-1", batch)).resolves.toEqual({
      receivedCount: 2,
      persistedCount: 2,
      newCount: 1,
      duplicateCount: 0,
      officialArchiveCount: 1,
      rejectedCount: 0,
      evidenceCreatedCount: 2,
    })
    expect(mocks.ingestMentionWithResult).toHaveBeenNthCalledWith(1, expect.objectContaining({
      organizationId: "org-1",
      platform: "facebook",
      externalId: "facebook:post:post_123",
      sourceProvider: "browser_capture",
      accountId: null,
      sourceMetadata: expect.objectContaining({
        monitoringSourceId: "source-2",
        targetScenarioId: "scenario-1",
        targetSubjectId: "subject-1",
        routeAdapter: "BROWSER_CAPTURE_READ_ONLY",
        audience: "PUBLIC",
        manualOnly: true,
        noAutomation: true,
      }),
      observation: expect.objectContaining({
        sourceId: "source-2",
        adapterKey: "BROWSER_CAPTURE_READ_ONLY",
        idempotencyKey: expect.stringMatching(/^facebook-native-search-v2:[a-f0-9]{64}$/),
      }),
    }))
    expect(mocks.evidenceUpsert).toHaveBeenCalledTimes(2)
    expect(mocks.evidenceUpsert).toHaveBeenNthCalledWith(2, {
      where: {
        id: expect.stringMatching(/^fbnme_[a-f0-9]{32}$/),
      },
      create: expect.objectContaining({
        id: expect.stringMatching(/^fbnme_[a-f0-9]{32}$/),
        organizationId: "org-1",
        mentionId: "mention-2",
        sourceId: "source-2",
        screenshotUrl: null,
        sourceTrustTier: "T5",
        confidence: 0.6,
        rawPayload: expect.objectContaining({
          scenarioId: "scenario-1",
          subjectId: "subject-1",
          sourceId: "source-2",
          manualOnly: true,
          noAutomation: true,
        }),
      }),
      update: expect.objectContaining({
        rawPayload: expect.objectContaining({
          scenarioId: "scenario-1",
          subjectId: "subject-1",
          sourceId: "source-2",
        }),
      }),
    })
  })

  it("fans one searched publication out to every bound source without repeating the search job", async () => {
    mocks.sourceLinksFindMany.mockResolvedValue([
      managedSourceLink("source-1", "LeadDrive"),
      managedSourceLink("source-other", "leaddrive"),
    ])
    const [job] = await listFacebookNativeSearchJobs("org-1")
    mocks.ingestMentionWithResult
      .mockResolvedValueOnce({ id: "mention-1", created: true, envelopeId: "envelope-1" })
      .mockResolvedValueOnce({ id: "mention-1", created: false, envelopeId: "envelope-2" })
    mocks.envelopeFindFirst
      .mockResolvedValueOnce({ acceptedMentionId: "mention-1" })
      .mockResolvedValueOnce({ acceptedMentionId: "mention-1" })

    await expect(applyFacebookNativeSearchResultBatch(
      "org-1",
      parseFacebookNativeSearchResultBatch(resultBatch(job, [resultItem()])),
    )).resolves.toEqual({
      receivedCount: 1,
      persistedCount: 2,
      newCount: 1,
      duplicateCount: 1,
      officialArchiveCount: 0,
      rejectedCount: 0,
      evidenceCreatedCount: 2,
    })

    expect(mocks.ingestMentionWithResult).toHaveBeenCalledTimes(2)
    expect(mocks.ingestMentionWithResult.mock.calls.map(call => (
      call[0].observation.sourceId
    ))).toEqual(["source-1", "source-other"])
    const idempotencyKeys = mocks.ingestMentionWithResult.mock.calls.map(call =>
      call[0].observation.idempotencyKey)
    expect(new Set(idempotencyKeys).size).toBe(2)
    expect(mocks.evidenceUpsert.mock.calls.map(call => call[0].create.sourceId))
      .toEqual(["source-1", "source-other"])
  })

  it("keeps target-specific evidence when one physical source is shared by scenarios", async () => {
    const secondScenario = {
      ...activeScenario,
      id: "scenario-2",
      subjectId: "subject-2",
      name: "Second LeadDrive monitoring",
    }
    const sharedLink = managedSourceLink("source-shared", "LeadDrive", {
      settings: {
        managedBy: "monitoring_scenario",
        scenarioId: "scenario-1",
        scenarioLinks: [
          { scenarioId: "scenario-1" },
          { scenarioId: "scenario-2" },
        ],
      },
    })
    mocks.getMonitoringScenariosUncached.mockResolvedValue([
      activeScenario,
      secondScenario,
    ])
    mocks.sourceLinksFindMany.mockResolvedValue([
      sharedLink,
      {
        ...sharedLink,
        scenarioId: "scenario-2",
        subjectId: "subject-2",
      },
    ])
    mocks.ingestMentionWithResult
      .mockResolvedValueOnce({ id: "mention-1", created: true, envelopeId: "envelope-1" })
      .mockResolvedValueOnce({ id: "mention-1", created: false, envelopeId: "envelope-2" })
    mocks.envelopeFindFirst
      .mockResolvedValueOnce({ acceptedMentionId: "mention-1" })
      .mockResolvedValueOnce({ acceptedMentionId: "mention-1" })

    const [job] = await listFacebookNativeSearchJobs("org-1")
    await applyFacebookNativeSearchResultBatch(
      "org-1",
      parseFacebookNativeSearchResultBatch(resultBatch(job, [resultItem()])),
    )

    const evidenceIds = mocks.evidenceUpsert.mock.calls.map(call => call[0].where.id)
    expect(new Set(evidenceIds).size).toBe(2)
    expect(mocks.evidenceUpsert.mock.calls.map(call => ({
      scenarioId: call[0].create.rawPayload.scenarioId,
      subjectId: call[0].create.rawPayload.subjectId,
      sourceId: call[0].create.sourceId,
    }))).toEqual([
      { scenarioId: "scenario-1", subjectId: "subject-1", sourceId: "source-shared" },
      { scenarioId: "scenario-2", subjectId: "subject-2", sourceId: "source-shared" },
    ])
    expect(mocks.collectorRunUpsert).toHaveBeenCalledTimes(2)
  })

  it("reuses deterministic evidence and collector-run ids on result redelivery", async () => {
    const [job] = await listFacebookNativeSearchJobs("org-1")
    const batch = parseFacebookNativeSearchResultBatch(resultBatch(job, [resultItem()]))
    mocks.ingestMentionWithResult
      .mockResolvedValueOnce({ id: "mention-1", created: true, envelopeId: "envelope-1" })
      .mockResolvedValueOnce({ id: "mention-1", created: false, envelopeId: "envelope-2" })
    mocks.envelopeFindFirst.mockResolvedValue({ acceptedMentionId: "mention-1" })
    mocks.evidenceFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "existing-evidence" })

    await applyFacebookNativeSearchResultBatch("org-1", batch)
    await applyFacebookNativeSearchResultBatch("org-1", batch)

    const evidenceIds = mocks.evidenceUpsert.mock.calls.map(call => call[0].where.id)
    const collectorRunIds = mocks.collectorRunUpsert.mock.calls.map(call => call[0].where.id)
    expect(new Set(evidenceIds).size).toBe(1)
    expect(new Set(collectorRunIds).size).toBe(1)
  })

  it("requires public audience and matching canonical publication kind", async () => {
    const [job] = await listFacebookNativeSearchJobs("org-1")
    expect(() => parseFacebookNativeSearchResultBatch(resultBatch(job, [resultItem({
      audience: { kind: "FRIENDS", evidenceLabel: "Friends" },
    })]))).toThrow("payload_invalid")
    expect(() => parseFacebookNativeSearchResultBatch(resultBatch(job, [resultItem({
      kind: "REEL",
      externalId: "facebook:post:post_123",
    })]))).toThrow("payload_invalid")
  })

  it("maps every public publication kind to a post while preserving its canonical identity", async () => {
    const [job] = await listFacebookNativeSearchJobs("org-1")
    mocks.ingestMentionWithResult.mockResolvedValue({
      id: "mention-reel",
      created: true,
      envelopeId: "envelope-reel",
    })
    mocks.envelopeFindFirst.mockResolvedValue({ acceptedMentionId: "mention-reel" })
    const batch = parseFacebookNativeSearchResultBatch(resultBatch(job, [resultItem({
      kind: "REEL",
      externalId: "facebook:reel:1509",
      permalink: "https://facebook.com/reel/1509",
      evidence: {
        ...resultItem().evidence,
        mediaKinds: ["REEL", "VIDEO"],
      },
    })]))

    await applyFacebookNativeSearchResultBatch("org-1", batch)
    expect(mocks.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      externalId: "facebook:reel:1509",
      contentKind: "POST",
      postExternalId: "facebook:reel:1509",
      sourceType: "post",
    }))
  })

  it("rejects stale job query metadata even when the subject and job id are otherwise valid", async () => {
    const [job] = await listFacebookNativeSearchJobs("org-1")
    const batch = parseFacebookNativeSearchResultBatch({
      ...resultBatch(job, []),
      query: "A different query",
    })
    await expect(applyFacebookNativeSearchResultBatch("org-1", batch))
      .rejects.toThrow("job_inactive")
  })

  it("revalidates the exact scenario/source tuple before accepting a result batch", async () => {
    const [job] = await listFacebookNativeSearchJobs("org-1")
    const batch = parseFacebookNativeSearchResultBatch({
      ...resultBatch(job, []),
      targets: [{
        scenarioId: "scenario-1",
        subjectId: "subject-1",
        sourceId: "source-1",
      }],
    })

    await expect(applyFacebookNativeSearchResultBatch("org-1", batch))
      .rejects.toThrow("job_inactive")
    expect(mocks.sourceLinksFindMany).toHaveBeenCalled()
    expect(mocks.ingestMentionWithResult).not.toHaveBeenCalled()
  })

  it("rejects a result when the active normalized-query target group changed after dispatch", async () => {
    const [job] = await listFacebookNativeSearchJobs("org-1")
    mocks.sourceLinksFindMany.mockResolvedValue([
      ...activeSourceLinks,
      managedSourceLink("source-added", "LeadDrive"),
    ])
    const batch = parseFacebookNativeSearchResultBatch(resultBatch(job, []))

    await expect(applyFacebookNativeSearchResultBatch("org-1", batch))
      .rejects.toThrow("job_inactive")
    expect(mocks.ingestMentionWithResult).not.toHaveBeenCalled()
  })

  it("reapplies the active Facebook scenario gate when accepting results", async () => {
    const [job] = await listFacebookNativeSearchJobs("org-1")
    mocks.getMonitoringScenariosUncached.mockResolvedValueOnce([{
      ...activeScenario,
      status: "paused",
    }])
    const batch = parseFacebookNativeSearchResultBatch(resultBatch(job, []))

    await expect(applyFacebookNativeSearchResultBatch("org-1", batch))
      .rejects.toThrow("job_inactive")
    expect(mocks.ingestMentionWithResult).not.toHaveBeenCalled()
  })

  it("accepts empty zero-result coverage and never persists rejected-envelope evidence", async () => {
    const [job] = await listFacebookNativeSearchJobs("org-1")
    const empty = parseFacebookNativeSearchResultBatch(resultBatch(job, []))
    await expect(applyFacebookNativeSearchResultBatch("org-1", empty)).resolves.toEqual({
      receivedCount: 0,
      persistedCount: 0,
      newCount: 0,
      duplicateCount: 0,
      officialArchiveCount: 0,
      rejectedCount: 0,
      evidenceCreatedCount: 0,
    })
    expect(mocks.ingestMentionWithResult).not.toHaveBeenCalled()
    expect(mocks.collectorRunUpsert).toHaveBeenCalledWith({
      where: {
        id: expect.stringMatching(/^fbncr_[a-f0-9]{32}$/),
      },
      create: expect.objectContaining({
        sourceId: job.targets[0]?.sourceId,
        status: "success",
        foundCount: 0,
        rawStats: expect.objectContaining({
          coverageClass: "COMPLETE_FOR_QUERY_WINDOW",
          workerRunId: "run-20260729-1",
          targetScenarioId: job.targets[0]?.scenarioId,
          targetSubjectId: job.targets[0]?.subjectId,
          monitoringSourceId: job.targets[0]?.sourceId,
          providerRunCreated: false,
          receivedCount: 0,
        }),
      }),
      update: expect.objectContaining({
        status: "success",
        foundCount: 0,
      }),
    })

    mocks.collectorRunUpsert.mockClear()
    const blocked = parseFacebookNativeSearchResultBatch({
      ...resultBatch(job, []),
      runId: "run-20260729-blocked",
      coverage: {
        status: "BLOCKED",
        searchedResultCount: 0,
        recentPostsVerified: false,
        reason: "FACEBOOK_AUTH_REQUIRED",
      },
    })
    await applyFacebookNativeSearchResultBatch("org-1", blocked)
    expect(mocks.collectorRunUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        status: "failed",
        error: "FACEBOOK_AUTH_REQUIRED",
        rawStats: expect.objectContaining({
          coverageClass: "BLOCKED",
          coverage: expect.objectContaining({
            status: "BLOCKED",
            reason: "FACEBOOK_AUTH_REQUIRED",
          }),
        }),
      }),
    }))

    mocks.collectorRunUpsert.mockClear()
    mocks.ingestMentionWithResult.mockResolvedValue({
      id: "envelope-rejected",
      created: false,
      accepted: false,
      envelopeId: "envelope-rejected",
    })
    mocks.envelopeFindFirst.mockResolvedValue({ acceptedMentionId: null })
    const rejected = parseFacebookNativeSearchResultBatch(resultBatch(job, [resultItem()]))
    await expect(applyFacebookNativeSearchResultBatch("org-1", rejected)).resolves.toEqual(
      expect.objectContaining({ persistedCount: 0, rejectedCount: 1, evidenceCreatedCount: 0 }),
    )
    expect(mocks.evidenceUpsert).not.toHaveBeenCalled()
    expect(mocks.collectorRunUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        ignoredCount: 1,
        rawStats: expect.objectContaining({ rejectedCount: 1 }),
      }),
    }))
  })
})
