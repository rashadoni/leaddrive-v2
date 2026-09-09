import { describe, expect, it } from "vitest"
import {
  emptyMtmRoutePlannerContext,
  mergeMtmRoutePlannerContext,
  mtmRoutePlannerContextStorageKey,
  mtmRoutePlannerContextsEqual,
  parseMtmRoutePlannerContext,
} from "@/lib/mtm/route-planner-context"

describe("MTM route planner context", () => {
  it("parses only bounded, valid planning state", () => {
    expect(parseMtmRoutePlannerContext({
      date: "2026-08-28",
      agentId: "agent-1",
      direction: "PHARMACY",
      search: "  Central pharmacy ",
      filters: {
        region: " Absheron ",
        administrativeDistrict: " Nasimi ",
        customerId: "customer-1",
        specialtyCode: "PE",
        psychotype: "Analytical",
      },
    })).toEqual({
      schemaVersion: 1,
      date: "2026-08-28",
      agentId: "agent-1",
      direction: "PHARMACY",
      search: "Central pharmacy",
      filters: {
        region: "Absheron",
        administrativeDistrict: "Nasimi",
        customerId: "customer-1",
        specialtyCode: "PE",
        psychotype: "Analytical",
      },
    })

    expect(parseMtmRoutePlannerContext({
      date: "28-08-2026",
      agentId: "x".repeat(121),
      direction: "UNSAFE",
      search: "x".repeat(161),
      filters: { region: "x".repeat(121) },
    })).toEqual(emptyMtmRoutePlannerContext())
  })

  it("merges an intentional context patch without keeping stale filters", () => {
    const initial = parseMtmRoutePlannerContext({
      date: "2026-08-28",
      agentId: "agent-1",
      direction: "DOCTOR",
      search: "old search",
      filters: { region: "Baku", specialtyCode: "PE" },
    })
    const next = mergeMtmRoutePlannerContext(initial, {
      date: "2026-08-29",
      search: "new search",
      filters: { administrativeDistrict: "Nasimi" },
    })

    expect(next).toMatchObject({
      date: "2026-08-29",
      agentId: "agent-1",
      direction: "DOCTOR",
      search: "new search",
      filters: {
        region: "",
        administrativeDistrict: "Nasimi",
        specialtyCode: "",
      },
    })
    expect(mtmRoutePlannerContextsEqual(initial, next)).toBe(false)
    expect(mtmRoutePlannerContextsEqual(next, parseMtmRoutePlannerContext(next))).toBe(true)
  })

  it("scopes session storage keys to the encoded tenant and viewer", () => {
    expect(mtmRoutePlannerContextStorageKey("org / one", "user@example.test"))
      .toBe("leaddrive:mtm:route-planner-context:org%20%2F%20one:user%40example.test")
  })
})
