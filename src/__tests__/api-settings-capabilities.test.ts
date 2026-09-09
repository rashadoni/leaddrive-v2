/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    app: {
      findMany: vi.fn(),
    },
    appInstallation: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn((r: unknown) => r instanceof Response),
}))

import { GET, PATCH } from "@/app/api/v1/settings/capabilities/route"
import { requireAuth } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

const auth = {
  orgId: "org1",
  userId: "u1",
  role: "admin",
  email: "",
  name: "",
}

const org = {
  plan: "enterprise",
  addons: [],
  features: ["mtm"],
  modules: { crm: true, sales: true, settings: true, mtm: true },
  settings: {
    locale: "ru",
    marketplaceCapabilities: {
      requested: { "da-vinci-ai": true },
    },
  },
}

function makePatch(body: unknown) {
  return new NextRequest(new URL("/api/v1/settings/capabilities", "http://localhost:3000"), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(auth as never)
  vi.mocked(prisma.organization.findUnique).mockResolvedValue(org as any)
  vi.mocked(prisma.organization.update).mockResolvedValue({ id: "org1" } as any)
  vi.mocked(prisma.app.findMany).mockResolvedValue([
    { id: "app-slack", slug: "slack-deal-notifier" },
    { id: "app-lead", slug: "lead-scoring-rules" },
  ] as any)
  vi.mocked(prisma.appInstallation.findMany).mockResolvedValue([])
  vi.mocked(prisma.appInstallation.findUnique).mockResolvedValue({
    id: "install-lead",
    uninstalledAt: null,
  } as any)
  vi.mocked(prisma.appInstallation.update).mockResolvedValue({ id: "install-lead" } as any)
})

describe("GET /api/v1/settings/capabilities", () => {
  it("returns resolved tenant capability states", async () => {
    const res = await GET(
      new NextRequest(new URL("/api/v1/settings/capabilities", "http://localhost:3000")),
      undefined,
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "route-field", status: "enabled" }),
        expect.objectContaining({ id: "da-vinci-ai", status: "requested" }),
      ]),
    )
  })
})

describe("PATCH /api/v1/settings/capabilities", () => {
  it("records request_access without changing tenant features or plan", async () => {
    const res = await PATCH(makePatch({ capabilityId: "ai-security-monitoring", action: "request_access" }), undefined)

    expect(res.status).toBe(200)
    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: "org1" },
      data: {
        settings: {
          locale: "ru",
          marketplaceCapabilities: {
            requested: {
              "da-vinci-ai": true,
              "ai-security-monitoring": true,
            },
          },
        },
      },
      select: { id: true },
    })
  })

  it("records hide for an enabled capability", async () => {
    const res = await PATCH(makePatch({ capabilityId: "route-field", action: "hide" }), undefined)

    expect(res.status).toBe(200)
    expect(vi.mocked(prisma.organization.update).mock.calls[0][0].data).toEqual({
      settings: {
        locale: "ru",
        marketplaceCapabilities: {
          requested: { "da-vinci-ai": true },
          hidden: { "route-field": true },
        },
      },
    })
  })

  it("soft-disables route-field without changing the legacy mtm entitlement or an app installation", async () => {
    const res = await PATCH(makePatch({ capabilityId: "route-field", action: "disable" }), undefined)

    expect(res.status).toBe(200)
    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: "org1" },
      data: {
        features: ["mtm"],
        modules: { crm: true, sales: true, settings: true, mtm: true, "route-field": false },
      },
      select: { id: true },
    })
    expect(prisma.appInstallation.findUnique).not.toHaveBeenCalled()
    expect(prisma.appInstallation.update).not.toHaveBeenCalled()
  })

  it("re-enables only route-field after a soft-disable", async () => {
    const disabledRouteFieldOrg = {
      ...org,
      modules: { ...org.modules, "route-field": false },
    }
    vi.mocked(prisma.organization.findUnique).mockResolvedValue(disabledRouteFieldOrg as any)

    const res = await PATCH(makePatch({ capabilityId: "route-field", action: "enable" }), undefined)

    expect(res.status).toBe(200)
    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: "org1" },
      data: {
        features: ["mtm", "route-field"],
        modules: { crm: true, sales: true, settings: true, mtm: true, "route-field": true },
      },
      select: { id: true },
    })
    expect(prisma.appInstallation.findUnique).not.toHaveBeenCalled()
  })

  it("rejects actions that are not valid for the current capability state", async () => {
    const res = await PATCH(makePatch({ capabilityId: "ai-security-monitoring", action: "hide" }), undefined)
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body).toMatchObject({
      error: "Action is not allowed for this tenant capability state",
      status: "demo",
    })
    expect(prisma.organization.update).not.toHaveBeenCalled()
  })

  it("disables an installed app-backed capability through the capability API", async () => {
    vi.mocked(prisma.appInstallation.findMany).mockResolvedValue([
      {
        appId: "app-lead",
        status: "active",
        config: { __marketplaceProvisioning: { setupComplete: true } },
      },
    ] as any)

    const res = await PATCH(makePatch({ capabilityId: "lead-scoring-template", action: "disable" }), undefined)

    expect(res.status).toBe(200)
    expect(prisma.appInstallation.findUnique).toHaveBeenCalledWith({
      where: { organizationId_appId: { organizationId: "org1", appId: "app-lead" } },
      select: { id: true, uninstalledAt: true },
    })
    expect(prisma.appInstallation.update).toHaveBeenCalledWith({
      where: { id: "install-lead" },
      data: { status: "disabled" },
      select: { id: true },
    })
    expect(prisma.organization.update).not.toHaveBeenCalled()
  })

  it("enables a disabled app-backed capability through the capability API", async () => {
    vi.mocked(prisma.appInstallation.findMany).mockResolvedValue([
      {
        appId: "app-lead",
        status: "disabled",
        config: { __marketplaceProvisioning: { setupComplete: true } },
      },
    ] as any)

    const res = await PATCH(makePatch({ capabilityId: "lead-scoring-template", action: "enable" }), undefined)

    expect(res.status).toBe(200)
    expect(prisma.appInstallation.update).toHaveBeenCalledWith({
      where: { id: "install-lead" },
      data: { status: "active" },
      select: { id: true },
    })
    expect(prisma.organization.update).not.toHaveBeenCalled()
  })
})
