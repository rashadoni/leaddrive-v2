import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { mtmAgentPresence, mtmAgentSilenceExplained } from "@/lib/mtm/agent-day-state"

/**
 * Field UX audit 2026-09-05, A7 tail. The web list of agents knew one thing:
 * whether a GPS point arrived recently. The same audit made the server refuse
 * points recorded during a break, so a rep at lunch fades to grey exactly like
 * a rep whose phone died — and the manager calls the second one.
 */
describe("agent presence for the web list", () => {
  it("names the break and when it started", () => {
    const presence = mtmAgentPresence({
      status: "PAUSED",
      startedAt: "2026-09-09T05:00:00.000Z",
      pausedAt: "2026-09-09T10:05:00.000Z",
    })
    expect(presence).toEqual({ kind: "paused", since: "2026-09-09T10:05:00.000Z" })
  })

  it("prefers a finished day over a break it still remembers", () => {
    // `pausedAt` keeps the last break after the day is closed; "finished" is
    // the newer truth, and closing is final and once per day.
    const presence = mtmAgentPresence({
      status: "COMPLETED",
      startedAt: "2026-09-09T05:00:00.000Z",
      pausedAt: "2026-09-09T10:05:00.000Z",
      completedAt: "2026-09-09T15:24:00.000Z",
    })
    expect(presence).toEqual({ kind: "finished", at: "2026-09-09T15:24:00.000Z" })
  })

  it("says the shift has not begun when there is no row at all", () => {
    expect(mtmAgentPresence(null)).toEqual({ kind: "not-started" })
    expect(mtmAgentPresence(undefined)).toEqual({ kind: "not-started" })
  })

  it("still reports the state when a moment is missing or unparseable", () => {
    // The columns are nullable and a row can arrive from a correction tool.
    // A break with no start is still a break — losing the state because the
    // clock is missing would put the grey dot back.
    expect(mtmAgentPresence({ status: "PAUSED", pausedAt: null })).toEqual({ kind: "paused", since: null })
    expect(mtmAgentPresence({ status: "PAUSED", pausedAt: "not a date" })).toEqual({ kind: "paused", since: null })
    expect(mtmAgentPresence({ status: "STARTED", startedAt: null })).toEqual({ kind: "working", since: null })
  })

  it("knows when silence needs no explaining from GPS", () => {
    for (const day of [null, { status: "PAUSED" as const }, { status: "COMPLETED" as const }]) {
      expect(mtmAgentSilenceExplained(mtmAgentPresence(day))).toBe(true)
    }
    // A running shift is the only case where no recent point means something.
    expect(mtmAgentSilenceExplained(mtmAgentPresence({ status: "STARTED" }))).toBe(false)
  })
})

describe("agent presence wiring", () => {
  it("is served for the whole page in one query, not per agent", () => {
    const route = readFileSync("src/app/api/v1/mtm/agents/route.ts", "utf8")
    expect(route).toContain("mtmAgentPresence(dayByAgent.get(agent.id))")
    // One findMany for the page's ids. A per-row lookup here would be an N+1
    // on a list that is paginated precisely because it can be long.
    expect(route).toContain("agentId: { in: agents.map((agent) => agent.id) }")
    expect(route.match(/prisma\.mtmAgentWorkday\.findMany/g) ?? []).toHaveLength(1)
  })

  it("lets the workday speak before the last-seen dot does", () => {
    const page = readFileSync("src/app/(dashboard)/mtm/agents/page.tsx", "utf8")
    const helper = page.slice(page.indexOf("const presenceText"), page.indexOf("const lastSeenText"))
    expect(helper.indexOf('presence?.kind === "paused"')).toBeLessThan(helper.indexOf("lastSeenText(a)"))
  })

  it("has every presence string in every language", () => {
    const keys = ["presencePausedSince", "presencePaused", "presenceFinishedAt", "presenceFinished", "presenceNotStarted"]
    const missing: string[] = []
    for (const locale of ["en", "ru", "az"]) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
      for (const key of keys) {
        if (typeof messages.mtmAgents?.[key] !== "string") missing.push(`${locale}.${key}`)
      }
    }
    expect(missing).toEqual([])
    for (const locale of ["en", "ru", "az"]) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
      expect(messages.mtmAgents.presencePausedSince).toContain("{time}")
      expect(messages.mtmAgents.presenceFinishedAt).toContain("{time}")
    }
  })
})
