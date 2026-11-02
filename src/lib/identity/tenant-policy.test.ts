import { describe, expect, it, vi } from "vitest"
import type { Prisma } from "@prisma/client"
import { ATTENDANCE_FEATURE_SETTING_KEY } from "../mtm/attendance-feature"
import { IDENTITY_AUTH_SETTING_KEY, readIdentityMobileTenantPolicy as policy } from "./tenant-policy"
function fixture() {
  const company = { id: "tenant-a", isActive: true, plan: "starter", addons: [], features: [], modules: { personnel: true, "route-field": false } }
  const data = { flag: { version: 1, enabled: true } as unknown, timeSwitch: true as unknown }
  const settings = vi.fn(async ({ where }: { where: { organizationId_key: { organizationId: string; key: string } } }) => {
    if (where.organizationId_key.organizationId !== company.id) return null
    const value = where.organizationId_key.key === IDENTITY_AUTH_SETTING_KEY ? data.flag : data.timeSwitch
    return value === undefined ? null : { value }
  })
  const client = { organization: { findFirst: vi.fn(async () => company) }, mtmSetting: { findUnique: settings } }
  return { company, data, settings, client: client as unknown as Prisma.TransactionClient }
}
describe("actual shared tenant entitlement and rollout policy", () => {
  it("admits licensed Time separately from Field using the shared catalog and attendance reader", async () => {
    const f = fixture()
    expect(await policy(f.client, f.company.id, "TIME")).toEqual({ identityEnabled: true, licensed: true })
    expect(await policy(f.client, f.company.id, "ROUTE_FIELD")).toEqual({ identityEnabled: true, licensed: false })
  })
  it("requires exact versioned opt-in, with no truthy or unknown-field fallback", async () => {
    for (const flag of [undefined, null, true, "true", {}, { version: 1, enabled: false }, { version: 2, enabled: true }, { version: 1, enabled: "true" }, { version: 1, enabled: true, extra: true }]) {
      const f = fixture(); f.data.flag = flag
      expect((await policy(f.client, f.company.id, "TIME")).identityEnabled).toBe(false)
    }
  })
  it("requires explicit attendance-on and Personnel entitlement for Time", async () => {
    for (const value of [undefined, false, "true", 1]) {
      const f = fixture(); f.data.timeSwitch = value
      expect((await policy(f.client, f.company.id, "TIME")).licensed).toBe(false)
    }
    const f = fixture(); f.company.modules.personnel = false
    expect((await policy(f.client, f.company.id, "TIME")).licensed).toBe(false)
  })
  it("does not read an HR switch for a Field-only entitlement", async () => {
    const f = fixture(); f.company.modules = { personnel: false, "route-field": true }; f.data.timeSwitch = false
    expect(await policy(f.client, f.company.id, "ROUTE_FIELD")).toEqual({ identityEnabled: true, licensed: true })
    expect(f.settings.mock.calls.every(([args]) => args.where.organizationId_key.key !== ATTENDANCE_FEATURE_SETTING_KEY)).toBe(true)
    expect((await policy(f.client, f.company.id, "TIME")).licensed).toBe(false)
  })
  it("refuses an inactive or wrong-tenant company regardless of paid flags", async () => {
    for (const kind of ["inactive", "foreign"]) {
      const f = fixture()
      if (kind === "inactive") f.company.isActive = false
      else f.company.id = "tenant-b"
      expect(await policy(f.client, "tenant-a", "TIME")).toEqual({ identityEnabled: false, licensed: false })
    }
  })
  it("never interprets CRM as a mobile app or changes the input entitlement records", async () => {
    const f = fixture(), before = JSON.stringify(f.company)
    await expect(policy(f.client, f.company.id, "CRM" as "TIME")).rejects.toThrow("IDENTITY_APPLICATION_INVALID")
    await policy(f.client, f.company.id, "TIME")
    expect(JSON.stringify(f.company)).toBe(before)
  })
})
