import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const { loadReport, loadLatestRun } = vi.hoisted(() => ({
  loadReport: vi.fn(),
  loadLatestRun: vi.fn(),
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: (...args: unknown[]) => unknown) =>
    (req: NextRequest, context: unknown) => handler(req, { orgId: "org-1", userId: "user-1" }, context),
}))

vi.mock("@/lib/social/discovery-auto-review-report", () => ({
  loadDiscoveryAutoReviewReport: loadReport,
}))
vi.mock("@/lib/social/discovery-auto-review-apply", () => ({
  loadLatestDiscoveryAutoReviewRun: loadLatestRun,
}))

import { GET } from "@/app/api/v1/social/monitoring-profiles/[id]/review-dry-run/route"

const request = new NextRequest(
  "http://localhost/api/v1/social/monitoring-profiles/subject-1/review-dry-run",
)

beforeEach(() => {
  vi.clearAllMocks()
  loadLatestRun.mockResolvedValue(null)
  loadReport.mockResolvedValue({
    resolverVersion: "discovery_auto_review_v1",
    subjectId: "subject-1",
    totalRows: 12,
    uniqueCandidates: 9,
    duplicateRows: 3,
    decisions: { reject: 5, release: 2, review: 2 },
    reasonBreakdown: [
      { reason: "outside_lookback_window", count: 5 },
      { reason: "missing_date_on_content_url", count: 2 },
    ],
    apply: {
      mode: "REJECT_ONLY",
      planFingerprint: "a".repeat(64),
      eligibleLinks: 5,
      eligibleRows: 7,
      protectedSharedLinks: 0,
      protectedSharedRows: 0,
      protectedPreviousDecisionLinks: 0,
      protectedPreviousDecisionRows: 0,
      protectedRetentionLinks: 0,
      protectedRetentionRows: 0,
      rollbackUntil: "2026-07-24T16:00:00.000Z",
    },
    generatedAt: "2026-07-23T16:00:00.000Z",
  })
})

describe("GET /api/v1/social/monitoring-profiles/[id]/review-dry-run", () => {
  it("returns a read-only tenant-scoped automatic review preview", async () => {
    const response = await GET(request, { params: Promise.resolve({ id: "subject-1" }) })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        totalRows: 12,
        uniqueCandidates: 9,
        duplicateRows: 3,
        decisions: { reject: 5, release: 2, review: 2 },
        latestRun: null,
      },
    })
    expect(loadReport).toHaveBeenCalledWith("org-1", "subject-1")
    expect(loadLatestRun).toHaveBeenCalledWith("org-1", "subject-1")
  })

  it("returns 404 when the subject does not belong to the tenant", async () => {
    loadReport.mockResolvedValue(null)

    const response = await GET(request, { params: Promise.resolve({ id: "missing" }) })

    expect(response.status).toBe(404)
    expect(loadReport).toHaveBeenCalledWith("org-1", "missing")
    expect(loadLatestRun).toHaveBeenCalledWith("org-1", "missing")
  })

  it("rejects an invalid route id before querying the report", async () => {
    const response = await GET(request, { params: Promise.resolve({ id: "" }) })

    expect(response.status).toBe(400)
    expect(loadReport).not.toHaveBeenCalled()
    expect(loadLatestRun).not.toHaveBeenCalled()
  })
})
