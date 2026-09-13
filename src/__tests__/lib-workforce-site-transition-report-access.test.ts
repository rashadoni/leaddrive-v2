import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: vi.fn() },
    workforceAccessGrant: { findMany: vi.fn() },
  },
}))
vi.mock("@/lib/workforce/sensitive-operation-log", () => ({
  logWorkforceSensitiveOperationFailure: vi.fn(),
}))

import { prisma } from "@/lib/prisma"
import { requireWorkforceSiteTransitionReportAccess } from "@/lib/workforce/site-transition-report-access"
import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"

const AUTH = { principalType: "session" as const, role: "admin", userId: "user-1" }

function grant(overrides: Record<string, unknown> = {}) {
  return {
    id: "grant-1",
    organizationId: "org-1",
    principalUserId: "user-1",
    role: "TEAM_MANAGER",
    scopeKind: "SITE",
    scopeTeamId: null,
    scopeSiteId: "site-a",
    scopeAgentId: null,
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveUntil: null,
    revocation: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({ features: [] } as never)
  vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([])
})

describe("requireWorkforceSiteTransitionReportAccess", () => {
  it("preserves the legacy session-admin boundary before granular cutover", async () => {
    await expect(requireWorkforceSiteTransitionReportAccess({
      organizationId: "org-1",
      auth: AUTH,
      selectedAgentId: null,
      selectedSiteId: null,
    })).resolves.toBeNull()

    const denied = await requireWorkforceSiteTransitionReportAccess({
      organizationId: "org-1",
      auth: { ...AUTH, role: "member" },
      selectedAgentId: null,
      selectedSiteId: null,
    })
    expect(denied?.status).toBe(403)
  })

  it("allows only an exact site grant for a selected site after cutover", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      features: ["workforce-granular-access-v1"],
    } as never)
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([grant()] as never)

    await expect(requireWorkforceSiteTransitionReportAccess({
      organizationId: "org-1",
      auth: AUTH,
      selectedAgentId: null,
      selectedSiteId: "site-a",
    })).resolves.toBeNull()
  })

  it("does not widen a team grant into an unfiltered historical aggregate", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      features: ["workforce-granular-access-v1"],
    } as never)
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([grant({
      scopeKind: "TEAM",
      scopeTeamId: "team-a",
      scopeSiteId: null,
    })] as never)

    const response = await requireWorkforceSiteTransitionReportAccess({
      organizationId: "org-1",
      auth: AUTH,
      selectedAgentId: null,
      selectedSiteId: null,
    })
    expect(response?.status).toBe(403)
  })

  it("rejects ambiguous site-and-employee scope before persistence", async () => {
    const response = await requireWorkforceSiteTransitionReportAccess({
      organizationId: "org-1",
      auth: AUTH,
      selectedAgentId: "agent-1",
      selectedSiteId: "site-a",
    })
    expect(response?.status).toBe(403)
    expect(prisma.organization.findUnique).not.toHaveBeenCalled()
  })

  it("fails closed with fixed-label logging when grants cannot be read", async () => {
    vi.mocked(prisma.organization.findUnique).mockRejectedValue(new Error("private db detail"))

    const response = await requireWorkforceSiteTransitionReportAccess({
      organizationId: "org-1",
      auth: AUTH,
      selectedAgentId: null,
      selectedSiteId: null,
    })
    expect(response?.status).toBe(503)
    expect(response?.headers.get("cache-control")).toBe("private, no-store")
    expect(logWorkforceSensitiveOperationFailure).toHaveBeenCalledWith({
      operation: "authorize-site-transition-report",
    })
  })
})
