import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  MTM_AGENT_APP_ACTIVE_WINDOW_MS,
  mtmAgentActivityWindowStart,
  mtmAgentAppActivity,
  mtmAgentCardActivity,
  mtmAgentPlanFulfillment,
} from "@/lib/mtm/agent-card-activity"

const NOW = new Date("2026-09-14T10:00:00.000Z")

describe("agent card: app activity", () => {
  it("calls the app active on a fresh GPS point even without a push token", () => {
    // Prod: amber «Aktiv deyil» on a phone sending GPS every 30 s.
    const app = mtmAgentAppActivity({ lastLocationAt: new Date(NOW.getTime() - 30_000), lastSeenAt: null, hasPushToken: false, now: NOW })
    expect(app).toEqual({ state: "active", lastSignalAt: "2026-09-14T09:59:30.000Z", notificationsConnected: false })
  })

  it("takes the newest of GPS and lastSeenAt", () => {
    const app = mtmAgentAppActivity({
      lastLocationAt: "2026-09-13T18:00:00.000Z",
      lastSeenAt: new Date(NOW.getTime() - 5 * 60_000),
      hasPushToken: true,
      now: NOW,
    })
    expect(app.state).toBe("active")
    expect(app.notificationsConnected).toBe(true)
  })

  it("goes quiet after the window and says never when there was no signal", () => {
    const edge = mtmAgentAppActivity({ lastLocationAt: new Date(NOW.getTime() - MTM_AGENT_APP_ACTIVE_WINDOW_MS), now: NOW })
    expect(edge.state).toBe("active")
    const stale = mtmAgentAppActivity({ lastLocationAt: new Date(NOW.getTime() - MTM_AGENT_APP_ACTIVE_WINDOW_MS - 1), now: NOW })
    expect(stale.state).toBe("quiet")
    expect(mtmAgentAppActivity({ lastLocationAt: null, lastSeenAt: "not a date", now: NOW })).toEqual({
      state: "never",
      lastSignalAt: null,
      notificationsConnected: false,
    })
  })
})

describe("agent card: plan fulfilment", () => {
  it("is visited over planned route points, like analytics", () => {
    expect(mtmAgentPlanFulfillment(2, 2)).toBe(100)
    expect(mtmAgentPlanFulfillment(3, 1)).toBe(33)
  })

  it("is null, not 0%, when nothing was planned", () => {
    expect(mtmAgentPlanFulfillment(0, 0)).toBeNull()
    expect(mtmAgentCardActivity({ visits: 2 })).toEqual({ periodDays: 7, visits: 2, plannedPoints: 0, visitedPoints: 0, planFulfillment: null })
  })

  it("never reports more than 100%", () => {
    expect(mtmAgentPlanFulfillment(4, 9)).toBe(100)
  })

  it("uses the analytics weekly window", () => {
    expect(mtmAgentActivityWindowStart(NOW).toISOString()).toBe("2026-09-07T10:00:00.000Z")
  })
})

describe("agents page reads fields the list returns", () => {
  const page = readFileSync("src/app/(dashboard)/mtm/agents/page.tsx", "utf8")

  it("no longer prints fallbacks for fields that never arrived", () => {
    expect(page).not.toContain("visitEffectiveness")
    expect(page).not.toContain("expoPushToken")
    expect(page).not.toContain("/mtm/visits?agentId")
    expect(page).toContain("agent.activity")
    expect(page).toContain("agent.app")
    expect(page).toContain('t("planNone")')
  })

  it("links an employee to their route history and supports focusing one employee", () => {
    expect(page).toContain("/mtm/map?mode=history&agentId=")
    expect(page).toContain('searchParams.get("agentId")')
    expect(page).toContain('data-testid="mtm-agent-focus-chip"')
  })
})
