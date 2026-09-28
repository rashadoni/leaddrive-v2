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
import {
  requireWorkforceEvidenceTimelineAccess,
  resolveWorkforceEvidenceDirectoryAccess,
} from "@/lib/workforce/evidence-timeline-access"

const base: Parameters<typeof requireWorkforceEvidenceTimelineAccess>[0] = {
  organizationId: "org-1",
  targetAgentId: "agent-1",
  auth: { principalType: "session", role: "admin", userId: "user-1" },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({ features: [] } as never)
  vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([] as never)
})

describe("Workforce evidence timeline access", () => {
  it("retains only live administrators before granular cutover", async () => {
    await expect(requireWorkforceEvidenceTimelineAccess(base)).resolves.toBeNull()
    const denied = await requireWorkforceEvidenceTimelineAccess({
      ...base,
      auth: { ...base.auth, role: "manager" },
    })
    expect(denied?.status).toBe(403)
  })

  it("requires an exact EVIDENCE_REVIEWER grant after cutover", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      features: ["workforce-granular-access-v1"],
    } as never)
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValueOnce([{
      id: "grant-1",
      organizationId: "org-1",
      principalUserId: "user-1",
      role: "EVIDENCE_REVIEWER",
      scopeKind: "AGENT",
      scopeTeamId: null,
      scopeSiteId: null,
      scopeAgentId: "agent-1",
      effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
      effectiveUntil: null,
      revocation: null,
    }] as never)
    await expect(requireWorkforceEvidenceTimelineAccess(base)).resolves.toBeNull()

    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValueOnce([] as never)
    const denied = await requireWorkforceEvidenceTimelineAccess(base)
    expect(denied?.status).toBe(403)
  })

  it("never admits an API-key principal", async () => {
    const denied = await requireWorkforceEvidenceTimelineAccess({
      ...base,
      auth: { ...base.auth, principalType: "api_key" },
    })
    expect(denied?.status).toBe(403)
    expect(prisma.organization.findUnique).not.toHaveBeenCalled()
  })

  it("returns only organization-wide or exact-agent directory predicates", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      features: ["workforce-granular-access-v1"],
    } as never)
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValueOnce([{
      id: "grant-agent-1",
      organizationId: "org-1",
      principalUserId: "user-1",
      role: "EVIDENCE_REVIEWER",
      scopeKind: "AGENT",
      scopeTeamId: null,
      scopeSiteId: null,
      scopeAgentId: "agent-1",
      effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
      effectiveUntil: null,
      revocation: null,
    }, {
      id: "grant-team-1",
      organizationId: "org-1",
      principalUserId: "user-1",
      role: "EVIDENCE_REVIEWER",
      scopeKind: "TEAM",
      scopeTeamId: "team-1",
      scopeSiteId: null,
      scopeAgentId: null,
      effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
      effectiveUntil: null,
      revocation: null,
    }] as never)

    await expect(resolveWorkforceEvidenceDirectoryAccess({
      organizationId: "org-1",
      auth: base.auth,
    })).resolves.toEqual({ mode: "EXACT_AGENTS", agentIds: ["agent-1"] })

    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValueOnce([{
      id: "grant-org-1",
      organizationId: "org-1",
      principalUserId: "user-1",
      role: "EVIDENCE_REVIEWER",
      scopeKind: "ORGANIZATION",
      scopeTeamId: null,
      scopeSiteId: null,
      scopeAgentId: null,
      effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
      effectiveUntil: null,
      revocation: null,
    }] as never)

    await expect(resolveWorkforceEvidenceDirectoryAccess({
      organizationId: "org-1",
      auth: base.auth,
    })).resolves.toEqual({ mode: "ALL_ACTIVE_AGENTS" })
  })

  it("does not turn team/site evidence grants into a directory oracle", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      features: ["workforce-granular-access-v1"],
    } as never)
    vi.mocked(prisma.workforceAccessGrant.findMany).mockResolvedValue([{
      id: "grant-team-1",
      organizationId: "org-1",
      principalUserId: "user-1",
      role: "EVIDENCE_REVIEWER",
      scopeKind: "TEAM",
      scopeTeamId: "team-1",
      scopeSiteId: null,
      scopeAgentId: null,
      effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
      effectiveUntil: null,
      revocation: null,
    }] as never)

    const denied = await resolveWorkforceEvidenceDirectoryAccess({
      organizationId: "org-1",
      auth: base.auth,
    })
    expect(denied).toBeInstanceOf(Response)
    expect((denied as Response).status).toBe(403)
  })
})
