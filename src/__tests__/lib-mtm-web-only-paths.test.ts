import { describe, it, expect } from "vitest"
import { isMtmWebOnlyPath } from "@/lib/mtm-web-only"

/**
 * Phase E sweep [P2]: the web-only MTM prefixes must reject a mobile JWT (so those
 * routes 401 a field-agent token), while the routes the mobile app actually calls
 * must KEEP accepting mobile JWTs (gating them would break the app).
 */
describe("isMtmWebOnlyPath", () => {
  it("flags the web-admin MTM groups the mobile app never calls (batch 1 + 2)", () => {
    for (const p of [
      // batch-1
      "/api/v1/mtm/analytics",
      "/api/v1/mtm/analytics/export",
      "/api/v1/mtm/teams",
      "/api/v1/mtm/teams/t1",
      "/api/v1/mtm/regions/r1",
      "/api/v1/mtm/reports",
      // batch-2 (clean web-only — no in-handler mobile auth)
      "/api/v1/mtm/activity",
      "/api/v1/mtm/locations",
      "/api/v1/mtm/notifications",
    ]) {
      expect(isMtmWebOnlyPath(p)).toBe(true)
    }
  })

  it("does NOT flag routes the mobile app uses (must keep accepting a mobile JWT)", () => {
    for (const p of [
      "/api/v1/mtm/routes",
      "/api/v1/mtm/visits/v1",
      "/api/v1/mtm/tasks",
      "/api/v1/mtm/dashboard",
      "/api/v1/mtm/customers",
      "/api/v1/mtm/alerts",
      "/api/v1/mtm/settings",
      "/api/v1/mtm/mobile/sync/pull",
      // batch-2 boundary: the mobile app's location/notifications live under
      // /mtm/mobile/* — they must NOT match the web-only /mtm/locations|notifications.
      "/api/v1/mtm/mobile/location",
      "/api/v1/mtm/mobile/workday",
      "/api/v1/mtm/mobile/notifications",
      // /mtm/agents (+ /agents/{id}, /agents/push-token) and /mtm/onboarding have a
      // legitimate in-handler mobile path (territory-scope / mobile auth), so they are
      // deliberately NOT denylisted — denying them would 401 a real mobile feature.
      "/api/v1/mtm/agents",
      "/api/v1/mtm/agents/agent_1",
      "/api/v1/mtm/agents/push-token",
      "/api/v1/mtm/onboarding",
    ]) {
      expect(isMtmWebOnlyPath(p)).toBe(false)
    }
  })

  it("does not flag non-MTM paths", () => {
    expect(isMtmWebOnlyPath("/api/v1/contacts")).toBe(false)
    expect(isMtmWebOnlyPath("/api/v1/leaderboard/arena")).toBe(false)
  })
})
