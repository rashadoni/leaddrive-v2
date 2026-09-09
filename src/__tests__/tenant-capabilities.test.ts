import { describe, expect, it } from "vitest"
import {
  TENANT_CAPABILITY_CATALOG,
  applyCapabilityEntitlement,
  capabilitySettingsFromTenantSettings,
  entitlementKeysForCapability,
  featuresToModuleRecord,
  featuresToStringArray,
  isTenantCapabilityEnabled,
  mergeCapabilitySettingsIntoTenantSettings,
  removeCapabilityEntitlement,
  resolveTenantCapabilities,
  resolveTenantCapability,
  softDisableCapabilityEntitlement,
  tenantModulesFromFields,
  type TenantCapabilityDefinition,
} from "@/lib/tenant-capabilities"

const byId = (id: string) => {
  const found = TENANT_CAPABILITY_CATALOG.find((capability) => capability.id === id)
  if (!found) throw new Error(`Missing capability ${id}`)
  return found
}

describe("tenant capability resolver", () => {
  it("materializes Organization.features from json array or serialized json", () => {
    expect(featuresToModuleRecord(["crm", "sales"])).toEqual({ crm: true, sales: true })
    expect(featuresToModuleRecord("[\"mtm\",\"ai_security_monitoring\"]")).toEqual({ mtm: true, ai_security_monitoring: true })
    expect(featuresToModuleRecord("{bad json")).toEqual({})
  })

  it("keeps feature arrays unique while accepting serialized json", () => {
    expect(featuresToStringArray(["crm", "crm", "sales"])).toEqual(["crm", "sales"])
    expect(featuresToStringArray("[\"ai\",\"ai_security_monitoring\"]")).toEqual(["ai", "ai_security_monitoring"])
  })

  it("merges legacy features with materialized org modules for capability checks", () => {
    expect(tenantModulesFromFields({
      features: ["mtm", "ai_security_monitoring"],
      modules: { crm: true, sales: true, mtm: false },
    })).toEqual({
      crm: true,
      sales: true,
      mtm: false,
      ai_security_monitoring: true,
    })
  })

  it("computes entitlement keys and applies them to features plus modules", () => {
    const routeField = byId("route-field")
    const workforceHrm = byId("workforce-hrm")
    const aiSecurity = byId("ai-security-monitoring")

    expect(entitlementKeysForCapability(routeField)).toEqual(["route-field"])
    expect(entitlementKeysForCapability(workforceHrm)).toEqual(["workforce-hrm"])
    expect(entitlementKeysForCapability(aiSecurity)).toEqual(["ai_security_monitoring"])
    expect(applyCapabilityEntitlement(aiSecurity, {
      features: ["crm", "mtm"],
      modules: { crm: true, mtm: true },
    })).toEqual({
      features: ["crm", "mtm", "ai_security_monitoring"],
      modules: { crm: true, mtm: true, ai_security_monitoring: true },
    })
  })

  it("keeps Route & Field and Workforce independent in all four tenant modes", () => {
    const routeField = byId("route-field")
    const workforceHrm = byId("workforce-hrm")
    const context = (modules: Record<string, boolean>) => ({ plan: "enterprise", role: "admin", modules })

    expect(isTenantCapabilityEnabled(routeField.id, context({}))).toBe(false)
    expect(isTenantCapabilityEnabled(workforceHrm.id, context({}))).toBe(false)

    expect(isTenantCapabilityEnabled(routeField.id, context({ "route-field": true }))).toBe(true)
    expect(isTenantCapabilityEnabled(workforceHrm.id, context({ "route-field": true }))).toBe(false)

    expect(isTenantCapabilityEnabled(routeField.id, context({ "workforce-hrm": true }))).toBe(false)
    expect(isTenantCapabilityEnabled(workforceHrm.id, context({ "workforce-hrm": true }))).toBe(true)

    expect(isTenantCapabilityEnabled(routeField.id, context({ "route-field": true, "workforce-hrm": true }))).toBe(true)
    expect(isTenantCapabilityEnabled(workforceHrm.id, context({ "route-field": true, "workforce-hrm": true }))).toBe(true)
  })

  it("keeps legacy mtm access while an explicit split soft-disable wins", () => {
    const routeField = byId("route-field")
    const workforceHrm = byId("workforce-hrm")
    const legacy = { plan: "enterprise", role: "admin", modules: { mtm: true } }

    expect(isTenantCapabilityEnabled(routeField.id, legacy)).toBe(true)
    expect(isTenantCapabilityEnabled(workforceHrm.id, legacy)).toBe(true)

    const softDisabled = softDisableCapabilityEntitlement(routeField, {
      features: ["mtm", "route-field"],
      modules: { mtm: true, "route-field": true },
    })
    expect(softDisabled).toEqual({
      features: ["mtm"],
      modules: { mtm: true, "route-field": false },
    })
    expect(isTenantCapabilityEnabled(routeField.id, {
      plan: "enterprise",
      role: "admin",
      modules: softDisabled.modules,
    })).toBe(false)
    expect(isTenantCapabilityEnabled(workforceHrm.id, {
      plan: "enterprise",
      role: "admin",
      modules: softDisabled.modules,
    })).toBe(true)
  })

  it("keeps workforce independent from Route & Field and layers attendance add-ons on it", () => {
    const workforce = byId("workforce-hrm")
    const qr = byId("attendance-qr")

    expect(entitlementKeysForCapability(workforce)).toEqual(["workforce-hrm"])
    expect(resolveTenantCapability(workforce, {
      plan: "enterprise",
      role: "admin",
      modules: { "workforce-hrm": true },
    })).toMatchObject({ enabled: true, actions: expect.arrayContaining(["disable"]) })
    expect(resolveTenantCapability(byId("route-field"), {
      plan: "enterprise",
      role: "admin",
      modules: { "workforce-hrm": true },
    }).enabled).toBe(false)
    expect(resolveTenantCapability(qr, {
      plan: "enterprise",
      role: "admin",
      modules: { "attendance-qr": true },
    }).enabled).toBe(false)
    expect(resolveTenantCapability(qr, {
      plan: "enterprise",
      role: "admin",
      modules: { "workforce-hrm": true, "attendance-qr": true },
    }).enabled).toBe(true)
  })

  it("keeps legacy MTM workday access until an explicit Routes-only split is written", () => {
    const workforce = byId("workforce-hrm")

    expect(resolveTenantCapability(workforce, {
      plan: "enterprise",
      modules: { mtm: true },
    })).toMatchObject({ enabled: true, status: "enabled" })
    expect(isTenantCapabilityEnabled("workforce-hrm", {
      plan: "enterprise",
      features: ["mtm"],
      modules: { mtm: true },
    })).toBe(true)

    const routeOnly = removeCapabilityEntitlement(workforce, {
      features: ["mtm"],
      modules: { mtm: true },
    })
    expect(routeOnly).toEqual({
      features: ["mtm"],
      modules: { mtm: true, "workforce-hrm": false },
    })
    expect(isTenantCapabilityEnabled("workforce-hrm", {
      plan: "enterprise",
      features: routeOnly.features,
      modules: routeOnly.modules,
    })).toBe(false)
  })

  it("resolves workforce entitlement directly from Organization-compatible fields", () => {
    expect(isTenantCapabilityEnabled("workforce-hrm", {
      plan: "enterprise",
      features: ["workforce-hrm"],
      modules: { mtm: false },
    })).toBe(true)
    expect(isTenantCapabilityEnabled("route-field", {
      plan: "enterprise",
      features: ["workforce-hrm"],
      modules: { mtm: false },
    })).toBe(false)
  })

  it("reads hidden/requested capability state from tenant settings", () => {
    expect(capabilitySettingsFromTenantSettings({
      marketplaceCapabilities: {
        hidden: ["route-field"],
        requested: { "ai-security-monitoring": true, ignored: false },
      },
    })).toEqual({
      hidden: { "route-field": true },
      requested: { "ai-security-monitoring": true },
    })
  })

  it("merges marketplace capability settings without clobbering unrelated tenant settings", () => {
    expect(mergeCapabilitySettingsIntoTenantSettings({
      locale: "ru",
      marketplaceCapabilities: {
        hidden: { "crm-core": true, "route-field": true },
        requested: ["ai-security-monitoring"],
      },
    }, {
      hidden: { "route-field": false },
      requested: { "da-vinci-ai": true },
    })).toEqual({
      locale: "ru",
      marketplaceCapabilities: {
        hidden: { "crm-core": true },
        requested: { "ai-security-monitoring": true, "da-vinci-ai": true },
      },
    })
  })

  it("marks core CRM modules as included when enabled by group module flags", () => {
    const states = resolveTenantCapabilities({
      plan: "starter",
      role: "admin",
      modules: { crm: true, sales: true, settings: true },
    })

    expect(states.find((state) => state.definition.id === "crm-core")?.status).toBe("included")
    expect(states.find((state) => state.definition.id === "sales-core")?.status).toBe("included")
    expect(states.find((state) => state.definition.id === "settings-core")?.status).toBe("included")
  })

  it("keeps Mars-style legacy feature records working for MTM and base modules", () => {
    const marsLike = {
      plan: "enterprise",
      role: "admin",
      modules: {
        mtm: true,
        core: true,
        deals: true,
        leads: true,
        tasks: true,
        reports: true,
        "knowledge-base": true,
        "custom-fields": true,
        currencies: true,
      },
    }

    expect(resolveTenantCapability(byId("route-field"), marsLike).status).toBe("enabled")
    expect(resolveTenantCapability(byId("crm-core"), marsLike).status).toBe("included")
    expect(resolveTenantCapability(byId("sales-core"), marsLike).status).toBe("included")
  })

  it("treats AI security monitoring as a separate add-on layered on top of the AI module", () => {
    const aiSecurity = byId("ai-security-monitoring")

    expect(resolveTenantCapability(aiSecurity, {
      plan: "enterprise",
      role: "admin",
      modules: { ai: true },
    }).status).toBe("demo")

    expect(resolveTenantCapability(aiSecurity, {
      plan: "enterprise",
      role: "admin",
      modules: { ai: true, ai_security_monitoring: true },
    }).status).toBe("enabled")
  })

  it("does not activate a layered feature when its owner module is disabled", () => {
    const state = resolveTenantCapability(byId("ai-security-monitoring"), {
      plan: "enterprise",
      role: "admin",
      modules: { ai_security_monitoring: true },
    })

    expect(state.enabled).toBe(false)
    expect(state.status).toBe("demo")
    expect(state.reason).toContain("ai")
  })

  it("supports hidden enabled capabilities without losing their entitlement", () => {
    const state = resolveTenantCapability(byId("route-field"), {
      plan: "enterprise",
      role: "admin",
      modules: { mtm: true },
      hidden: { "route-field": true },
    })

    expect(state.status).toBe("hidden")
    expect(state.enabled).toBe(true)
    expect(state.visibleInMenu).toBe(false)
    expect(state.actions).toContain("show")
  })

  it("offers hide for enabled soft-disable modules without unsafe disable", () => {
    const state = resolveTenantCapability(byId("da-vinci-ai"), {
      plan: "enterprise",
      role: "admin",
      modules: { ai: true },
    })

    expect(state.actions).toContain("hide")
    expect(state.actions).not.toContain("disable")
  })

  it("uses app installation status for connectors and setup-required cards", () => {
    const slack = byId("slack-deal-notifier")

    expect(resolveTenantCapability(slack, {
      plan: "professional",
      role: "admin",
      modules: { sales: true },
      installations: {
        "slack-deal-notifier": { status: "active", config: {} },
      },
    }).status).toBe("setup_required")

    expect(resolveTenantCapability(slack, {
      plan: "professional",
      role: "admin",
      modules: { sales: true },
      installations: {
        "slack-deal-notifier": { status: "active", config: { channel: "#sales-wins" } },
      },
    }).status).toBe("enabled")
  })

  it("offers disable and enable actions for app-backed capabilities", () => {
    const leadScoring = byId("lead-scoring-template")

    const enabled = resolveTenantCapability(leadScoring, {
      plan: "enterprise",
      role: "admin",
      modules: { sales: true },
      installations: {
        "lead-scoring-rules": {
          status: "active",
          config: { __marketplaceProvisioning: { setupComplete: true } },
        },
      },
    })
    expect(enabled.actions).toContain("disable")
    expect(enabled.actions).not.toContain("enable")

    const disabled = resolveTenantCapability(leadScoring, {
      plan: "enterprise",
      role: "admin",
      modules: { sales: true },
      installations: {
        "lead-scoring-rules": {
          status: "disabled",
          config: { __marketplaceProvisioning: { setupComplete: true } },
        },
      },
    })
    expect(disabled.actions).toContain("enable")
    expect(disabled.actions).not.toContain("disable")
  })

  it("does not offer destructive disable actions for hide-only core modules", () => {
    const state = resolveTenantCapability(byId("crm-core"), {
      plan: "starter",
      role: "admin",
      modules: { crm: true },
    })

    expect(state.actions).toContain("hide")
    expect(state.actions).not.toContain("disable")
  })

  it("lets normal users view demos and request access but not configure or disable", () => {
    const state = resolveTenantCapability(byId("da-vinci-ai"), {
      plan: "starter",
      role: "viewer",
      modules: { crm: true, sales: true, settings: true },
    })

    expect(state.status).toBe("demo")
    expect(state.actions).toContain("view_demo")
    expect(state.actions).toContain("request_access")
    expect(state.actions).not.toContain("configure")
    expect(state.actions).not.toContain("disable")
  })

  it("marks requested paid capabilities separately from demo-only browsing", () => {
    const state = resolveTenantCapability(byId("ai-security-monitoring"), {
      plan: "professional",
      role: "admin",
      modules: { ai: true },
      requested: { "ai-security-monitoring": true },
    })

    expect(state.status).toBe("requested")
    expect(state.visibleInMenu).toBe(false)
  })

  it("can resolve custom marketplace definitions without changing schema", () => {
    const custom: TenantCapabilityDefinition = {
      id: "custom-security-pack",
      label: "Custom Security Pack",
      description: "Contracted enterprise controls.",
      kind: "security_pack",
      billing: "contract",
      featureKey: "custom_security_pack",
      demoAvailable: false,
      disableMode: "soft_disable",
    }

    expect(resolveTenantCapability(custom, {
      plan: "enterprise",
      role: "superadmin",
      modules: { custom_security_pack: true },
    }).status).toBe("enabled")
  })
})
