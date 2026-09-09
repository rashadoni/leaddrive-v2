import { hasModule, LEGACY_MODULE_MAP, MODULE_REGISTRY, type ModuleId } from "@/lib/modules"
import { checkPermission, type Module, type Role } from "@/lib/permissions"
import type { AdvisorCapability, AdvisorDomainKey } from "./types"
import { featureFlagsToArray } from "@/lib/modules"

export interface AdvisorOrgContext {
  plan: string
  addons?: string[]
  modules?: Record<string, boolean>
}

export interface AdvisorDomainDefinition {
  key: AdvisorDomainKey
  label: string
  moduleId: ModuleId
  permissionModules: Module[]
  href: string
}

export const ADVISOR_DOMAINS: AdvisorDomainDefinition[] = [
  { key: "crm", label: "CRM", moduleId: "crm", permissionModules: ["companies", "contacts", "leads"], href: "/companies" },
  { key: "sales", label: "Sales", moduleId: "sales", permissionModules: ["deals", "offers"], href: "/deals" },
  { key: "contracts", label: "Contracts", moduleId: "contracts", permissionModules: ["contracts"], href: "/contracts" },
  { key: "marketing", label: "Marketing", moduleId: "marketing", permissionModules: ["campaigns", "segments", "journeys"], href: "/campaigns" },
  { key: "tasks", label: "Tasks & Projects", moduleId: "crm", permissionModules: ["tasks", "projects"], href: "/boards" },
  { key: "finance", label: "Finance", moduleId: "finance", permissionModules: ["invoices", "payments"], href: "/finance" },
  { key: "support", label: "Ticketing", moduleId: "support", permissionModules: ["tickets"], href: "/tickets" },
  { key: "routes", label: "Routes", moduleId: "mtm", permissionModules: ["mtm"], href: "/mtm/routes" },
  { key: "mtm", label: "Routes & Field", moduleId: "mtm", permissionModules: ["mtm"], href: "/mtm/visits" },
  { key: "kpi", label: "KPI / Managers", moduleId: "analytics", permissionModules: ["reports", "profitability"], href: "/leaderboard" },
]

export function normalizeOrgModules(raw: unknown): Record<string, boolean> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined
  const out: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    out[key] = value === true
  }
  return out
}

export function featuresToModuleMap(features: unknown): Record<string, boolean> | undefined {
  // Запакованная в строку форма встречалась на проде: без разбора карта
  // модулей выходила пустой, и советник считал тенанта безмодульным.
  const flags = featureFlagsToArray(features)
  if (flags.length === 0 && !Array.isArray(features)) return undefined
  const out: Record<string, boolean> = {}
  for (const value of flags) {
    if (typeof value !== "string") continue
    out[value] = true
    const mapped = LEGACY_MODULE_MAP[value]
    if (mapped) out[mapped] = true
  }
  return out
}

export function mergeAdvisorModuleMaps(
  fallback?: Record<string, boolean>,
  authoritative?: Record<string, boolean>,
): Record<string, boolean> | undefined {
  if (!fallback && !authoritative) return undefined
  return {
    ...(fallback || {}),
    ...(authoritative || {}),
  }
}

export function buildAdvisorCapabilities(org: AdvisorOrgContext, role?: string | null): AdvisorCapability[] {
  return ADVISOR_DOMAINS.map((domain) => {
    const enabled = hasModule(org, domain.moduleId)
    const hasReadAccess = !role || hasAdvisorDomainReadAccess(role, domain)
    const status = enabled ? hasReadAccess ? "active" : "no_access" : "locked"
    return {
      key: domain.key,
      label: domain.label,
      moduleId: domain.moduleId,
      href: domain.href,
      status,
      reason: enabled
        ? hasReadAccess ? undefined : `Role ${role} cannot read ${domain.label} Advisor sources.`
        : `${MODULE_REGISTRY[domain.moduleId].name} is not enabled for this tenant.`,
    }
  })
}

export function capabilityFor(capabilities: AdvisorCapability[], key: AdvisorDomainKey): AdvisorCapability | undefined {
  return capabilities.find((capability) => capability.key === key)
}

function hasAdvisorDomainReadAccess(role: string, domain: AdvisorDomainDefinition): boolean {
  return domain.permissionModules.some((module) => checkPermission(role as Role, module, "read"))
}
