import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

type AuthContext = { orgId: string; userId: string; role: string }
type RouteHandler = (
  request: NextRequest,
  auth: AuthContext,
  context: unknown,
) => Promise<Response>

const mocks = vi.hoisted(() => ({
  auth: {
    orgId: "org-1",
    userId: "user-1",
    role: "admin",
  } as AuthContext,
  fenceBlocked: false,
  registrations: [] as Array<{
    wrapper: "rls" | "fence"
    module: string | undefined
    action: string | undefined
  }>,
  createJob: vi.fn(),
  getLatestJob: vi.fn(),
  getJob: vi.fn(),
  cancelJob: vi.fn(),
  resumeJob: vi.fn(),
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (
    module: string | undefined,
    action: string | undefined,
    handler: RouteHandler,
  ) => {
    mocks.registrations.push({ wrapper: "rls", module, action })
    return (request: NextRequest, context?: unknown) => handler(
      request,
      { ...mocks.auth },
      context,
    )
  },
}))

vi.mock("@/lib/social/with-monitoring-mutation-fence", () => ({
  withSocialMonitoringMutationFence: (
    module: string | undefined,
    action: string | undefined,
    handler: RouteHandler,
  ) => {
    mocks.registrations.push({ wrapper: "fence", module, action })
    return (request: NextRequest, context?: unknown) => {
      if (mocks.fenceBlocked) {
        return new Response(JSON.stringify({
          error: "Social Monitoring is paused for a clean-slate reset",
          code: "social_monitoring_collection_blocked",
        }), {
          status: 409,
          headers: { "content-type": "application/json" },
        })
      }
      return handler(request, { ...mocks.auth }, context)
    }
  },
}))

vi.mock("@/lib/social/monitoring-run-job", () => {
  class SocialMonitoringRunJobError extends Error {
    constructor(
      readonly code: string,
      readonly status: number,
      readonly details: Record<string, unknown> = {},
    ) {
      super(code)
      this.name = "SocialMonitoringRunJobError"
    }
  }

  return {
    SOCIAL_MONITORING_RUN_JOB_KINDS: ["PROFILE_FULL", "SOURCE_FULL", "WEB_NEWS"] as const,
    SOCIAL_MONITORING_RUN_JOB_SOURCE_SCOPES: ["OWNED", "EXTERNAL"] as const,
    SocialMonitoringRunJobError,
    createSocialMonitoringRunJob: mocks.createJob,
    getLatestSocialMonitoringRunJob: mocks.getLatestJob,
    getSocialMonitoringRunJob: mocks.getJob,
    cancelSocialMonitoringRunJob: mocks.cancelJob,
    resumeSocialMonitoringRunJob: mocks.resumeJob,
  }
})

import {
  SocialMonitoringRunJobError,
} from "@/lib/social/monitoring-run-job"
import {
  GET as getLatestJob,
  POST as createJob,
} from "@/app/api/v1/social/monitoring-run-jobs/route"
import { GET as getJob } from "@/app/api/v1/social/monitoring-run-jobs/[id]/route"
import { POST as cancelJob } from "@/app/api/v1/social/monitoring-run-jobs/[id]/cancel/route"
import { POST as resumeJob } from "@/app/api/v1/social/monitoring-run-jobs/[id]/resume/route"

const job = {
  id: "job-1",
  kind: "PROFILE_FULL",
  sourceScope: null,
  status: "QUEUED",
  totalItems: 2,
  paidItems: 1,
  sharedItems: 1,
  processedItems: 0,
  foundCount: 0,
  newCount: 0,
  currentItem: null,
  items: [],
  createdAt: "2026-08-01T12:00:00.000Z",
  startedAt: null,
  finishedAt: null,
  error: null,
}

function createRequest(
  body: unknown,
  idempotencyKey = "profile-full:request-1",
) {
  return new NextRequest("http://localhost/api/v1/social/monitoring-run-jobs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify(body),
  })
}

function params(id = "job-1") {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(mocks.auth, {
    orgId: "org-1",
    userId: "user-1",
    role: "admin",
  })
  mocks.fenceBlocked = false
  mocks.createJob.mockResolvedValue(job)
  mocks.getLatestJob.mockResolvedValue(job)
  mocks.getJob.mockResolvedValue(job)
  mocks.cancelJob.mockResolvedValue({ ...job, status: "CANCELED" })
  mocks.resumeJob.mockResolvedValue(job)
})

describe("POST /api/v1/social/monitoring-run-jobs", () => {
  it("enqueues a tenant-scoped job with authenticated actor and confirmations", async () => {
    Object.assign(mocks.auth, {
      orgId: "org-tenant-a",
      userId: "admin-a",
      role: "superadmin",
    })

    const response = await createJob(createRequest({
      kind: "PROFILE_FULL",
      fullArchiveConfirmed: true,
      paidConfirmed: true,
      sharedConfirmed: true,
    }))

    expect(response.status).toBe(202)
    expect(mocks.createJob).toHaveBeenCalledWith({
      organizationId: "org-tenant-a",
      requestedBy: "admin-a",
      requestedByRole: "superadmin",
      idempotencyKey: "profile-full:request-1",
      kind: "PROFILE_FULL",
      fullArchiveConfirmed: true,
      paidConfirmed: true,
      sharedConfirmed: true,
    })
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { id: "job-1", status: "QUEUED" },
    })
  })

  it("rejects invalid payloads and idempotency keys before enqueue", async () => {
    const invalidPayload = await createJob(createRequest({ kind: "UNKNOWN" }))
    const invalidKey = await createJob(createRequest(
      { kind: "SOURCE_FULL", sourceScope: "EXTERNAL" },
      "contains spaces",
    ))

    expect(invalidPayload.status).toBe(400)
    expect(invalidKey.status).toBe(400)
    expect(mocks.createJob).not.toHaveBeenCalled()
  })

  it("requires an idempotency key for every potentially paid batch", async () => {
    const response = await createJob(new NextRequest(
      "http://localhost/api/v1/social/monitoring-run-jobs",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "PROFILE_FULL", fullArchiveConfirmed: true }),
      },
    ))

    expect(response.status).toBe(400)
    expect(mocks.createJob).not.toHaveBeenCalled()
  })

  it("maps a typed enqueue conflict and preserves its active job details", async () => {
    mocks.createJob.mockRejectedValueOnce(new SocialMonitoringRunJobError(
      "social_monitoring_run_job_already_active",
      409,
      { activeJobId: "job-active" },
    ))

    const response = await createJob(createRequest({
      kind: "SOURCE_FULL",
      sourceScope: "EXTERNAL",
    }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: "social_monitoring_run_job_already_active",
      activeJobId: "job-active",
    })
  })

  it("does not enqueue while the collection mutation fence is closed", async () => {
    mocks.fenceBlocked = true

    const response = await createJob(createRequest({
      kind: "SOURCE_FULL",
      sourceScope: "EXTERNAL",
    }))

    expect(response.status).toBe(409)
    expect(mocks.createJob).not.toHaveBeenCalled()
  })
})

describe("GET /api/v1/social/monitoring-run-jobs", () => {
  it("loads the latest job only inside the authenticated tenant", async () => {
    mocks.auth.orgId = "org-tenant-b"

    const response = await getLatestJob(new NextRequest(
      "http://localhost/api/v1/social/monitoring-run-jobs?kind=WEB_NEWS&sourceScope=EXTERNAL&latest=1",
    ))

    expect(response.status).toBe(200)
    expect(mocks.getLatestJob).toHaveBeenCalledWith(
      "org-tenant-b",
      "WEB_NEWS",
      "EXTERNAL",
    )
  })

  it("rejects an invalid kind without querying another tenant's queue", async () => {
    const response = await getLatestJob(new NextRequest(
      "http://localhost/api/v1/social/monitoring-run-jobs?kind=OTHER",
    ))

    expect(response.status).toBe(400)
    expect(mocks.getLatestJob).not.toHaveBeenCalled()
  })

  it("rejects an incompatible source scope before querying the queue", async () => {
    const response = await getLatestJob(new NextRequest(
      "http://localhost/api/v1/social/monitoring-run-jobs?kind=PROFILE_FULL&sourceScope=OWNED",
    ))

    expect(response.status).toBe(400)
    expect(mocks.getLatestJob).not.toHaveBeenCalled()
  })
})

describe("GET/cancel/resume /api/v1/social/monitoring-run-jobs/[id]", () => {
  it("passes the authenticated tenant to a point lookup and hides missing jobs", async () => {
    mocks.auth.orgId = "org-tenant-c"
    mocks.getJob.mockResolvedValueOnce(null)

    const response = await getJob(
      new NextRequest("http://localhost/api/v1/social/monitoring-run-jobs/foreign"),
      params("foreign"),
    )

    expect(response.status).toBe(404)
    expect(mocks.getJob).toHaveBeenCalledWith("org-tenant-c", "foreign")
  })

  it("scopes cancel and resume mutations to tenant and authenticated actor", async () => {
    Object.assign(mocks.auth, { orgId: "org-tenant-d", userId: "admin-d" })

    const cancelResponse = await cancelJob(
      new NextRequest("http://localhost/api/v1/social/monitoring-run-jobs/job-9/cancel", { method: "POST" }),
      params("job-9"),
    )
    const resumeResponse = await resumeJob(
      new NextRequest("http://localhost/api/v1/social/monitoring-run-jobs/job-9/resume", { method: "POST" }),
      params("job-9"),
    )

    expect(cancelResponse.status).toBe(200)
    expect(resumeResponse.status).toBe(200)
    expect(mocks.cancelJob).toHaveBeenCalledWith(
      "org-tenant-d",
      "job-9",
      "admin-d",
      "admin",
    )
    expect(mocks.resumeJob).toHaveBeenCalledWith(
      "org-tenant-d",
      "job-9",
      "admin-d",
      "admin",
    )
  })

  it("maps typed cancel and resume state errors", async () => {
    mocks.cancelJob.mockRejectedValueOnce(new SocialMonitoringRunJobError(
      "social_monitoring_run_job_not_cancelable",
      409,
    ))
    mocks.resumeJob.mockRejectedValueOnce(new SocialMonitoringRunJobError(
      "social_monitoring_run_job_not_resumable",
      409,
    ))

    const cancelResponse = await cancelJob(
      new NextRequest("http://localhost/api/v1/social/monitoring-run-jobs/job-1/cancel", { method: "POST" }),
      params(),
    )
    const resumeResponse = await resumeJob(
      new NextRequest("http://localhost/api/v1/social/monitoring-run-jobs/job-1/resume", { method: "POST" }),
      params(),
    )

    expect(cancelResponse.status).toBe(409)
    expect(resumeResponse.status).toBe(409)
  })

  it("does not acknowledge cancel until it acquires the collection fence", async () => {
    mocks.fenceBlocked = true

    const response = await cancelJob(
      new NextRequest("http://localhost/api/v1/social/monitoring-run-jobs/job-1/cancel", { method: "POST" }),
      params(),
    )

    expect(response.status).toBe(409)
    expect(mocks.cancelJob).not.toHaveBeenCalled()
  })

  it("registers every queue route on the social permission boundary", () => {
    expect(mocks.registrations).toEqual(expect.arrayContaining([
      { wrapper: "rls", module: "social", action: "read" },
      { wrapper: "fence", module: "social", action: "write" },
    ]))
  })
})
