import { describe, expect, it } from "vitest"
import { isQaWeekPlanAgent, visibleWeekPlanAgents } from "@/lib/mtm/week-plan-agents"

const AGENTS = [
  { id: "1", name: "Aysel Məmmədova", teamId: "team-a" },
  { id: "2", name: "Rəşad Quliyev", teamId: "team-b" },
  { id: "3", name: "[QA-SMOKE] Robot", teamId: "team-a" },
  { id: "4", name: "Nigar Əliyeva", teamId: null },
]

describe("team week rows (field UX audit C7)", () => {
  it("hides QA accounts by default", () => {
    expect(visibleWeekPlanAgents(AGENTS).map((agent) => agent.id)).toEqual(["1", "2", "4"])
    expect(isQaWeekPlanAgent({ name: "[QA-SMOKE] Robot" })).toBe(true)
    expect(isQaWeekPlanAgent({ name: "Aysel" })).toBe(false)
    expect(isQaWeekPlanAgent({ name: null })).toBe(false)
  })

  it("shows them when explicitly asked", () => {
    expect(visibleWeekPlanAgents(AGENTS, { includeQa: true })).toHaveLength(4)
  })

  it("narrows by team and by name together", () => {
    expect(visibleWeekPlanAgents(AGENTS, { teamId: "team-a" }).map((a) => a.id)).toEqual(["1"])
    expect(visibleWeekPlanAgents(AGENTS, { search: "quliyev" }).map((a) => a.id)).toEqual(["2"])
    expect(visibleWeekPlanAgents(AGENTS, { search: "  ƏLİYEVA " }).map((a) => a.id)).toEqual(["4"])
    expect(visibleWeekPlanAgents(AGENTS, { teamId: "team-a", search: "robot", includeQa: true }).map((a) => a.id)).toEqual(["3"])
  })

  it("returns nobody rather than everybody when nothing matches", () => {
    // Falling back to the full list would answer the manager's question with
    // its opposite.
    expect(visibleWeekPlanAgents(AGENTS, { search: "нет такого" })).toEqual([])
  })

  it("finds an Azerbaijani name typed in capitals", () => {
    // "İ" does not lowercase to a plain "i", so toLowerCase alone found
    // nothing in "Əliyeva" — the same casing trap as audit B13, one screen
    // over.
    expect(visibleWeekPlanAgents(AGENTS, { search: "ƏLİYEVA" }).map((a) => a.id)).toEqual(["4"])
    expect(visibleWeekPlanAgents(AGENTS, { search: "əliyeva" }).map((a) => a.id)).toEqual(["4"])
  })

  it("keeps the order it was given", () => {
    const reversed = [...AGENTS].reverse()
    expect(visibleWeekPlanAgents(reversed).map((agent) => agent.id)).toEqual(["4", "2", "1"])
  })
})
