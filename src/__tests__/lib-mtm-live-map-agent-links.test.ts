/**
 * Where the selected employee's card on the live map leads (owner,
 * 2026-10-09, of the fleet tracker shown to him as the model: «бери почти
 * всё, чего у нас нет» — there a row opens the same person's reports, alerts
 * and settings).
 *
 * The addresses are tested exactly: each of these screens reads the employee
 * from the address in its own way, and an address that is a little off opens
 * the whole team's screen without a word.
 */
import { describe, expect, it } from "vitest"
import { liveMapAgentLinks } from "@/lib/mtm/live-map-agent-links"

const links = (input: Partial<Parameters<typeof liveMapAgentLinks>[0]> = {}) =>
  liveMapAgentLinks({ agentId: "agent-7", tenantToday: "2026-10-09", fieldContactsEnabled: true, ...input })
const hrefOf = (list: ReturnType<typeof liveMapAgentLinks>, id: string) => list.find((link) => link.id === id)?.href ?? null

describe("the links of the selected employee to the other screens", () => {
  it("lead to his day, his alerts, his period, his tasks and his own section — and to the organization's alert rules", () => {
    expect(links()).toEqual([
      { id: "history", href: "/mtm/map?mode=history&agentId=agent-7&date=2026-10-09" },
      { id: "alerts", href: "/mtm/alerts?agentId=agent-7" },
      { id: "period", href: "/mtm/calendar?view=agent&agentId=agent-7" },
      { id: "tasks", href: "/mtm/tasks?agentId=agent-7" },
      { id: "card", href: "/mtm/agents/agent-7" },
      { id: "alertRules", href: "/mtm/settings?tab=alerts" },
    ])
  })

  it("an id with a space, a slash or an ampersand stays one employee in every address", () => {
    const odd = links({ agentId: "a b/c&d=e" })
    const encoded = "a%20b%2Fc%26d%3De"
    expect(odd.map((link) => link.href)).toEqual([
      `/mtm/map?mode=history&agentId=${encoded}&date=2026-10-09`,
      `/mtm/alerts?agentId=${encoded}`,
      `/mtm/calendar?view=agent&agentId=${encoded}`,
      `/mtm/tasks?agentId=${encoded}`,
      `/mtm/agents/${encoded}`,
      "/mtm/settings?tab=alerts",
    ])
    // Read back the way the screens read it: the same id, and no parameter invented by the id.
    for (const link of odd.filter((candidate) => candidate.href.includes("agentId="))) {
      const query = new URLSearchParams(link.href.slice(link.href.indexOf("?") + 1))
      expect(query.get("agentId"), link.id).toBe("a b/c&d=e")
      expect(query.has("d"), link.id).toBe(false)
    }
    expect(new URL(hrefOf(odd, "card") ?? "", "https://crm.example").pathname.split("/")).toHaveLength(4)
  })

  it("offer no day's history until the organization's day is known, and keep the rest", () => {
    for (const tenantToday of [null, undefined, "", "today", "09.10.2026"]) {
      expect(links({ tenantToday }).map((link) => link.id), String(tenantToday))
        .toEqual(["alerts", "period", "tasks", "card", "alertRules"])
    }
  })

  it("open his own section where the organization keeps those sections, and the agents list narrowed to him where it does not", () => {
    expect(hrefOf(links({ fieldContactsEnabled: true }), "card")).toBe("/mtm/agents/agent-7")
    expect(hrefOf(links({ fieldContactsEnabled: false }), "card")).toBe("/mtm/agents?agentId=agent-7")
  })

  it("name the employee on every screen that can show one person, and on no other", () => {
    const all = links()
    expect(all.filter((link) => !link.href.includes("agent-7")).map((link) => link.id)).toEqual(["alertRules"])
    // Reports, analytics, the rating, the journal, photos and visits ignore «?agentId=»: no link pretends otherwise.
    for (const screen of ["/mtm/reports", "/mtm/analytics", "/mtm/leaderboard", "/mtm/activity", "/mtm/photos", "/mtm/visits"]) {
      expect(all.some((link) => link.href.startsWith(screen)), screen).toBe(false)
    }
  })

  it("are nothing at all without an employee", () => {
    expect(links({ agentId: "" })).toEqual([])
  })
})
