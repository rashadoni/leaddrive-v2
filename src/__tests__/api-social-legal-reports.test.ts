import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

type AuthContext = { orgId: string; userId: string; role: string }
type RouteContext = { params: Promise<{ id: string }> }
type RouteHandler = (req: NextRequest, auth: AuthContext, ctx: RouteContext) => Promise<Response>

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: RouteHandler) =>
    (req: NextRequest, ctx: RouteContext) => handler(req, { orgId: "org-1", userId: "user-1", role: "manager" }, ctx),
}))

const mockPrisma = vi.hoisted(() => ({
  socialMention: { findFirst: vi.fn() },
  socialLegalCase: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
  },
  socialLegalReport: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  organization: { findUnique: vi.fn() },
}))

const mockLetter = vi.hoisted(() => ({
  generateLegalLetterDraft: vi.fn(),
}))

const mockLegalWorkflow = vi.hoisted(() => ({
  createLegalCandidate: vi.fn(),
  promoteLegalCandidate: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
  logAudit: vi.fn(),
}))

vi.mock("@/lib/social/legal-workflow", () => mockLegalWorkflow)

vi.mock("@/lib/social/legal-case", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/social/legal-case")>()
  return {
    ...original,
    generateLegalLetterDraft: mockLetter.generateLegalLetterDraft,
  }
})

import { POST as flagPOST, DELETE as flagDELETE } from "@/app/api/v1/social/mentions/[id]/legal-case/route"
import { GET as reportsGET, POST as reportsPOST } from "@/app/api/v1/social/legal-reports/route"
import { PATCH as reportPATCH, DELETE as reportDELETE } from "@/app/api/v1/social/legal-reports/[id]/route"
import { logAudit } from "@/lib/prisma"

function request(url: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const mentionCtx: RouteContext = { params: Promise.resolve({ id: "mention-1" }) }
const reportCtx: RouteContext = { params: Promise.resolve({ id: "report-1" }) }

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.socialMention.findFirst.mockResolvedValue({
    id: "mention-1",
    text: "Bu açıq böhtandır",
    platform: "facebook",
  })
  mockPrisma.socialLegalCase.findFirst.mockResolvedValue(null)
  mockPrisma.socialLegalCase.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "case-1", ...data }))
  mockPrisma.socialLegalCase.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "case-1", ...data }))
  mockPrisma.socialLegalCase.updateMany.mockResolvedValue({ count: 1 })
  mockPrisma.socialLegalCase.count.mockResolvedValue(2)
  mockPrisma.socialLegalCase.findMany.mockResolvedValue([])
  mockPrisma.socialLegalReport.findMany.mockResolvedValue([])
  mockPrisma.socialLegalReport.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "report-1",
    letterText: null,
    letterSource: "none",
    ...data,
  }))
  mockPrisma.socialLegalReport.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "report-1",
    title: "t",
    ...data,
  }))
  mockPrisma.organization.findUnique.mockResolvedValue({ name: "LeadDrive" })
  mockLetter.generateLegalLetterDraft.mockResolvedValue({ letterText: "Hörmətli rəhbərlik ..." })
  mockLegalWorkflow.createLegalCandidate.mockImplementation(async (input: { category: string }) => ({
    id: "candidate-1",
    category: input.category,
  }))
  mockLegalWorkflow.promoteLegalCandidate.mockImplementation(async (input: { category: string }) => ({
    id: "case-1",
    category: input.category,
    status: "open",
    aiSuggested: false,
  }))
})

describe("POST /api/v1/social/mentions/[id]/legal-case", () => {
  it("flags a mention with a heuristic category without falsely labeling it as AI", async () => {
    const res = await flagPOST(request("/api/v1/social/mentions/mention-1/legal-case", "POST", {}), mentionCtx)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.category).toBe("defamation")
    expect(json.data.aiSuggested).toBe(false)
    expect(mockLegalWorkflow.createLegalCandidate).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      mentionId: "mention-1",
      category: "defamation",
      requestedBy: "user-1",
    }))
    expect(mockLegalWorkflow.promoteLegalCandidate).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      candidateId: "candidate-1",
      reviewedBy: "user-1",
    }))
    expect(logAudit).toHaveBeenCalledWith("org-1", "social_legal_case_flagged", "social_mention", "mention-1", "facebook", expect.anything())
  })

  it("passes an explicit category through the human-review workflow", async () => {
    const res = await flagPOST(request("/api/v1/social/mentions/mention-1/legal-case", "POST", { category: "insult" }), mentionCtx)

    expect(res.status).toBe(200)
    expect(mockLegalWorkflow.createLegalCandidate).toHaveBeenCalledWith(expect.objectContaining({ category: "insult" }))
    expect(mockLegalWorkflow.promoteLegalCandidate).toHaveBeenCalledWith(expect.objectContaining({ category: "insult" }))
  })

  it("404s for a mention outside the org", async () => {
    mockPrisma.socialMention.findFirst.mockResolvedValue(null)

    const res = await flagPOST(request("/api/v1/social/mentions/mention-1/legal-case", "POST", {}), mentionCtx)

    expect(res.status).toBe(404)
  })

  it("blocks dismissing a case attached to a report", async () => {
    mockPrisma.socialLegalCase.findFirst.mockResolvedValue({ id: "case-1", reportId: "report-1" })

    const res = await flagDELETE(request("/api/v1/social/mentions/mention-1/legal-case", "DELETE"), mentionCtx)

    expect(res.status).toBe(409)
    expect(mockPrisma.socialLegalCase.update).not.toHaveBeenCalled()
  })

  it("dismisses an unattached case", async () => {
    mockPrisma.socialLegalCase.findFirst.mockResolvedValue({ id: "case-1", reportId: null })

    const res = await flagDELETE(request("/api/v1/social/mentions/mention-1/legal-case", "DELETE"), mentionCtx)

    expect(res.status).toBe(200)
    expect(mockPrisma.socialLegalCase.update).toHaveBeenCalledWith({
      where: { id: "case-1" },
      data: { status: "dismissed" },
    })
  })
})

describe("/api/v1/social/legal-reports", () => {
  it("lists reports with case counts and the open-case pool size", async () => {
    mockPrisma.socialLegalReport.findMany.mockResolvedValue([
      { id: "report-1", title: "Report", status: "draft", _count: { cases: 3 } },
    ])

    const res = await reportsGET(request("/api/v1/social/legal-reports", "GET"), reportCtx)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.reports[0]).toMatchObject({ id: "report-1", caseCount: 3 })
    expect(json.data.reports[0]._count).toBeUndefined()
    expect(json.data.openCaseCount).toBe(2)
  })

  it("rejects report creation when the period has no open cases", async () => {
    mockPrisma.socialLegalCase.findMany.mockResolvedValue([])

    const res = await reportsPOST(request("/api/v1/social/legal-reports", "POST", {
      periodStart: "2026-07-07T00:00:00.000Z",
      periodEnd: "2026-07-08T00:00:00.000Z",
    }), reportCtx)

    expect(res.status).toBe(400)
    expect(mockPrisma.socialLegalReport.create).not.toHaveBeenCalled()
  })

  it("creates a report, attaches cases, and stores the AI letter draft", async () => {
    mockPrisma.socialLegalCase.findMany.mockResolvedValue([
      {
        id: "case-1",
        category: "defamation",
        notes: null,
        mention: {
          id: "mention-1",
          platform: "facebook",
          sourceType: "post",
          text: "Böhtan mətni",
          url: "https://facebook.com/p/1",
          authorName: "Author",
          authorHandle: "author",
          sentiment: "negative",
          publishedAt: new Date("2026-07-07T10:00:00.000Z"),
          createdAt: new Date("2026-07-07T10:00:00.000Z"),
          evidences: [],
        },
      },
    ])

    const res = await reportsPOST(request("/api/v1/social/legal-reports", "POST", {
      recipient: "Bakı Şəhər Baş Polis İdarəsi",
      language: "az",
      periodStart: "2026-07-07T00:00:00.000Z",
      periodEnd: "2026-07-08T00:00:00.000Z",
    }), reportCtx)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.caseCount).toBe(1)
    expect(json.data.letterText).toContain("Hörmətli")
    expect(mockPrisma.socialLegalCase.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["case-1"] }, organizationId: "org-1" },
      data: { reportId: "report-1", status: "included" },
    })
    expect(mockLetter.generateLegalLetterDraft).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      orgName: "LeadDrive",
      recipient: "Bakı Şəhər Baş Polis İdarəsi",
    }))
  })

  it("still creates the report when the letter draft is skipped", async () => {
    mockPrisma.socialLegalCase.findMany.mockResolvedValue([
      {
        id: "case-1",
        category: "insult",
        notes: null,
        mention: {
          id: "mention-1",
          platform: "facebook",
          sourceType: "comment",
          text: "Təhqir",
          url: null,
          authorName: null,
          authorHandle: null,
          sentiment: "negative",
          publishedAt: null,
          createdAt: new Date("2026-07-07T10:00:00.000Z"),
          evidences: [],
        },
      },
    ])
    mockLetter.generateLegalLetterDraft.mockResolvedValue({ letterText: null, skipped: "budget_exceeded" })

    const res = await reportsPOST(request("/api/v1/social/legal-reports", "POST", {
      periodStart: "2026-07-07T00:00:00.000Z",
      periodEnd: "2026-07-08T00:00:00.000Z",
    }), reportCtx)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.letterSkipped).toBe("budget_exceeded")
    expect(json.data.letterText).toBeNull()
  })
})

describe("PATCH/DELETE /api/v1/social/legal-reports/[id]", () => {
  it("finalizes a draft report with finalizer stamp", async () => {
    mockPrisma.socialLegalReport.findFirst.mockResolvedValue({ id: "report-1", status: "draft" })

    const res = await reportPATCH(request("/api/v1/social/legal-reports/report-1", "PATCH", { status: "final" }), reportCtx)

    expect(res.status).toBe(200)
    expect(mockPrisma.socialLegalReport.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "final", finalizedBy: "user-1", finalizedAt: expect.any(Date) }),
    }))
  })

  it("freezes finalized reports against edits but allows reopening", async () => {
    mockPrisma.socialLegalReport.findFirst.mockResolvedValue({ id: "report-1", status: "final" })

    const blocked = await reportPATCH(request("/api/v1/social/legal-reports/report-1", "PATCH", { letterText: "edited" }), reportCtx)
    expect(blocked.status).toBe(409)

    const reopened = await reportPATCH(request("/api/v1/social/legal-reports/report-1", "PATCH", { status: "draft" }), reportCtx)
    expect(reopened.status).toBe(200)
    expect(mockPrisma.socialLegalReport.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "draft", finalizedBy: null, finalizedAt: null }),
    }))
  })

  it("deletes a draft report and releases its cases back to the open pool", async () => {
    mockPrisma.socialLegalReport.findFirst.mockResolvedValue({ id: "report-1", status: "draft", title: "Report" })
    mockPrisma.socialLegalReport.delete.mockResolvedValue({ id: "report-1" })

    const res = await reportDELETE(request("/api/v1/social/legal-reports/report-1", "DELETE"), reportCtx)

    expect(res.status).toBe(200)
    expect(mockPrisma.socialLegalCase.updateMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", reportId: "report-1" },
      data: { reportId: null, status: "open" },
    })
    expect(mockPrisma.socialLegalReport.delete).toHaveBeenCalledWith({ where: { id: "report-1" } })
  })

  it("refuses to delete a finalized report", async () => {
    mockPrisma.socialLegalReport.findFirst.mockResolvedValue({ id: "report-1", status: "final", title: "Report" })

    const res = await reportDELETE(request("/api/v1/social/legal-reports/report-1", "DELETE"), reportCtx)

    expect(res.status).toBe(409)
    expect(mockPrisma.socialLegalReport.delete).not.toHaveBeenCalled()
  })
})
