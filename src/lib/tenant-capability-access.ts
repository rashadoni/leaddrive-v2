import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  capabilitySettingsFromTenantSettings,
  getTenantCapabilityDefinition,
  resolveTenantCapability,
  tenantModulesFromFields,
  type TenantCapabilityState,
} from "@/lib/tenant-capabilities"

export interface TenantCapabilityAccess {
  allowed: boolean
  capability: TenantCapabilityState | null
  error?: string
}


export async function getTenantCapabilityAccess(
  organizationId: string,
  capabilityId: string,
): Promise<TenantCapabilityAccess> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      plan: true,
      addons: true,
      features: true,
      modules: true,
      settings: true,
    },
  })
  if (!org) {
    return { allowed: false, capability: null, error: "Organization not found" }
  }

  const settings = capabilitySettingsFromTenantSettings(org.settings)
  const definition = getTenantCapabilityDefinition(capabilityId)
  if (!definition) {
    return { allowed: false, capability: null, error: "Capability not found" }
  }

  const capability = resolveTenantCapability(definition, {
    plan: org.plan,
    addons: org.addons,
    modules: tenantModulesFromFields({ features: org.features, modules: org.modules }),
    hidden: settings.hidden,
    requested: settings.requested,
  })

  return {
    allowed: capability.enabled && capability.status !== "disabled",
    capability,
    error: capability.enabled ? undefined : capability.reason,
  }
}

export function tenantCapabilityDeniedPayload(
  access: TenantCapabilityAccess,
  fallbackLabel = "This capability",
) {
  const definition = access.capability?.definition
  const label = definition?.label ?? fallbackLabel

  return {
    success: false,
    code: "TENANT_CAPABILITY_DISABLED",
    capabilityId: definition?.id,
    capabilityLabel: label,
    capabilityStatus: access.capability?.status ?? "unknown",
    error: access.error ?? `${label} is not enabled for this tenant.`,
  }
}

export async function requireTenantCapabilityAccessResponse(
  organizationId: string,
  capabilityId: string,
  fallbackLabel?: string,
): Promise<NextResponse | null> {
  const access = await getTenantCapabilityAccess(organizationId, capabilityId)
  if (access.allowed) return null
  return NextResponse.json(tenantCapabilityDeniedPayload(access, fallbackLabel), { status: 403 })
}
