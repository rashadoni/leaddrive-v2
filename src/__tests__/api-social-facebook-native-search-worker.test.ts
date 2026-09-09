import crypto from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  resolveOrganization: vi.fn(),
  listJobs: vi.fn(),
  applyBatch: vi.fn(),
  runWithTenant: vi.fn((_organizationId: string, callback: () => unknown) => callback()),
  withFence: vi.fn(async (_organizationId: string, callback: () => Promise<unknown>) => ({
    allowed: true,
    value: await callback(),
  })),
}))

vi.mock("@/lib/rls-context", () => ({
  runWithTenant: mocks.runWithTenant,
  runWithRlsBypass: (callback: () => unknown) => callback(),
}))

vi.mock("@/lib/social/monitoring-import-fence", () => ({
  withSocialMonitoringTenantCollectionFence: mocks.withFence,
}))

// Keep this route contract test dependency-light. The real worker module imports
// ingest-mention, whose workflow side effects pull the application auth graph
// into Vitest before these endpoint mocks can replace persistence.
vi.mock("@/lib/social/ingest-mention", () => ({
  findMatchedKeyword: vi.fn(),
  ingestMentionWithResult: vi.fn(),
}))

vi.mock("@/lib/social/facebook-native-search-worker", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/social/facebook-native-search-worker")>()
  return {
    ...original,
    resolveFacebookNativeWorkerOrganization: mocks.resolveOrganization,
    listFacebookNativeSearchJobs: mocks.listJobs,
    applyFacebookNativeSearchResultBatch: mocks.applyBatch,
  }
})

import { GET } from "@/app/api/v1/social/providers/facebook-native-search/jobs/route"
import { POST } from "@/app/api/v1/social/providers/facebook-native-search/results/route"
import {
  FACEBOOK_NATIVE_SEARCH_MAX_BODY_BYTES,
  FACEBOOK_NATIVE_SEARCH_RESULTS_SCHEMA_VERSION,
} from "@/lib/social/facebook-native-search-worker"

const token = "dedicated-facebook-native-worker-token"
const authorization = `Bearer ${token}`

function getRequest(auth = authorization) {
  return new NextRequest("http://localhost/api/v1/social/providers/facebook-native-search/jobs", {
    headers: { authorization: auth },
  })
}

function postRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/v1/social/providers/facebook-native-search/results", {
    method: "POST",
    headers: {
      authorization,
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

function validBatch() {
  return {
    schemaVersion: FACEBOOK_NATIVE_SEARCH_RESULTS_SCHEMA_VERSION,
    jobId: "fbns_0123456789abcdef0123456789abcdef",
    runId: "run-20260729-1",
    startedAt: "2026-07-29T10:00:00.000Z",
    finishedAt: "2026-07-29T10:01:00.000Z",
    targetBindingVersion: "facebook-native-search-targets-v1",
    targets: [{
      scenarioId: "scenario-1",
      subjectId: "subject-1",
      sourceId: "source-1",
    }],
    query: "Example subject",
    coverage: {
      status: "COMPLETE",
      searchedResultCount: 1,
      recentPostsVerified: true,
      reason: null,
    },
    items: [{
      kind: "POST",
      externalId: "facebook:post:post_1",
      permalink: "https://www.facebook.com/example/posts/post_1",
      authorName: "Example author",
      authorUrl: "https://www.facebook.com/example",
      text: "Example subject mention",
      capturedAt: "2026-07-29T10:00:00.000Z",
      audience: {
        kind: "PUBLIC",
        evidenceLabel: "Public",
      },
      evidence: {
        articleHtmlSha256: "a".repeat(64),
        screenshotSha256: null,
        parserVersion: "facebook-native-v1",
        discoveredAtScroll: 1,
        dateRaw: null,
        datePrecision: "UNKNOWN",
        mediaKinds: [],
        outboundLinks: [],
      },
    }],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SOCIAL_FACEBOOK_NATIVE_WORKER_ENABLED = "1"
  process.env.SOCIAL_FACEBOOK_NATIVE_WORKER_TOKEN_SHA256 =
    crypto.createHash("sha256").update(token).digest("hex")
  process.env.SOCIAL_FACEBOOK_NATIVE_WORKER_ORG_SLUG = "worker-tenant"
  mocks.resolveOrganization.mockResolvedValue({ id: "org-1" })
  mocks.listJobs.mockResolvedValue([{
    jobId: "fbns_0123456789abcdef0123456789abcdef",
    targetBindingVersion: "facebook-native-search-targets-v1",
    targets: [{
      scenarioId: "scenario-1",
      subjectId: "subject-1",
      sourceId: "source-1",
    }],
    query: "Example subject",
  }])
  mocks.applyBatch.mockResolvedValue({
    receivedCount: 1,
    persistedCount: 1,
    newCount: 1,
    duplicateCount: 0,
    officialArchiveCount: 0,
    rejectedCount: 0,
    evidenceCreatedCount: 1,
  })
})

describe("Facebook native-search worker API", () => {
  it("keeps the endpoints disabled unless explicitly enabled", async () => {
    process.env.SOCIAL_FACEBOOK_NATIVE_WORKER_ENABLED = "0"
    expect((await GET(getRequest())).status).toBe(404)
    expect((await POST(postRequest(validBatch()))).status).toBe(404)
    expect(mocks.resolveOrganization).not.toHaveBeenCalled()
  })

  it("rejects any bearer other than the dedicated worker credential", async () => {
    const response = await GET(getRequest("Bearer wrong-token"))
    expect(response.status).toBe(401)
    expect(mocks.resolveOrganization).not.toHaveBeenCalled()
  })

  it("returns bounded jobs inside the env-selected tenant and collection fence", async () => {
    const response = await GET(getRequest())
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        schemaVersion: "facebook-native-search-jobs-v2",
        limits: {
          maxJobs: 50,
          maxSubjects: 25,
          maxBatchItems: 25,
          maxTargetsPerJob: 25,
        },
        jobs: [{
          jobId: "fbns_0123456789abcdef0123456789abcdef",
          targetBindingVersion: "facebook-native-search-targets-v1",
          targets: [{
            scenarioId: "scenario-1",
            subjectId: "subject-1",
            sourceId: "source-1",
          }],
          query: "Example subject",
        }],
      },
    })
    expect(mocks.runWithTenant).toHaveBeenCalledWith("org-1", expect.any(Function))
    expect(mocks.withFence).toHaveBeenCalledWith("org-1", expect.any(Function))
    expect(mocks.listJobs).toHaveBeenCalledWith("org-1")
  })

  it("returns an explicit conflict instead of silently truncating an over-capacity queue", async () => {
    mocks.listJobs.mockRejectedValueOnce(
      new Error("facebook_native_worker_query_capacity_exceeded"),
    )

    const response = await GET(getRequest())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: "facebook_native_worker_query_capacity_exceeded",
    })
  })

  it("accepts a strict batch and persists it under the resolved tenant", async () => {
    const response = await POST(postRequest(validBatch()))
    expect(response.status).toBe(200)
    expect(mocks.applyBatch).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({
        schemaVersion: FACEBOOK_NATIVE_SEARCH_RESULTS_SCHEMA_VERSION,
        targetBindingVersion: "facebook-native-search-targets-v1",
        targets: [{
          scenarioId: "scenario-1",
          subjectId: "subject-1",
          sourceId: "source-1",
        }],
      }),
    )
    expect(mocks.runWithTenant).toHaveBeenCalledWith("org-1", expect.any(Function))
    expect(mocks.withFence).toHaveBeenCalledWith("org-1", expect.any(Function))
  })

  it("accepts an empty complete batch as explicit zero-result coverage", async () => {
    const batch = validBatch()
    batch.items = []
    batch.coverage.searchedResultCount = 0
    const response = await POST(postRequest(batch))
    expect(response.status).toBe(200)
    expect(mocks.applyBatch).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({
        items: [],
        coverage: expect.objectContaining({
          status: "COMPLETE",
          searchedResultCount: 0,
        }),
      }),
    )
  })

  it("rejects undeclared cookies and oversized bodies before persistence", async () => {
    const response = await POST(postRequest({
      ...validBatch(),
      cookies: "never-store-this",
    }))
    expect(response.status).toBe(400)
    expect(mocks.applyBatch).not.toHaveBeenCalled()

    const oversized = await POST(postRequest(validBatch(), {
      "content-length": String(FACEBOOK_NATIVE_SEARCH_MAX_BODY_BYTES + 1),
    }))
    expect(oversized.status).toBe(413)
    expect(mocks.applyBatch).not.toHaveBeenCalled()

    const streamOversizedRequest = new NextRequest(
      "http://localhost/api/v1/social/providers/facebook-native-search/results",
      {
        method: "POST",
        headers: {
          authorization,
          "content-type": "application/json",
        },
        body: "x".repeat(FACEBOOK_NATIVE_SEARCH_MAX_BODY_BYTES + 1),
      },
    )
    expect(streamOversizedRequest.headers.get("content-length")).toBeNull()
    const streamOversized = await POST(streamOversizedRequest)
    expect(streamOversized.status).toBe(413)
    expect(mocks.applyBatch).not.toHaveBeenCalled()
  })

  it("fails closed when the tenant collection fence is blocked", async () => {
    mocks.withFence.mockResolvedValueOnce({
      allowed: false,
      reason: "social_monitoring_collection_blocked",
    })
    const response = await POST(postRequest(validBatch()))
    expect(response.status).toBe(409)
    expect(mocks.applyBatch).not.toHaveBeenCalled()
  })

  it("marks an inactive exact job binding as permanently gone", async () => {
    mocks.applyBatch.mockRejectedValueOnce(
      new Error("facebook_native_worker_job_inactive"),
    )

    const response = await POST(postRequest(validBatch()))

    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toEqual({
      error: "facebook_native_worker_job_inactive",
    })
  })
})
