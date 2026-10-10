/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: vi.fn(), update: vi.fn() },
    app: { findMany: vi.fn() },
    appInstallation: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
  logAudit: vi.fn(),
}))
vi.mock("@/lib/superadmin-guard", () => ({ requireSuperAdmin: vi.fn() }))
vi.mock("@/lib/rls-context", () => ({ runWithRlsBypass: vi.fn() }))
vi.mock("@/lib/tenant-provisioning", () => ({
  validateSlug: vi.fn(),
  assertTenantWorkforceRetentionClear: vi.fn(),
  deactivateTenant: vi.fn(),
  activateTenant: vi.fn(),
  scheduleTenantDeletion: vi.fn(),
  hardDeleteTenant: vi.fn(),
  WorkforceRetentionBlockedError: class extends Error {},
}))
vi.mock("@/lib/tenant-export", () => ({ exportTenantData: vi.fn() }))
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }))
vi.mock("@/lib/emails/tenant-deletion", () => ({
  getDeletionScheduledEmail: vi.fn(),
  getDeletionCompletedEmail: vi.fn(),
}))
vi.mock("@/lib/apps/install-executor", () => ({
  AppInstallError: class extends Error {},
  installTenantApp: vi.fn(),
}))
vi.mock("@/lib/workforce/default-configuration-provisioning", () => ({
  ensureWorkforceDefaultProfile: vi.fn(),
}))

import { PUT } from "@/app/api/v1/admin/tenants/[id]/route"
import {
  GET as GET_CAPABILITIES,
  PATCH as PATCH_CAPABILITIES,
} from "@/app/api/v1/admin/tenants/[id]/capabilities/route"
import { prisma, logAudit } from "@/lib/prisma"
import { requireSuperAdmin } from "@/lib/superadmin-guard"
import { runWithRlsBypass } from "@/lib/rls-context"
import { ensureWorkforceDefaultProfile } from "@/lib/workforce/default-configuration-provisioning"
import { featuresToStringArray } from "@/lib/tenant-capabilities"

const AUTH = {
  orgId: "platform-org", userId: "super-1", role: "superadmin" as const,
  name: "Superadmin", email: "super@example.test",
}
const WORKFORCE = "workforce-hrm"
let tenant: any

function params() {
  return { params: Promise.resolve({ id: "target-tenant" }) }
}

function request(method: string, body?: unknown, capabilities = false) {
  return new NextRequest(`http://localhost:3000/api/v1/admin/tenants/target-tenant${capabilities ? "/capabilities" : ""}`, {
    method,
    ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  })
}

async function reloadedWorkforce() {
  const response = await GET_CAPABILITIES(request("GET", undefined, true), params())
  expect(response.status).toBe(200)
  const body = await response.json()
  return body.data.capabilities.find((capability: { id: string }) => capability.id === WORKFORCE)
}

beforeEach(() => {
  vi.resetAllMocks()
  tenant = {
    id: "target-tenant", name: "Target", slug: "target", plan: "enterprise",
    isActive: true, maxUsers: 10, maxContacts: 1000,
    features: ["crm"], modules: { crm: true, "route-field": true, unrelated_flag: false },
    addons: [], settings: {}, updatedAt: new Date("2026-10-10T13:00:00.000Z"),
  }
  vi.mocked(requireSuperAdmin).mockResolvedValue(AUTH as any)
  vi.mocked(runWithRlsBypass).mockImplementation(async (callback: any) => await callback())
  vi.mocked(prisma.organization.findUnique).mockImplementation(async ({ where }: any) => (
    where.id === tenant.id ? { ...tenant } : null
  ))
  vi.mocked(prisma.organization.update).mockImplementation(async ({ where, data }: any) => {
    if (where.id !== tenant.id || (where.updatedAt && where.updatedAt.getTime() !== tenant.updatedAt.getTime()) ||
      (where.features && JSON.stringify(where.features.equals) !== JSON.stringify(tenant.features)) ||
      (where.modules && JSON.stringify(where.modules.equals) !== JSON.stringify(tenant.modules))) {
      throw Object.assign(new Error("Record changed"), { code: "P2025" })
    }
    tenant = { ...tenant, ...data, updatedAt: new Date(tenant.updatedAt.getTime() + 1) }
    return { ...tenant }
  })
  vi.mocked(prisma.app.findMany).mockResolvedValue([])
  vi.mocked(prisma.appInstallation.findMany).mockResolvedValue([])
  vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => await callback(prisma))
  vi.mocked(ensureWorkforceDefaultProfile).mockResolvedValue({
    state: "provisioned", profileVersion: "baku-standard-v1",
    effectiveFrom: "2026-08-30", policyId: "policy", shiftTemplateId: "shift",
  } as never)
})

describe("tenant metadata preserves explicit Workforce decisions", () => {
  it.each([
    { name: "enabled", features: ["crm", WORKFORCE], modules: { [WORKFORCE]: true }, incoming: ["crm"], featurePresent: true, moduleValue: true },
    { name: "disabled", features: ["crm", "mtm"], modules: { mtm: true, [WORKFORCE]: false }, incoming: ["crm", "mtm", WORKFORCE], featurePresent: false, moduleValue: false },
    { name: "conflicting historical fields", features: ["crm", WORKFORCE], modules: { [WORKFORCE]: false }, incoming: ["crm"], featurePresent: true, moduleValue: false },
    { name: "a modules-only grant", features: ["crm"], modules: { [WORKFORCE]: true }, incoming: ["crm", WORKFORCE], featurePresent: false, moduleValue: true },
    { name: "a serialized historical feature grant", features: '["crm","workforce-hrm"]', modules: {}, incoming: ["crm"], featurePresent: true, moduleValue: undefined },
    { name: "unclassified legacy MTM", features: ["crm", "mtm"], modules: { mtm: true }, incoming: ["crm", "mtm", WORKFORCE], featurePresent: false, moduleValue: undefined },
    { name: "an ungranted tenant", features: ["crm"], modules: {}, incoming: ["crm", WORKFORCE], featurePresent: false, moduleValue: undefined },
  ])("preserves $name despite an opposite raw features payload", async ({ features, modules, incoming, featurePresent, moduleValue }) => {
    tenant.features = features
    tenant.modules = { ...tenant.modules, ...modules }
    const previousUpdatedAt = tenant.updatedAt

    const response = await PUT(request("PUT", { name: "Edited", features: incoming }), params())

    expect(response.status).toBe(200)
    expect(tenant.name).toBe("Edited")
    expect(featuresToStringArray(tenant.features).includes(WORKFORCE)).toBe(featurePresent)
    expect(tenant.modules[WORKFORCE]).toBe(moduleValue)
    expect(tenant.modules["route-field"]).toBe(true)
    expect(tenant.modules.unrelated_flag).toBe(false)
    expect(prisma.organization.update).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: "target-tenant", updatedAt: previousUpdatedAt,
        features: { equals: features }, modules: { equals: expect.objectContaining(modules) },
      },
    }))
    expect(ensureWorkforceDefaultProfile).not.toHaveBeenCalled()
    expect(logAudit).toHaveBeenCalledTimes(1)
    expect(logAudit).toHaveBeenCalledWith("platform-org", "update", "tenant", "target-tenant", "Target", expect.any(Object))
  })

  it("ignores body target, actor, modules and capability actions on a metadata-only save", async () => {
    tenant.features = ["crm", WORKFORCE]
    tenant.modules[WORKFORCE] = true
    const before = { features: tenant.features, modules: tenant.modules }

    const response = await PUT(request("PUT", {
      name: "Renamed", id: "other-tenant", organizationId: "other-tenant", userId: "other-user",
      modules: { [WORKFORCE]: false }, capabilityId: WORKFORCE, action: "disable",
    }), params())

    expect(response.status).toBe(200)
    expect(tenant.id).toBe("target-tenant")
    expect(tenant.features).toEqual(before.features)
    expect(tenant.modules).toEqual(before.modules)
    expect(prisma.organization.findUnique).toHaveBeenCalledWith({ where: { id: "target-tenant" } })
    expect(logAudit).toHaveBeenCalledWith("platform-org", "update", "tenant", "target-tenant", "Target", {
      oldValue: { plan: "enterprise", isActive: true }, newValue: { name: "Renamed" },
    })
    expect(ensureWorkforceDefaultProfile).not.toHaveBeenCalled()
  })

  it("retains the existing behavior of an intentional MTM module edit", async () => {
    tenant.features = ["crm", "mtm"]
    tenant.modules.mtm = true

    const response = await PUT(request("PUT", { features: ["crm"] }), params())

    expect(response.status).toBe(200)
    expect(tenant.modules.mtm).toBe(false)
    expect(tenant.modules).not.toHaveProperty(WORKFORCE)
    expect(featuresToStringArray(tenant.features)).not.toContain(WORKFORCE)
    expect(ensureWorkforceDefaultProfile).not.toHaveBeenCalled()
  })

  it("preserves explicit approval through stale metadata Save and authoritative reload", async () => {
    const approved = await PATCH_CAPABILITIES(request("PATCH", { capabilityId: WORKFORCE, action: "approve" }, true), params())
    expect(approved.status).toBe(200)
    expect(ensureWorkforceDefaultProfile).toHaveBeenCalledTimes(1)

    const saved = await PUT(request("PUT", { name: "Edited", features: ["crm"] }), params())

    expect(saved.status).toBe(200)
    expect(await reloadedWorkforce()).toMatchObject({ enabled: true, status: "enabled" })
    expect(featuresToStringArray(tenant.features)).toContain(WORKFORCE)
    expect(tenant.modules[WORKFORCE]).toBe(true)
    expect(ensureWorkforceDefaultProfile).toHaveBeenCalledTimes(1)
    expect(logAudit).toHaveBeenCalledTimes(2)
    expect(vi.mocked(logAudit).mock.calls.map((call) => call[1])).toEqual(["approve", "update"])
  })

  it("preserves explicit disable through stale metadata Save and legacy MTM reload", async () => {
    tenant.features = ["crm", "mtm", WORKFORCE]
    tenant.modules = { ...tenant.modules, mtm: true, [WORKFORCE]: true }
    const disabled = await PATCH_CAPABILITIES(request("PATCH", { capabilityId: WORKFORCE, action: "disable" }, true), params())
    expect(disabled.status).toBe(200)

    const saved = await PUT(request("PUT", { features: ["crm", "mtm", WORKFORCE] }), params())

    expect(saved.status).toBe(200)
    expect(await reloadedWorkforce()).toMatchObject({ enabled: false, status: "disabled" })
    expect(featuresToStringArray(tenant.features)).not.toContain(WORKFORCE)
    expect(tenant.modules).toMatchObject({ mtm: true, "route-field": true, [WORKFORCE]: false })
    expect(ensureWorkforceDefaultProfile).not.toHaveBeenCalled()
    expect(vi.mocked(logAudit).mock.calls.map((call) => call[1])).toEqual(["disable", "update"])
  })

  it("returns 409 without a metadata write or audit when approval races with Save", async () => {
    vi.mocked(prisma.organization.update).mockImplementationOnce(async ({ where }: any) => {
      const approved = await PATCH_CAPABILITIES(request("PATCH", { capabilityId: WORKFORCE, action: "approve" }, true), params())
      expect(approved.status).toBe(200)
      if (where.updatedAt?.getTime() !== tenant.updatedAt.getTime()) {
        throw Object.assign(new Error("Record changed"), { code: "P2025" })
      }
      throw new Error("Metadata Save did not protect the read snapshot")
    })

    const response = await PUT(request("PUT", { name: "Stale name", features: ["crm"] }), params())

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "TENANT_UPDATE_CONFLICT" })
    expect(tenant.name).toBe("Target")
    expect(tenant.modules[WORKFORCE]).toBe(true)
    expect(featuresToStringArray(tenant.features)).toContain(WORKFORCE)
    expect(ensureWorkforceDefaultProfile).toHaveBeenCalledTimes(1)
    expect(logAudit).toHaveBeenCalledTimes(1)
    expect(vi.mocked(logAudit).mock.calls[0][1]).toBe("approve")
  })

  it.each([401, 403])("rejects unauthorized metadata Save before bypass or database access (%i)", async (status) => {
    vi.mocked(requireSuperAdmin).mockResolvedValue(NextResponse.json({ error: "Denied" }, { status }))

    const response = await PUT(request("PUT", { features: [WORKFORCE] }), params())

    expect(response.status).toBe(status)
    expect(runWithRlsBypass).not.toHaveBeenCalled()
    expect(prisma.organization.findUnique).not.toHaveBeenCalled()
    expect(prisma.organization.update).not.toHaveBeenCalled()
    expect(logAudit).not.toHaveBeenCalled()
    expect(ensureWorkforceDefaultProfile).not.toHaveBeenCalled()
  })

  it("rejects a capability change even when its timestamp collides in the same millisecond", async () => {
    vi.mocked(prisma.organization.update).mockImplementationOnce(async ({ where }: any) => {
      const approved = await PATCH_CAPABILITIES(request("PATCH", { capabilityId: WORKFORCE, action: "approve" }, true), params())
      expect(approved.status).toBe(200)
      tenant.updatedAt = where.updatedAt
      if (JSON.stringify(where.features?.equals) !== JSON.stringify(tenant.features) ||
        JSON.stringify(where.modules?.equals) !== JSON.stringify(tenant.modules)) {
        throw Object.assign(new Error("Entitlements changed"), { code: "P2025" })
      }
      throw new Error("Metadata Save did not protect the entitlement snapshot")
    })

    const response = await PUT(request("PUT", { name: "Stale", features: ["crm"] }), params())

    expect(response.status).toBe(409)
    expect(tenant.name).toBe("Target")
    expect(tenant.modules[WORKFORCE]).toBe(true)
    expect(logAudit).toHaveBeenCalledTimes(1)
    expect(vi.mocked(logAudit).mock.calls[0][1]).toBe("approve")
  })

  it("preserves a missing route target as 404 without a write", async () => {
    const response = await PUT(request("PUT", { id: "target-tenant", name: "Edited" }), {
      params: Promise.resolve({ id: "missing-tenant" }),
    })

    expect(response.status).toBe(404)
    expect(prisma.organization.update).not.toHaveBeenCalled()
    expect(logAudit).not.toHaveBeenCalled()
  })

  it("does not turn a different database failure into conflict or successful audit", async () => {
    const failure = new Error("Database unavailable")
    vi.mocked(prisma.organization.update).mockRejectedValueOnce(failure)

    await expect(PUT(request("PUT", { name: "Edited" }), params())).rejects.toBe(failure)

    expect(tenant.name).toBe("Target")
    expect(logAudit).not.toHaveBeenCalled()
  })
})
