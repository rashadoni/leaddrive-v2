import { pushConfigured } from "@/lib/mtm/push-send"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"

/**
 * What the person giving a task sees next to each name in «Кому»
 * (owner-approved mockup, 2026-10-20): whether the pop-up will reach the
 * phone, whether the agent is on shift, and how far today's route has gone.
 *
 * «The pop-up will reach the phone» means the phone registered for pushes and
 * Firebase has not told us to stop using that address — and this server can
 * send at all. It cannot know that the agent switched notifications off on
 * the phone; that case still lands in his bell.
 */

export interface AgentTaskGlance {
  pushReady: boolean
  onShift: boolean
  routeToday: { planned: number; visited: number } | null
}

interface GlanceClient {
  mtmDeviceToken: { findMany(args: unknown): Promise<Array<{ agentId: string }>> }
  mtmAgentWorkday: { findMany(args: unknown): Promise<Array<{ agentId: string }>> }
  mtmRoute: { findMany(args: unknown): Promise<Array<{ agentId: string; points: Array<{ status: string }> }>> }
}

/** Published routes only: a draft is nobody's plan yet, a cancelled one nobody's any more. */
const ROUTE_TODAY_STATUSES = ["PLANNED", "IN_PROGRESS", "COMPLETED", "INCOMPLETE"]

/** Agents whose phones a push can reach now. */
export async function agentsReachableByPush(
  client: Pick<GlanceClient, "mtmDeviceToken">,
  organizationId: string,
  agentIds: readonly string[],
  configured = pushConfigured(),
): Promise<Set<string>> {
  if (!configured || agentIds.length === 0) return new Set()
  const rows = await client.mtmDeviceToken.findMany({
    where: { organizationId, agentId: { in: [...agentIds] }, disabledAt: null,
      agent: { OR: [{ fieldDeletedAt: null }, { role: "EMPLOYEE" }] } },
    select: { agentId: true },
    distinct: ["agentId"],
  })
  return new Set(rows.map((row) => row.agentId))
}

export async function agentTaskGlance(
  client: GlanceClient,
  input: { organizationId: string; agentIds: readonly string[]; timezone: string; now?: Date; pushConfigured?: boolean },
): Promise<Map<string, AgentTaskGlance>> {
  const glance = new Map<string, AgentTaskGlance>()
  const agentIds = [...new Set(input.agentIds)]
  if (agentIds.length === 0) return glance
  const zone = isValidTimezone(input.timezone) ? input.timezone : "UTC"
  const today = new Date(`${currentDateKey(input.now ?? new Date(), zone)}T00:00:00.000Z`)
  const [reachable, openDays, routes] = await Promise.all([
    agentsReachableByPush(client, input.organizationId, agentIds, input.pushConfigured ?? pushConfigured()),
    client.mtmAgentWorkday.findMany({
      where: { organizationId: input.organizationId, agentId: { in: agentIds }, status: { in: ["STARTED", "PAUSED"] } },
      select: { agentId: true },
    }),
    client.mtmRoute.findMany({
      where: { organizationId: input.organizationId, agentId: { in: agentIds }, date: today, deletedAt: null, status: { in: ROUTE_TODAY_STATUSES } },
      select: { agentId: true, points: { where: { deletedAt: null }, select: { status: true } } },
    }),
  ])
  const onShift = new Set(openDays.map((row) => row.agentId))
  const routeToday = new Map<string, { planned: number; visited: number }>()
  for (const route of routes) {
    const counts = routeToday.get(route.agentId) ?? { planned: 0, visited: 0 }
    for (const point of route.points) {
      counts.planned += 1
      if (point.status === "VISITED") counts.visited += 1
    }
    routeToday.set(route.agentId, counts)
  }
  for (const agentId of agentIds) {
    glance.set(agentId, {
      pushReady: reachable.has(agentId),
      onShift: onShift.has(agentId),
      routeToday: routeToday.get(agentId) ?? null,
    })
  }
  return glance
}
