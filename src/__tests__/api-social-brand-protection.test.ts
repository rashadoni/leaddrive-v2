import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

type AuthContext = { orgId: string; userId: string; role: string }
type RouteHandler = (req: NextRequest, auth: AuthContext) => Promise<Response>

const db = { features: [] as string[] }

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: RouteHandler) =>
    (req: NextRequest) => handler(req, { orgId: "org-1", userId: "user-1", role: "manager" }),
}))

vi.mock("@/lib/social/with-monitoring-mutation-fence", () => ({
  withSocialMonitoringMutationFence: (_module: string, _action: string, handler: RouteHandler) =>
    (req: NextRequest) => handler(req, { orgId: "org-1", userId: "user-1", role: "manager" }),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: vi.fn(async () => ({ features: db.features })) },
    socialAccount: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "acc-1", ...data })),
    },
    monitoringSource: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "src-1", collectorRuns: [], ...data })),
    },
  },
  logAudit: vi.fn(),
}))

vi.mock("@/lib/social/source-route-plan", () => ({
  compileOrganizationSourceRoutePlans: vi.fn(async () => []),
  compileSourceRoutePlans: vi.fn(async () => []),
}))

// Keep monitoring-source decoration/readiness from touching unmocked deps.
vi.mock("@/lib/social/monitoring-source", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/social/monitoring-source")>()
  return {
    ...actual,
    summarizeMonitoringReadiness: () => ({ overall: "needs_setup", steps: [], missing: [] }),
    summarizeSourceHealth: () => ({ state: "needs_setup", due: false }),
    summarizeMonitoringProviderSetup: () => ({}),
    buildMonitoringReadinessEnvironment: () => ({}),
  }
})

import { POST as accountsPost } from "@/app/api/v1/social/accounts/route"
import { POST as sourcesPost } from "@/app/api/v1/social/monitoring-sources/route"

function post(url: string, body: unknown) {
  return new NextRequest(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
}

beforeEach(() => {
  vi.clearAllMocks()
  db.features = []
})

describe("brand-protection-only guards", () => {
  it("allows connecting an owned account by default", async () => {
    db.features = []
    const res = await accountsPost(post("http://localhost/api/v1/social/accounts", { platform: "instagram", handle: "@brand" }))
    expect(res.status).toBe(201)
  })

  it("blocks connecting an owned account in brand-protection-only mode", async () => {
    db.features = ["social_brand_protection_only"]
    const res = await accountsPost(post("http://localhost/api/v1/social/accounts", { platform: "instagram", handle: "@brand" }))
    const json = await res.json()
    expect(res.status).toBe(403)
    expect(json.error).toBe("brand_protection_only")
  })

  it("blocks creating an owned monitoring source in brand-protection-only mode", async () => {
    db.features = ["social_brand_protection_only"]
    const res = await sourcesPost(post("http://localhost/api/v1/social/monitoring-sources", {
      platform: "instagram", sourceType: "profile", handle: "@brand", ownership: "owned",
    }))
    expect(res.status).toBe(403)
  })

  it("still allows creating an external monitoring source in brand-protection-only mode", async () => {
    db.features = ["social_brand_protection_only"]
    const res = await sourcesPost(post("http://localhost/api/v1/social/monitoring-sources", {
      platform: "instagram", sourceType: "search_url", url: "https://instagram.com/competitor", ownership: "external",
    }))
    expect(res.status).toBe(201)
  })
})
