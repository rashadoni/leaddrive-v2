/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextResponse } from "next/server"

const mocks = vi.hoisted(() => ({
  organization: vi.fn(),
  audit: vi.fn(),
  user: vi.fn(),
  entitlement: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findFirst: mocks.organization },
    auditLog: { findFirst: mocks.audit },
    user: { findFirst: mocks.user },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn((value: unknown) => value instanceof NextResponse),
}))

vi.mock("@/lib/ai/support-settings-access", () => ({
  isSupportAiSettingsRole: vi.fn((role: string) => role === "admin" || role === "superadmin"),
  hasSupportAiSettingsEntitlement: mocks.entitlement,
}))

import { requireAuth } from "@/lib/api-auth"
import { GET } from "@/app/api/v1/support/ai-settings/route"

const AUTH = {
  orgId: "org-1",
  userId: "user-1",
  role: "admin",
  email: "admin@example.com",
  name: "Admin",
}

function request() {
  return new Request("http://localhost/api/v1/support/ai-settings") as any
}

describe("GET /api/v1/support/ai-settings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAuth).mockResolvedValue(AUTH as any)
    mocks.entitlement.mockResolvedValue(true)
    mocks.organization.mockResolvedValue({
      id: "org-1",
      name: "Acme",
      features: ["support", "ai", "supportAiDisabled"],
    })
    mocks.audit.mockResolvedValue({
      id: "audit-1",
      userId: "user-1",
      oldValue: { supportAiEnabled: true },
      newValue: { supportAiEnabled: false },
      createdAt: new Date("2026-09-04T09:30:00.000Z"),
    })
    mocks.user.mockResolvedValue({ name: "Admin User", email: "admin@example.com" })
  })

  it("returns server truth and the latest audit evidence", async () => {
    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toMatchObject({
      enabled: false,
      organization: { id: "org-1", name: "Acme" },
      latestChange: {
        actor: "Admin User",
        previousEnabled: true,
        newEnabled: false,
        changedAt: "2026-09-04T09:30:00.000Z",
      },
    })
  })

  it("denies a direct request by a non-admin", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...AUTH, role: "manager" } as any)

    const response = await GET(request())

    expect(response.status).toBe(403)
    expect(mocks.organization).not.toHaveBeenCalled()
  })

  it("denies an unlicensed organization", async () => {
    mocks.entitlement.mockResolvedValue(false)

    const response = await GET(request())

    expect(response.status).toBe(403)
    expect(mocks.organization).not.toHaveBeenCalled()
  })

  it("reports the legacy enabled default when no opt-out exists", async () => {
    mocks.organization.mockResolvedValue({ id: "org-1", name: "Acme", features: ["support", "ai"] })
    mocks.audit.mockResolvedValue(null)

    const response = await GET(request())
    const body = await response.json()

    expect(body.data.enabled).toBe(true)
    expect(body.data.latestChange).toBeNull()
    expect(mocks.user).not.toHaveBeenCalled()
  })
})
