/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: {
      findUnique: vi.fn(),
    },
  },
}))

import {
  getTenantCapabilityAccess,
  tenantCapabilityDeniedPayload,
} from "@/lib/tenant-capability-access"
import { prisma } from "@/lib/prisma"

const ROUTE_FIELD_CAPABILITY_ID = "route-field"

const baseOrg = {
  plan: "enterprise",
  addons: [],
  features: ["crm", "sales", "settings"],
  modules: { crm: true, sales: true, settings: true },
  settings: {},
}

describe("tenant capability access", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("denies route-field access when neither its own nor a legacy entitlement is enabled", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue(baseOrg as any)

    const access = await getTenantCapabilityAccess("org-1", ROUTE_FIELD_CAPABILITY_ID)

    expect(access.allowed).toBe(false)
    expect(access.capability?.status).toBe("demo")
    expect(tenantCapabilityDeniedPayload(access).code).toBe("TENANT_CAPABILITY_DISABLED")
  })

  it("allows route-field access when the legacy mtm entitlement is enabled", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      ...baseOrg,
      features: [...baseOrg.features, "mtm"],
      modules: { ...baseOrg.modules, mtm: true },
    } as any)

    const access = await getTenantCapabilityAccess("org-1", ROUTE_FIELD_CAPABILITY_ID)

    expect(access.allowed).toBe(true)
    expect(access.capability?.status).toBe("enabled")
  })

  it("uses an explicit route-field false to soft-disable only Routes while preserving legacy Workforce", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      ...baseOrg,
      features: [...baseOrg.features, "mtm"],
      modules: { ...baseOrg.modules, mtm: true, [ROUTE_FIELD_CAPABILITY_ID]: false },
    } as any)

    const access = await getTenantCapabilityAccess("org-1", ROUTE_FIELD_CAPABILITY_ID)

    expect(access.allowed).toBe(false)
    expect(access.capability?.status).toBe("disabled")
    expect(tenantCapabilityDeniedPayload(access)).toMatchObject({
      code: "TENANT_CAPABILITY_DISABLED",
      capabilityId: ROUTE_FIELD_CAPABILITY_ID,
      capabilityStatus: "disabled",
    })
  })

  it("allows hidden capabilities because hiding only affects navigation", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      ...baseOrg,
      features: [...baseOrg.features, "mtm"],
      modules: { ...baseOrg.modules, mtm: true },
      settings: {
        marketplaceCapabilities: {
          hidden: { [ROUTE_FIELD_CAPABILITY_ID]: true },
        },
      },
    } as any)

    const access = await getTenantCapabilityAccess("org-1", ROUTE_FIELD_CAPABILITY_ID)

    expect(access.allowed).toBe(true)
    expect(access.capability?.status).toBe("hidden")
  })
})
