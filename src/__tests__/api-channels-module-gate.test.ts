import { describe, it, expect, vi, beforeEach } from "vitest"
import type { NextRequest } from "next/server"

/**
 * gateChannelsAccess ([P3]) — browser-admin + omni-channel feature gate for the
 * channels-config API, with the GRANDFATHER rule so an existing channel-using
 * tenant is never locked out.
 * Pass if: authenticated admin AND (superadmin OR has omnichannel OR already has
 * ≥1 ChannelConfig). Else → 401/403.
 * Org-scoping at the query layer remains the cross-tenant boundary (tested elsewhere).
 */

const state: { role: string; hasSession: boolean; hasModule: boolean; channelCount: number } = {
  role: "admin", hasSession: true, hasModule: true, channelCount: 0,
}

vi.mock("@/lib/api-auth", () => ({
  requireSessionAuth: vi.fn(async () => state.hasSession
    ? { orgId: "org_1", userId: "user_1", role: state.role }
    : new Response("", { status: 401 })),
  isAuthError: vi.fn((value: unknown) => value instanceof Response),
  orgHasModule: vi.fn(async () => state.hasModule),
  moduleDisabledResponse: vi.fn(() => new Response("", { status: 403 })),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: { channelConfig: { count: vi.fn(async () => state.channelCount) } },
}))

import { gateChannelsAccess } from "@/lib/channels-access"

const req = {} as NextRequest
const blocked = (g: any) => g instanceof Response
const ok = (g: any) => !!g && typeof g === "object" && !(g instanceof Response) && g.orgId === "org_1"

beforeEach(() => {
  vi.clearAllMocks()
  state.role = "admin"
  state.hasSession = true
  state.hasModule = true
  state.channelCount = 0
})

describe("gateChannelsAccess — browser-admin + omnichannel gate", () => {
  it("BLOCKS an API-key/mobile request without a browser session", async () => {
    state.hasSession = false
    const g = await gateChannelsAccess(req)

    expect(blocked(g)).toBe(true)
    expect((g as Response).status).toBe(401)
  })

  it("BLOCKS a non-admin browser session before credential configuration is read", async () => {
    state.role = "sales"
    const g = await gateChannelsAccess(req)

    expect(blocked(g)).toBe(true)
    expect((g as Response).status).toBe(403)
  })

  it("ALLOWS a tenant WITH the omnichannel module", async () => {
    state.hasModule = true
    expect(ok(await gateChannelsAccess(req))).toBe(true)
  })

  it("BLOCKS (403) a non-omnichannel tenant with NO existing channels", async () => {
    state.hasModule = false; state.channelCount = 0
    const g = await gateChannelsAccess(req)
    expect(blocked(g)).toBe(true)
    expect((g as Response).status).toBe(403)
  })

  it("GRANDFATHERS a non-omnichannel tenant that ALREADY has a ChannelConfig (no lockout)", async () => {
    state.hasModule = false; state.channelCount = 1
    expect(ok(await gateChannelsAccess(req))).toBe(true)
  })

  it("superadmin BYPASSES even without module or channels", async () => {
    state.role = "superadmin"; state.hasModule = false; state.channelCount = 0
    expect(ok(await gateChannelsAccess(req))).toBe(true)
  })
})
