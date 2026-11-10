/**
 * For «Настройки → ИИ и расходы»: per provider, the parts of the CRM that call
 * it and that this organization has, and what the provider cost it in the
 * last 30 days.
 */
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { getOrgModuleContext } from "@/lib/api-auth"
import { featureFlagsToArray, hasModule, type ModuleId } from "@/lib/modules"
import { AI_USES, PROVIDER_USES, SELF_KEY_PROVIDERS, type AiUseId } from "./features"

export type ProviderUse = {
  provider: (typeof SELF_KEY_PROVIDERS)[number]
  /** The provider's uses this organization has, in the provider's order. */
  uses: AiUseId[]
  /** Last 30 days, from the journal. */
  costUsd: number
  calls: number
}

export async function providerUses(orgId: string, now = new Date()): Promise<ProviderUse[]> {
  const since = new Date(now.getTime() - 30 * 86_400_000)
  const [ctx, org, spend] = await Promise.all([
    getOrgModuleContext(orgId),
    runWithTenant(orgId, () => prisma.organization.findUnique({ where: { id: orgId }, select: { features: true } })),
    runWithTenant(orgId, () => prisma.aiUsage.groupBy({
      by: ["provider"],
      where: { organizationId: orgId, createdAt: { gte: since } },
      _sum: { costUsd: true },
      _count: { _all: true },
    })),
  ])
  const features = new Set(featureFlagsToArray(org?.features))
  const open = (id: AiUseId) => {
    const use = AI_USES[id] as { module: string; feature?: string }
    return hasModule(ctx, use.module as ModuleId) && (!use.feature || features.has(use.feature))
  }
  return SELF_KEY_PROVIDERS.map((provider) => {
    const row = spend.find((s) => s.provider === provider)
    return {
      provider,
      uses: PROVIDER_USES[provider].filter(open),
      costUsd: Math.round((row?._sum.costUsd ?? 0) * 1e6) / 1e6,
      calls: row?._count._all ?? 0,
    }
  })
}
