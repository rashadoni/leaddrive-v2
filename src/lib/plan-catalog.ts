import { MODULE_REGISTRY, ADDON_MODULES, SEPARATE_SUBSCRIPTIONS, PAID_ADDONS } from "@/lib/modules"

// Feature flags that gate UI/modules but are NOT in MODULE_REGISTRY (verified present in
// TENANT_PLANS; consumed by tickets/complaints/portal feature checks). The catalog is the
// union so existing plan seed data validates. Keep in sync with TENANT_PLANS — the drift
// guard in lib-plan-catalog.test.ts fails CI if a TENANT_PLANS key is missing here.
const EXTRA_FEATURE_FLAGS = ["whatsapp", "complaints_register"] as const

export const FEATURE_CATALOG: string[] = [
  ...Object.keys(MODULE_REGISTRY),
  ...EXTRA_FEATURE_FLAGS,
]

export const ADDON_CATALOG: string[] = Array.from(
  new Set([
    ...Object.keys(ADDON_MODULES),
    ...Object.keys(SEPARATE_SUBSCRIPTIONS),
    ...Object.keys(PAID_ADDONS),
    "voip", // used as an addon in TENANT_PLANS.enterprise but absent from the maps above
  ]),
)

export function isKnownFeature(key: string): boolean {
  return FEATURE_CATALOG.includes(key)
}

export function isKnownAddon(key: string): boolean {
  return ADDON_CATALOG.includes(key)
}
