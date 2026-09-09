import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { NextResponse } from "next/server"

/**
 * Role validation for user create/update.
 *
 * Two invariants:
 *  1. Editing a user who already holds an extended/custom role (e.g. the
 *     built-in "marketing") must NOT fail — regression guard for the reported
 *     bug where PUT /users/[id] hard-coded a 4-value enum and rejected the
 *     form's re-sent current role. The route skips role validation when the
 *     role is unchanged.
 *  2. NEWLY assigning a role only succeeds for roles the permission engine
 *     enforces (admin/manager/sales/support/viewer). Extended/custom roles
 *     resolve to deny-all in checkPermission(), so assigning them is blocked to
 *     avoid silently locking the user out. superadmin is never assignable.
 */

const state: { authOk: boolean; user: any; lastUpdate: any; lastCreate: any } = {
  authOk: true, user: null, lastUpdate: null, lastCreate: null,
}

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(async () => (state.authOk ? "org_1" : null)),
  getSession: vi.fn(async () =>
    state.authOk ? { userId: "admin_1", orgId: "org_1", role: "admin", email: "a@b.com", name: "A" } : null
  ),
  requireAuth: vi.fn(async () => {
    if (!state.authOk) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    return { userId: "admin_1", orgId: "org_1", role: "admin", email: "a@b.com", name: "A" }
  }),
  requireSessionAuth: vi.fn(async () => {
    if (!state.authOk) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    return { userId: "admin_1", orgId: "org_1", role: "admin", email: "a@b.com", name: "A" }
  }),
  orgHasModule: vi.fn(async () => true),
  moduleDisabledResponse: vi.fn((moduleId: string) =>
    NextResponse.json({ error: "Forbidden", message: `Module "${moduleId}" is not enabled.` }, { status: 403 })),
  isAuthError: vi.fn((x: any) => x instanceof NextResponse),
}))

vi.mock("@/lib/plan-limits", () => ({ checkUserLimit: vi.fn(async () => ({ allowed: true })) }))

vi.mock("@/lib/prisma", () => ({
  logAudit: vi.fn(),
  prisma: {
    user: {
      findFirst: vi.fn(async () => state.user),
      findUnique: vi.fn(async () => state.user),
      update: vi.fn(async ({ where, data }: any) => {
        state.lastUpdate = { where, data }
        return { ...state.user, ...data }
      }),
      create: vi.fn(async ({ data }: any) => {
        state.lastCreate = data
        return { id: "new_1", ...data }
      }),
    },
  },
}))

vi.mock("bcryptjs", () => ({ default: { hash: vi.fn(async (p: string) => `H(${p})`) } }))

import { PUT } from "@/app/api/v1/users/[id]/route"
import { POST } from "@/app/api/v1/users/route"
import { logAudit, prisma } from "@/lib/prisma"

function putReq(body: any): NextRequest {
  return new NextRequest("https://example.com/api/v1/users/u1", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  })
}
function postReq(body: any): NextRequest {
  return new NextRequest("https://example.com/api/v1/users", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  })
}
const params = { params: Promise.resolve({ id: "u1" }) }

beforeEach(() => {
  state.authOk = true
  state.lastUpdate = null
  state.lastCreate = null
  state.user = {
    id: "u1", organizationId: "org_1", name: "Mehriban", email: "m@azmade.az", role: "viewer", isActive: true,
  }
  vi.clearAllMocks()
})

describe("PUT /api/v1/users/[id] — role validation", () => {
  it("rejects password changes through the general edit endpoint", async () => {
    const res = await PUT(putReq({ name: "Mehriban", password: "Valid-Test-Pass-2026!" }), params)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toContain("reset-password")
    expect(state.lastUpdate).toBeNull()
  })

  it("audits who disabled the selected user", async () => {
    const res = await PUT(putReq({ isActive: false }), params)

    expect(res.status).toBe(200)
    expect(logAudit).toHaveBeenCalledWith(
      "org_1",
      "user_deactivated",
      "user",
      "u1",
      "m@azmade.az",
      expect.objectContaining({
        userId: "admin_1",
        oldValue: expect.objectContaining({ isActive: true }),
        newValue: expect.objectContaining({ isActive: false }),
      }),
    )
  })

  it("edits a user who already holds 'marketing' without failing (the reported bug)", async () => {
    state.user.role = "marketing" // form re-sends the current role on every save
    const res = await PUT(putReq({ role: "marketing", phone: "+994501234567" }), params)
    expect(res.status).toBe(200)
    expect(state.lastUpdate.data.phone).toBe("+994501234567")
  })

  it("allows changing to an enforce-able role (manager)", async () => {
    const res = await PUT(putReq({ role: "manager" }), params)
    expect(res.status).toBe(200)
    expect(state.lastUpdate.data.role).toBe("manager")
    expect(state.lastUpdate.data.passwordChangedAt).toEqual(expect.any(Date))
  })

  it("does not revoke sessions for an ordinary profile-only edit", async () => {
    const res = await PUT(putReq({ name: "Renamed" }), params)
    expect(res.status).toBe(200)
    expect(state.lastUpdate.data.passwordChangedAt).toBeUndefined()
  })

  it("blocks newly assigning a deny-all role (marketing)", async () => {
    const res = await PUT(putReq({ role: "marketing" }), params)
    expect(res.status).toBe(400)
    expect(state.lastUpdate).toBeNull()
  })

  it("rejects an unknown role", async () => {
    const res = await PUT(putReq({ role: "wizard" }), params)
    expect(res.status).toBe(400)
    expect(state.lastUpdate).toBeNull()
  })

  it("blocks privilege escalation to superadmin", async () => {
    const res = await PUT(putReq({ role: "superadmin" }), params)
    expect(res.status).toBe(400)
    expect(state.lastUpdate).toBeNull()
  })

  it("keeps an existing legacy/custom role while editing other fields", async () => {
    state.user.role = "legacy_role"
    const res = await PUT(putReq({ role: "legacy_role", name: "Renamed" }), params)
    expect(res.status).toBe(200)
    expect(state.lastUpdate.data.name).toBe("Renamed")
  })

  it("normalizes administrator-edited email and rejects non-E.164 phone values", async () => {
    vi.mocked(prisma.user.findFirst)
      .mockResolvedValueOnce(state.user)
      .mockResolvedValueOnce(null)
    const normalized = await PUT(putReq({ email: "  NEW.User@Example.COM  ", phone: "" }), params)
    expect(normalized.status).toBe(200)
    expect(state.lastUpdate.data.email).toBe("new.user@example.com")
    expect(state.lastUpdate.data.phone).toBeNull()

    state.lastUpdate = null
    const invalid = await PUT(putReq({ phone: "+0000000" }), params)
    expect(invalid.status).toBe(400)
    expect(state.lastUpdate).toBeNull()
  })
})

describe("POST /api/v1/users — role validation", () => {
  beforeEach(() => { state.user = null })

  it("creates a user with an enforce-able role (manager)", async () => {
    const res = await POST(postReq({ name: "Bob", email: "bob@x.az", password: "SecurePass123!", role: "manager" }))
    expect(res.status).toBe(201)
    expect(state.lastCreate.role).toBe("manager")
  })

  it("rejects a deny-all role (marketing) with 400 — no silent coercion to sales", async () => {
    const res = await POST(postReq({ name: "Bob", email: "bob@x.az", password: "SecurePass123!", role: "marketing" }))
    expect(res.status).toBe(400)
    expect(state.lastCreate).toBeNull()
  })

  it("rejects an unknown role with 400", async () => {
    const res = await POST(postReq({ name: "Bob", email: "bob@x.az", password: "SecurePass123!", role: "wizard" }))
    expect(res.status).toBe(400)
    expect(state.lastCreate).toBeNull()
  })

  it("defaults an absent role to least-privilege viewer", async () => {
    const res = await POST(postReq({ name: "Bob", email: "bob@x.az", password: "SecurePass123!" }))
    expect(res.status).toBe(201)
    expect(state.lastCreate.role).toBe("viewer")
  })

  it("normalizes a valid email and persists only canonical E.164 phone values", async () => {
    const res = await POST(postReq({
      name: " Bob ",
      email: "  BOB@Example.COM  ",
      password: "SecurePass123!",
      phone: "+994501234567",
    }))

    expect(res.status).toBe(201)
    expect(state.lastCreate).toEqual(expect.objectContaining({
      name: "Bob",
      email: "bob@example.com",
      phone: "+994501234567",
    }))
  })

  it.each([
    ["not-an-email", "+994501234567"],
    ["bob@example.com", "994501234567"],
    ["bob@example.com", "+0000000"],
    ["bob@example.com", "+994 50 123 45 67"],
  ])("rejects invalid contact fields (%s, %s)", async (email, phone) => {
    const res = await POST(postReq({
      name: "Bob",
      email,
      password: "SecurePass123!",
      phone,
    }))

    expect(res.status).toBe(400)
    expect(state.lastCreate).toBeNull()
  })
})
