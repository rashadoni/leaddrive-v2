import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getReport: vi.fn(),
  buildPdf: vi.fn(),
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (
    module: string,
    action: string,
    handler: (request: NextRequest, auth: { orgId: string }) => Promise<Response>,
  ) => {
    mocks.auth(module, action)
    return (request: NextRequest) => handler(request, { orgId: "org-1" })
  },
}))

vi.mock("@/lib/social/visual-monitoring-report", () => {
  class VisualReportSubjectsNotFoundError extends Error {}
  return {
    getVisualMonitoringReport: mocks.getReport,
    VisualReportSubjectsNotFoundError,
  }
})

vi.mock("@/lib/social/social-monitoring-pdf", () => ({
  buildSocialMonitoringPdf: mocks.buildPdf,
}))

import { POST } from "@/app/api/v1/social/reports/visual/route"
import { VisualReportSubjectsNotFoundError } from "@/lib/social/visual-monitoring-report"

const snapshot = {
  schemaVersion: "1",
  locale: "az",
  generatedAt: "2026-07-31T12:00:00.000Z",
  range: {
    from: "2026-07-01",
    to: "2026-07-31",
    fromInclusive: "2026-07-01T00:00:00.000Z",
    toExclusive: "2026-08-01T00:00:00.000Z",
    days: 31,
  },
  sections: ["summary", "kpis", "comments"],
  organization: { name: "Brand Protection", primaryColor: "#f97316" },
  subjects: [],
  totals: { findings: 0, positive: 0, neutral: 0, negative: 0, unknown: 0, engagement: 0, reach: 0 },
  summaryText: "Hesabat",
  sentiment: [],
  platforms: [],
  trend: [],
  contentTypes: [],
  topFindings: [],
  topFindingsFilter: { sentiments: ["positive", "neutral", "negative", "unknown"], matched: 0, shown: 0 },
  comments: [],
  commentsFilter: { matched: 0, shown: 0 },
  methodology: {
    dateField: "publishedAt|firstSeenAt",
    globalDeduplication: "mentionId",
    subjectMatchStatus: "MATCHED",
    unclassifiedSentiment: "unknown",
    dataLimit: 20_000,
    truncated: false,
  },
}

const validBody = {
  format: "json",
  locale: "az",
  subjectIds: ["subject-a", "subject-b"],
  range: { from: "2026-07-01", to: "2026-07-31" },
  sections: ["summary", "kpis", "comments"],
  topFindingsLimit: 12,
  commentsLimit: 20,
  // Схема материализует умолчание, поэтому в теле запроса поле должно быть
  // явным — иначе сравнение с parsed.data разойдётся на дефолте.
  topFindingsSentiments: ["negative", "neutral"],
}

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/social/reports/visual", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  mocks.getReport.mockReset().mockResolvedValue(snapshot)
  mocks.buildPdf.mockReset().mockReturnValue(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))
})

describe("POST /api/v1/social/reports/visual", () => {
  it("is protected by social read permission", () => {
    expect(mocks.auth).toHaveBeenCalledWith("social", "read")
  })

  it("rejects invalid selection and periods before reading tenant data", async () => {
    const tooManySubjects = await POST(request({
      ...validBody,
      subjectIds: Array.from({ length: 21 }, (_, index) => `subject-${index}`),
    }))
    expect(tooManySubjects.status).toBe(400)

    const tooLong = await POST(request({
      ...validBody,
      range: { from: "2025-01-01", to: "2026-01-02" },
    }))
    expect(tooLong.status).toBe(400)

    const tooManyComments = await POST(request({
      ...validBody,
      commentsLimit: 51,
    }))
    expect(tooManyComments.status).toBe(400)
    expect(mocks.getReport).not.toHaveBeenCalled()
  })

  it.each([[[]], [["negative", "negative"]], [["angry"]]])(
    "rejects an invalid findings sentiment selection %j before touching data",
    async (topFindingsSentiments) => {
      const response = await POST(request({ ...validBody, topFindingsSentiments }))

      expect(response.status).toBe(400)
      expect(mocks.getReport).not.toHaveBeenCalled()
    },
  )

  it("returns a private JSON preview built from the parsed request", async () => {
    const response = await POST(request(validBody))

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(await response.json()).toEqual({ success: true, data: snapshot })
    expect(mocks.getReport).toHaveBeenCalledTimes(1)
    expect(mocks.getReport).toHaveBeenCalledWith({
      organizationId: "org-1",
      request: validBody,
    })
    expect(mocks.buildPdf).not.toHaveBeenCalled()
  })

  it("renders the exact same snapshot as an attachment PDF", async () => {
    const response = await POST(request({ ...validBody, format: "pdf" }))

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("application/pdf")
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="social-monitoring-2026-07-01-2026-07-31.pdf"',
    )
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(mocks.getReport).toHaveBeenCalledTimes(1)
    expect(mocks.buildPdf).toHaveBeenCalledWith(snapshot)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
    )
  })

  it("does not disclose whether a missing subject belongs to another tenant", async () => {
    mocks.getReport.mockRejectedValue(new VisualReportSubjectsNotFoundError())
    const response = await POST(request(validBody))

    expect(response.status).toBe(404)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(await response.json()).toEqual({ error: "One or more monitoring subjects were not found" })
  })
})
