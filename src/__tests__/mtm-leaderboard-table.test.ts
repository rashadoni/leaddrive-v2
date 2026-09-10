import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * Field UX audit 2026-09-05, W-12 / task C13, backlog T15.
 *
 * The page opened on a near-black canvas of floating bubbles, one per agent,
 * every one reading 0 %. The Phase 1 UX contract says the field module is "not
 * a gamified dashboard", and with empty data the screen was not merely
 * off-contract — it was useless: nothing to read, nothing to compare.
 *
 * The trap in T15's acceptance is "no dead code is left", which reads as
 * "delete BubbleArena". It must not be deleted: the general /leaderboard page
 * is built on it. Only its use here goes.
 */
const PAGE = "src/app/(dashboard)/mtm/leaderboard/page.tsx"
const page = readFileSync(PAGE, "utf8")

describe("C13: the leaderboard is a table", () => {
  it("no longer draws the bubble canvas or its view switch", () => {
    const code = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
    expect(code).not.toContain("<BubbleArena")
    expect(code).not.toContain("BubbleArenaSkeleton")
    expect(code).not.toContain('view === "bubbles"')
    expect(code).not.toContain("ViewMode")
    expect(code).not.toContain("bubble-arena")
  })

  it("leaves the component itself alone for the page that needs it", () => {
    // Deleting it would break /leaderboard, a screen this audit never opened.
    const arena = readFileSync("src/components/leaderboard/bubble-arena.tsx", "utf8")
    expect(arena.length).toBeGreaterThan(0)
    const general = readFileSync("src/app/(dashboard)/leaderboard/page.tsx", "utf8")
    expect(general).toContain("BubbleArena")
  })

  it("draws a real table with sortable columns", () => {
    expect(page).toContain("<table")
    expect(page).toContain('aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"}')
    for (const key of ["visits", "completedTasks", "approvedPhotos", "score"]) {
      expect(page).toContain(`{ key: "${key}"`)
    }
  })

  it("reads Top 3 from the ranking, never from the sorted table", () => {
    // This is T15's acceptance, and the defect it names appears the moment
    // sorting exists: slicing the user-sorted array would silently turn "the
    // three best" into "the three at the top of whatever was just sorted".
    expect(page).toContain("{rankings.slice(0, 3).map(")
    expect(page).not.toContain("sortedRankings.slice(0, 3)")
    expect(page).toContain("const sortedRankings = useMemo(")
    const top3 = page.slice(page.indexOf('data-testid="mtm-leaderboard-top3"'), page.indexOf('data-testid="mtm-leaderboard-top3"') + 700)
    expect(top3).toContain("rankings.slice(0, 3)")
    expect(top3).not.toContain("sortedRankings.slice")
    expect(top3).not.toContain("sortedRankings.map")
  })

  it("keeps the KPI breakdown reachable, now from a row", () => {
    expect(page).toContain("AgentDetailCard")
    expect(page).toContain("openBreakdown(agent.agentId)")
    expect(page).toContain("const breakdownById = useMemo(")
    // Keyboard too: a row that only answers to a mouse is not a control.
    expect(page).toContain('if (event.key === "Enter" || event.key === " ")')
    expect(page).toContain('aria-label={t("openBreakdown", { name: agent.name })}')
  })

  it("does not recompute attainment on the client", () => {
    // Weights are per-organization; a client-side guess would print a number
    // different from the one the panel's own API returns.
    expect(page).not.toContain("mtmAttainment")
    expect(page).not.toContain("mtmToNormalized")
    expect(page).toContain("/api/v1/leaderboard/arena?group=mtm")
  })

  it("says so when the breakdown cannot be opened", () => {
    // The arena feed is module- and RBAC-gated; a row that does nothing is the
    // defect this whole audit is about.
    expect(page).toContain('toast.message(t("breakdownUnavailable"))')
  })

  it("has every new string in all three languages", () => {
    const missing: string[] = []
    for (const locale of ["en", "ru", "az"]) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
      const block = messages.mtmLeaderboard ?? {}
      for (const key of ["colAgent", "colVisits", "colTasks", "colPhotos", "colScore", "sortBy", "openBreakdown", "top3FromRanking", "breakdownUnavailable"]) {
        if (typeof block[key] !== "string" || !block[key].trim()) missing.push(`${locale}.${key}`)
      }
    }
    expect(missing).toEqual([])
  })
})
