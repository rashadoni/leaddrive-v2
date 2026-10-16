/** Who «Агент за период» lists and opens on. Pure: the view and its tests read the same answer. */
export type AgentPeriodChoice = {
  id: string
  name: string
  role?: string | null
  status?: string | null
  /** The newest of the last GPS point and the last time the app was seen. */
  lastSignalAt?: string | null
}

/**
 * «Агент за период» is about a field employee's days (owner, 2026-10-16,
 * from a picture): it lists the active field agents only, and opens on the
 * one who was in the field last — it used to open on the first name of the
 * whole team, a manager or an agent with no visits. An agent the address
 * asks for is kept, whoever he is.
 */
export function agentPeriodChoices(list: AgentPeriodChoice[], keepId?: string | null): AgentPeriodChoice[] {
  return list.filter((agent) => agent.id === keepId
    || ((agent.role ?? "AGENT") === "AGENT" && (agent.status ?? "ACTIVE") === "ACTIVE"))
}

export function agentPeriodDefaultAgentId(list: AgentPeriodChoice[]): string {
  let best: AgentPeriodChoice | null = null
  let bestAt = Number.NEGATIVE_INFINITY
  for (const agent of list) {
    const at = agent.lastSignalAt ? Date.parse(agent.lastSignalAt) : Number.NaN
    const signal = Number.isFinite(at) ? at : Number.NEGATIVE_INFINITY
    if (!best || signal > bestAt) {
      best = agent
      bestAt = signal
    }
  }
  return best?.id ?? ""
}

