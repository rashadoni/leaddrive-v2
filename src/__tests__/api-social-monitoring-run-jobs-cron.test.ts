import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const mocks = vi.hoisted(() => ({
  requireCronAuth: vi.fn(),
  runWithRlsBypass: vi.fn((action: () => Promise<unknown>) => action()),
  processJobs: vi.fn(),
  withJobLease: vi.fn(),
  autoTriage: vi.fn(),
  judgePass: vi.fn(),
}))

vi.mock("@/lib/cron-auth", () => ({ requireCronAuth: mocks.requireCronAuth }))
vi.mock("@/lib/rls-context", () => ({ runWithRlsBypass: mocks.runWithRlsBypass }))
vi.mock("@/lib/social/monitoring-run-job", () => ({
  processSocialMonitoringRunJobs: mocks.processJobs,
}))
vi.mock("@/lib/cron/job-lease", () => ({ withJobLease: mocks.withJobLease }))
vi.mock("@/lib/social/automatic-review-backfill", () => ({
  autoTriageStoredReviewEnvelopes: mocks.autoTriage,
}))
vi.mock("@/lib/social/ai-relevance-judge-pass", () => ({
  judgeAmbiguousAliasRejections: mocks.judgePass,
}))

import { POST } from "@/app/api/cron/social-monitoring-run-jobs/route"

function request(query = "") {
  return new NextRequest(`http://localhost/api/cron/social-monitoring-run-jobs${query}`, {
    method: "POST",
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireCronAuth.mockReturnValue(null)
  mocks.processJobs.mockResolvedValue({ selected: 1, claimed: 1, results: [] })
  mocks.autoTriage.mockResolvedValue({ selected: 2, accepted: 1, rejected: 1 })
  mocks.judgePass.mockResolvedValue({
    scanned: 3, judged: 3, confirmed: 1, restored: 1, notAbout: 1, unsure: 1, failed: 0, skippedOrgs: 0,
  })
  mocks.withJobLease.mockImplementation(async (
    _options: unknown,
    action: () => Promise<unknown>,
  ) => ({ status: "completed", value: await action() }))
})

describe("POST /api/cron/social-monitoring-run-jobs", () => {
  it("drains several tenant jobs every minute with a bounded per-job budget", async () => {
    const response = await POST(request("?organizationId=org-1&limit=8&maxItemsPerJob=4"))

    expect(response.status).toBe(200)
    expect(mocks.runWithRlsBypass).toHaveBeenCalledTimes(1)
    expect(mocks.processJobs).toHaveBeenCalledWith({
      organizationId: "org-1",
      limit: 8,
      maxItemsPerJob: 4,
      maxItemsTotal: 3,
      deadlineAt: expect.any(Date),
    })
    expect(mocks.withJobLease).toHaveBeenCalledWith(
      { name: "social-monitoring-automatic-review", ttlMs: 120_000 },
      expect.any(Function),
    )
    expect(mocks.autoTriage).toHaveBeenCalledWith({
      organizationId: "org-1",
      limit: 25,
      aiLimit: 10,
      deadlineAt: expect.any(Date),
    })
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        selected: 1,
        automaticReview: {
          status: "completed",
          selected: 2,
          accepted: 1,
          rejected: 1,
        },
      },
    })
  })

  it("uses safe global defaults for the installed schedule", async () => {
    await POST(request())

    expect(mocks.processJobs).toHaveBeenCalledWith({
      organizationId: undefined,
      limit: 5,
      maxItemsPerJob: 3,
      maxItemsTotal: 3,
      deadlineAt: expect.any(Date),
    })
    expect(mocks.autoTriage).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: undefined,
    }))
  })

  it("rejects unauthenticated ticks before entering RLS bypass", async () => {
    mocks.requireCronAuth.mockReturnValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    )

    const response = await POST(request())

    expect(response.status).toBe(401)
    expect(mocks.runWithRlsBypass).not.toHaveBeenCalled()
    expect(mocks.processJobs).not.toHaveBeenCalled()
    expect(mocks.withJobLease).not.toHaveBeenCalled()
    expect(mocks.autoTriage).not.toHaveBeenCalled()
  })

  it("reports a singleton lease skip without failing the queue cron", async () => {
    mocks.withJobLease.mockResolvedValueOnce({ status: "skipped", reason: "already_running" })

    const response = await POST(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        automaticReview: { status: "skipped", reason: "already_running" },
      },
    })
    expect(mocks.autoTriage).not.toHaveBeenCalled()
  })
})

// Проход судьи (#646) из крона УБРАН: на проде он вернул в ленту чужих тёзок.
describe("проход судьи релевантности в кроне сбора", () => {
  it("не вызывается, пока судья не научится отличать тёзок", async () => {
    const response = await POST(request("?organizationId=org-1"))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.judgePass).not.toHaveBeenCalled()
    expect(payload.data).not.toHaveProperty("relevanceJudge")
    expect(mocks.withJobLease).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: "social-ai-relevance-judge" }),
      expect.any(Function),
    )
  })
})
