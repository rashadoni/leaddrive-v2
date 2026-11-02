import type { Prisma } from "@prisma/client"

/**
 * Which presentations a phone gets — the one rule behind the app's catalog,
 * opening a presentation on a visit and downloading its file.
 *
 * Owner, 2026-10-21: «я хочу выбрать несколько презентаций и указать, для
 * какого агента будут видны». So a field agent gets exactly the presentations
 * he is listed on (`MtmProductViewer`): a tick on a group no longer hands him
 * the group, and a subgroup inherits nobody. (These phone routes serve the
 * AGENT role only — `FIELD_EXECUTE` — so a group's managers need no rule here.)
 *
 * Never a deleted or inactive presentation, nor one in an inactive group.
 */
export function mtmPhoneProductWhere({ orgId, agentId }: { orgId: string; agentId: string }): Prisma.MtmProductWhereInput {
  return {
    organizationId: orgId,
    isActive: true,
    deletedAt: null,
    group: { isActive: true },
    viewers: { some: { organizationId: orgId, agentId } },
  }
}
