import { prisma } from "@/lib/prisma"
import { hasModule, moduleRecordFromOrgFields } from "@/lib/modules"
import { runWithTenant } from "@/lib/rls-context"

const SUPPORT_AI_SETTINGS_ROLES = new Set(["admin", "superadmin"])

export function isSupportAiSettingsRole(role: string | null | undefined): boolean {
  return typeof role === "string" && SUPPORT_AI_SETTINGS_ROLES.has(role)
}

/**
 * Authoritative server-side entitlement gate for the Support AI control.
 * Both paid grants are required: Support owns the affected workflows and the
 * AI add-on grants access to model-backed capabilities. A failed read denies.
 */
export async function hasSupportAiSettingsEntitlement(organizationId: string): Promise<boolean> {
  try {
    const organization = await runWithTenant(organizationId, () =>
      prisma.organization.findFirst({
        where: { id: organizationId },
        select: {
          plan: true,
          addons: true,
          features: true,
          modules: true,
        },
      }),
    )

    if (!organization) return false

    const context = {
      plan: organization.plan,
      addons: organization.addons,
      modules: moduleRecordFromOrgFields({
        features: organization.features,
        modules: organization.modules,
      }),
    }

    return hasModule(context, "support") && hasModule(context, "ai")
  } catch {
    return false
  }
}
