/**
 * Where the selected employee's card on the live map leads: the other screens
 * that open already narrowed to him.
 *
 * Only screens that read an employee from the address are listed. Reports,
 * analytics, the rating, the journal, photos and visits take no employee from
 * it: a link there with «?agentId=» would open the whole team's screen and
 * look as if it had worked. They are left out until those screens can do it.
 *
 * The last link is not about him at all. The alert rules are switches and
 * thresholds of the whole organization — nobody has rules of his own — so it
 * leads to the settings tab that holds them and carries no employee.
 *
 * Pure: no React, no fetch.
 */

export type LiveMapAgentLinkId = "history" | "alerts" | "period" | "tasks" | "card" | "alertRules"

export interface LiveMapAgentLink {
  id: LiveMapAgentLinkId
  href: string
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

export function liveMapAgentLinks(input: {
  agentId: string
  /** The organization's «today» (YYYY-MM-DD) as the list has it; unknown until the list has answered. */
  tenantToday: string | null | undefined
  /**
   * Whether the organization keeps the employees' own sections (his clients)
   * switched on. Where it is off that page is a «switched off» notice, so the
   * link goes to the agents list narrowed to him instead.
   */
  fieldContactsEnabled: boolean
}): LiveMapAgentLink[] {
  if (!input.agentId) return []
  const id = encodeURIComponent(input.agentId)
  const today = typeof input.tenantToday === "string" && DATE_KEY.test(input.tenantToday) ? input.tenantToday : null

  return [
    // The day goes with the link: «История за день» must open the day the
    // card is about, and a list left open over midnight is still yesterday's.
    ...(today ? [{ id: "history" as const, href: `/mtm/map?mode=history&agentId=${id}&date=${today}` }] : []),
    { id: "alerts", href: `/mtm/alerts?agentId=${id}` },
    { id: "period", href: `/mtm/calendar?view=agent&agentId=${id}` },
    { id: "tasks", href: `/mtm/tasks?agentId=${id}` },
    { id: "card", href: input.fieldContactsEnabled ? `/mtm/agents/${id}` : `/mtm/agents?agentId=${id}` },
    { id: "alertRules", href: "/mtm/settings?tab=alerts" },
  ]
}
