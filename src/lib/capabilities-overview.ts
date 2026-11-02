import { hasModule, type ModuleId } from "@/lib/modules"
import { accessibleNavItems, NAV_ORG_SETTING_KEYS, type OrgNavContext } from "@/lib/nav-items"
import { checkPermission, type Role } from "@/lib/permissions"
import { capabilitySettingsFromTenantSettings, getTenantCapabilityDefinition, resolveTenantCapability, tenantModulesFromFields } from "@/lib/tenant-capabilities"
import { effectiveHiddenModules, moduleContextForUser } from "@/lib/user-module-access"

export type CapabilityGoal = "customers" | "team" | "operations" | "industry"
export type OverviewStatus = "available" | "requires_access" | "requested" | "restricted"

interface OverviewDefinition {
  id: string
  module: ModuleId
  goal: CapabilityGoal
  capabilityId?: string
  openPath?: string
  setupPath?: string
}

/** Presentation metadata only. Existing module, capability and navigation gates decide access. */
export const CAPABILITIES_OVERVIEW_CATALOG: readonly OverviewDefinition[] = [
  { id: "crm", module: "crm", goal: "customers", openPath: "/companies" },
  { id: "sales", module: "sales", goal: "customers", openPath: "/deals", setupPath: "/settings/pipelines" },
  { id: "omnichannel", module: "omnichannel", goal: "customers", openPath: "/inbox", setupPath: "/settings/channels" },
  { id: "voip", module: "voip", goal: "customers", openPath: "/voip/insights", setupPath: "/settings/channels" },
  { id: "marketing", module: "marketing", goal: "customers", openPath: "/campaigns" },
  { id: "loyalty", module: "loyalty", goal: "customers", openPath: "/loyalty/dashboard" },
  { id: "support", module: "support", goal: "team", openPath: "/tickets" },
  { id: "route-field", module: "mtm", goal: "team", capabilityId: "route-field", openPath: "/mtm/routes", setupPath: "/mtm/settings" },
  { id: "personnel", module: "mtm", goal: "team", capabilityId: "personnel", openPath: "/mtm/attendance", setupPath: "/mtm/attendance/settings" },
  { id: "contracts", module: "contracts", goal: "operations", openPath: "/contracts" },
  { id: "finance", module: "finance", goal: "operations" },
  { id: "analytics", module: "analytics", goal: "operations" },
  { id: "social", module: "social", goal: "operations", capabilityId: "brand-monitoring", openPath: "/social-monitoring" },
  { id: "ai", module: "ai", goal: "operations", capabilityId: "da-vinci-ai" },
  { id: "settings", module: "settings", goal: "operations", openPath: "/settings/integrations", setupPath: "/settings/integrations" },
  { id: "health", module: "health", goal: "industry" },
  { id: "insurance", module: "insurance", goal: "industry" },
  { id: "public-sector", module: "public-sector", goal: "industry" },
  { id: "media", module: "media", goal: "industry" },
  { id: "energy", module: "energy", goal: "industry" },
]

export interface CapabilityOverviewEntry {
  id: string
  goal: CapabilityGoal
  status: OverviewStatus
  openHref: string | null
  setupHref: string | null
}

export interface CapabilityOverview {
  capabilities: CapabilityOverviewEntry[]
  canManage: boolean
  installedAppsCount: number
}

export function resolveCapabilitiesOverview(
  org: { plan: string; addons?: string[]; features?: unknown; modules?: unknown; settings?: unknown },
  auth: { role: Role; hiddenModules?: readonly string[] },
  installedAppsCount = 0,
): CapabilityOverview {
  const modules = tenantModulesFromFields(org)
  const hiddenModules = effectiveHiddenModules(auth.role, auth.hiddenModules)
  const orgSettings: NonNullable<OrgNavContext["orgSettings"]> = {}
  const settings = org.settings && typeof org.settings === "object" && !Array.isArray(org.settings)
    ? org.settings as Record<string, unknown> : {}
  for (const key of NAV_ORG_SETTING_KEYS) {
    if (typeof settings[key] === "boolean") orgSettings[key] = settings[key]
  }
  const context = moduleContextForUser({ plan: org.plan, addons: org.addons ?? [], modules, role: auth.role, hiddenModules, orgSettings }, { hiddenModules })
  const navigation = accessibleNavItems(context)
  const capabilitySettings = capabilitySettingsFromTenantSettings(org.settings)
  const canManage = (auth.role === "admin" || auth.role === "superadmin") && checkPermission(auth.role, "settings", "write")
  const capabilities: CapabilityOverviewEntry[] = []

  for (const definition of CAPABILITIES_OVERVIEW_CATALOG) {
    const capability = definition.capabilityId ? getTenantCapabilityDefinition(definition.capabilityId) : undefined
    const enabled = capability
      ? resolveTenantCapability(capability, { ...context, requested: capabilitySettings.requested }).enabled
      : hasModule(context, definition.module)
    // Industry products are shown only to tenants that actually have them.
    if (definition.goal === "industry" && !enabled) continue
    const hidden = hiddenModules.includes(definition.module as typeof hiddenModules[number])
    const fieldCapability = definition.capabilityId === "route-field" || definition.capabilityId === "personnel"
    const candidates = navigation.filter(item => !item.href.startsWith("/marketplace") && (
      fieldCapability
        ? (item.tenantCapability ?? item.capability) === definition.capabilityId
        : item.module === definition.module || definition.module === "ai" && item.addon === "ai"
    ))
    const open = navigation.find(item => item.href === definition.openPath) ?? candidates.find(item => !item.href.startsWith("/settings/")) ?? candidates[0]
    const setup = canManage && enabled ? navigation.find(item => item.href === definition.setupPath) : undefined
    const requested = definition.capabilityId && capabilitySettings.requested?.[definition.capabilityId] === true
    capabilities.push({
      id: definition.id,
      goal: definition.goal,
      status: hidden || enabled && !open ? "restricted" : enabled ? "available" : requested ? "requested" : "requires_access",
      openHref: enabled && !hidden ? open?.href ?? null : null,
      setupHref: !hidden ? setup?.href ?? null : null,
    })
  }
  return { capabilities, canManage, installedAppsCount }
}
