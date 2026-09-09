import { describe, it, expect, vi } from "vitest"

// Mock prisma so importing tenant-provisioning (which transitively imports prisma) has no side effects.
vi.mock("@/lib/prisma", () => ({ prisma: {}, logAudit: vi.fn() }))

import {
  effectiveModulesEnableMtm,
  generateTempPassword,
  resolveScaffolding,
  resolveTenantFeatures,
} from "@/lib/tenant-provisioning"
import { DEFAULT_TASK_TYPES } from "@/lib/constants"
import { passwordPolicyError } from "@/lib/password-policy"

describe("generateTempPassword", () => {
  it("always produces unique credentials accepted by the central policy", () => {
    const passwords = Array.from({ length: 32 }, () => generateTempPassword())

    expect(new Set(passwords).size).toBe(passwords.length)
    for (const password of passwords) {
      expect(passwordPolicyError(password)).toBeNull()
    }
  })
})

describe("effectiveModulesEnableMtm", () => {
  it("true when features include mtm", () => {
    expect(effectiveModulesEnableMtm(["mtm"], [])).toBe(true)
  })
  it("true when an addon expands to mtm (e.g. enterprise addons)", () => {
    expect(effectiveModulesEnableMtm([], ["mtm"])).toBe(true)
  })
  it("false otherwise", () => {
    expect(effectiveModulesEnableMtm(["deals"], ["ai"])).toBe(false)
  })
})

describe("resolveTenantFeatures", () => {
  it("includes omnichannel + social when all supported channels are initialized implicitly", () => {
    // `social` — отдельный модуль с 2026-08-01, но v2-провижининг всегда гоняет
    // social_monitoring_foundation, поэтому контракт нового тенанта включает оба
    // (до сплита соцмониторинг был виден всем новым тенантам через omnichannel).
    expect(resolveTenantFeatures({
      requestedFeatures: ["crm"],
      channels: undefined,
    })).toEqual(["crm", "omnichannel", "social"])
  })

  it("keeps Omni-Channel and Social off when the wizard explicitly selects no channels", () => {
    expect(resolveTenantFeatures({
      requestedFeatures: ["crm", "support"],
      channels: [],
    })).toEqual(["crm", "support"])
  })

  it("adds Основная when Support is selected without the customer-base module", () => {
    expect(resolveTenantFeatures({
      requestedFeatures: ["support"],
      channels: [],
    })).toEqual(["support", "crm"])
  })

  it("adds Omni-Channel, but not Social, for a selected connection", () => {
    expect(resolveTenantFeatures({
      requestedFeatures: ["crm"],
      channels: ["facebook"],
    })).toEqual(["crm", "omnichannel"])
  })

  it("deduplicates already contracted omnichannel/social modules", () => {
    expect(resolveTenantFeatures({
      requestedFeatures: ["crm", "omnichannel", "social"],
      channels: ["facebook"],
    })).toEqual(["crm", "omnichannel", "social"])
  })
})

describe("resolveScaffolding", () => {
  it("falls back to defaults when absent", () => {
    expect(resolveScaffolding({}).taskTypes).toEqual(DEFAULT_TASK_TYPES)
  })
  it("uses provided arrays", () => {
    const custom = [{ name: "x", displayName: "X", color: "#fff", sortOrder: 0 }]
    expect(resolveScaffolding({ taskTypes: custom }).taskTypes).toEqual(custom)
  })
})
