/**
 * Unit tests for assertMtmAdmin (src/lib/mtm/auth-gate.ts).
 *
 * Covers the three branches directly:
 *   1. No mobile JWT (web admin panel) → null (allow)
 *   2. Phase 1 rejection: JWT role is not admin → 403, no DB hit
 *   3. Phase 2 pass: JWT is admin + DB confirms → null (allow)
 *   4. Phase 2 rejection: JWT claims admin but DB returns null (stale JWT) → 403
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/mobile-auth", () => ({
  getMobileAuth: vi.fn(),
}))

import { assertMtmAdmin } from "@/lib/mtm/auth-gate"
import { getMobileAuth } from "@/lib/mobile-auth"

// Minimal Prisma stub — only mtmAgent.findFirst is needed
function makeDb(result: { id: string } | null) {
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

beforeEach(() => {
  vi.clearAllMocks()
})

describe("assertMtmAdmin", () => {
  it("returns null (allow) when there is no mobile JWT (web admin panel)", async () => {
    vi.mocked(getMobileAuth).mockReturnValue(null)
    const db = makeDb(null)
    const result = await assertMtmAdmin(req(), ORG, db as any)

    expect(result).toBeNull()
    // No DB call needed for web admin panel callers
    expect(db.mtmAgent.findFirst).not.toHaveBeenCalled()
  })

  it("returns 403 (Phase 1) when JWT role is AGENT — no DB hit", async () => {
    vi.mocked(getMobileAuth).mockReturnValue({ agentId: "a1", role: "AGENT" } as any)
    const db = makeDb({ id: "a1" }) // DB would allow, but Phase 1 blocks first
    const result = await assertMtmAdmin(req(), ORG, db as any)

    expect(result).not.toBeNull()
    const body = await result!.json()
    expect(result!.status).toBe(403)
    expect(body.error).toBe("Forbidden")
    // Phase 1 must short-circuit before hitting the DB
    expect(db.mtmAgent.findFirst).not.toHaveBeenCalled()
  })

  it("returns 403 (Phase 1) when JWT role is SUPERVISOR — no DB hit", async () => {
    vi.mocked(getMobileAuth).mockReturnValue({ agentId: "a1", role: "SUPERVISOR" } as any)
    const db = makeDb({ id: "a1" })
    const result = await assertMtmAdmin(req(), ORG, db as any)

    expect(result!.status).toBe(403)
    expect(db.mtmAgent.findFirst).not.toHaveBeenCalled()
  })

  it("returns null (allow) when JWT=ADMIN and DB confirms the role", async () => {
    vi.mocked(getMobileAuth).mockReturnValue({ agentId: "a1", role: "ADMIN" } as any)
    const db = makeDb({ id: "a1" })
    const result = await assertMtmAdmin(req(), ORG, db as any)

    expect(result).toBeNull()
    // DB re-check must be called with org-scoped where clause
    expect(db.mtmAgent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "a1", organizationId: ORG }),
      }),
    )
  })

  it("returns null (allow) when JWT=MANAGER and DB confirms the role", async () => {
    vi.mocked(getMobileAuth).mockReturnValue({ agentId: "a2", role: "MANAGER" } as any)
    const db = makeDb({ id: "a2" })
    const result = await assertMtmAdmin(req(), ORG, db as any)

    expect(result).toBeNull()
  })

  it("returns 403 (Phase 2, stale JWT) when JWT=MANAGER but DB returns null", async () => {
    // Simulates a demoted agent: JWT still claims MANAGER, DB row downgraded
    vi.mocked(getMobileAuth).mockReturnValue({ agentId: "a1", role: "MANAGER" } as any)
    const db = makeDb(null) // DB: agent no longer holds an admin role
    const result = await assertMtmAdmin(req(), ORG, db as any)

    expect(result).not.toBeNull()
    expect(result!.status).toBe(403)
    // DB re-check WAS called (Phase 1 passed, Phase 2 denied)
    expect(db.mtmAgent.findFirst).toHaveBeenCalledTimes(1)
  })

  it("returns 403 (Phase 2, stale JWT) when JWT=ADMIN but DB returns null", async () => {
    vi.mocked(getMobileAuth).mockReturnValue({ agentId: "a1", role: "ADMIN" } as any)
    const db = makeDb(null)
    const result = await assertMtmAdmin(req(), ORG, db as any)

    expect(result!.status).toBe(403)
    expect(db.mtmAgent.findFirst).toHaveBeenCalledTimes(1)
  })

  it("DB re-check WHERE clause includes organizationId (cross-tenant guard)", async () => {
    vi.mocked(getMobileAuth).mockReturnValue({ agentId: "a1", role: "ADMIN" } as any)
    const db = makeDb({ id: "a1" })
    await assertMtmAdmin(req(), ORG, db as any)

    const call = db.mtmAgent.findFirst.mock.calls[0][0] as any
    expect(call.where.organizationId).toBe(ORG)
    expect(call.where.id).toBe("a1")
  })
})
