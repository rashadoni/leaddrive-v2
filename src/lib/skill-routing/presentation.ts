export const ROUTABLE_AGENT_ROLES = ["admin", "manager", "agent", "support", "ticketing"] as const
const SKILL_ROUTING_MANAGER_ROLES = new Set(["superadmin", "admin", "manager"])

export function canManageSkillRouting(role: string): boolean {
  return SKILL_ROUTING_MANAGER_ROLES.has(role)
}

export interface RoutingAgent {
  id: string
  name: string
  role: string
  skills: string[]
  isAvailable: boolean
  isActive: boolean
}

export interface RoutingQueue {
  id: string
  name: string
  skills: string[]
  priority: number
  autoAssign: boolean
  assignMethod: string
  isActive: boolean
  createdAt: string
}

export function normalizeRoutingSkills(skills: readonly string[]): string[] {
  return Array.from(new Set(skills.map((skill) => skill.trim().toLowerCase()).filter(Boolean))).sort()
}

export function agentEligibleForQueue(agent: RoutingAgent, queue: RoutingQueue): boolean {
  if (!agent.isActive || !agent.isAvailable || !ROUTABLE_AGENT_ROLES.includes(agent.role as typeof ROUTABLE_AGENT_ROLES[number])) {
    return false
  }
  const queueSkills = normalizeRoutingSkills(queue.skills)
  if (queueSkills.length === 0) return true
  const agentSkills = new Set(normalizeRoutingSkills(agent.skills))
  return queueSkills.some((skill) => agentSkills.has(skill))
}

export function eligibleAgentsForQueue(agents: readonly RoutingAgent[], queue: RoutingQueue): RoutingAgent[] {
  return agents.filter((agent) => agentEligibleForQueue(agent, queue))
}

export function routingCoverage(queues: readonly RoutingQueue[], agents: readonly RoutingAgent[]) {
  const activeQueues = queues.filter((queue) => queue.isActive && queue.autoAssign)
  const uncoveredQueues = activeQueues.filter((queue) => eligibleAgentsForQueue(agents, queue).length === 0)
  const agentsWithoutSkills = agents.filter((agent) => agent.isActive && normalizeRoutingSkills(agent.skills).length === 0)
  return { activeQueues, uncoveredQueues, agentsWithoutSkills }
}

export function applyBulkSkillChange(
  current: readonly string[],
  selected: readonly string[],
  mode: "add" | "remove",
): string[] {
  const existing = normalizeRoutingSkills(current)
  const changed = new Set(normalizeRoutingSkills(selected))
  return mode === "add"
    ? normalizeRoutingSkills([...existing, ...changed])
    : existing.filter((skill) => !changed.has(skill))
}
