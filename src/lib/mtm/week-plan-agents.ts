/**
 * Who is shown in the team week (field UX audit 2026-09-05, task C7).
 *
 * The grid lists every agent of the tenant, one row each. Two things made it
 * unreadable in the audit:
 *
 *   - QA accounts. They are created with a `[QA-...]` marker in the name and
 *     exist only for smoke runs, but they take rows between real people.
 *   - No way to narrow it down. With forty agents the manager scrolled past
 *     everyone to find one (RUX-602).
 *
 * The rule about QA accounts is deliberately a name-prefix match: that marker
 * is what the seeding scripts write, and there is no separate flag on the row
 * to key off. If one ever appears, this is the single place to change.
 */
export type WeekPlanAgent = { id: string; name: string; teamId?: string | null }

/** True for an account created for smoke runs rather than for a person. */
export function isQaWeekPlanAgent(agent: { name?: string | null }): boolean {
  return typeof agent.name === "string" && agent.name.includes("[QA-")
}

/**
 * Name comparison for a search box, not for identity.
 *
 * Plain `toLowerCase()` is wrong here for the language this product is used
 * in: Azerbaijani "İ" lowercases to "i" plus a combining dot, so typing
 * "ƏLİYEVA" found nothing in "Əliyeva". Decomposing and dropping the marks
 * fixes that and, as a side effect, makes the search forgiving about accents
 * — which is what someone typing a colleague's name in a hurry wants.
 * `toLocaleLowerCase("az")` would not do: it turns "I" into dotless "ı" and
 * would then break every Latin name typed by a Russian- or English-speaking
 * manager.
 */
function foldForSearch(value: string): string {
  return value.trim().normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
}

export type WeekPlanAgentFilter = {
  /** Free text; matched against the name, case- and space-insensitive. */
  search?: string
  /** Team id, or null/undefined for "any team". */
  teamId?: string | null
  /** Show the QA accounts too. Off by default — that is the point. */
  includeQa?: boolean
}

/**
 * The rows to draw, in the order they were given.
 *
 * An empty result is a real answer ("nobody matches"), never a reason to fall
 * back to the full list: silently showing everything after a search would tell
 * the manager the opposite of the truth.
 */
export function visibleWeekPlanAgents<T extends WeekPlanAgent>(
  agents: readonly T[],
  filter: WeekPlanAgentFilter = {},
): T[] {
  const needle = foldForSearch(filter.search ?? "")
  return agents.filter((agent) => {
    if (!filter.includeQa && isQaWeekPlanAgent(agent)) return false
    if (filter.teamId && agent.teamId !== filter.teamId) return false
    if (needle && !foldForSearch(String(agent.name ?? "")).includes(needle)) return false
    return true
  })
}
