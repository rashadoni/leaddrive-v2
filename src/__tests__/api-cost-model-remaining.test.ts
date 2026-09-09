import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

/* ─── Mocks ──────────────────────────────────────────────────────────── */

vi.mock("@/lib/prisma", () => ({
  prisma: {
    costModelLog: { findMany: vi.fn() },
    costModelSnapshot: { upsert: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    clientService: { findMany: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
    pricingParameters: { findUnique: vi.fn() },
    overheadCost: { findMany: vi.fn() },
    costEmployee: { findMany: vi.fn() },
    company: { findMany: vi.fn() },
    deal: { groupBy: vi.fn() },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation(
    (r: any) => r instanceof Response || (r && r.status !== undefined && typeof r.json === "function" && !r.orgId),
  ),
}))

vi.mock("@/lib/cost-model/db", () => ({
  loadAndCompute: vi.fn(),
  writeCostModelLog: vi.fn().mockResolvedValue(undefined),
  invalidateAiCache: vi.fn(),
  getAiCache: vi.fn(),
  setAiCache: vi.fn(),
}))

vi.mock("@/lib/cost-model/ai-analysis", () => ({
  analyzeTab: vi.fn(),
}))

import { POST as POST_AI_ANALYSIS } from "@/app/api/cost-model/ai-analysis/route"
import { GET as GET_CLIENT_ANALYTICS } from "@/app/api/cost-model/client-analytics/[id]/route"
import { GET as GET_CLIENT_SERVICES, PUT as PUT_CLIENT_SERVICES } from "@/app/api/cost-model/client-services/[id]/route"
import { GET as GET_LOG } from "@/app/api/cost-model/log/route"
import { POST as POST_SEED } from "@/app/api/cost-model/seed-clients/route"
import { POST as POST_SNAPSHOT } from "@/app/api/cost-model/snapshot/route"
import { GET as GET_SNAPSHOTS } from "@/app/api/cost-model/snapshots/route"
import { GET as GET_SNAPSHOT_MONTH } from "@/app/api/cost-model/snapshots/[month]/route"
import { POST as POST_SYNC } from "@/app/api/cost-model/sync-pricing-services/route"
import { GET as GET_V1_COST_MODEL } from "@/app/api/v1/cost-model/route"
import { GET as GET_V1_CLIENTS, PUT as PUT_V1_CLIENTS } from "@/app/api/v1/cost-model/clients/route"

import { prisma } from "@/lib/prisma"
import { getOrgId, requireAuth } from "@/lib/api-auth"
import { loadAndCompute, getAiCache, setAiCache, invalidateAiCache, writeCostModelLog } from "@/lib/cost-model/db"
import { analyzeTab } from "@/lib/cost-model/ai-analysis"

function makeRequest(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(new URL(url, "http://localhost:3000"), init)
}

function makeParams(key: string, value: string) {
  return { params: Promise.resolve({ [key]: value }) }
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ─── AI ANALYSIS ────────────────────────────────────────────────────── */

describe("POST /api/cost-model/ai-analysis", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await POST_AI_ANALYSIS(
      makeRequest("/api/cost-model/ai-analysis", { method: "POST", body: JSON.stringify({ tab: "analytics" }) }),
    )
    expect(res.status).toBe(401)
  })

  it("returns cached result when available", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1")
    vi.mocked(getAiCache).mockReturnValue({ analysis: "cached-analysis", thinking: "cached-thinking", timestamp: 0 })
    const res = await POST_AI_ANALYSIS(
      makeRequest("/api/cost-model/ai-analysis", { method: "POST", body: JSON.stringify({ tab: "analytics", lang: "en" }) }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.cached).toBe(true)
    expect(json.data.analysis).toBe("cached-analysis")
  })

  it("calls AI and caches result when force=true", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1")
    vi.mocked(loadAndCompute).mockResolvedValue({ summary: {} } as any)
    vi.mocked(analyzeTab).mockResolvedValue({ analysis: "fresh", thinking: "think" })
    const res = await POST_AI_ANALYSIS(
      makeRequest("/api/cost-model/ai-analysis", { method: "POST", body: JSON.stringify({ tab: "analytics", force: true }) }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.cached).toBe(false)
    expect(json.data.analysis).toBe("fresh")
    expect(setAiCache).toHaveBeenCalled()
  })

  it("returns 400 for invalid JSON body", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1")
    const res = await POST_AI_ANALYSIS(
      makeRequest("/api/cost-model/ai-analysis", { method: "POST", body: "not-json" }),
    )
    expect(res.status).toBe(400)
  })
})

/* ─── CLIENT ANALYTICS ───────────────────────────────────────────────── */

describe("GET /api/cost-model/client-analytics/[id]", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await GET_CLIENT_ANALYTICS(makeRequest("/api/cost-model/client-analytics/c1"), makeParams("id", "c1") as any)
    expect(res.status).toBe(401)
  })

  it("returns 404 when client not found", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1")
    vi.mocked(loadAndCompute).mockResolvedValue({ clients: [] } as any)
    const res = await GET_CLIENT_ANALYTICS(makeRequest("/api/cost-model/client-analytics/c1"), makeParams("id", "c1") as any)
    expect(res.status).toBe(404)
  })

  it("returns client analytics data", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1")
    vi.mocked(loadAndCompute).mockResolvedValue({
      clients: [{ id: "c1", companyId: "c1", name: "Test" }],
    } as any)
    const res = await GET_CLIENT_ANALYTICS(makeRequest("/api/cost-model/client-analytics/c1"), makeParams("id", "c1") as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.name).toBe("Test")
  })
})

/* ─── CLIENT SERVICES ────────────────────────────────────────────────── */

describe("GET /api/cost-model/client-services/[id]", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await GET_CLIENT_SERVICES(makeRequest("/api/cost-model/client-services/c1"), makeParams("id", "c1") as any)
    expect(res.status).toBe(401)
  })

  it("returns services for a company", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1")
    const mockServices = [{ id: "s1", serviceType: "helpdesk", monthlyRevenue: 1000 }]
    vi.mocked(prisma.clientService.findMany).mockResolvedValue(mockServices as any)
    const res = await GET_CLIENT_SERVICES(makeRequest("/api/cost-model/client-services/c1"), makeParams("id", "c1") as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toHaveLength(1)
  })
})

describe("PUT /api/cost-model/client-services/[id]", () => {
  it("returns 400 when services array missing", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org1", userId: "u1" } as any)
    const res = await PUT_CLIENT_SERVICES(
      makeRequest("/api/cost-model/client-services/c1", { method: "PUT", body: JSON.stringify({}) }),
      makeParams("id", "c1") as any,
    )
    expect(res.status).toBe(400)
  })

  it("upserts services and invalidates cache", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org1", userId: "u1" } as any)
    vi.mocked(prisma.clientService.findMany).mockResolvedValue([])
    vi.mocked(prisma.clientService.upsert).mockResolvedValue({ id: "s1" } as any)
    const res = await PUT_CLIENT_SERVICES(
      makeRequest("/api/cost-model/client-services/c1", {
        method: "PUT",
        body: JSON.stringify({ services: [{ serviceType: "helpdesk", monthlyRevenue: 500, isActive: true }] }),
      }),
      makeParams("id", "c1") as any,
    )
    expect(res.status).toBe(200)
    expect(invalidateAiCache).toHaveBeenCalled()
    expect(writeCostModelLog).toHaveBeenCalled()
  })
})

/* ─── LOG ─────────────────────────────────────────────────────────────── */

describe("GET /api/cost-model/log", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await GET_LOG(makeRequest("/api/cost-model/log"))
    expect(res.status).toBe(401)
  })

  it("returns logs", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1")
    vi.mocked(prisma.costModelLog.findMany).mockResolvedValue([{ id: "l1" }] as any)
    const res = await GET_LOG(makeRequest("/api/cost-model/log"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toHaveLength(1)
  })
})

/* ─── SEED CLIENTS (placeholder) ──────────────────────────────────────── */

describe("POST /api/cost-model/seed-clients", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await POST_SEED(makeRequest("/api/cost-model/seed-clients", { method: "POST" }))
    expect(res.status).toBe(401)
  })

  it("returns placeholder response", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1")
    const res = await POST_SEED(makeRequest("/api/cost-model/seed-clients", { method: "POST" }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
  })
})

/* ─── SNAPSHOT (create) ──────────────────────────────────────────────── */

describe("POST /api/cost-model/snapshot", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await POST_SNAPSHOT(makeRequest("/api/cost-model/snapshot", { method: "POST" }))
    expect(res.status).toBe(401)
  })

  it("creates a snapshot and returns 201", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1")
    vi.mocked(loadAndCompute).mockResolvedValue({ summary: { totalCost: 100, totalRevenue: 200, margin: 100, marginPct: 50 } } as any)
    vi.mocked(prisma.costModelSnapshot.upsert).mockResolvedValue({ id: "snap1", snapshotMonth: "2026-04" } as any)
    const res = await POST_SNAPSHOT(makeRequest("/api/cost-model/snapshot", { method: "POST" }))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.data.id).toBe("snap1")
    expect(invalidateAiCache).toHaveBeenCalled()
  })
})

/* ─── SNAPSHOTS (list) ────────────────────────────────────────────────── */

describe("GET /api/cost-model/snapshots", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await GET_SNAPSHOTS(makeRequest("/api/cost-model/snapshots"))
    expect(res.status).toBe(401)
  })

  it("returns list of snapshots", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1")
    vi.mocked(prisma.costModelSnapshot.findMany).mockResolvedValue([{ id: "s1", snapshotMonth: "2026-03" }] as any)
    const res = await GET_SNAPSHOTS(makeRequest("/api/cost-model/snapshots"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toHaveLength(1)
  })
})

/* ─── SNAPSHOTS/[month] ──────────────────────────────────────────────── */

describe("GET /api/cost-model/snapshots/[month]", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await GET_SNAPSHOT_MONTH(makeRequest("/api/cost-model/snapshots/2026-03"), makeParams("month", "2026-03") as any)
    expect(res.status).toBe(401)
  })

  it("returns 404 when snapshot not found", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1")
    vi.mocked(prisma.costModelSnapshot.findUnique).mockResolvedValue(null)
    const res = await GET_SNAPSHOT_MONTH(makeRequest("/api/cost-model/snapshots/2026-03"), makeParams("month", "2026-03") as any)
    expect(res.status).toBe(404)
  })

  it("returns snapshot with parsed dataJson", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1")
    vi.mocked(prisma.costModelSnapshot.findUnique).mockResolvedValue({
      id: "s1",
      snapshotMonth: "2026-03",
      dataJson: JSON.stringify({ summary: { totalCost: 100 } }),
    } as any)
    const res = await GET_SNAPSHOT_MONTH(makeRequest("/api/cost-model/snapshots/2026-03"), makeParams("month", "2026-03") as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.dataJson.summary.totalCost).toBe(100)
  })
})

/* ─── SYNC PRICING SERVICES (placeholder) ─────────────────────────────── */

describe("POST /api/cost-model/sync-pricing-services", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await POST_SYNC(makeRequest("/api/cost-model/sync-pricing-services", { method: "POST" }))
    expect(res.status).toBe(401)
  })

  it("returns placeholder response", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1")
    const res = await POST_SYNC(makeRequest("/api/cost-model/sync-pricing-services", { method: "POST" }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
  })
})

/* ─── V1 COST MODEL (GET) ─────────────────────────────────────────────── */

describe("GET /api/v1/cost-model", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await GET_V1_COST_MODEL(makeRequest("/api/v1/cost-model"))
    expect(res.status).toBe(401)
  })

  it("returns aggregated cost model data", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1")
    vi.mocked(prisma.pricingParameters.findUnique).mockResolvedValue({ id: "p1" } as any)
    vi.mocked(prisma.overheadCost.findMany).mockResolvedValue([{ amount: 500, isAnnual: false, hasVat: false }] as any)
    vi.mocked(prisma.costEmployee.findMany).mockResolvedValue([{ superGross: 2000, count: 2, department: "dev" }] as any)
    vi.mocked(prisma.clientService.findMany).mockResolvedValue([{ monthlyRevenue: 3000, serviceType: "helpdesk" }] as any)
    vi.mocked(prisma.company.findMany).mockResolvedValue([{ id: "c1", name: "Acme" }] as any)
    vi.mocked(prisma.deal.groupBy).mockResolvedValue([{ companyId: "c1", _sum: { value: 5000 } }] as any)
    const res = await GET_V1_COST_MODEL(makeRequest("/api/v1/cost-model"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.summary).toBeDefined()
    expect(json.data.summary.totalCost).toBeDefined()
    expect(json.data.summary.totalRevenue).toBeDefined()
  })
})

/* ─── V1 COST MODEL CLIENTS ──────────────────────────────────────────── */

describe("GET /api/v1/cost-model/clients", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await GET_V1_CLIENTS(makeRequest("/api/v1/cost-model/clients"))
    expect(res.status).toBe(401)
  })

  it("returns clients with services", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1")
    vi.mocked(prisma.company.findMany).mockResolvedValue([{ id: "c1", name: "Acme", costCode: "A1", userCount: 5 }] as any)
    vi.mocked(prisma.clientService.findMany).mockResolvedValue([
      { id: "s1", companyId: "c1", serviceType: "helpdesk", monthlyRevenue: 1000, isActive: true },
    ] as any)
    const res = await GET_V1_CLIENTS(makeRequest("/api/v1/cost-model/clients"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.clients).toHaveLength(1)
    expect(json.data.clients[0].totalRevenue).toBe(1000)
  })
})

describe("PUT /api/v1/cost-model/clients", () => {
  it("returns 400 when updates is not an array", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org1", userId: "u1" } as any)
    const res = await PUT_V1_CLIENTS(
      makeRequest("/api/v1/cost-model/clients", { method: "PUT", body: JSON.stringify({ updates: "not-array" }) }),
    )
    expect(res.status).toBe(400)
  })

  it("updates service revenues", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org1", userId: "u1" } as any)
    vi.mocked(prisma.clientService.updateMany).mockResolvedValue({ count: 1 } as any)
    const res = await PUT_V1_CLIENTS(
      makeRequest("/api/v1/cost-model/clients", {
        method: "PUT",
        body: JSON.stringify({ updates: [{ id: "s1", monthlyRevenue: 2000 }] }),
      }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
  })
})
