import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

/**
 * GET/PATCH /api/v1/users/me — self-service personal-cabinet profile.
 * Mirrors the api-users-reset-sms mocking style: a shared `state` object the
 * prisma + api-auth mocks read from, flipped per test.
 */

const state: {
  authOk: boolean
  user: any
  lastUpdate: any
  updateCount: number
} = {
  authOk: true,
  user: null,
  lastUpdate: null,
  updateCount: 1,
}

vi.mock("@/lib/api-auth", () => ({
  requireSessionAuth: vi.fn(async () => {
    if (!state.authOk) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    return { userId: "u1", orgId: "org_1", role: "sales", email: "me@b.com", name: "Me" }
  }),
  isAuthError: vi.fn((x: any) => x instanceof NextResponse),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findFirst: vi.fn(async () => state.user),
      updateMany: vi.fn(async ({ where, data }: any) => {
        state.lastUpdate = { where, data }
        if (state.updateCount > 0) state.user = { ...state.user, ...data }
        return { count: state.updateCount }
      }),
    },
  },
}))

import { GET, PATCH } from "@/app/api/v1/users/me/route"

function getReq(): NextRequest {
  return new NextRequest("https://example.com/api/v1/users/me", { method: "GET" })
}
function patchReq(body: any): NextRequest {
  return new NextRequest("https://example.com/api/v1/users/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  state.authOk = true
  state.lastUpdate = null
  state.updateCount = 1
  state.user = {
    id: "u1",
    organizationId: "org_1",
    name: "Me",
    email: "me@b.com",
    phone: "+994500000000",
    department: "Sales",
    avatar: null,
    preferredLanguage: "en",
    timezone: "Europe/Warsaw",
    role: "sales",
    totpEnabled: false,
    smsAuthEnabled: false,
    lastLogin: null,
    loginCount: 3,
    // secret fields that MUST NOT leak — present on the row, absent from select
    passwordHash: "H(secret)",
    totpSecret: "JBSWY3DPEHPK3PXP",
    backupCodes: "[]",
  }
  vi.clearAllMocks()
})

describe("GET /api/v1/users/me", () => {
  it("returns the caller's profile without secret fields", async () => {
    const res = await GET(getReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    // NOTE: the mock returns state.user verbatim (no real `select` projection),
    // so we assert the route asked prisma for the safe select — that's where the
    // projection is enforced in production.
    const { prisma } = (await import("@/lib/prisma")) as any
    const call = prisma.user.findFirst.mock.calls[0][0]
    expect(call.where).toEqual({ id: "u1", organizationId: "org_1" })
    expect(call.select.passwordHash).toBeUndefined()
    expect(call.select.totpSecret).toBeUndefined()
    expect(call.select.backupCodes).toBeUndefined()
    expect(call.select.email).toBe(true)
    expect(call.select.name).toBe(true)
  })

  it("returns 404 when the row is missing", async () => {
    state.user = null
    const res = await GET(getReq())
    expect(res.status).toBe(404)
  })

  it("returns 401 when unauthenticated", async () => {
    state.authOk = false
    const res = await GET(getReq())
    expect(res.status).toBe(401)
  })
})

describe("PATCH /api/v1/users/me", () => {
  it("updates name and phone, scoped to the caller's row", async () => {
    const res = await PATCH(patchReq({ name: "New Name", phone: "+994511111111" }))
    expect(res.status).toBe(200)
    expect(state.lastUpdate.where).toEqual({ id: "u1", organizationId: "org_1" })
    expect(state.lastUpdate.data).toEqual({ name: "New Name", phone: "+994511111111" })
  })

  it("allows nulling out an optional field", async () => {
    const res = await PATCH(patchReq({ phone: null, department: null }))
    expect(res.status).toBe(200)
    expect(state.lastUpdate.data).toEqual({ phone: null, department: null })
  })

  it("normalizes a formatted international phone", async () => {
    const res = await PATCH(patchReq({
      phone: "+994 (50) 123-45-67",
    }))
    expect(res.status).toBe(200)
    expect(state.lastUpdate.data).toEqual({
      phone: "+994501234567",
    })
  })

  it.each([
    "sasaas23434t@gmail.comerg",
    "fresh@example.com",
    "not-an-email",
  ])("rejects every unverified self-service email change %s", async (email) => {
    const res = await PATCH(patchReq({ email }))
    expect(res.status).toBe(400)
    expect(state.lastUpdate).toBeNull()
  })

  it.each([
    "994501234567",
    "+0123456789",
    "+12345",
    "+1234567890123456",
    "+99450CALLME",
  ])("rejects non-E.164 profile phone %s", async (phone) => {
    const res = await PATCH(patchReq({ phone }))
    expect(res.status).toBe(400)
    expect(state.lastUpdate).toBeNull()
  })

  it("rejects a forbidden field (role) with 400 and never writes it", async () => {
    const res = await PATCH(patchReq({ name: "X", role: "admin" }))
    expect(res.status).toBe(400)
    expect(state.lastUpdate).toBeNull()
  })

  it("rejects an invalid preferredLanguage with 400", async () => {
    const res = await PATCH(patchReq({ preferredLanguage: "fr" }))
    expect(res.status).toBe(400)
  })

  it("returns 401 when unauthenticated", async () => {
    state.authOk = false
    const res = await PATCH(patchReq({ name: "X" }))
    expect(res.status).toBe(401)
  })
})
