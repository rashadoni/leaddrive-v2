import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const { recordFeedback, getReport, logAudit } = vi.hoisted(() => ({
  recordFeedback: vi.fn(),
  getReport: vi.fn(),
  logAudit: vi.fn(),
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: (...args: unknown[]) => unknown) =>
    (req: NextRequest) => handler(req, { orgId: "org-1", userId: "user-1", role: "manager" }),
}))

vi.mock("@/lib/social/monitoring-import-fence", () => ({
  withSocialMonitoringTenantCollectionFence: async (
    _organizationId: string,
    mutate: () => Promise<unknown>,
  ) => ({ allowed: true, value: await mutate() }),
}))

vi.mock("@/lib/prisma", () => ({ logAudit }))
vi.mock("@/lib/social/relevance-feedback", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/social/relevance-feedback")>()
  return {
    ...original,
    recordSocialRelevanceFeedback: recordFeedback,
    getWeeklySocialRelevanceQualityReport: getReport,
  }
})

import { GET, POST } from "@/app/api/v1/social/relevance-feedback/route"

function request(method: string, body?: unknown, query = "") {
  return new NextRequest(`http://localhost/api/v1/social/relevance-feedback${query}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  recordFeedback.mockResolvedValue({ id: "feedback-1", feedbackType: "RELEVANT" })
  getReport.mockResolvedValue({ totals: { total: 0 }, byWeek: [] })
})

describe("social relevance feedback API", () => {
  it("records a validated operator decision inside the authenticated tenant", async () => {
    const response = await POST(request("POST", {
      mentionId: "mention-1",
      subjectId: "subject-1",
      feedbackType: "RELEVANT",
    }))

    expect(response.status).toBe(201)
    expect(recordFeedback).toHaveBeenCalledWith("org-1", "user-1", {
      mentionId: "mention-1",
      subjectId: "subject-1",
      feedbackType: "RELEVANT",
    })
    expect(logAudit).toHaveBeenCalledWith(
      "org-1",
      "upsert",
      "social_relevance_feedback",
      "feedback-1",
      "RELEVANT:mention-1:subject-1",
    )
  })

  it("rejects unknown feedback types before persistence", async () => {
    const response = await POST(request("POST", {
      mentionId: "mention-1",
      subjectId: "subject-1",
      feedbackType: "MAYBE",
    }))

    expect(response.status).toBe(400)
    expect(recordFeedback).not.toHaveBeenCalled()
  })

  it("returns 404 for tenant-scoped mention or subject misses", async () => {
    recordFeedback.mockRejectedValueOnce(new Error("Social mention not found"))
    const response = await POST(request("POST", {
      mentionId: "missing",
      subjectId: "subject-1",
      feedbackType: "NOT_RELEVANT",
    }))
    expect(response.status).toBe(404)
  })

  it("returns a filtered weekly quality report", async () => {
    const before = Date.now()
    const response = await GET(request("GET", undefined, "?weeks=4&subjectId=subject-1&platform=instagram"))
    const after = Date.now()

    expect(response.status).toBe(200)
    expect(getReport).toHaveBeenCalledWith(
      "org-1",
      expect.any(Date),
      { subjectId: "subject-1", platform: "instagram" },
    )
    const since = getReport.mock.calls[0][1] as Date
    expect(since.getTime()).toBeGreaterThanOrEqual(before - 4 * 7 * 24 * 60 * 60 * 1000)
    expect(since.getTime()).toBeLessThanOrEqual(after - 4 * 7 * 24 * 60 * 60 * 1000)
  })

  it("rejects report windows outside the bounded range", async () => {
    const response = await GET(request("GET", undefined, "?weeks=99"))
    expect(response.status).toBe(400)
    expect(getReport).not.toHaveBeenCalled()
  })
})
