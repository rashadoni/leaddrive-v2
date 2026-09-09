import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

/**
 * Admin can reset a user's SMS 2FA via PUT /api/v1/users/[id] with { resetSms: true }.
 * Useful when a user loses their phone — they can no longer receive codes, so
 * an admin flips smsAuthEnabled back to false. The verifiedPhone is kept on
 * the record so the user can re-enable without re-verifying.
 */

const state: { authOk: boolean; user: any; lastUpdate: any } = {
  authOk: true,
  user: null,
  lastUpdate: null,
}

import { NextResponse } from "next/server"

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

vi.mock("@/lib/prisma", () => ({
  logAudit: vi.fn(),
  prisma: {
    user: {
      findFirst: vi.fn(async () => state.user),
      findUnique: vi.fn(async () => state.user),
      update: vi.fn(async ({ where, data }: any) => {
        state.lastUpdate = { where, data }
        state.user = { ...state.user, ...data }
        return state.user
      }),
      delete: vi.fn(),
    },
  },
}))

vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn(async (p: string) => `H(${p})`) },
}))

import { PUT } from "@/app/api/v1/users/[id]/route"

function putReq(body: any): NextRequest {
  return new NextRequest("https://example.com/api/v1/users/u1", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  state.authOk = true
  state.lastUpdate = null
  state.user = {
    id: "u1",
    organizationId: "org_1",
    name: "Victim",
    email: "v@b.com",
    role: "viewer",
    smsAuthEnabled: true,
    verifiedPhone: "+994512060838",
    totpEnabled: false,
    isActive: true,
  }
  vi.clearAllMocks()
})

describe("PUT /api/v1/users/[id] — resetSms", () => {
  it("flips smsAuthEnabled=false but keeps verifiedPhone", async () => {
    const res = await PUT(putReq({ resetSms: true }), { params: Promise.resolve({ id: "u1" }) })

    expect(res.status).toBe(200)
    expect(state.lastUpdate.data.smsAuthEnabled).toBe(false)
    expect(state.lastUpdate.data.passwordChangedAt).toEqual(expect.any(Date))
    // verifiedPhone NOT cleared — user can re-enable without re-verifying
    expect(state.lastUpdate.data.verifiedPhone).toBeUndefined()
  })

  it("does nothing when resetSms is not provided", async () => {
    await PUT(putReq({ name: "Renamed" }), { params: Promise.resolve({ id: "u1" }) })
    expect(state.lastUpdate.data.smsAuthEnabled).toBeUndefined()
    expect(state.lastUpdate.data.passwordChangedAt).toBeUndefined()
  })

  it("both resets can be combined in a single request", async () => {
    state.user.totpEnabled = true
    await PUT(putReq({ resetTotp: true, resetSms: true }), { params: Promise.resolve({ id: "u1" }) })

    expect(state.lastUpdate.data.totpEnabled).toBe(false)
    expect(state.lastUpdate.data.smsAuthEnabled).toBe(false)
  })

  it("401 when not authenticated", async () => {
    state.authOk = false
    const res = await PUT(putReq({ resetSms: true }), { params: Promise.resolve({ id: "u1" }) })
    expect(res.status).toBe(401)
  })
})
