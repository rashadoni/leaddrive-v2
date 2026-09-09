import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const sessionRole = vi.hoisted(() => ({ value: "manager" }))

const AUTH = {
  orgId: "org-1",
  userId: "user-1",
  role: "manager",
  email: "manager@example.test",
  name: "Manager",
  principalType: "session",
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: vi.fn() },
  },
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: vi.fn((_module, _action, handler) => (req: NextRequest, ctx?: unknown) => handler(req, AUTH, ctx)),
  withRlsSessionAuth: vi.fn((handler) => (req: NextRequest, ctx?: unknown) => handler(req, {
    ...AUTH,
    role: sessionRole.value,
    principalType: "session",
  }, ctx)),
}))

import { prisma } from "@/lib/prisma"
import { withRlsAuth, withRlsSessionAuth } from "@/lib/with-rls"
import {
  withWorkforceRlsAuth,
  withWorkforceSessionAdminAuth,
} from "@/lib/with-workforce-rls-auth"

const request = () => new NextRequest("http://localhost:3000/api/v1/workforce/today")

beforeEach(() => {
  vi.clearAllMocks()
  sessionRole.value = "manager"
})
describe("withWorkforceRlsAuth", () => {
  it("requires the dedicated permission scope and active Workforce capability", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      plan: "enterprise",
      addons: [],
      features: ["workforce-hrm"],
      modules: { "workforce-hrm": true, mtm: false },
    } as never)
    const handler = vi.fn(async () => NextResponse.json({ success: true }))

    const response = await withWorkforceRlsAuth("read", handler)(request())

    expect(response.status).toBe(200)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(withRlsAuth).toHaveBeenCalledWith("workforce", "read", expect.any(Function))
  })

  it("keeps the legacy MTM bundle working until Workforce is explicitly split", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      plan: "enterprise",
      addons: [],
      features: ["mtm"],
      modules: { mtm: true },
    } as never)
    const handler = vi.fn(async () => NextResponse.json({ success: true }))

    const response = await withWorkforceRlsAuth("read", handler)(request())

    expect(response.status).toBe(200)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("fails closed for a Routes-only tenant before the handler can query HRM data", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      plan: "enterprise",
      addons: [],
      features: ["mtm"],
      modules: { mtm: true, "workforce-hrm": false },
    } as never)
    const handler = vi.fn(async () => NextResponse.json({ success: true }))

    const response = await withWorkforceRlsAuth("read", handler)(request())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      code: "TENANT_CAPABILITY_DISABLED",
      capabilityId: "workforce-hrm",
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it("does not fail open if the entitlement lookup fails", async () => {
    vi.mocked(prisma.organization.findUnique).mockRejectedValue(new Error("database unavailable"))
    const handler = vi.fn(async () => NextResponse.json({ success: true }))

    const response = await withWorkforceRlsAuth("read", handler)(request())

    expect(response.status).toBe(503)
    expect(handler).not.toHaveBeenCalled()
  })
})

describe("withWorkforceSessionAdminAuth", () => {
  it("requires a signed-in tenant administrator instead of accepting the API-key write path", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      plan: "enterprise",
      addons: [],
      features: ["workforce-hrm"],
      modules: { "workforce-hrm": true, mtm: false },
    } as never)
    const handler = vi.fn(async () => NextResponse.json({ success: true }))

    const managerResponse = await withWorkforceSessionAdminAuth(handler)(request())

    expect(managerResponse.status).toBe(403)
    await expect(managerResponse.json()).resolves.toMatchObject({ code: "WORKFORCE_POLICY_ADMIN_REQUIRED" })
    expect(handler).not.toHaveBeenCalled()
    expect(withRlsSessionAuth).toHaveBeenCalledTimes(1)
    expect(withRlsAuth).not.toHaveBeenCalled()

    sessionRole.value = "admin"
    const adminResponse = await withWorkforceSessionAdminAuth(handler)(request())

    expect(adminResponse.status).toBe(200)
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
