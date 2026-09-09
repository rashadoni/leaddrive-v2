/**
 * P9 App Marketplace — PATCH + DELETE install tests.
 *
 * Covers the new mutation routes:
 *   PATCH /api/v1/apps/[id]/install — toggle status / update config
 *   DELETE /api/v1/apps/[id]/install — soft uninstall
 *
 * Cross-tenant safety: every mutation looks up by the (orgId, appId)
 * composite key, so a different tenant's installation cannot be
 * touched by manipulating the URL.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    namedCredential: {
      findMany: vi.fn(),
    },
    appInstallation: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn((r: unknown) => r instanceof Response),
}))

import { PATCH, DELETE } from "@/app/api/v1/apps/[id]/install/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"

function makeReq(method: "PATCH" | "DELETE", body?: unknown) {
  return new NextRequest(
    new URL("/api/v1/apps/app1/install", "http://localhost:3000"),
    {
      method,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(method === "PATCH" ? { headers: { "Content-Type": "application/json" } } : {}),
    },
  )
}
function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}
const auth = (orgId = "org1", userId = "u1") => ({
  orgId,
  userId,
  role: "admin",
  email: "",
  name: "",
})

const appManifest = {
  schemaVersion: 1,
  capabilities: {
    settingsKeys: [
      { key: "region", label: "Region", type: "string", required: false, defaultValue: "us" },
      { key: "api_key", label: "API key", type: "secret", required: true },
    ],
  },
}

function existingInstallation(config: Record<string, unknown> = {}) {
  return {
    id: "inst1",
    uninstalledAt: null,
    installedVersion: "1.0.0",
    config,
    app: {
      id: "app1",
      slug: "test-app",
      manifest: appManifest,
    },
  } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.namedCredential.findMany).mockResolvedValue([])
})

/* ── PATCH ──────────────────────────────────────────────────────── */

describe("PATCH /api/v1/apps/[id]/install — auth", () => {
  it("propagates auth error", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      new Response("Unauthorized", { status: 401 }) as never,
    )
    const res = await PATCH(makeReq("PATCH", { status: "disabled" }), makeParams("app1"))
    expect(res.status).toBe(401)
  })
})

describe("PATCH /api/v1/apps/[id]/install — body validation", () => {
  beforeEach(() => {
    vi.mocked(requireAuth).mockResolvedValue(auth() as never)
  })

  it("400 when neither status nor config in body", async () => {
    const res = await PATCH(makeReq("PATCH", {}), makeParams("app1"))
    expect(res.status).toBe(400)
  })

  it("400 when status is not in enum", async () => {
    const res = await PATCH(makeReq("PATCH", { status: "zombie" }), makeParams("app1"))
    expect(res.status).toBe(400)
  })
})

describe("PATCH /api/v1/apps/[id]/install — cross-tenant + lifecycle", () => {
  beforeEach(() => {
    vi.mocked(requireAuth).mockResolvedValue(auth() as never)
  })

  it("404 when no installation exists for (org, app)", async () => {
    vi.mocked(prisma.appInstallation.findUnique).mockResolvedValue(null)
    const res = await PATCH(makeReq("PATCH", { status: "disabled" }), makeParams("app1"))
    expect(res.status).toBe(404)
  })

  it("404 when installation is already soft-uninstalled", async () => {
    vi.mocked(prisma.appInstallation.findUnique).mockResolvedValue({
      id: "inst1",
      uninstalledAt: new Date("2026-01-01"),
    } as any)
    const res = await PATCH(makeReq("PATCH", { status: "disabled" }), makeParams("app1"))
    expect(res.status).toBe(404)
  })

  it("scopes lookup by composite (organizationId, appId)", async () => {
    vi.mocked(prisma.appInstallation.findUnique).mockResolvedValue(null)
    await PATCH(makeReq("PATCH", { status: "disabled" }), makeParams("app42"))
    expect(prisma.appInstallation.findUnique).toHaveBeenCalledWith({
      where: { organizationId_appId: { organizationId: "org1", appId: "app42" } },
      select: {
        id: true,
        uninstalledAt: true,
        config: true,
        installedVersion: true,
        app: {
          select: {
            id: true,
            slug: true,
            manifest: true,
          },
        },
      },
    })
  })

  it("200 + updates status only when status is sent", async () => {
    vi.mocked(prisma.appInstallation.findUnique).mockResolvedValue(existingInstallation())
    vi.mocked(prisma.appInstallation.update).mockResolvedValue({} as any)
    const res = await PATCH(makeReq("PATCH", { status: "disabled" }), makeParams("app1"))
    expect(res.status).toBe(200)
    const call = vi.mocked(prisma.appInstallation.update).mock.calls[0][0]
    expect(call.data).toEqual({ status: "disabled" })
  })

  it("200 + updates config only when config is sent", async () => {
    vi.mocked(prisma.appInstallation.findUnique).mockResolvedValue(existingInstallation({
      region: "eu",
      __marketplaceProvisioning: { setupComplete: false, resources: [{ kind: "setting" }] },
    }))
    vi.mocked(prisma.appInstallation.update).mockResolvedValue({} as any)
    const res = await PATCH(makeReq("PATCH", { config: { api_key: "X" } }), makeParams("app1"))
    expect(res.status).toBe(200)
    const call = vi.mocked(prisma.appInstallation.update).mock.calls[0][0]
    expect(call.data.config).toMatchObject({
      region: "eu",
      api_key: "X",
      __marketplaceProvisioning: {
        setupComplete: true,
        resources: [{ kind: "setting" }],
        configuredBy: "u1",
      },
    })
  })

  it("200 + updates both when both sent", async () => {
    vi.mocked(prisma.appInstallation.findUnique).mockResolvedValue(existingInstallation({ api_key: "old" }))
    vi.mocked(prisma.appInstallation.update).mockResolvedValue({} as any)
    const res = await PATCH(
      makeReq("PATCH", { status: "active", config: { region: "us" } }),
      makeParams("app1"),
    )
    expect(res.status).toBe(200)
    const call = vi.mocked(prisma.appInstallation.update).mock.calls[0][0]
    expect(call.data).toMatchObject({
      status: "active",
      config: {
        region: "us",
        api_key: "old",
        __marketplaceProvisioning: {
          setupComplete: true,
        },
      },
    })
  })
})

/* ── DELETE ─────────────────────────────────────────────────────── */

describe("DELETE /api/v1/apps/[id]/install — auth", () => {
  it("propagates auth error", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      new Response("Unauthorized", { status: 401 }) as never,
    )
    const res = await DELETE(makeReq("DELETE"), makeParams("app1"))
    expect(res.status).toBe(401)
  })
})

describe("DELETE /api/v1/apps/[id]/install — soft-uninstall", () => {
  beforeEach(() => {
    vi.mocked(requireAuth).mockResolvedValue(auth() as never)
  })

  it("404 when no active installation", async () => {
    vi.mocked(prisma.appInstallation.findUnique).mockResolvedValue(null)
    const res = await DELETE(makeReq("DELETE"), makeParams("app1"))
    expect(res.status).toBe(404)
  })

  it("404 when already soft-uninstalled (idempotency boundary)", async () => {
    vi.mocked(prisma.appInstallation.findUnique).mockResolvedValue({
      id: "inst1",
      uninstalledAt: new Date("2026-01-01"),
    } as any)
    const res = await DELETE(makeReq("DELETE"), makeParams("app1"))
    expect(res.status).toBe(404)
  })

  it("200 + stamps uninstalledAt + flips status to disabled", async () => {
    vi.mocked(prisma.appInstallation.findUnique).mockResolvedValue({
      id: "inst1",
      config: {
        region: "eu",
        __marketplaceProvisioning: { resources: [{ kind: "custom_field" }] },
      },
      uninstalledAt: null,
    } as any)
    vi.mocked(prisma.appInstallation.update).mockResolvedValue({
      id: "inst1",
      appId: "app1",
      status: "disabled",
      uninstalledAt: new Date(),
    } as any)
    const res = await DELETE(makeReq("DELETE"), makeParams("app1"))
    expect(res.status).toBe(200)
    const call = vi.mocked(prisma.appInstallation.update).mock.calls[0][0]
    expect(call.data.status).toBe("disabled")
    expect(call.data.uninstalledAt).toBeInstanceOf(Date)
    expect(call.data.config).toMatchObject({
      region: "eu",
      __marketplaceProvisioning: {
        cleanupPolicy: "preserve_data",
        setupComplete: false,
        resources: [{ kind: "custom_field" }],
      },
    })
  })

  it("scopes lookup by composite (organizationId, appId)", async () => {
    vi.mocked(prisma.appInstallation.findUnique).mockResolvedValue(null)
    await DELETE(makeReq("DELETE"), makeParams("app99"))
    expect(prisma.appInstallation.findUnique).toHaveBeenCalledWith({
      where: { organizationId_appId: { organizationId: "org1", appId: "app99" } },
      select: { id: true, config: true, uninstalledAt: true },
    })
  })
})
