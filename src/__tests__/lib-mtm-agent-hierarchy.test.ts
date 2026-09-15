import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  buildMtmAgentHierarchy,
  flattenMtmAgentTeam,
  mtmAgentMatchesSearch,
  mtmLocalPhoneDigits,
  type MtmAgentTeam,
  type MtmHierarchyAgent,
} from "@/lib/mtm/agent-hierarchy"

type A = MtmHierarchyAgent & { email?: string | null; userEmail?: string | null }

const agent = (id: string, role: string, managerId: string | null = null, managerName?: string): A => ({
  id,
  name: id,
  role,
  managerId,
  manager: managerId ? { id: managerId, name: managerName ?? managerId } : null,
})

const ids = (team: MtmAgentTeam<A>) => flattenMtmAgentTeam(team).map((row) => row.agent.id)

describe("agents page hierarchy", () => {
  // Prod 2026-09-15: Ramil (MANAGER, no manager of his own) sank into
  // "no manager" at the very end while his team header was just a label.
  const ramil = agent("Ramil", "MANAGER")
  const nigar = agent("Nigar", "SUPERVISOR", "Ramil")
  const a1 = agent("A1", "AGENT", "Ramil")
  const a2 = agent("A2", "AGENT", "Nigar")
  const a3 = agent("A3", "AGENT", "Nigar")
  const lone = agent("Lone", "AGENT")
  const idleManager = agent("Idle", "MANAGER")
  const all = [a1, a2, a3, lone, idleManager, nigar, ramil]

  it("starts a manager's team with the manager's own card, then the reports", () => {
    const { teams } = buildMtmAgentHierarchy(all)
    expect(teams).toHaveLength(1)
    const [team] = teams
    expect(team.leader?.id).toBe("Ramil")
    expect(team.label).toBe("Ramil")
    expect(team.members.map((m) => m.id)).toEqual(["A1"])
    expect(team.size).toBe(5)
  })

  it("nests a manager who reports to another manager inside the parent team, once", () => {
    const { teams } = buildMtmAgentHierarchy(all)
    const [team] = teams
    expect(team.subteams).toHaveLength(1)
    expect(team.subteams[0].leader?.id).toBe("Nigar")
    expect(team.subteams[0].members.map((m) => m.id)).toEqual(["A2", "A3"])
    // Nigar never heads a top-level team of her own.
    expect(teams.map((t) => t.key)).toEqual(["Ramil"])
  })

  it("puts agents without a manager, and managers without a team, at the end", () => {
    const { unassigned } = buildMtmAgentHierarchy(all)
    expect(unassigned.map((a) => a.id)).toEqual(["Lone", "Idle"])
  })

  it("shows every card exactly once", () => {
    const { teams, unassigned } = buildMtmAgentHierarchy(all)
    const placed = [...teams.flatMap(ids), ...unassigned.map((a) => a.id)]
    expect(placed.sort()).toEqual(all.map((a) => a.id).sort())
    expect(new Set(placed).size).toBe(placed.length)
  })

  it("flattens leader first, members, then nested teams one level deeper", () => {
    const [team] = buildMtmAgentHierarchy(all).teams
    expect(flattenMtmAgentTeam(team).map((r) => [r.agent.id, r.depth, r.isLeader])).toEqual([
      ["Ramil", 0, true],
      ["A1", 1, false],
      ["Nigar", 1, true],
      ["A2", 2, false],
      ["A3", 2, false],
    ])
  })

  it("keeps a manager as a team when the filter hides their reports", () => {
    const { teams, unassigned } = buildMtmAgentHierarchy([ramil], all)
    expect(teams.map((t) => t.leader?.id)).toEqual(["Ramil"])
    expect(unassigned).toEqual([])
  })

  it("keeps reports under their manager's name when the filter hides the manager", () => {
    const { teams, unassigned } = buildMtmAgentHierarchy([a2, a3], all)
    expect(unassigned).toEqual([])
    expect(teams).toHaveLength(1)
    expect(teams[0].leader).toBeNull()
    expect(teams[0].label).toBe("Nigar")
    expect(teams[0].members.map((m) => m.id)).toEqual(["A2", "A3"])
  })

  it("promotes a nested leader to the top when their own manager is hidden", () => {
    const { teams } = buildMtmAgentHierarchy([nigar, a2], all)
    expect(teams.map((t) => t.leader?.id)).toEqual(["Nigar"])
    expect(ids(teams[0])).toEqual(["Nigar", "A2"])
  })

  it("survives a management cycle without dropping or repeating anyone", () => {
    const x = agent("X", "MANAGER", "Y")
    const y = agent("Y", "MANAGER", "X")
    const { teams, unassigned } = buildMtmAgentHierarchy([x, y])
    const placed = [...teams.flatMap(ids), ...unassigned.map((a) => a.id)]
    expect(placed.sort()).toEqual(["X", "Y"])
  })

  it("orders the biggest team first", () => {
    const small = agent("Small", "MANAGER")
    const s1 = agent("S1", "AGENT", "Small")
    const { teams } = buildMtmAgentHierarchy([small, s1, ...all])
    expect(teams.map((t) => t.key)).toEqual(["Ramil", "Small"])
  })
})

describe("agents page search", () => {
  const card = { name: "Ramil Əsgərov", email: null, phone: "+994 50 123-45-67", externalCode: "MR-007", userEmail: "rashad@guven.az" }

  it("finds a manager by the email of the linked web login", () => {
    expect(mtmAgentMatchesSearch(card, "rashad@guven.az")).toBe(true)
    expect(mtmAgentMatchesSearch(card, "RASHAD@")).toBe(true)
  })

  it("matches name, agent code and phone in any spacing", () => {
    expect(mtmAgentMatchesSearch(card, "ramil")).toBe(true)
    expect(mtmAgentMatchesSearch(card, "mr-007")).toBe(true)
    expect(mtmAgentMatchesSearch(card, "501234567")).toBe(true)
    // Local, international and bare formats are the same number.
    expect(mtmAgentMatchesSearch(card, "050 123 45")).toBe(true)
    expect(mtmAgentMatchesSearch({ phone: "+994 50 1234567" }, "050 123 45 67")).toBe(true)
    expect(mtmAgentMatchesSearch({ phone: "050-123-45-67" }, "+994501234567")).toBe(true)
    expect(mtmAgentMatchesSearch({ phone: "994501234567" }, "(050) 123")).toBe(true)
    expect(mtmAgentMatchesSearch({ phone: "+994 55 1234567" }, "050 123 45 67")).toBe(false)
    expect(mtmAgentMatchesSearch(card, "123 45 67")).toBe(true)
  })

  it("does not match what is not there, and an empty query matches everyone", () => {
    expect(mtmAgentMatchesSearch(card, "guven.com")).toBe(false)
    expect(mtmAgentMatchesSearch({ name: null }, "x")).toBe(false)
    expect(mtmAgentMatchesSearch(card, "   ")).toBe(true)
  })
})

describe("local phone digits", () => {
  it("drops the country code and the trunk zero", () => {
    expect(mtmLocalPhoneDigits("+994 50 123-45-67")).toBe("501234567")
    expect(mtmLocalPhoneDigits("050 123 45 67")).toBe("501234567")
    expect(mtmLocalPhoneDigits("501234567")).toBe("501234567")
    expect(mtmLocalPhoneDigits(null)).toBe("")
  })
})

describe("agents page contract", () => {
  const page = readFileSync("src/app/(dashboard)/mtm/agents/page.tsx", "utf8")

  it("groups by team hierarchy instead of by manager name", () => {
    expect(page).toContain("buildMtmAgentHierarchy(filtered, agents)")
    expect(page).not.toContain("a.manager?.name || noMgrLabel")
    expect(page).toContain('data-testid={leads ? "mtm-agent-leader-card" : "mtm-agent-card"}')
    expect(page).toContain('t("unassignedGroup")')
  })

  it("searches through the shared matcher, login email included", () => {
    expect(page).toContain("mtmAgentMatchesSearch(a, search)")
  })

  it("keeps cards equal height and small teams side by side", () => {
    expect(page).toContain("grid-cols-[repeat(auto-fill,minmax(18rem,1fr))]")
    expect(page).toContain("auto-rows-fr")
    expect(page).toContain("mt-auto flex h-8")
    expect(page).not.toContain("md:grid-cols-2 lg:grid-cols-3\">{g.items")
  })

  it("offers a remembered list view without an inner scroll frame", () => {
    expect(page).toContain('const VIEW_STORAGE_KEY = "mtm-agents-view"')
    expect(page).toContain("window.localStorage.setItem(VIEW_STORAGE_KEY, next)")
    const list = page.slice(page.indexOf("const renderList"), page.indexOf("const toggleManagers"))
    expect(list).toContain('data-testid="mtm-agents-list"')
    expect(list).not.toMatch(/overflow-(x|y)?-?auto|overflow-scroll/)
  })

  it("makes the managers tile the one managers filter, readable with its count", () => {
    expect(page).toContain('data-testid="mtm-agents-managers-tile"')
    expect(page).toContain('activeFilter === "managers"')
    expect(page).toContain("isMtmLeaderRole(a.role)")
    const tile = page.slice(page.indexOf('data-testid="mtm-agents-managers-tile"') - 400, page.indexOf("</ColorStatCard>") > 0 ? page.indexOf("</ColorStatCard>") : page.indexOf('label={t("statManagers")}') + 200)
    // aria-label would replace the tile's content, count included.
    expect(tile).not.toContain("aria-label=")
    expect(tile).toContain('aria-describedby="mtm-agents-managers-tile-hint"')
    // Review of #214: tile and chip did the same thing — one control stays.
    expect(page).not.toContain('t("filterManagers")')
    expect(page).toContain('activeFilter === "managers" ? t("leadersWithoutTeam") : t("unassignedGroup")')
  })

  it("loads every page of agents, bounded, instead of the first 200", () => {
    expect(page).toContain("const AGENTS_PAGE_SIZE = 200")
    expect(page).toContain("const AGENTS_MAX_PAGES = 10")
    expect(page).toContain("page=${page}")
    expect(page).not.toContain('fetch("/api/v1/mtm/agents?limit=200"')
    expect(page).not.toContain('t("leaderHidden")')
  })

  it("has every new label in every language", () => {
    const keys = [...page.matchAll(/(?<![\w.])t\("([A-Za-z0-9]+)"/g)].map((m) => m[1])
    const missing: string[] = []
    for (const locale of ["en", "ru", "az"]) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
      for (const key of new Set(keys)) if (typeof messages.mtmAgents?.[key] !== "string") missing.push(`${locale}.${key}`)
    }
    expect(missing).toEqual([])
  })
})
