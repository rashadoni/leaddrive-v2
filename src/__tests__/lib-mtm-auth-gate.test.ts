/**
 * Unit tests for assertMtmAdmin (src/lib/mtm/auth-gate.ts).
 *
 * Regions and teams define managers' territories, so their writes are
 * administrator-only (scope audit 2026-09-14). Before, every web caller passed
 * ("web admin panel: unrestricted") and a mobile MANAGER qualified too.
 *
 *   1. Browser session: web admin/superadmin → allow without a query.
 *   2. Browser session: other web roles → allow only when the user's oldest
 *      ACTIVE MTM card is ADMIN.
 *   3. API key (no session, no JWT) → allow.
 *   4. Mobile JWT: ADMIN only, re-checked in the database (stale JWT → 403).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/mobile-auth", () => ({
  getMobileAuth: vi.fn(),
}))

import { assertMtmAdmin } from "@/lib/mtm/auth-gate"
import { getMobileAuth } from "@/lib/mobile-auth"

function makeDb(result: { id?: string; role?: string } | null) {
  return {
    mtmAgent: {
      findFirst: vi.fn().mockResolvedValue(result),
    },
  }
}

function req(): NextRequest {
  return new NextRequest("http://localhost/api/v1/mtm/regions", { method: "POST" })
}

const ORG = "org-test"

function session(role: string) {
  return { orgId: ORG, userId: "user-1", role, email: "u@example.com", name: "U" } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getMobileAuth).mockReturnValue(null)
})

describe("assertMtmAdmin — browser session", () => {
  it("allows a web admin or superadmin without a database lookup", async () => {
    for (const role of ["admin", "superadmin"]) {
      const db = makeDb(null)
      expect(await assertMtmAdmin(req(), { orgId: ORG, session: session(role) }, db as any)).toBeNull()
      expect(db.mtmAgent.findFirst).not.toHaveBeenCalled()
    }
  })

  it("refuses a web manager whose card is not ADMIN — the old 'web is unrestricted' hole", async () => {
    const db = makeDb({ role: "MANAGER" })
    const result = await assertMtmAdmin(req(), { orgId: ORG, session: session("manager") }, db as any)
    expect(result!.status).toBe(403)
    expect(await result!.json()).toMatchObject({ code: "MTM_STRUCTURE_ADMIN_REQUIRED" })
  })

  it("refuses a web user without any MTM card", async () => {
    const db = makeDb(null)
    const result = await assertMtmAdmin(req(), { orgId: ORG, session: session("sales") }, db as any)
    expect(result!.status).toBe(403)
  })

  it("allows a web user whose oldest ACTIVE card is MTM ADMIN, looked up inside the tenant", async () => {
    const db = makeDb({ role: "ADMIN" })
    expect(await assertMtmAdmin(req(), { orgId: ORG, session: session("manager") }, db as any)).toBeNull()
    expect(db.mtmAgent.findFirst).toHaveBeenCalledWith({
      where: { organizationId: ORG, userId: "user-1", status: "ACTIVE" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { role: true },
    })
  })
})

describe("assertMtmAdmin — API key and mobile JWT", () => {
  it("allows an API key (no session, no JWT) without a lookup", async () => {
    const db = makeDb(null)
    expect(await assertMtmAdmin(req(), { orgId: ORG, session: null }, db as any)).toBeNull()
    expect(db.mtmAgent.findFirst).not.toHaveBeenCalled()
  })

  it.each(["AGENT", "SUPERVISOR", "MANAGER"])("refuses a %s token without a lookup", async (role) => {
    vi.mocked(getMobileAuth).mockReturnValue({ agentId: "a1", role } as any)
    const db = makeDb({ id: "a1" })
    const result = await assertMtmAdmin(req(), { orgId: ORG, session: null }, db as any)
    expect(result!.status).toBe(403)
    expect(db.mtmAgent.findFirst).not.toHaveBeenCalled()
  })

  it("allows an ADMIN token when the database confirms the role in the same tenant", async () => {
    vi.mocked(getMobileAuth).mockReturnValue({ agentId: "a1", role: "ADMIN" } as any)
    const db = makeDb({ id: "a1" })
    expect(await assertMtmAdmin(req(), { orgId: ORG, session: null }, db as any)).toBeNull()
    const call = db.mtmAgent.findFirst.mock.calls[0][0] as any
    expect(call.where).toMatchObject({ id: "a1", organizationId: ORG, role: "ADMIN", status: "ACTIVE" })
  })

  it("refuses a stale ADMIN token the database no longer confirms", async () => {
    vi.mocked(getMobileAuth).mockReturnValue({ agentId: "a1", role: "ADMIN" } as any)
    const db = makeDb(null)
    const result = await assertMtmAdmin(req(), { orgId: ORG, session: null }, db as any)
    expect(result!.status).toBe(403)
    expect(db.mtmAgent.findFirst).toHaveBeenCalledTimes(1)
  })
})
