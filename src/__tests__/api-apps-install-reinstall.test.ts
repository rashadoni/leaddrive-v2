/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * P9 App Marketplace — POST install route tests.
 *
 * The route blocks capability-managed self-install, then delegates
 * safe side effects + AppInstallation lifecycle to installTenantApp.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    app: { findFirst: vi.fn() },
    appInstallation: {
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn((r: unknown) => r instanceof Response),
}))

vi.mock("@/lib/apps/install-executor", () => {
  class AppInstallError extends Error {
    status: number
    code: string
    details?: unknown

    constructor(code: string, message: string, status = 400, details?: unknown) {
      super(message)
      this.name = "AppInstallError"
      this.code = code
      this.status = status
      this.details = details
    }
  }

  return {
    AppInstallError,
    installTenantApp: vi.fn(),
  }
})

import { POST } from "@/app/api/v1/apps/[id]/install/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import { AppInstallError, installTenantApp } from "@/lib/apps/install-executor"

function makeReq(body: unknown) {
  return new NextRequest(
    new URL("/api/v1/apps/app1/install", "http://localhost:3000"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  )
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

const auth = (orgId = "org1", userId = "u1") => ({
  orgId, userId, role: "admin", email: "", name: "",
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(auth() as never)
  vi.mocked(prisma.app.findFirst).mockResolvedValue({
    id: "app1",
    slug: "test-app",
  } as any)
  vi.mocked(installTenantApp).mockResolvedValue({
    installation: {
      id: "inst1",
      appId: "app1",
      installedVersion: "2.0.0",
      config: { foo: "bar" },
      status: "active",
      installedAt: new Date("2026-06-27T00:00:00.000Z"),
      updatedAt: new Date("2026-06-27T00:00:00.000Z"),
    },
    plan: {
      appId: "app1",
      appSlug: "test-app",
      installedVersion: "2.0.0",
      config: { foo: "bar" },
      actions: [],
    },
    provisionedResources: [{ kind: "setting", ref: "foo", status: "updated" }],
    warnings: [],
    executed: true,
  } as Awaited<ReturnType<typeof installTenantApp>>)
})

describe("POST /install", () => {
  it("blocks direct installation for capability-managed apps", async () => {
    vi.mocked(prisma.app.findFirst).mockResolvedValue({
      id: "app1",
      slug: "slack-deal-notifier",
    } as any)

    const res = await POST(makeReq({ config: {} }), makeParams("app1"))
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body).toMatchObject({
      capabilityId: "slack-deal-notifier",
      action: "request_access",
    })
    expect(installTenantApp).not.toHaveBeenCalled()
    expect(prisma.appInstallation.create).not.toHaveBeenCalled()
    expect(prisma.appInstallation.update).not.toHaveBeenCalled()
  })

  it("delegates non-managed installs to the executor and returns executed=true", async () => {
    const res = await POST(makeReq({ config: { foo: "bar" } }), makeParams("app1"))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body).toMatchObject({
      installation: { id: "inst1", status: "active" },
      plan: { appId: "app1", appSlug: "test-app" },
      provisionedResources: [{ kind: "setting", ref: "foo", status: "updated" }],
      warnings: [],
      executed: true,
    })
    expect(installTenantApp).toHaveBeenCalledWith({
      appId: "app1",
      organizationId: "org1",
      installedBy: "u1",
      userConfig: { foo: "bar" },
    })
    expect(prisma.appInstallation.create).not.toHaveBeenCalled()
    expect(prisma.appInstallation.update).not.toHaveBeenCalled()
  })

  it("returns executor conflict errors as JSON", async () => {
    vi.mocked(installTenantApp).mockRejectedValue(
      new AppInstallError("already_installed", "App is already installed in this tenant", 409),
    )

    const res = await POST(makeReq({ config: {} }), makeParams("app1"))
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body).toMatchObject({
      error: "App is already installed in this tenant",
      code: "already_installed",
    })
  })

  it("preserves missing array for requirement errors used by the UI", async () => {
    vi.mocked(installTenantApp).mockRejectedValue(
      new AppInstallError(
        "missing_named_credentials",
        "App requires named credentials that do not exist in this tenant",
        409,
        ["slack_bot"],
      ),
    )

    const res = await POST(makeReq({ config: {} }), makeParams("app1"))
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body).toMatchObject({
      code: "missing_named_credentials",
      details: ["slack_bot"],
      missing: ["slack_bot"],
    })
  })
})
