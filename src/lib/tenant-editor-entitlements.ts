import { hasModule, reconcileModulesWithFeatures } from "./modules"
import {
  applyCapabilityEntitlement,
  featuresToStringArray,
  getTenantCapabilityDefinition,
  isTenantCapabilityEnabled,
  removeCapabilityEntitlement,
  tenantModulesFromFields,
} from "./tenant-capabilities"

// Workforce has a separate approval/provisioning flow and is not editable here.
export const EDITABLE_TENANT_CAPABILITIES = ["route-field", "personnel"] as const
export type EditableTenantCapability = (typeof EDITABLE_TENANT_CAPABILITIES)[number]
export type TenantEditorCapabilities = Record<EditableTenantCapability, boolean>
export type TenantEditorCapabilityChanges = Partial<TenantEditorCapabilities>
type TenantFields = Parameters<typeof isTenantCapabilityEnabled>[1]

export function getTenantEditorCapabilities(tenant: TenantFields): TenantEditorCapabilities {
  return {
    "route-field": isTenantCapabilityEnabled("route-field", tenant),
    personnel: isTenantCapabilityEnabled("personnel", tenant),
  }
}

export function isTenantEditorCapabilityChanges(value: unknown): value is TenantEditorCapabilityChanges {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.entries(value).every(([key, enabled]) =>
      EDITABLE_TENANT_CAPABILITIES.some((id) => id === key) && typeof enabled === "boolean",
    )
}

/** Explicit changes only: an unrelated save must not undo a newer capability decision. */
export function reconcileTenantEditorEntitlements(
  features: string[],
  existing: TenantFields,
  changes: TenantEditorCapabilityChanges,
) {
  const previousFeatures = featuresToStringArray(existing.features)
  let patch = { features: [...features], modules: reconcileModulesWithFeatures(features, existing.modules) }
  const previousCapabilities = getTenantEditorCapabilities(existing)
  const mtmChanged = hasModule({
    plan: existing.plan || "starter",
    addons: featuresToStringArray(existing.addons),
    modules: tenantModulesFromFields(existing),
  }, "mtm") !== patch.modules.mtm

  for (const id of EDITABLE_TENANT_CAPABILITIES) {
    // The new editor's raw feature snapshot is not authority for capability
    // grants. Preserve current storage until the operator changes its switch.
    patch.features = patch.features.filter((feature) => feature !== id)
    if (previousFeatures.includes(id)) patch.features.push(id)
    const enabled = changes[id] ?? (mtmChanged ? previousCapabilities[id] : undefined)
    if (enabled === undefined) continue
    const definition = getTenantCapabilityDefinition(id)!
    patch = enabled
      ? applyCapabilityEntitlement(definition, patch)
      : removeCapabilityEntitlement(definition, patch)
  }
  return patch
}
