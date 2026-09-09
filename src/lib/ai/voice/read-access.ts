import { LEGACY_MODULE_MAP, hasModule, type ModuleId } from "@/lib/modules"
import { canRead, checkPermission, type Module, type Role } from "@/lib/permissions"
import { isNavItemEnabled } from "@/lib/nav-items"
import { SECTION_DESCRIPTORS } from "./section-registry"
import { VOICE_SECTION_KEYS, VOICE_SECTIONS, voiceSectionNavItem } from "./sections"
import type { VoiceRecordType } from "./record-types"

export type { VoiceRecordType } from "./record-types"

export type VoiceOrgModuleContext = {
  plan: string
  addons: string[]
  modules: Record<string, boolean>
}

type VoiceDataAccess = {
  module: ModuleId
  permission: Module
  feature?: string
}

export const VOICE_RECORD_ACCESS: Record<VoiceRecordType, VoiceDataAccess> = {
  deal: { module: "sales", permission: "deals" },
  contact: { module: "crm", permission: "contacts" },
  company: { module: "crm", permission: "companies" },
  lead: { module: "sales", permission: "leads" },
  ticket: { module: "support", permission: "tickets" },
  invoice: { module: "finance", permission: "invoices" },
  project: { module: "crm", permission: "projects" },
  contract: { module: "contracts", permission: "contracts" },
  board: { module: "crm", permission: "tasks" },
  product: { module: "crm", permission: "companies" },
  quote: { module: "sales", permission: "offers" },
  campaign: { module: "marketing", permission: "campaigns" },
  complaint: { module: "support", permission: "tickets", feature: "complaints_register" },
  event: { module: "marketing", permission: "events" },
  task: { module: "crm", permission: "tasks" },
}

export type VoiceOverduePart = "tasks" | "invoices" | "deals"

export const VOICE_OVERDUE_ACCESS: Record<VoiceOverduePart, VoiceDataAccess> = {
  tasks: { module: "crm", permission: "tasks" },
  invoices: { module: "finance", permission: "invoices" },
  deals: { module: "sales", permission: "deals" },
}

export type VoiceWorkloadFocus = "tasks" | "leads" | "deals" | "tickets"

export const VOICE_WORKLOAD_ACCESS: Record<VoiceWorkloadFocus, VoiceDataAccess> = {
  tasks: { module: "crm", permission: "tasks" },
  leads: { module: "sales", permission: "leads" },
  deals: { module: "sales", permission: "deals" },
  tickets: { module: "support", permission: "tickets" },
}

export function canAccessVoiceData(
  role: Role,
  org: VoiceOrgModuleContext,
  access: VoiceDataAccess,
): boolean {
  return canRead(role, access.permission)
    && hasModule(org, access.module)
    && (!access.feature || org.modules?.[access.feature] === true)
}

export function canAccessVoiceRecord(
  role: Role,
  org: VoiceOrgModuleContext,
  type: VoiceRecordType,
): boolean {
  return canAccessVoiceData(role, org, VOICE_RECORD_ACCESS[type])
}

export function canAccessAllVoiceOverdueData(
  role: Role,
  org: VoiceOrgModuleContext,
): boolean {
  return Object.values(VOICE_OVERDUE_ACCESS).every((access) => canAccessVoiceData(role, org, access))
}

export function canAccessVoiceWorkload(
  role: Role,
  org: VoiceOrgModuleContext,
  focus: VoiceWorkloadFocus | "all",
): boolean {
  if (focus === "all") {
    return Object.values(VOICE_WORKLOAD_ACCESS).every((access) => canAccessVoiceData(role, org, access))
  }
  return canAccessVoiceData(role, org, VOICE_WORKLOAD_ACCESS[focus])
}

/**
 * A section guide is visible only when the real sidebar page is visible. This
 * deliberately starts from VOICE_SECTIONS: SECTION_GUIDE also documents
 * settings pages that voice navigation excludes because they expose secrets or
 * tenant administration. A guide key existing is therefore not authorization.
 */
export function canAccessVoiceSection(
  role: Role,
  org: VoiceOrgModuleContext,
  section: string,
): boolean {
  const path = VOICE_SECTIONS[section]
  if (!path) return false

  const item = voiceSectionNavItem(section)
  const visibleInNavigation = Boolean(item
    && isNavItemEnabled(org, item)
    && (!item.permissionScope || checkPermission(role, item.permissionScope, "read")))
  if (!visibleInNavigation) return false

  const descriptor = SECTION_DESCRIPTORS[section]
  if (!descriptor) return true

  // Permission scopes still use the legacy vocabulary while tenant modules use
  // sidebar groups. Leads/deals are the important mismatch: their descriptor
  // historically said crm, but their canonical group is now sales.
  const groupModule = (LEGACY_MODULE_MAP[descriptor.permission] as ModuleId | undefined) ?? descriptor.module
  return canRead(role, descriptor.permission) && hasModule(org, groupModule)
}

/**
 * Exact navigation/explanation destinations available to this authenticated
 * role and tenant.  The browser and the Realtime provider both consume this
 * same list so a client-side navigation tool cannot drift from the sidebar's
 * module, feature, add-on or permission-scope gates.
 */
export function accessibleVoiceSectionKeys(
  role: Role,
  org: VoiceOrgModuleContext,
): string[] {
  return VOICE_SECTION_KEYS.filter((section) => canAccessVoiceSection(role, org, section))
}
