/**
 * A9 Adaptive AI Models — slice-2 route tests.
 *
 * Covers POST /api/v1/ai-feedback (insert) +
 *        GET  /api/v1/ai-feedback (list) +
 *        GET  /api/v1/ai-feedback/aggregate (computed metrics).
 *
 * Multi-tenant safety: every test asserts the org filter is
 * applied at the DB layer — a slip-through here would expose
 * cross-tenant feedback.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiFeedback: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  getSession: vi.fn(),
}))

import { POST as POST_FEEDBACK, GET as GET_FEEDBACK } from "@/app/api/v1/ai-feedback/route"
import { GET as GET_AGGREGATE } from "@/app/api/v1/ai-feedback/aggregate/route"
import { prisma } from "@/lib/prisma"
import { getSession } from "@/lib/api-auth"

function makeReq(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(new URL(url, "http://localhost:3000"), init)
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ── POST /api/v1/ai-feedback ──────────────────────────────────────── */

describe("POST /api/v1/ai-feedback", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    const res = await POST_FEEDBACK(
      makeReq("/api/v1/ai-feedback", {
        method: "POST",
        body: JSON.stringify({ predictionType: "prediction_deal_win", predictionTargetId: "d1", rating: 1 }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it("returns 400 on invalid JSON body", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1", role: "admin", email: "", name: "" })
    const res = await POST_FEEDBACK(
      makeReq("/api/v1/ai-feedback", { method: "POST", body: "not-json{" }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 on unknown predictionType", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1", role: "admin", email: "", name: "" })
    const res = await POST_FEEDBACK(
      makeReq("/api/v1/ai-feedback", {
        method: "POST",
        body: JSON.stringify({ predictionType: "spaceship_will_fly", predictionTargetId: "d1", rating: 1 }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 when predictionTargetId is missing", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1", role: "admin", email: "", name: "" })
    const res = await POST_FEEDBACK(
      makeReq("/api/v1/ai-feedback", {
        method: "POST",
        body: JSON.stringify({ predictionType: "prediction_deal_win", rating: 1 }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 when rating is out of range", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1", role: "admin", email: "", name: "" })
    const res = await POST_FEEDBACK(
      makeReq("/api/v1/ai-feedback", {
        method: "POST",
        body: JSON.stringify({ predictionType: "prediction_deal_win", predictionTargetId: "d1", rating: 5 }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 when comment is too long", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1", role: "admin", email: "", name: "" })
    const res = await POST_FEEDBACK(
      makeReq("/api/v1/ai-feedback", {
        method: "POST",
        body: JSON.stringify({
          predictionType: "prediction_deal_win",
          predictionTargetId: "d1",
          rating: 1,
          comment: "x".repeat(1001),
        }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it("creates feedback row scoped to caller's org", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1", role: "admin", email: "", name: "" })
    vi.mocked(prisma.aiFeedback.create).mockResolvedValue({
      id: "fb1",
      organizationId: "org1",
      predictionType: "prediction_deal_win",
      predictionTargetId: "d1",
      predictionValue: "0.73",
      rating: 1,
      comment: "spot on",
      userId: "u1",
      createdAt: new Date(),
    } as any)

    const res = await POST_FEEDBACK(
      makeReq("/api/v1/ai-feedback", {
        method: "POST",
        body: JSON.stringify({
          predictionType: "prediction_deal_win",
          predictionTargetId: "d1",
          predictionValue: "0.73",
          rating: 1,
          comment: "spot on",
        }),
      }),
    )
    expect(res.status).toBe(201)
    expect(prisma.aiFeedback.create).toHaveBeenCalledWith({
      data: {
        organizationId: "org1",
        predictionType: "prediction_deal_win",
        predictionTargetId: "d1",
        predictionValue: "0.73",
        rating: 1,
        comment: "spot on",
        userId: "u1",
      },
    })
  })

  it("accepts neutral (skip) rating", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1", role: "admin", email: "", name: "" })
    vi.mocked(prisma.aiFeedback.create).mockResolvedValue({ id: "fb1" } as any)
    const res = await POST_FEEDBACK(
      makeReq("/api/v1/ai-feedback", {
        method: "POST",
        body: JSON.stringify({
          predictionType: "prediction_deal_win",
          predictionTargetId: "d1",
          rating: 0,
        }),
      }),
    )
    expect(res.status).toBe(201)
  })

  it("falls back userId to null when session has none", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "", role: "admin", email: "", name: "" })
    vi.mocked(prisma.aiFeedback.create).mockResolvedValue({ id: "fb1" } as any)
    await POST_FEEDBACK(
      makeReq("/api/v1/ai-feedback", {
        method: "POST",
        body: JSON.stringify({
          predictionType: "prediction_churn",
          predictionTargetId: "c1",
          rating: -1,
        }),
      }),
    )
    expect(prisma.aiFeedback.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: null }) }),
    )
  })
})

/* ── GET /api/v1/ai-feedback (list) ────────────────────────────────── */

describe("GET /api/v1/ai-feedback", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    const res = await GET_FEEDBACK(makeReq("/api/v1/ai-feedback"))
    expect(res.status).toBe(401)
  })

  it("scopes findMany to caller's org", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1", role: "admin", email: "", name: "" })
    vi.mocked(prisma.aiFeedback.findMany).mockResolvedValue([])
    await GET_FEEDBACK(makeReq("/api/v1/ai-feedback"))
    expect(prisma.aiFeedback.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org1" }),
      }),
    )
  })

  it("filters by predictionType when provided", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1", role: "admin", email: "", name: "" })
    vi.mocked(prisma.aiFeedback.findMany).mockResolvedValue([])
    await GET_FEEDBACK(makeReq("/api/v1/ai-feedback?type=prediction_churn"))
    expect(prisma.aiFeedback.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org1", predictionType: "prediction_churn" },
      }),
    )
  })

  it("rejects unknown predictionType in query", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1", role: "admin", email: "", name: "" })
    const res = await GET_FEEDBACK(makeReq("/api/v1/ai-feedback?type=bogus"))
    expect(res.status).toBe(400)
  })

  it("caps limit at 500 even with absurd query", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1", role: "admin", email: "", name: "" })
    vi.mocked(prisma.aiFeedback.findMany).mockResolvedValue([])
    await GET_FEEDBACK(makeReq("/api/v1/ai-feedback?limit=99999"))
    expect(prisma.aiFeedback.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 500 }),
    )
  })
})

/* ── GET /api/v1/ai-feedback/aggregate ─────────────────────────────── */

describe("GET /api/v1/ai-feedback/aggregate", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    const res = await GET_AGGREGATE(
      makeReq("/api/v1/ai-feedback/aggregate?type=prediction_deal_win"),
    )
    expect(res.status).toBe(401)
  })

  it("returns 400 when type query param is missing", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1", role: "admin", email: "", name: "" })
    const res = await GET_AGGREGATE(makeReq("/api/v1/ai-feedback/aggregate"))
    expect(res.status).toBe(400)
  })

  it("returns 400 when since is not a valid ISO timestamp", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1", role: "admin", email: "", name: "" })
    const res = await GET_AGGREGATE(
      makeReq("/api/v1/ai-feedback/aggregate?type=prediction_deal_win&since=banana"),
    )
    expect(res.status).toBe(400)
  })

  it("aggregates positive feedback into adjustmentFactor = 0.25 with 5 ratings (sample dampening)", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1", role: "admin", email: "", name: "" })
    vi.mocked(prisma.aiFeedback.findMany).mockResolvedValue(
      Array.from({ length: 5 }, () => ({ rating: 1, predictionValue: null })) as any,
    )
    const res = await GET_AGGREGATE(
      makeReq("/api/v1/ai-feedback/aggregate?type=prediction_deal_win"),
    )
    expect(res.status).toBe(200)
    const body: { data: { adjustmentFactor: number; sampleSize: number } } = await res.json()
    expect(body.data.sampleSize).toBe(5)
    // avgRating=1, credit=5/20=0.25 → adjustmentFactor=0.25
    expect(body.data.adjustmentFactor).toBe(0.25)
  })

  it("scopes findMany by org + predictionType (no cross-tenant leak)", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1", role: "admin", email: "", name: "" })
    vi.mocked(prisma.aiFeedback.findMany).mockResolvedValue([])
    await GET_AGGREGATE(makeReq("/api/v1/ai-feedback/aggregate?type=prediction_churn"))
    expect(prisma.aiFeedback.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org1", predictionType: "prediction_churn" },
      }),
    )
  })

  it("scopes by since when provided", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1", role: "admin", email: "", name: "" })
    vi.mocked(prisma.aiFeedback.findMany).mockResolvedValue([])
    const sinceIso = "2026-05-01T00:00:00.000Z"
    await GET_AGGREGATE(
      makeReq(`/api/v1/ai-feedback/aggregate?type=prediction_deal_win&since=${sinceIso}`),
    )
    const call = vi.mocked(prisma.aiFeedback.findMany).mock.calls[0][0]
    expect(call?.where).toMatchObject({
      organizationId: "org1",
      predictionType: "prediction_deal_win",
      createdAt: { gte: new Date(sinceIso) },
    })
  })

  it("scopes by targetId when provided", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1", role: "admin", email: "", name: "" })
    vi.mocked(prisma.aiFeedback.findMany).mockResolvedValue([])
    await GET_AGGREGATE(
      makeReq("/api/v1/ai-feedback/aggregate?type=prediction_deal_win&targetId=d1"),
    )
    expect(prisma.aiFeedback.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ predictionTargetId: "d1" }),
      }),
    )
  })

  it("returns zeroed result when no feedback exists", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1", role: "admin", email: "", name: "" })
    vi.mocked(prisma.aiFeedback.findMany).mockResolvedValue([])
    const res = await GET_AGGREGATE(
      makeReq("/api/v1/ai-feedback/aggregate?type=prediction_deal_win"),
    )
    const body: { data: { sampleSize: number; avgRating: number; adjustmentFactor: number } } = await res.json()
    expect(body.data.sampleSize).toBe(0)
    expect(body.data.avgRating).toBe(0)
    expect(body.data.adjustmentFactor).toBe(0)
  })
})
