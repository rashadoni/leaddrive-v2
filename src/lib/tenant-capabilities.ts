import { hasModule, type ModuleId } from "@/lib/modules"

export const ADVISOR_SUITE_MODULE_IDS: ModuleId[] = [
  "crm",
  "sales",
  "contracts",
  "marketing",
  "support",
  "finance",
  "analytics",
  "mtm",
  "settings",
]

export const ADVISOR_SUITE_ADDONS = ["ai", "finance", "mtm"] as const

export const ADVISOR_SUITE_SETTINGS_DEFAULTS = {
  aiDailyBudgetUsd: 10,
  aiAdvisorDailyRequestLimit: 300,
  aiAdvisorExecutionEnabled: true,
  aiAdvisorExecutionDisabled: false,
  aiAdvisorExecutionDailyLimit: 100,
  aiAdvisorActionTypeDailyLimit: 25,
  aiAdvisorMaxAutonomyLevel: "L2",
} as const

export type TenantCapabilityKind =
  | "native_module"
  | "template_pack"
  | "connector"
  | "industry_module"
  | "security_pack"
  | "ai_addon"

export type TenantCapabilityBilling =
  | "included"
  | "paid_addon"
  | "enterprise"
  | "contract"

export type TenantCapabilityStatus =
  | "included"
  | "enabled"
  | "hidden"
  | "demo"
  | "requested"
  | "requires_plan"
  | "setup_required"
  | "disabled"

export type TenantCapabilityAction =
  | "open"
  | "view_demo"
  | "request_access"
  | "configure"
  | "hide"
  | "show"
  | "disable"
  | "enable"

export type TenantCapabilityDisableMode = "none" | "hide_only" | "soft_disable"

/**
 * Product capabilities that used to travel together under the broad `mtm`
 * entitlement. They are intentionally not ModuleIds: unlike sidebar groups,
 * these are independently sellable/runtime-gated domain capabilities.
 */
export const FIELD_TENANT_CAPABILITY_IDS = [
  "route-field",
  "workforce-hrm",
] as const

export type FieldTenantCapabilityId = (typeof FIELD_TENANT_CAPABILITY_IDS)[number]

export interface TenantCapabilityDefinition {
  id: string
  label: string
  description: string
  kind: TenantCapabilityKind
  billing: TenantCapabilityBilling
  ownerModule?: ModuleId
  /**
   * A capability can be layered on another capability without inventing a
   * fake group module.  Workforce add-ons deliberately use this instead of
   * `ownerModule: "mtm"`: HRM is sellable without routes.
   */
  ownerFeatureKey?: string
  moduleId?: ModuleId
  featureKey?: string
  /**
   * Read-only compatibility grants for tenants provisioned before a capability
   * received its own entitlement key. New approvals never write these keys.
   */
  legacyModuleIds?: readonly ModuleId[]
  /**
   * Allows a tenant administrator to write this capability's feature key
   * directly. Keep this opt-in: generic module-backed capabilities may have
   * billing, provisioning, or rollback rules that cannot safely be inferred
   * from an on/off flag.
   */
  directEntitlementManagement?: boolean
  appSlug?: string
  demoAvailable?: boolean
  requiresSetup?: boolean
  disableMode: TenantCapabilityDisableMode
}

export interface TenantAppInstallationState {
  status: "active" | "disabled" | string
  config?: Record<string, unknown> | null
}

export interface TenantCapabilityContext {
  plan: string
  role?: string
  addons?: string[]
  modules?: Record<string, boolean>
  installations?: Record<string, TenantAppInstallationState | null | undefined>
  hidden?: Record<string, boolean>
  requested?: Record<string, boolean>
}

export interface TenantCapabilityState {
  definition: TenantCapabilityDefinition
  status: TenantCapabilityStatus
  reason: string
  actions: TenantCapabilityAction[]
  enabled: boolean
  visibleInMenu: boolean
}

export interface TenantCapabilitySettings {
  hidden?: Record<string, boolean>
  requested?: Record<string, boolean>
}

export interface TenantCapabilityEntitlementPatch {
  features: string[]
  modules: Record<string, boolean>
}

export interface AdvisorSuiteActivationPatch extends TenantCapabilityEntitlementPatch {
  addons: string[]
  settings: Record<string, unknown>
}

export function featuresToModuleRecord(features: unknown): Record<string, boolean> {
  const values = featuresToStringArray(features)
  const modules: Record<string, boolean> = {}
  for (const value of values) {
    modules[value] = true
  }
  return modules
}

export function featuresToStringArray(features: unknown): string[] {
  let values: unknown[] = []
  if (Array.isArray(features)) {
    values = features
  } else if (typeof features === "string") {
    try {
      const parsed = JSON.parse(features || "[]")
      if (Array.isArray(parsed)) values = parsed
    } catch {
      values = []
    }
  }

  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (typeof value === "string" && !seen.has(value)) {
      seen.add(value)
      result.push(value)
    }
  }
  return result
}

export function tenantModulesFromFields(fields: { features?: unknown; modules?: unknown }): Record<string, boolean> {
  return {
    ...featuresToModuleRecord(fields.features),
    ...booleanRecord(fields.modules),
  }
}

export function capabilitySettingsFromTenantSettings(settings: unknown): TenantCapabilitySettings {
  const root = asRecord(settings)
  const marketplace = asRecord(root?.marketplaceCapabilities) ?? asRecord(root?.capabilities)
  return {
    hidden: truthyStringMap(marketplace?.hidden),
    requested: truthyStringMap(marketplace?.requested),
  }
}

export function mergeCapabilitySettingsIntoTenantSettings(
  settings: unknown,
  patch: TenantCapabilitySettings,
): Record<string, unknown> {
  const root = { ...(asRecord(settings) ?? {}) }
  const marketplace = { ...(asRecord(root.marketplaceCapabilities) ?? {}) }

  if (patch.hidden) {
    marketplace.hidden = mergeBooleanMap(marketplace.hidden, patch.hidden)
  }
  if (patch.requested) {
    marketplace.requested = mergeBooleanMap(marketplace.requested, patch.requested)
  }

  return {
    ...root,
    marketplaceCapabilities: marketplace,
  }
}

export function getTenantCapabilityDefinition(capabilityId: string): TenantCapabilityDefinition | undefined {
  return TENANT_CAPABILITY_CATALOG.find((capability) => capability.id === capabilityId)
}

/**
 * Resolve a capability from the fields carried by an Organization row.  This
 * keeps auth/bootstrap code on the same entitlement semantics as the admin
 * capability catalog, while avoiding a second database read in hot paths.
 */
export function isTenantCapabilityEnabled(
  capabilityId: string,
  fields: {
    plan?: string | null
    role?: string
    addons?: unknown
    features?: unknown
    modules?: unknown
    hidden?: Record<string, boolean>
    requested?: Record<string, boolean>
  },
): boolean {
  const definition = getTenantCapabilityDefinition(capabilityId)
  if (!definition) return false
  return resolveTenantCapability(definition, {
    plan: fields.plan || "starter",
    role: fields.role,
    addons: featuresToStringArray(fields.addons),
    modules: tenantModulesFromFields(fields),
    hidden: fields.hidden,
    requested: fields.requested,
  }).enabled
}

export function entitlementKeysForCapability(definition: TenantCapabilityDefinition): string[] {
  return [...new Set([
    definition.moduleId,
    definition.featureKey,
  ].filter((key): key is string => Boolean(key)))]
}

export function applyCapabilityEntitlement(
  definition: TenantCapabilityDefinition,
  fields: { features?: unknown; modules?: unknown },
): TenantCapabilityEntitlementPatch {
  const keys = entitlementKeysForCapability(definition)
  const features = featuresToStringArray(fields.features)
  const modules = tenantModulesFromFields(fields)

  for (const key of keys) {
    if (!features.includes(key)) features.push(key)
    modules[key] = true
  }

  return { features, modules }
}

/**
 * Soft-disables an entitlement without deleting tenant data. The explicit
 * `false` marker wins over a legacy MTM grant, so either independently sold
 * field capability can be turned off while the other remains available during
 * the compatibility window.
 */
export function removeCapabilityEntitlement(
  definition: TenantCapabilityDefinition,
  fields: { features?: unknown; modules?: unknown },
): TenantCapabilityEntitlementPatch {
  const keys = entitlementKeysForCapability(definition)
  const features = featuresToStringArray(fields.features).filter((key) => !keys.includes(key))
  const modules = tenantModulesFromFields(fields)

  for (const key of keys) modules[key] = false

  return { features, modules }
}

/** Legacy name retained for settings callers during the capability split. */
export const softDisableCapabilityEntitlement = removeCapabilityEntitlement

export function applyAdvisorSuiteActivation(fields: {
  features?: unknown
  modules?: unknown
  addons?: unknown
  settings?: unknown
}): AdvisorSuiteActivationPatch {
  const features = featuresToStringArray(fields.features)
  const modules = tenantModulesFromFields(fields)
  const addons = featuresToStringArray(fields.addons)
  const settings = { ...(asRecord(fields.settings) ?? {}) }

  for (const moduleId of ADVISOR_SUITE_MODULE_IDS) {
    if (!features.includes(moduleId)) features.push(moduleId)
    modules[moduleId] = true
  }
  for (const addon of ADVISOR_SUITE_ADDONS) {
    if (!addons.includes(addon)) addons.push(addon)
  }

  settings.aiDailyBudgetUsd = positiveNumberOrDefault(
    settings.aiDailyBudgetUsd,
    ADVISOR_SUITE_SETTINGS_DEFAULTS.aiDailyBudgetUsd,
  )
  settings.aiAdvisorDailyRequestLimit = positiveNumberOrDefault(
    settings.aiAdvisorDailyRequestLimit,
    ADVISOR_SUITE_SETTINGS_DEFAULTS.aiAdvisorDailyRequestLimit,
  )
  settings.aiAdvisorExecutionDailyLimit = positiveNumberOrDefault(
    settings.aiAdvisorExecutionDailyLimit,
    ADVISOR_SUITE_SETTINGS_DEFAULTS.aiAdvisorExecutionDailyLimit,
  )
  settings.aiAdvisorActionTypeDailyLimit = positiveNumberOrDefault(
    settings.aiAdvisorActionTypeDailyLimit,
    ADVISOR_SUITE_SETTINGS_DEFAULTS.aiAdvisorActionTypeDailyLimit,
  )
  settings.aiAdvisorExecutionEnabled = true
  settings.aiAdvisorExecutionDisabled = false
  if (typeof settings.aiAdvisorMaxAutonomyLevel !== "string" || !settings.aiAdvisorMaxAutonomyLevel) {
    settings.aiAdvisorMaxAutonomyLevel = ADVISOR_SUITE_SETTINGS_DEFAULTS.aiAdvisorMaxAutonomyLevel
  }

  return { features, modules, addons, settings }
}

export const TENANT_CAPABILITY_CATALOG: TenantCapabilityDefinition[] = [
  {
    id: "crm-core",
    label: "CRM Core",
    description: "Companies, contacts, products, boards, projects, and shared CRM records.",
    kind: "native_module",
    billing: "included",
    moduleId: "crm",
    disableMode: "hide_only",
  },
  {
    id: "sales-core",
    label: "Sales Core",
    description: "Leads, deals, quotes, sequences, forecast, and sales setup.",
    kind: "native_module",
    billing: "included",
    moduleId: "sales",
    disableMode: "hide_only",
  },
  {
    id: "settings-core",
    label: "Settings Core",
    description: "Users, roles, API keys, audit, security, and tenant configuration.",
    kind: "native_module",
    billing: "included",
    moduleId: "settings",
    disableMode: "hide_only",
  },
  {
    id: "route-field",
    label: "Route & Field",
    description: "Routes, visits, tasks, photos, agents, field analytics, and MTM operations.",
    kind: "industry_module",
    billing: "paid_addon",
    featureKey: "route-field",
    // Existing MTM tenants keep their working route/visit access until their
    // entitlement is explicitly split. New grants write only `route-field`.
    legacyModuleIds: ["mtm"],
    directEntitlementManagement: true,
    demoAvailable: true,
    disableMode: "soft_disable",
  },
  {
    id: "workforce-hrm",
    label: "Workforce HRM",
    description: "Work time, timesheets, attendance requests, and workforce policies.",
    kind: "industry_module",
    billing: "paid_addon",
    featureKey: "workforce-hrm",
    // MTM was the historical bundle. Preserve it as a compatibility grant but
    // never make it a prerequisite for a new HRM-only tenant.
    legacyModuleIds: ["mtm"],
    directEntitlementManagement: true,
    demoAvailable: true,
    disableMode: "soft_disable",
  },
  {
    id: "attendance-qr",
    label: "Attendance QR",
    description: "Rotating QR attendance stations and their verification policies.",
    kind: "security_pack",
    billing: "paid_addon",
    featureKey: "attendance-qr",
    ownerFeatureKey: "workforce-hrm",
    demoAvailable: true,
    disableMode: "soft_disable",
  },
  {
    id: "attendance-device-trust",
    label: "Attendance device trust",
    description: "Trusted attendance devices and local-device confirmation policies.",
    kind: "security_pack",
    billing: "paid_addon",
    featureKey: "attendance-device-trust",
    ownerFeatureKey: "workforce-hrm",
    demoAvailable: true,
    disableMode: "soft_disable",
  },
  {
    id: "da-vinci-ai",
    label: "Da Vinci AI",
    description: "AI analytics, recommendations, actions, and automation assistance.",
    kind: "ai_addon",
    billing: "paid_addon",
    moduleId: "ai",
    demoAvailable: true,
    disableMode: "soft_disable",
  },
  {
    id: "ai-security-monitoring",
    label: "AI Security Monitoring",
    description: "AI request audit, DLP/redaction, retention controls, and security export.",
    kind: "security_pack",
    billing: "enterprise",
    ownerModule: "ai",
    featureKey: "ai_security_monitoring",
    demoAvailable: true,
    disableMode: "soft_disable",
  },
  {
    id: "slack-deal-notifier",
    label: "Slack Deal Notifier",
    description: "Send Slack notifications when deals are won.",
    kind: "connector",
    billing: "paid_addon",
    ownerModule: "sales",
    appSlug: "slack-deal-notifier",
    demoAvailable: true,
    requiresSetup: true,
    disableMode: "soft_disable",
  },
  {
    id: "lead-scoring-template",
    label: "Lead Scoring Template",
    description: "Ready scoring fields and recompute hooks for the existing leads module.",
    kind: "template_pack",
    billing: "included",
    ownerModule: "sales",
    appSlug: "lead-scoring-rules",
    demoAvailable: true,
    disableMode: "soft_disable",
  },
]

export function resolveTenantCapability(
  definition: TenantCapabilityDefinition,
  context: TenantCapabilityContext,
): TenantCapabilityState {
  const installation = definition.appSlug ? context.installations?.[definition.appSlug] : undefined
  const moduleEnabled = definition.moduleId ? hasModule(context, definition.moduleId) : false
  const ownerEnabled = definition.ownerModule
    ? hasModule(context, definition.ownerModule)
    : definition.ownerFeatureKey
      ? context.modules?.[definition.ownerFeatureKey] === true
      : true
  const featureState = definition.featureKey ? context.modules?.[definition.featureKey] : undefined
  const explicitlyDisabled = featureState === false
  const legacyModuleEnabled = !explicitlyDisabled && Boolean(
    definition.legacyModuleIds?.some((moduleId) => hasModule(context, moduleId)),
  )
  const featureEnabled = featureState === true || legacyModuleEnabled
  const isTenantAdmin = context.role === "admin" || context.role === "superadmin"
  const isHidden = context.hidden?.[definition.id] === true

  let status: TenantCapabilityStatus
  let reason: string
  let enabled = false

  if (installation?.status === "disabled") {
    status = "disabled"
    reason = "Installed for this tenant, but currently disabled."
  } else if (explicitlyDisabled) {
    status = "disabled"
    reason = "Disabled for this tenant while preserving historical data."
  } else if (installation?.status === "active") {
    enabled = true
    status = definition.requiresSetup && !hasRequiredSetup(installation.config)
      ? "setup_required"
      : "enabled"
    reason = status === "setup_required"
      ? "Installed, but configuration or credentials are still required."
      : "Installed and active for this tenant."
  } else if (definition.featureKey && featureEnabled && ownerEnabled) {
    enabled = true
    status = definition.billing === "included" ? "included" : "enabled"
    reason = legacyModuleEnabled
      ? "Enabled by a legacy tenant entitlement during the compatibility window."
      : "Enabled by this tenant's feature flags."
  } else if (definition.moduleId && moduleEnabled) {
    enabled = true
    status = definition.billing === "included" ? "included" : "enabled"
    reason = definition.billing === "included"
      ? "Included in this tenant's active CRM package."
      : "Enabled by this tenant's module entitlement."
  } else if (legacyModuleEnabled && ownerEnabled) {
    enabled = true
    status = definition.billing === "included" ? "included" : "enabled"
    reason = "Enabled by a legacy tenant entitlement during the compatibility window."
  } else if (context.requested?.[definition.id] === true) {
    status = "requested"
    reason = "Access has been requested and is waiting for approval."
  } else if (!ownerEnabled) {
    status = definition.demoAvailable ? "demo" : "requires_plan"
    const owner = definition.ownerModule ?? definition.ownerFeatureKey
    reason = `Requires the ${owner} capability before it can be activated.`
  } else if (definition.demoAvailable) {
    status = "demo"
    reason = "Demo is available, but live activation requires admin or LeadDrive approval."
  } else {
    status = "requires_plan"
    reason = "Not available in this tenant's current plan or contract."
  }

  if (enabled && isHidden) {
    status = "hidden"
    reason = "Enabled for this tenant, but hidden from navigation."
  }

  return {
    definition,
    status,
    reason,
    actions: resolveCapabilityActions(definition, status, isTenantAdmin),
    enabled,
    visibleInMenu: enabled && status !== "hidden" && status !== "disabled",
  }
}

export function resolveTenantCapabilities(
  context: TenantCapabilityContext,
  catalog: TenantCapabilityDefinition[] = TENANT_CAPABILITY_CATALOG,
): TenantCapabilityState[] {
  return catalog.map((definition) => resolveTenantCapability(definition, context))
}

function resolveCapabilityActions(
  definition: TenantCapabilityDefinition,
  status: TenantCapabilityStatus,
  isTenantAdmin: boolean,
): TenantCapabilityAction[] {
  const actions: TenantCapabilityAction[] = []

  if (status === "included" || status === "enabled") actions.push("open")
  if (status === "hidden" && isTenantAdmin) actions.push("show")
  if (status === "disabled" && isTenantAdmin && definition.appSlug) actions.push("enable")
  if (status === "setup_required" && isTenantAdmin) actions.push("configure")
  if ((status === "demo" || status === "requires_plan") && definition.demoAvailable) actions.push("view_demo")
  if ((status === "demo" || status === "requires_plan") && !isTenantAdmin) actions.push("request_access")
  if ((status === "demo" || status === "requires_plan") && isTenantAdmin) actions.push("request_access")

  if ((status === "included" || status === "enabled" || status === "setup_required" || status === "hidden") && isTenantAdmin) {
    if (status !== "hidden" && (definition.disableMode === "hide_only" || definition.disableMode === "soft_disable")) actions.push("hide")
    // Feature-backed capabilities can be soft-disabled without deleting their
    // history. Direct management keeps the Route & Field split explicitly
    // opt-in rather than inferring billing behavior from a generic module.
    if (definition.disableMode === "soft_disable" && (
      definition.appSlug || definition.featureKey || definition.directEntitlementManagement
    )) actions.push("disable")
  }
  if (status === "disabled" && isTenantAdmin && (definition.appSlug || definition.directEntitlementManagement)) {
    actions.push("enable")
  }

  return [...new Set(actions)]
}

function hasRequiredSetup(config: Record<string, unknown> | null | undefined): boolean {
  if (!config) return false
  const provisioning = asRecord(config.__marketplaceProvisioning)
  if (typeof provisioning?.setupComplete === "boolean") return provisioning.setupComplete
  return Object.values(config).some((value) => value !== null && value !== undefined && value !== "")
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function positiveNumberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback
}

function truthyStringMap(value: unknown): Record<string, boolean> | undefined {
  if (Array.isArray(value)) {
    const map: Record<string, boolean> = {}
    for (const item of value) {
      if (typeof item === "string") map[item] = true
    }
    return Object.keys(map).length > 0 ? map : undefined
  }
  const record = asRecord(value)
  if (!record) return undefined
  const map: Record<string, boolean> = {}
  for (const [key, enabled] of Object.entries(record)) {
    if (enabled === true) map[key] = true
  }
  return Object.keys(map).length > 0 ? map : undefined
}

function booleanRecord(value: unknown): Record<string, boolean> {
  const record = asRecord(value)
  if (!record) return {}
  const map: Record<string, boolean> = {}
  for (const [key, enabled] of Object.entries(record)) {
    if (typeof enabled === "boolean") map[key] = enabled
  }
  return map
}

function mergeBooleanMap(
  current: unknown,
  patch: Record<string, boolean>,
): Record<string, boolean> {
  const next = { ...(truthyStringMap(current) ?? {}) }
  for (const [key, enabled] of Object.entries(patch)) {
    if (enabled) {
      next[key] = true
    } else {
      delete next[key]
    }
  }
  return next
}
