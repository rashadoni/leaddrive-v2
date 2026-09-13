import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    mtmAgent: { findFirst: vi.fn() },
    workforceAttendanceEvidence: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock("@/lib/with-workforce-rls-auth", () => ({
  withWorkforceSessionAuth: vi.fn((_action, handler) => handler),
}))
vi.mock("@/lib/mtm-settings", () => ({ getMtmSettings: vi.fn() }))
vi.mock("@/lib/workforce/approved-report-rate-limit", () => ({
  requireWorkforceEvidenceTimelineRateLimit: vi.fn(async () => null),
}))
vi.mock("@/lib/workforce/evidence-timeline-access", () => ({
  requireWorkforceEvidenceTimelineAccess: vi.fn(async () => null),
}))
vi.mock("@/lib/workforce/sensitive-operation-log", () => ({
  logWorkforceSensitiveOperationFailure: vi.fn(),
}))

import { GET } from "@/app/api/v1/workforce/evidence/timeline/route"
import { getMtmSettings } from "@/lib/mtm-settings"
import { prisma } from "@/lib/prisma"
import { requireWorkforceEvidenceTimelineRateLimit } from "@/lib/workforce/approved-report-rate-limit"
import { requireWorkforceEvidenceTimelineAccess } from "@/lib/workforce/evidence-timeline-access"
import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"

const AUTH = { orgId: "org-1", userId: "reviewer-1", role: "admin", principalType: "session" as const }
const invoke = GET as unknown as (request: NextRequest, auth: typeof AUTH) => Promise<Response>

function request(query = "?agentId=agent-1&start=2026-09-13&end=2026-09-13", headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost/api/v1/workforce/evidence/timeline${query}`, {
    headers: {
      "x-workforce-access-purpose": "ATTENDANCE_REVIEW",
      "x-workforce-access-reason-code": "OPEN_EXCEPTION",
      "x-workforce-case-reference": "case-17",
      ...headers,
    },
  })
}

function evidenceRow() {
  return {
    id: "evidence-1",
    source: "ACTION_LOCATION",
    capturedAt: new Date("2026-09-13T05:01:00.000Z"),
    rawPurgedAt: null,
    workdayEvent: {
      id: "event-1",
      type: "START",
      occurredAt: new Date("2026-09-13T05:00:00.000Z"),
      attendanceReviewState: "PENDING_REVIEW",
    },
    siteTransition: null,
    assessments: [{
      id: "assessment-1",
      kind: "GEOFENCE",
      assessorVersion: "geo-v1",
      verdict: "INSIDE",
      reasonCodes: ["INSIDE_FENCE"],
      assessedAt: new Date("2026-09-13T05:01:01.000Z"),
    }],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getMtmSettings).mockResolvedValue({ timezone: "Asia/Baku" } as never)
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", name: "Aysel" } as never)
  vi.mocked(prisma.workforceAttendanceEvidence.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never)
  vi.mocked(requireWorkforceEvidenceTimelineRateLimit).mockResolvedValue(null)
  vi.mocked(requireWorkforceEvidenceTimelineAccess).mockResolvedValue(null)
})

describe("GET /api/v1/workforce/evidence/timeline", () => {
  it("returns only derived verdicts after an exact-purpose access audit", async () => {
    vi.mocked(prisma.workforceAttendanceEvidence.findMany).mockResolvedValue([evidenceRow()] as never)
    const response = await invoke(request(), AUTH)

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    const body = await response.json()
    expect(body).toMatchObject({
      success: true,
      data: {
        timezone: "Asia/Baku",
        employee: { id: "agent-1", name: "Aysel" },
        access: { purpose: "ATTENDANCE_REVIEW", reasonCode: "OPEN_EXCEPTION", caseReference: "case-17" },
        boundaries: { projection: "DERIVED_ONLY", rawEvidence: "NOT_RETURNED" },
        evidence: [{
          id: "evidence-1",
          rawRetentionState: "WITHIN_RETENTION",
          subject: { kind: "WORKDAY_EVENT", action: "START", reviewState: "PENDING_REVIEW" },
          assessments: [{ verdict: "INSIDE", reasonCodes: ["INSIDE_FENCE"] }],
        }],
      },
    })
    const serialized = JSON.stringify(body)
    expect(serialized).not.toMatch(/latitude|longitude|distanceMeters|accuracyMeters|rawEnvelopeCiphertext|redactedReceipt|payloadHash|nonce|deviceEnrollment/)
    const query = vi.mocked(prisma.workforceAttendanceEvidence.findMany).mock.calls[0]?.[0]
    expect(JSON.stringify(query?.select)).not.toMatch(/latitude|longitude|distanceMeters|accuracyMeters|rawEnvelopeCiphertext|redactedReceipt|payloadHash|nonce|deviceEnrollment/)
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: "reviewer-1",
        action: "read",
        entityType: "workforce_evidence_timeline",
        entityId: "agent-1",
        newValue: expect.objectContaining({
          event: "WORKFORCE_DERIVED_EVIDENCE_VIEWED",
          purpose: "ATTENDANCE_REVIEW",
          reasonCode: "OPEN_EXCEPTION",
          projection: "DERIVED_ONLY",
        }),
      }),
    }))
  })

  it("rejects missing purpose before access or evidence lookup", async () => {
    const response = await invoke(new NextRequest(
      "http://localhost/api/v1/workforce/evidence/timeline?agentId=agent-1",
    ), AUTH)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "WORKFORCE_EVIDENCE_ACCESS_CONTEXT_REQUIRED" })
    expect(requireWorkforceEvidenceTimelineAccess).not.toHaveBeenCalled()
    expect(prisma.workforceAttendanceEvidence.findMany).not.toHaveBeenCalled()
  })

  it("fails before employee/evidence reads when the grant is denied", async () => {
    vi.mocked(requireWorkforceEvidenceTimelineAccess).mockResolvedValueOnce(
      new Response(null, { status: 403 }) as never,
    )
    const response = await invoke(request(), AUTH)
    expect(response.status).toBe(403)
    expect(prisma.mtmAgent.findFirst).not.toHaveBeenCalled()
    expect(prisma.workforceAttendanceEvidence.findMany).not.toHaveBeenCalled()
  })

  it("stops before sensitive parsing and reads when rate limited", async () => {
    vi.mocked(requireWorkforceEvidenceTimelineRateLimit).mockResolvedValueOnce(
      new Response(null, { status: 429 }) as never,
    )
    const response = await invoke(request(), AUTH)
    expect(response.status).toBe(429)
    expect(requireWorkforceEvidenceTimelineAccess).not.toHaveBeenCalled()
    expect(prisma.workforceAttendanceEvidence.findMany).not.toHaveBeenCalled()
  })

  it("rejects oversized output rather than returning a silent truncation", async () => {
    vi.mocked(prisma.workforceAttendanceEvidence.findMany).mockResolvedValue(
      Array.from({ length: 501 }, evidenceRow) as never,
    )
    const response = await invoke(request(), AUTH)
    expect(response.status).toBe(413)
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
  })

  it("returns no evidence when its mandatory audit write fails", async () => {
    vi.mocked(prisma.workforceAttendanceEvidence.findMany).mockResolvedValue([evidenceRow()] as never)
    vi.mocked(prisma.auditLog.create).mockRejectedValueOnce(new Error("audit unavailable"))
    const response = await invoke(request(), AUTH)
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: "WORKFORCE_EVIDENCE_TIMELINE_UNAVAILABLE" })
    expect(logWorkforceSensitiveOperationFailure).toHaveBeenCalledWith({ operation: "read-evidence-timeline" })
  })
})
