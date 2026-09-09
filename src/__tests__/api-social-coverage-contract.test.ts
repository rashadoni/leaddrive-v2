import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import type { CapabilityInventoryResult } from "@/lib/social/capability-inventory-source"

type Auth = { orgId: string; userId: string; role: string }
type Handler = (request: NextRequest, auth: Auth) => Promise<Response>

const getCapabilityInventory = vi.hoisted(() => vi.fn())

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: Handler) => (request: NextRequest) =>
    handler(request, { orgId: "org-1", userId: "admin-1", role: "admin" }),
}))
vi.mock("@/lib/social/capability-inventory-source", () => ({ getCapabilityInventory }))

import { GET } from "@/app/api/v1/social/coverage-contract/route"

const inventory: CapabilityInventoryResult = {
  version: "social-monitoring-cr0-v2",
  generatedAt: "2026-07-12T00:00:00.000Z",
  organizationId: "org-1",
  organizationName: "Acme",
  summary: {
    total: 2,
    byStatus: { IMPLEMENTED: 1, CONFIGURED: 0, SANDBOX_VERIFIED: 0, PRODUCTION_VERIFIED: 0, BLOCKED: 1 },
    sellableRouteCount: 0,
    liveSendReadyCount: 0,
  },
  rows: [
    {
      platform: "instagram", capability: "READ_OWNED_COMMENTS", kind: "READ", ownership: "OWNED",
      contentScope: "OWNED", status: "IMPLEMENTED", canonicalAdapter: "META_GRAPH", engagementMode: "NO_ACTION",
      senderIdentity: "Подключённый Instagram professional account", readScope: "owned comments",
      historicalDepth: "since connection", latency: "webhook <5m", limitation: "only owned media",
      nextStep: "connect account", officialDocs: [], proof: null,
      routes: { activeCount: 0, degradedCount: 0, blockedCount: 0, acquisitionModes: [] }, liveSendReady: false,
    },
    {
      platform: "twitter", capability: "DISCOVER_POSTS", kind: "DISCOVER", ownership: "EXTERNAL",
      contentScope: "PUBLIC", status: "BLOCKED", canonicalAdapter: "X_API", engagementMode: "NO_ACTION",
      senderIdentity: "n/a", readScope: "search", historicalDepth: "tier", latency: "poll",
      limitation: "paid tier required", nextStep: "buy paid tier", officialDocs: [], proof: null,
      routes: { activeCount: 0, degradedCount: 0, blockedCount: 0, acquisitionModes: [] }, liveSendReady: false,
    },
  ],
}

function request(path: string) {
  return new NextRequest(`http://localhost${path}`, { method: "GET" })
}

beforeEach(() => {
  vi.clearAllMocks()
  getCapabilityInventory.mockResolvedValue(inventory)
})

describe("GET /api/v1/social/coverage-contract", () => {
  it("returns the machine-readable inventory as JSON by default", async () => {
    const res = await GET(request("/api/v1/social/coverage-contract"))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("application/json")
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.organizationName).toBe("Acme")
    expect(body.data.rows).toHaveLength(2)
    expect(getCapabilityInventory).toHaveBeenCalledWith("org-1")
  })

  it("renders a downloadable markdown coverage contract from the same data", async () => {
    const res = await GET(request("/api/v1/social/coverage-contract?format=markdown"))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/markdown")
    expect(res.headers.get("content-disposition")).toContain("coverage-contract-2026-07-12.md")
    const text = await res.text()
    expect(text).toContain("# Coverage contract")
    expect(text).toContain("Acme")
    expect(text).toContain("## Instagram")
    expect(text).toContain("Live-отправка выключена")
    expect(text).toContain("otherwise unrelated, undiscovered video are not discoverable")
  })
})
