import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"

/**
 * «Komanda / Rayon / Agent» on /mtm/reports (owner-approved mockup, 2026-11-01).
 * The filters narrow the caller's field scope and never widen it: an agent
 * outside a manager's scope is not found by naming his id.
 */
export interface ReportFilters {
  agentId: string | null
  teamId: string | null
  regionId: string | null
}

const id = (value: string | null) => (value && /^[\w-]{1,64}$/.test(value) ? value : null)

export function readReportFilters(params: URLSearchParams): ReportFilters {
  return { agentId: id(params.get("agentId")), teamId: id(params.get("teamId")), regionId: id(params.get("regionId")) }
}

export function hasReportFilters(filters: ReportFilters): boolean {
  return Boolean(filters.agentId || filters.teamId || filters.regionId)
}

/**
 * The agents a report counts: the scope (`null` — the whole organization)
 * cut by the filters. `null` back means «no cut at all».
 */
export async function reportAgentIds(
  organizationId: string,
  scopeAgentIds: readonly string[] | null,
  filters: ReportFilters,
): Promise<string[] | null> {
  if (!hasReportFilters(filters)) return scopeAgentIds === null ? null : [...scopeAgentIds]
  const where: Prisma.MtmAgentWhereInput = {
    organizationId,
    ...(filters.agentId ? { id: filters.agentId } : {}),
    ...(filters.teamId ? { teamId: filters.teamId } : {}),
    ...(filters.regionId ? { team: { regionId: filters.regionId } } : {}),
  }
  const found: Array<{ id: string }> = (await prisma.mtmAgent.findMany({ where, select: { id: true } })) ?? []
  const inScope = scopeAgentIds === null ? null : new Set(scopeAgentIds)
  return found.map((agent) => agent.id).filter((agentId) => inScope === null || inScope.has(agentId))
}
