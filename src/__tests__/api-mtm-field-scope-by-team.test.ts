/**
 * Field scope inside one organization (audit 2026-09-14).
 *
 * RLS separates tenants, not teams. The photo gallery and the alert list were
 * returning the whole company to every manager — and to a field agent's app
 * token — and any web user with MTM write could close or delete other teams'
 * alerts. These tests pin the scope each principal gets:
 *   - web admin → organization-wide;
 *   - manager/supervisor → rows of agents in their scope only;
 *   - field agent token → only themselves (and no alert review);
 *   - web user without an MTM card → MTM_FIELD_SCOPE_REQUIRED.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

vi.mock("@/lib/mtm/route-permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mtm/route-permissions")>()
  return { ...actual, resolveMtmRouteActor: vi.fn() }
})

vi.mock("@/lib/mtm-audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mtm-audit")>("@/lib/mtm-audit")
  return { ...actual, writeMtmAudit: vi.fn(() => Promise.resolve()) }
})

vi.mock("heic-convert", () => ({ default: vi.fn() }))

import { GET as ListPhotos } from "@/app/api/v1/mtm/photos/route"
import { GET as ListAlerts } from "@/app/api/v1/mtm/alerts/route"
import { PATCH as UpdateAlert, DELETE as DeleteAlert } from "@/app/api/v1/mtm/alerts/[id]/route"
import { prisma } from "@/lib/prisma"
import { resetMtmFieldScopeMemo } from "@/lib/mtm/field-access"
import { requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"

const ORG = "org-1"
const MANAGER_SCOPE = ["mgr-1", "agent-1", "agent-2"]
const WEB = { orgId: ORG, email: "user@example.com", name: "User" }

function req(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(new URL(url, "http://localhost:3000"), init)
}

function patch(id: string, body: unknown) {
  return UpdateAlert(
    req(`/api/v1/mtm/alerts/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  )
}

function remove(id: string) {
  return DeleteAlert(req(`/api/v1/mtm/alerts/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) })
}

function asWebAdmin() {
  vi.mocked(requireAuth).mockResolvedValue({ ...WEB, userId: "admin-user", role: "admin" } as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: null, role: "ADMIN", scopedAgentIds: null })
}

function asWebManager() {
  vi.mocked(requireAuth).mockResolvedValue({ ...WEB, userId: "manager-user", role: "manager" } as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: "mgr-1", role: "MANAGER", scopedAgentIds: MANAGER_SCOPE })
}

function asWebManagerWithoutCard() {
  vi.mocked(requireAuth).mockResolvedValue({ ...WEB, userId: "manager-user", role: "manager" } as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue(null)
}

function asAgentToken() {
  const mobile = {
    orgId: ORG,
    agentId: "agent-9",
    userId: "agent-user",
    role: "AGENT",
    email: "agent@example.com",
    name: "Agent",
    tenantCapabilities: { routeField: true, workforceHrm: true },
  }
  vi.mocked(getMobileAuth).mockReturnValue(mobile as never)
  vi.mocked(resolveMobileAuth).mockResolvedValue(mobile as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: "agent-9", role: "AGENT", scopedAgentIds: ["agent-9"] })
}

beforeEach(() => {
  vi.clearAllMocks()
  // Route tests reuse user ids with different cards; never serve a memoized actor.
  resetMtmFieldScopeMemo()
  vi.mocked(getMobileAuth).mockReturnValue(null)
  vi.mocked(resolveMobileAuth).mockResolvedValue(null)
  vi.mocked(prisma.organization.findFirst).mockResolvedValue({
    id: ORG,
    plan: "enterprise",
    addons: [],
    features: ["mtm"],
    modules: { mtm: true, "route-field": true },
  } as never)
  vi.mocked(prisma.mtmPhoto.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.mtmPhoto.count).mockResolvedValue(0)
  vi.mocked(prisma.mtmAlert.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.mtmAlert.count).mockResolvedValue(0)
  vi.mocked(prisma.mtmAlert.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.mtmAlert.updateMany).mockResolvedValue({ count: 1 } as never)
  vi.mocked(prisma.mtmAlert.deleteMany).mockResolvedValue({ count: 1 } as never)
})

describe("GET /api/v1/mtm/photos — field scope", () => {
  it("shows a manager only photos of their agents or taken on their agents' visits", async () => {
    asWebManager()
    const res = await ListPhotos(req("/api/v1/mtm/photos?limit=200"))
    expect(res.status).toBe(200)
    const where = (vi.mocked(prisma.mtmPhoto.findMany).mock.calls[0][0] as any).where
    expect(where.organizationId).toBe(ORG)
    expect(where.OR).toEqual([
      { agentId: { in: MANAGER_SCOPE } },
      { visit: { is: { agentId: { in: MANAGER_SCOPE } } } },
    ])
    expect((vi.mocked(prisma.mtmPhoto.count).mock.calls[0][0] as any).where).toEqual(where)
  })

  it("limits a field agent's token to their own photos", async () => {
    asAgentToken()
    const res = await ListPhotos(req("/api/v1/mtm/photos", { headers: { authorization: "Bearer token" } }))
    expect(res.status).toBe(200)
    const where = (vi.mocked(prisma.mtmPhoto.findMany).mock.calls[0][0] as any).where
    expect(where.OR).toEqual([
      { agentId: { in: ["agent-9"] } },
      { visit: { is: { agentId: { in: ["agent-9"] } } } },
    ])
  })

  it("rejects an agent filter outside the scope", async () => {
    asWebManager()
    const res = await ListPhotos(req("/api/v1/mtm/photos?agentId=agent-other-team"))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: "MTM_AGENT_OUT_OF_SCOPE" })
    expect(prisma.mtmPhoto.findMany).not.toHaveBeenCalled()
  })

  it("keeps an administrator's gallery organization-wide", async () => {
    asWebAdmin()
    await ListPhotos(req("/api/v1/mtm/photos?agentId=agent-other-team"))
    const where = (vi.mocked(prisma.mtmPhoto.findMany).mock.calls[0][0] as any).where
    expect(where).toEqual({ organizationId: ORG, agentId: "agent-other-team" })
  })

  it("refuses a web manager without an MTM card instead of returning the company", async () => {
    asWebManagerWithoutCard()
    const res = await ListPhotos(req("/api/v1/mtm/photos"))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: "MTM_FIELD_SCOPE_REQUIRED" })
    expect(prisma.mtmPhoto.findMany).not.toHaveBeenCalled()
  })
})

describe("/api/v1/mtm/alerts — field scope", () => {
  it("lists a manager's agents' alerts only", async () => {
    asWebManager()
    const res = await ListAlerts(req("/api/v1/mtm/alerts?limit=200&resolved=false"))
    expect(res.status).toBe(200)
    const where = (vi.mocked(prisma.mtmAlert.findMany).mock.calls[0][0] as any).where
    expect(where).toEqual({ organizationId: ORG, agentId: { in: MANAGER_SCOPE }, isResolved: false })
  })

  it("lists only an agent token's own alerts", async () => {
    asAgentToken()
    await ListAlerts(req("/api/v1/mtm/alerts", { headers: { authorization: "Bearer token" } }))
    expect((vi.mocked(prisma.mtmAlert.findMany).mock.calls[0][0] as any).where.agentId).toEqual({ in: ["agent-9"] })
  })

  it("refuses the list to a web manager without an MTM card", async () => {
    asWebManagerWithoutCard()
    const res = await ListAlerts(req("/api/v1/mtm/alerts"))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: "MTM_FIELD_SCOPE_REQUIRED" })
  })

  it("does not let a manager resolve or delete another team's alert", async () => {
    asWebManager()
    const resolved = await patch("alert-other", { isResolved: true })
    expect(resolved.status).toBe(404)
    expect((vi.mocked(prisma.mtmAlert.findFirst).mock.calls[0][0] as any).where)
      .toEqual({ id: "alert-other", organizationId: ORG, agentId: { in: MANAGER_SCOPE } })
    expect(prisma.mtmAlert.updateMany).not.toHaveBeenCalled()

    const deleted = await remove("alert-other")
    expect(deleted.status).toBe(404)
    expect(prisma.mtmAlert.deleteMany).not.toHaveBeenCalled()
  })

  it("lets a manager resolve an alert of their agent, fenced again at write time", async () => {
    asWebManager()
    vi.mocked(prisma.mtmAlert.findFirst).mockResolvedValue({ id: "alert-1", type: "LATE_START", isResolved: false, agentId: "agent-1" } as never)
    const res = await patch("alert-1", { isResolved: true })
    expect(res.status).toBe(200)
    expect((vi.mocked(prisma.mtmAlert.updateMany).mock.calls[0][0] as any).where)
      .toEqual({ id: "alert-1", organizationId: ORG, agentId: { in: MANAGER_SCOPE } })
  })

  it("does not let a field agent's token close or delete alerts, even their own", async () => {
    asAgentToken()
    vi.mocked(prisma.mtmAlert.findFirst).mockResolvedValue({ id: "alert-own", type: "LATE_START", isResolved: false, agentId: "agent-9" } as never)
    const resolved = await patch("alert-own", { isResolved: true })
    expect(resolved.status).toBe(403)
    expect(await resolved.json()).toMatchObject({ code: "MTM_ALERT_REVIEW_FORBIDDEN" })
    const deleted = await remove("alert-own")
    expect(deleted.status).toBe(403)
    expect(prisma.mtmAlert.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmAlert.deleteMany).not.toHaveBeenCalled()
  })

  it("refuses alert writes to a web manager without an MTM card", async () => {
    asWebManagerWithoutCard()
    const res = await patch("alert-1", { isResolved: true })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: "MTM_FIELD_SCOPE_REQUIRED" })
  })

  it("keeps alert review organization-wide for an administrator", async () => {
    asWebAdmin()
    vi.mocked(prisma.mtmAlert.findFirst).mockResolvedValue({ id: "alert-x", type: "LATE_START", title: "Late", agentId: "anyone" } as never)
    const res = await remove("alert-x")
    expect(res.status).toBe(200)
    expect((vi.mocked(prisma.mtmAlert.deleteMany).mock.calls[0][0] as any).where).toEqual({ id: "alert-x", organizationId: ORG })
  })
})
