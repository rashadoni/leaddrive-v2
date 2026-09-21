import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"
import {
  requireTwoFactorToggleUpdate,
  requiresTwoFactorSetup,
  resolveTwoFactorMethod,
} from "@/lib/two-factor-policy"

/**
 * PUT /api/v1/users/[id] with { require2fa } — the save behind the Settings →
 * Users "Require 2FA" switch. The switch used to save `false` for a user who
 * had an authenticator, so mandatory 2FA could not be switched on for them.
 */

type StoredUser = {
  id: string
  organizationId: string
  name: string
  email: string
  role: string
  isActive: boolean
  require2fa: boolean
  totpEnabled: boolean
  smsAuthEnabled: boolean
  verifiedPhone: string | null
}

const state: {
  role: string
  user: StoredUser
  lastUpdate: { where: unknown; data: Record<string, unknown> } | null
} = { role: "admin", user: {} as StoredUser, lastUpdate: null }

const mocks = vi.hoisted(() => ({ logAudit: vi.fn() }))

vi.mock("@/lib/api-auth", () => {
  const session = () => ({ userId: "admin_1", orgId: "org_1", role: state.role, email: "a@b.com", name: "A" })
  return {
    getOrgId: vi.fn(async () => "org_1"),
    getSession: vi.fn(async () => session()),
    requireAuth: vi.fn(async () => session()),
    requireSessionAuth: vi.fn(async () => session()),
    orgHasModule: vi.fn(async () => true),
    moduleDisabledResponse: vi.fn((moduleId: string) =>
      NextResponse.json({ error: "Forbidden", message: `Module "${moduleId}" is not enabled.` }, { status: 403 })),
    isAuthError: vi.fn((value: unknown) => value instanceof NextResponse),
  }
})

vi.mock("@/lib/prisma", () => ({
  logAudit: mocks.logAudit,
  prisma: {
    user: {
      findFirst: vi.fn(async () => state.user),
      findUnique: vi.fn(async () => state.user),
      update: vi.fn(async ({ where, data }: { where: unknown; data: Record<string, unknown> }) => {
        state.lastUpdate = { where, data }
        state.user = { ...state.user, ...data } as StoredUser
        return state.user
      }),
    },
  },
}))

import { PUT } from "@/app/api/v1/users/[id]/route"

function putRequest(body: unknown): NextRequest {
  return new NextRequest("https://example.com/api/v1/users/u1", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function save(body: unknown) {
  return PUT(putRequest(body), { params: Promise.resolve({ id: "u1" }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  state.role = "admin"
  state.lastUpdate = null
  state.user = {
    id: "u1",
    organizationId: "org_1",
    name: "Manager",
    email: "manager@b.com",
    role: "manager",
    isActive: true,
    require2fa: false,
    totpEnabled: true,
    smsAuthEnabled: false,
    verifiedPhone: null,
  }
})

describe("PUT /api/v1/users/[id] — require2fa", () => {
  it("stores the requirement the switch sends for a user who already has an authenticator", async () => {
    const response = await save(requireTwoFactorToggleUpdate(state.user))

    expect(response.status).toBe(200)
    expect(state.lastUpdate?.data).toMatchObject({ require2fa: true, passwordChangedAt: expect.any(Date) })
    // The enrolled factor is left as it is.
    expect(state.lastUpdate?.data.totpEnabled).toBeUndefined()
    expect(resolveTwoFactorMethod(state.user)).toBe("totp")
    expect(requiresTwoFactorSetup(state.user)).toBe(false)
    expect(mocks.logAudit).toHaveBeenCalledWith("org_1", "user_updated", "user", "u1", "manager@b.com", expect.objectContaining({
      oldValue: { require2fa: false },
      newValue: { require2fa: true, sessionsInvalidated: true },
    }))
  })

  it("turns the requirement off again", async () => {
    state.user.require2fa = true
    const response = await save(requireTwoFactorToggleUpdate(state.user))

    expect(response.status).toBe(200)
    expect(state.lastUpdate?.data.require2fa).toBe(false)
  })

  it("requires setup at the next sign-in when the user has no factor, as before", async () => {
    state.user.totpEnabled = false
    const response = await save({ require2fa: true })

    expect(response.status).toBe(200)
    expect(state.lastUpdate?.data.require2fa).toBe(true)
    expect(requiresTwoFactorSetup(state.user)).toBe(true)
  })

  it.each(["manager", "sales", "support", "viewer"])("refuses a %s: only an administrator may change it", async (role) => {
    state.role = role
    const response = await save({ require2fa: true })

    expect(response.status).toBe(403)
    expect(state.lastUpdate).toBeNull()
    expect(mocks.logAudit).not.toHaveBeenCalled()
  })
})
