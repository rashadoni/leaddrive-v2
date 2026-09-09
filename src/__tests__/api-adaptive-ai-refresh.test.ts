/**
 * A9 Adaptive AI Models — slice-3 cron route tests.
 *
 * Covers:
 *   - 401 on missing/wrong cron secret
 *   - 200 + skip when no feedback rows exist for a (org, type) pair
 *   - upsert called with computed metrics matching aggregator output
 *   - per-(org, predictionType) iteration (8 types × N orgs)
 *   - error in one (org, type) doesn't abort the whole cron
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findMany: vi.fn() },
    aiFeedback: { findMany: vi.fn() },
    aiPredictionAdjustment: { upsert: vi.fn() },
  },
}))

import { POST } from "@/app/api/cron/adaptive-ai-refresh/route"
import { prisma } from "@/lib/prisma"

function makeReq(headers: Record<string, string> = {}) {
  return new NextRequest(new URL("/api/cron/adaptive-ai-refresh", "http://localhost:3000"), {
    method: "POST",
    headers,
  })
}

const CRON_SECRET = "test-cron-secret"

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = CRON_SECRET
})

describe("POST /api/cron/adaptive-ai-refresh — auth", () => {
  it("503 when CRON_SECRET env var is unset (closed-by-default)", async () => {
    delete process.env.CRON_SECRET
    const res = await POST(makeReq({ "x-cron-secret": "anything" }))
    expect(res.status).toBe(503)
  })

  it("401 when no cron secret header", async () => {
    const res = await POST(makeReq())
    expect(res.status).toBe(401)
  })

  it("401 on wrong x-cron-secret", async () => {
    const res = await POST(makeReq({ "x-cron-secret": "wrong" }))
    expect(res.status).toBe(401)
  })

  it("200 with correct x-cron-secret + no orgs", async () => {
    vi.mocked(prisma.organization.findMany).mockResolvedValue([])
    const res = await POST(makeReq({ "x-cron-secret": CRON_SECRET }))
    expect(res.status).toBe(200)
  })

  it("accepts Bearer authorization header equivalent to x-cron-secret", async () => {
    vi.mocked(prisma.organization.findMany).mockResolvedValue([])
    const res = await POST(makeReq({ authorization: `Bearer ${CRON_SECRET}` }))
    expect(res.status).toBe(200)
  })
})

describe("POST /api/cron/adaptive-ai-refresh — aggregation behaviour", () => {
  it("skips when no feedback rows exist for an (org, type)", async () => {
    vi.mocked(prisma.organization.findMany).mockResolvedValue([{ id: "org1" }] as any)
    vi.mocked(prisma.aiFeedback.findMany).mockResolvedValue([])

    const res = await POST(makeReq({ "x-cron-secret": CRON_SECRET }))
    expect(res.status).toBe(200)
    const body: { summary: { organizationsScanned: number; skippedNoFeedback: number; adjustmentsUpserted: number } } = await res.json()
    expect(body.summary.organizationsScanned).toBe(1)
    // 8 predictionTypes × 1 org × all empty
    expect(body.summary.skippedNoFeedback).toBe(8)
    expect(body.summary.adjustmentsUpserted).toBe(0)
    expect(prisma.aiPredictionAdjustment.upsert).not.toHaveBeenCalled()
  })

  it("upserts with aggregator output when feedback exists", async () => {
    vi.mocked(prisma.organization.findMany).mockResolvedValue([{ id: "org1" }] as any)
    // 10 positive ratings for prediction_deal_win → avgRating=1, credit=10/20=0.5 → adjustmentFactor=0.5
    vi.mocked(prisma.aiFeedback.findMany).mockImplementation(async (args: any) => {
      if (args.where.predictionType === "prediction_deal_win") {
        return Array.from({ length: 10 }, () => ({ rating: 1, predictionValue: null })) as any
      }
      return [] as any
    })

    const res = await POST(makeReq({ "x-cron-secret": CRON_SECRET }))
    expect(res.status).toBe(200)
    expect(prisma.aiPredictionAdjustment.upsert).toHaveBeenCalledTimes(1)
    const call = vi.mocked(prisma.aiPredictionAdjustment.upsert).mock.calls[0][0]
    expect(call.where).toEqual({
      organizationId_predictionType: {
        organizationId: "org1",
        predictionType: "prediction_deal_win",
      },
    })
    expect(call.create).toMatchObject({
      organizationId: "org1",
      predictionType: "prediction_deal_win",
      adjustmentFactor: 0.5,
      sampleSize: 10,
      avgRating: 1,
      approvalRate: 1,
    })
    expect(call.update).toMatchObject({
      adjustmentFactor: 0.5,
      sampleSize: 10,
      avgRating: 1,
      approvalRate: 1,
    })
  })

  it("processes multiple orgs independently", async () => {
    vi.mocked(prisma.organization.findMany).mockResolvedValue([
      { id: "orgA" },
      { id: "orgB" },
    ] as any)
    vi.mocked(prisma.aiFeedback.findMany).mockImplementation(async (args: any) => {
      // orgA has churn feedback (3 ratings, all negative → adjustmentFactor=-0.15 due to small sample)
      if (args.where.organizationId === "orgA" && args.where.predictionType === "prediction_churn") {
        return Array.from({ length: 3 }, () => ({ rating: -1, predictionValue: null })) as any
      }
      return [] as any
    })

    const res = await POST(makeReq({ "x-cron-secret": CRON_SECRET }))
    const body: { summary: { organizationsScanned: number; adjustmentsUpserted: number } } = await res.json()
    expect(body.summary.organizationsScanned).toBe(2)
    expect(body.summary.adjustmentsUpserted).toBe(1)
    const call = vi.mocked(prisma.aiPredictionAdjustment.upsert).mock.calls[0][0]
    expect(call.create).toMatchObject({
      organizationId: "orgA",
      predictionType: "prediction_churn",
      adjustmentFactor: -0.15,
      sampleSize: 3,
    })
  })

  it("an upsert failure on one (org, type) does not abort the whole cron", async () => {
    vi.mocked(prisma.organization.findMany).mockResolvedValue([{ id: "org1" }] as any)
    vi.mocked(prisma.aiFeedback.findMany).mockResolvedValue(
      Array.from({ length: 5 }, () => ({ rating: 1, predictionValue: null })) as any,
    )
    // First upsert fails, subsequent succeed
    let calls = 0
    vi.mocked(prisma.aiPredictionAdjustment.upsert).mockImplementation(async () => {
      calls++
      if (calls === 1) throw new Error("transient DB error")
      return {} as any
    })

    const res = await POST(makeReq({ "x-cron-secret": CRON_SECRET }))
    expect(res.status).toBe(200)
    const body: { summary: { errors: string[]; adjustmentsUpserted: number } } = await res.json()
    expect(body.summary.errors.length).toBeGreaterThan(0)
    // 8 types × 1 org − 1 failure = 7 successful upserts
    expect(body.summary.adjustmentsUpserted).toBe(7)
  })

  it("applies the 10k take cap to each per-(org, type) findMany", async () => {
    vi.mocked(prisma.organization.findMany).mockResolvedValue([{ id: "org1" }] as any)
    vi.mocked(prisma.aiFeedback.findMany).mockResolvedValue([])
    await POST(makeReq({ "x-cron-secret": CRON_SECRET }))
    const sampleCall = vi.mocked(prisma.aiFeedback.findMany).mock.calls[0][0]
    expect(sampleCall?.take).toBe(10000)
    expect(sampleCall?.orderBy).toEqual({ createdAt: "desc" })
  })
})
