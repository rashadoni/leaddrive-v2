import { prisma } from "@/lib/prisma"

export type TeamQueueStrategy = "least_loaded" | "round_robin" | "skill_match"

export interface RouteConversationParams {
  organizationId: string
  conversationId: string
  queueId: string
  excludeUserIds?: string[]
}

export type RouteConversationResult =
  | {
      routed: true
      queueId: string
      queueName: string
      strategy: TeamQueueStrategy
      assignedTo: string
      agentName: string
      load: number
    }
  | {
      routed: false
      reason: "no_queue" | "invalid_strategy" | "no_available_agent" | "conversation_not_found"
    }

interface QueueRow {
  id: string
  name: string
  skillTags: string[]
  strategy: string
  lastAssignedTo: string | null
}

interface ConversationRow {
  assignedTo: string | null
  metadata: unknown
}

interface CandidateAgent {
  id: string
  name: string | null
  email: string
  skills: string[]
  maxTickets: number
}

const VALID_STRATEGIES = new Set<TeamQueueStrategy>(["least_loaded", "round_robin", "skill_match"])
const OPEN_CONVERSATION_STATUSES = ["open"]

function normalizeTags(tags: readonly string[] | null | undefined): string[] {
  return Array.from(
    new Set(
      (tags ?? [])
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    ),
  )
}

function agentHasAllQueueSkills(agent: CandidateAgent, requiredSkills: string[]): boolean {
  if (requiredSkills.length === 0) return true
  const agentSkills = new Set(normalizeTags(agent.skills))
  return requiredSkills.every((skill) => agentSkills.has(skill))
}

function displayName(agent: CandidateAgent): string {
  return agent.name?.trim() || agent.email
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {}
}

function routingMetadata(
  metadata: unknown,
  details: {
    queueId: string
    queueName: string
    strategy: TeamQueueStrategy
    assignedTo: string
    assignedAt: Date
    previousAssignedTo: string | null
  },
): Record<string, unknown> {
  const base = objectRecord(metadata)
  const existingRouting = objectRecord(base.routing)
  return {
    ...base,
    routing: {
      ...existingRouting,
      queueId: details.queueId,
      queueName: details.queueName,
      strategy: details.strategy,
      assignedTo: details.assignedTo,
      assignedAt: details.assignedAt.toISOString(),
      previousAssignedTo: details.previousAssignedTo,
    },
  }
}

function sortByLeastLoaded<T extends CandidateAgent>(agents: T[], countMap: Record<string, number>): T[] {
  return [...agents].sort((a, b) => {
    const byLoad = (countMap[a.id] ?? 0) - (countMap[b.id] ?? 0)
    if (byLoad !== 0) return byLoad
    return displayName(a).localeCompare(displayName(b)) || a.id.localeCompare(b.id)
  })
}

function selectRoundRobin(agents: CandidateAgent[], lastAssignedTo: string | null): CandidateAgent {
  const ordered = [...agents].sort((a, b) => displayName(a).localeCompare(displayName(b)) || a.id.localeCompare(b.id))
  const lastIdx = lastAssignedTo ? ordered.findIndex((a) => a.id === lastAssignedTo) : -1
  return ordered[(lastIdx + 1) % ordered.length]
}

function selectSkillMatch(agents: CandidateAgent[], requiredSkills: string[], countMap: Record<string, number>): CandidateAgent {
  return [...agents].sort((a, b) => {
    const aSkills = normalizeTags(a.skills)
    const bSkills = normalizeTags(b.skills)
    const aMatch = requiredSkills.filter((skill) => aSkills.includes(skill)).length
    const bMatch = requiredSkills.filter((skill) => bSkills.includes(skill)).length
    if (aMatch !== bMatch) return bMatch - aMatch
    const aExtra = Math.max(0, aSkills.length - aMatch)
    const bExtra = Math.max(0, bSkills.length - bMatch)
    if (aExtra !== bExtra) return aExtra - bExtra
    const byLoad = (countMap[a.id] ?? 0) - (countMap[b.id] ?? 0)
    if (byLoad !== 0) return byLoad
    return displayName(a).localeCompare(displayName(b)) || a.id.localeCompare(b.id)
  })[0]
}

/** Route one live SocialConversation to a user from a TeamQueue.
 *
 * Tenant isolation is enforced on every read/write:
 * - queue is fetched by `(id, organizationId, isActive)`;
 * - users are fetched by `organizationId`;
 * - load is counted from `SocialConversation.organizationId`;
 * - final assignment is `updateMany({ id, organizationId })`.
 */
export async function routeConversation(params: RouteConversationParams): Promise<RouteConversationResult> {
  const { organizationId, conversationId, queueId } = params

  const queue = (await prisma.teamQueue.findFirst({
    where: { id: queueId, organizationId, isActive: true },
    select: { id: true, name: true, skillTags: true, strategy: true, lastAssignedTo: true },
  })) as QueueRow | null
  if (!queue) return { routed: false, reason: "no_queue" }

  if (!VALID_STRATEGIES.has(queue.strategy as TeamQueueStrategy)) {
    return { routed: false, reason: "invalid_strategy" }
  }
  const strategy = queue.strategy as TeamQueueStrategy
  const requiredSkills = normalizeTags(queue.skillTags)
  const excluded = new Set(normalizeTags(params.excludeUserIds))

  const conversation = (await prisma.socialConversation.findFirst({
    where: { id: conversationId, organizationId },
    select: { assignedTo: true, metadata: true },
  })) as ConversationRow | null
  if (!conversation) return { routed: false, reason: "conversation_not_found" }

  const allAgents = (await prisma.user.findMany({
    where: {
      organizationId,
      isActive: true,
      isAvailable: true,
      role: { not: "viewer" },
    },
    select: { id: true, name: true, email: true, skills: true, maxTickets: true },
  })) as CandidateAgent[]

  const skilledAgents = allAgents.filter((agent) => agentHasAllQueueSkills(agent, requiredSkills) && !excluded.has(agent.id.toLowerCase()))
  if (skilledAgents.length === 0) return { routed: false, reason: "no_available_agent" }

  const openCounts = await prisma.socialConversation.groupBy({
    by: ["assignedTo"],
    where: {
      organizationId,
      status: { in: OPEN_CONVERSATION_STATUSES },
      assignedTo: { in: skilledAgents.map((agent) => agent.id) },
    },
    _count: { id: true },
  })
  const countMap: Record<string, number> = {}
  for (const row of openCounts) {
    if (row.assignedTo) countMap[row.assignedTo] = row._count.id
  }

  const underCapacity = skilledAgents.filter((agent) => (countMap[agent.id] ?? 0) < agent.maxTickets)
  if (underCapacity.length === 0) return { routed: false, reason: "no_available_agent" }

  let selected: CandidateAgent
  if (strategy === "round_robin") {
    selected = selectRoundRobin(underCapacity, queue.lastAssignedTo)
  } else if (strategy === "skill_match") {
    selected = selectSkillMatch(underCapacity, requiredSkills, countMap)
  } else {
    selected = sortByLeastLoaded(underCapacity, countMap)[0]
  }

  const assignedAt = new Date()
  const assigned = await prisma.socialConversation.updateMany({
    where: { id: conversationId, organizationId },
    data: {
      assignedTo: selected.id,
      metadata: routingMetadata(conversation.metadata, {
        queueId: queue.id,
        queueName: queue.name,
        strategy,
        assignedTo: selected.id,
        assignedAt,
        previousAssignedTo: conversation.assignedTo,
      }),
    },
  })
  if (assigned.count === 0) return { routed: false, reason: "conversation_not_found" }

  if (strategy === "round_robin") {
    await prisma.teamQueue
      .updateMany({
        where: { id: queue.id, organizationId },
        data: { lastAssignedTo: selected.id },
      })
      .catch(() => {})
  }

  return {
    routed: true,
    queueId: queue.id,
    queueName: queue.name,
    strategy,
    assignedTo: selected.id,
    agentName: displayName(selected),
    load: countMap[selected.id] ?? 0,
  }
}
