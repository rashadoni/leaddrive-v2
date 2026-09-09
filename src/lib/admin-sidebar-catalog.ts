/**
 * Admin tenant-editor module catalog — DERIVED from the same `navItems` the
 * live sidebar renders (`src/lib/nav-items.ts`), so the superadmin
 * module-toggle view can never silently drift from real navigation again.
 *
 * Previously the admin page (`app/admin/tenants/[id]/edit/page.tsx`) carried a
 * hand-maintained `SIDEBAR_SECTIONS` array that fell behind the real nav — it
 * omitted social-monitoring, surveys, loyalty, web-chat, ai/actions,
 * attribution, quotes, and the Phase-7 industry clouds, and never reflected
 * group moves (e.g. Social Monitoring Marketing→Communication). Deriving here
 * makes `navItems` the single source of truth; the regression tests in
 * `src/__tests__/nav-items.test.ts` lock the invariant.
 *
 * Labels are intentionally NOT resolved here — translating `tKey` needs the
 * `nav` i18n namespace at render time. Each item carries its `tKey`; the page
 * resolves it via `useTranslations("nav")`, exactly like the sidebar.
 */
import { navItems, NAV_GROUP_ORDER, type NavItem } from "./nav-items"
import type { ModuleId } from "./modules"
import {
  entitlementKeysForCapability,
  getTenantCapabilityDefinition,
  type FieldTenantCapabilityId,
} from "./tenant-capabilities"

type ModuleGatedNavItem = NavItem & { module: ModuleId }

function isModuleGatedNavItem(item: NavItem): item is ModuleGatedNavItem {
  return Boolean(item.module)
}

const moduleGatedNavItems = navItems.filter(isModuleGatedNavItem)

export interface AdminCatalogItem {
  moduleId: ModuleId
  tKey: string
  href: string
}

export interface AdminCatalogSection {
  group: string
  items: AdminCatalogItem[]
}

/**
 * Sidebar sections in the same group order the real sidebar uses
 * (`NAV_GROUP_ORDER` = first-appearance order in `navItems`). One entry per
 * nav item — the admin view lists every page a tenant could see, grouped
 * exactly like the sidebar, each mapped to the `moduleId` that gates it.
 */
export const SIDEBAR_SECTIONS: AdminCatalogSection[] = NAV_GROUP_ORDER.map((group) => ({
  group,
  // Capability-only areas are deliberately managed in the tenant capability
  // panel, not the legacy group-module editor. Keeping them out here prevents
  // a Workforce grant from being mistaken for an MTM/module toggle.
  items: moduleGatedNavItems
    .filter((i) => i.group === group)
    .map((i) => ({ moduleId: i.module, tKey: i.tKey, href: i.href })),
})).filter((section) => section.items.length > 0)

/** Unique toggleable module ids across the catalog. All nav items carry group
 *  ids since the narrow-union task — the always-on legacy `core` id no longer
 *  exists, so every catalog module is toggleable. */
export const TOGGLEABLE_MODULES: ModuleId[] = [
  ...new Set(moduleGatedNavItems.map((i) => i.module)),
]

/** Set form of {@link TOGGLEABLE_MODULES} for O(1) membership checks. */
export const TOGGLEABLE_MODULE_SET: ReadonlySet<string> = new Set(TOGGLEABLE_MODULES)

/**
 * How many toggleable group-modules a tenant's raw `Organization.features`
 * array has enabled — the numerator for the admin editor's
 * "{count} of {total} modules enabled" line.
 *
 * `features` is a grab-bag: alongside the 16 group-module ids it also carries
 * cross-cutting add-on flags (`ai`/`voip`/`sms-otp`), AI-automation scenario
 * keys (`ai_auto_*`) and legacy/social flags (`social_*`). A plain
 * `features.length` therefore overcounts against `TOGGLEABLE_MODULES.length`
 * (e.g. a Communication-only tenant seeded with social flags rendered
 * "19 of 16"). Count only entries that are real toggleable modules — and
 * dedupe, since the JSON column can legitimately hold repeats — so the
 * numerator can never exceed the denominator.
 */
export function countEnabledModules(features: readonly string[]): number {
  return new Set(features.filter((f) => TOGGLEABLE_MODULE_SET.has(f))).size
}

/**
 * "Select all" for the admin editor's Active Modules card: enable every
 * toggleable group-module while PRESERVING every non-module flag already in
 * `features`.
 *
 * `features` co-hosts AI-automation keys (`ai_auto_*`), extra-feature flags
 * (`complaints_register`) and social flags (`social_*`),
 * each driven by its own control elsewhere on the page. The old bulk action
 * replaced the whole array with just the 16 modules, silently wiping all of
 * them on the next save. This mirrors the additive per-module toggle and the
 * hidden-category chips: add the modules, touch nothing else.
 */
export function enableAllModules(features: readonly string[]): string[] {
  return [...new Set([...features, ...TOGGLEABLE_MODULES])]
}

/**
 * "Clear all" for the Active Modules card: disable every toggleable
 * group-module while PRESERVING non-module flags. The button is scoped to the
 * modules card, so it must leave the AI-automation, extra-feature and social
 * flags (managed by other sections) untouched — the old `[]` reset nuked them.
 */
export function clearAllModules(features: readonly string[]): string[] {
  return features.filter((f) => !TOGGLEABLE_MODULE_SET.has(f))
}

/* ── capability-gated areas ───────────────────────────────────────────────
 *
 * Some sidebar areas are gated by a tenant CAPABILITY rather than a group
 * module: `capability` for areas that have no group module at all (HRM), and
 * `tenantCapability` for a capability layered inside a historical group module
 * (Route & Field). Neither appears in `SIDEBAR_SECTIONS`, and that exclusion is
 * deliberate — a Workforce grant must not be mistaken for an MTM module
 * toggle, and the tests above lock that separation.
 *
 * The consequence, though, was that the superadmin tenant editor offered no
 * way to turn HRM on or off at all: the whole group simply had no control
 * anywhere, which is what the owner ran into. So the areas are catalogued
 * here, separately, for a separate card in that editor.
 *
 * What a toggle writes is the capability's own entitlement key, the same
 * string `resolveTenantCapability` reads out of the tenant's modules/features —
 * so this grants exactly what the capability system already understands, and
 * invents no parallel vocabulary.
 */

export interface AdminCapabilityCatalogItem {
  capabilityId: FieldTenantCapabilityId
  tKey: string
  href: string
}

export interface AdminCapabilityCatalogSection {
  group: string
  items: AdminCapabilityCatalogItem[]
}

type CapabilityGatedNavItem = NavItem & { capabilityId: FieldTenantCapabilityId }

function capabilityOf(item: NavItem): FieldTenantCapabilityId | undefined {
  return item.capability ?? item.tenantCapability
}

const capabilityGatedNavItems: CapabilityGatedNavItem[] = navItems.flatMap((item) => {
  const capabilityId = capabilityOf(item)
  return capabilityId ? [{ ...item, capabilityId }] : []
})

/**
 * Capability-gated sidebar areas, grouped and ordered exactly like the real
 * sidebar — the same derivation `SIDEBAR_SECTIONS` uses, so this view cannot
 * drift from navigation either.
 */
export const CAPABILITY_SECTIONS: AdminCapabilityCatalogSection[] = NAV_GROUP_ORDER.map((group) => ({
  group,
  items: capabilityGatedNavItems
    .filter((item) => item.group === group)
    .map((item) => ({ capabilityId: item.capabilityId, tKey: item.tKey, href: item.href })),
})).filter((section) => section.items.length > 0)

/** Unique capability ids across the catalog, in sidebar order. */
export const TOGGLEABLE_CAPABILITIES: FieldTenantCapabilityId[] = [
  ...new Set(CAPABILITY_SECTIONS.flatMap((section) => section.items.map((item) => item.capabilityId))),
]

/**
 * The entitlement strings a capability toggle writes into `features`. Taken
 * from the capability catalog rather than assumed, so a capability that grants
 * through a module id keeps working.
 */
export function entitlementKeysForCapabilityId(capabilityId: string): string[] {
  const definition = getTenantCapabilityDefinition(capabilityId)
  return definition ? entitlementKeysForCapability(definition) : []
}

/** Is this capability granted by the tenant's raw `features` array? */
export function isCapabilityEnabled(features: readonly string[], capabilityId: string): boolean {
  const keys = entitlementKeysForCapabilityId(capabilityId)
  return keys.length > 0 && keys.every((key) => features.includes(key))
}

/** Additive grant, mirroring the per-module toggle: touch nothing else. */
export function enableCapability(features: readonly string[], capabilityId: string): string[] {
  return [...new Set([...features, ...entitlementKeysForCapabilityId(capabilityId)])]
}

/** Revoke, leaving every unrelated flag in `features` alone. */
export function disableCapability(features: readonly string[], capabilityId: string): string[] {
  const keys = new Set(entitlementKeysForCapabilityId(capabilityId))
  return features.filter((feature) => !keys.has(feature))
}
