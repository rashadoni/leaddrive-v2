import { prisma } from "@/lib/prisma"
import { isTenantCapabilityEnabled } from "@/lib/tenant-capabilities"

export type WorkforceProductCapabilities = {
  routeField: boolean
  workforceHrm: boolean
}

/**
 * Resolve both products for a compatibility surface that stores their rows in
 * one legacy table.  A lookup failure fails closed for both domains: callers
 * must not guess which notification, audit row or presence fact is safe to
 * disclose when entitlement state is unavailable.
 */
export async function productCapabilitiesForMixedSurface(
  organizationId: string,
  surface: string,
): Promise<WorkforceProductCapabilities> {
  try {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { plan: true, addons: true, features: true, modules: true },
    })
    if (!organization) return { routeField: false, workforceHrm: false }
    return {
      routeField: isTenantCapabilityEnabled("route-field", organization),
      workforceHrm: isTenantCapabilityEnabled("workforce-hrm", organization),
    }
  } catch (error) {
    console.warn(`[${surface}] product capability lookup failed`, error)
    return { routeField: false, workforceHrm: false }
  }
}

/**
 * Resolve Workforce for a mixed Route + Workforce compatibility surface.
 * These callers must keep Route & Field available during an entitlement
 * outage, while omitting every Workforce-only field unless it is proven on.
 */
export async function workforceEnabledForMixedSurface(
  organizationId: string,
  surface: string,
): Promise<boolean> {
  return (await productCapabilitiesForMixedSurface(organizationId, surface)).workforceHrm
}
