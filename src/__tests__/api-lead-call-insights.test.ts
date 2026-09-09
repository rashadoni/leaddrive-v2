import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lead: { findFirst: vi.fn() },
    callLog: { findMany: vi.fn() },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))

vi.mock("@/lib/sharing-rules", () => ({
  applyRecordFilter: vi.fn(async (_orgId, _userId, _role, _entity, where) => where),
}))

import { GET } from "@/app/api/v1/leads/[id]/call-insights/route"
import { requireAuth } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { applyRecordFilter } from "@/lib/sharing-rules"

const AUTH = {
  orgId: "org-1",
  userId: "sales-1",
  role: "sales",
  email: "seller@example.test",
  name: "Seller",
}
const PARAMS = { params: Promise.resolve({ id: "lead-1" }) }
const request = () => new NextRequest("http://localhost:3000/api/v1/leads/lead-1/call-insights")

function insight(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    sentiment: "positive",
    sentimentScore: 0.8,
    summary: "Customer asked for a proposal.",
    topics: ["pricing"],
    actionItems: [{ text: "Send proposal", owner: "agent", dueDateHint: "tomorrow" }],
    competitorMentions: [{ name: "Example", context: "Compared prices", count: 1 }],
    coachingHints: [{ rule: "follow_up", message: "Confirm the next step", severity: "info" }],
    costUsd: 4.25,
    latencyMs: 900,
    model: "internal-model",
    ...overrides,
  }
}

describe("GET /api/v1/leads/[id]/call-insights", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAuth).mockResolvedValue(AUTH as never)
    vi.mocked(prisma.lead.findFirst).mockResolvedValue({ id: "lead-1" } as never)
    vi.mocked(prisma.callLog.findMany).mockResolvedValue([] as never)
  })

  it("preserves the leads read authorization gate", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }) as never,
    )

    const response = await GET(request(), PARAMS)

    expect(response.status).toBe(403)
    expect(prisma.lead.findFirst).not.toHaveBeenCalled()
  })

  it("validates record visibility and hides an inaccessible lead as 404", async () => {
    vi.mocked(applyRecordFilter).mockResolvedValueOnce({
      id: "lead-1",
      organizationId: "org-1",
      OR: [{ assignedTo: "sales-1" }],
    })
    vi.mocked(prisma.lead.findFirst).mockResolvedValueOnce(null)

    const response = await GET(request(), PARAMS)

    expect(response.status).toBe(404)
    expect(applyRecordFilter).toHaveBeenCalledWith(
      "org-1",
      "sales-1",
      "sales",
      "lead",
      { id: "lead-1", organizationId: "org-1" },
    )
    expect(prisma.callLog.findMany).not.toHaveBeenCalled()
  })

  it("returns only structured seller-safe insight fields for the exact lead", async () => {
    vi.mocked(prisma.callLog.findMany).mockResolvedValueOnce([
      {
        id: "call-1",
        direction: "outbound",
        duration: 96,
        insights: insight(),
        insightsAt: new Date("2026-08-09T16:00:00Z"),
        createdAt: new Date("2026-08-09T15:55:00Z"),
      },
    ] as never)

    const response = await GET(request(), PARAMS)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(prisma.callLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: "org-1",
        leadId: "lead-1",
        insightsAt: { not: null },
      },
      take: 21,
    }))
    expect(body.data.calls).toHaveLength(1)
    expect(body.data.calls[0]).toMatchObject({
      id: "call-1",
      direction: "outbound",
      durationSeconds: 96,
      insight: {
        sentiment: "positive",
        summary: "Customer asked for a proposal.",
        topics: ["pricing"],
      },
    })
    expect(JSON.stringify(body)).not.toContain("costUsd")
    expect(JSON.stringify(body)).not.toContain("latencyMs")
    expect(JSON.stringify(body)).not.toContain("internal-model")
    expect(JSON.stringify(body)).not.toContain("transcription")
    expect(JSON.stringify(body)).not.toContain("Number")
  })

  it("drops malformed legacy insight payloads instead of exposing partial data", async () => {
    vi.mocked(prisma.callLog.findMany).mockResolvedValueOnce([
      {
        id: "call-invalid",
        direction: "outbound",
        duration: 20,
        insights: { version: 0, summary: "legacy" },
        insightsAt: new Date("2026-08-09T16:00:00Z"),
        createdAt: new Date("2026-08-09T15:55:00Z"),
      },
      {
        id: "call-valid",
        direction: "inbound",
        duration: 40,
        insights: insight({ sentiment: "neutral" }),
        insightsAt: new Date("2026-08-09T15:00:00Z"),
        createdAt: new Date("2026-08-09T14:55:00Z"),
      },
    ] as never)

    const response = await GET(request(), PARAMS)
    const body = await response.json()

    expect(body.data.calls.map((call: { id: string }) => call.id)).toEqual(["call-valid"])
  })

  it("returns a stable 500 response when the scoped query fails", async () => {
    vi.mocked(prisma.callLog.findMany).mockRejectedValueOnce(new Error("db unavailable"))

    const response = await GET(request(), PARAMS)

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: "Internal server error" })
  })
})
