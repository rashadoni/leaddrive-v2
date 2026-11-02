import { describe, it, expect, vi, beforeEach } from "vitest"
import type { NextRequest } from "next/server"

/**
 * gateChannelsAccess ([P3]) — the browser-admin gate for the channels-config API.
 * Since 2026-10-26 Channels live in Settings for every tenant (owner: «каналы могут
 * использоваться в разных модулях»), so the omni-channel module no longer decides:
 * pass if an authenticated session admin (or superadmin). Else → 401/403.
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

describe("gateChannelsAccess — browser-admin gate, any module", () => {
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

  it("ALLOWS an admin of a tenant WITHOUT the omnichannel module and with no channels yet", async () => {
    state.hasModule = false; state.channelCount = 0
    expect(ok(await gateChannelsAccess(req))).toBe(true)
  })
  it("ALLOWS an admin of a tenant WITH the omnichannel module", async () => {
    state.hasModule = true
    expect(ok(await gateChannelsAccess(req))).toBe(true)
  })
  it("superadmin BYPASSES even without module or channels", async () => {
    state.role = "superadmin"; state.hasModule = false; state.channelCount = 0
    expect(ok(await gateChannelsAccess(req))).toBe(true)
  })
})
