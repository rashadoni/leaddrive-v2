import { describe, expect, it } from "vitest"
import {
  appendMtmRouteAssignmentHandoff,
  mtmRouteAssignmentCatalogHref,
  mtmRouteAssignmentHandoffFromSearchParams,
  mtmRoutePlannerHref,
  mtmRoutePlanningHref,
  mtmRouteReturnTarget,
} from "@/lib/mtm/route-links"

describe("MTM route links", () => {
  it("builds a customer-prefilled route link with a safe encoded return path", () => {
    expect(mtmRoutePlanningHref({
      customerId: "customer/1",
      contactId: "contact & 1",
      returnTo: "/mtm/customers?scope=ALL&sort=name",
    })).toBe(
      "/mtm/routes?customerId=customer%2F1&contactId=contact+%26+1&returnTo=%2Fmtm%2Fcustomers%3Fscope%3DALL%26sort%3Dname",
    )
  })

  it("allows only known internal return destinations", () => {
    expect(mtmRouteReturnTarget("/mtm?week=2026-08-17")).toEqual({
      href: "/mtm?week=2026-08-17",
      label: "returnToOperationalWeek",
    })
    expect(mtmRouteReturnTarget("/mtm/customers?scope=ALL")).toEqual({
      href: "/mtm/customers?scope=ALL",
      label: "returnToCustomers",
    })
    expect(mtmRouteReturnTarget("//evil.example/mtm")).toBeNull()
    expect(mtmRouteReturnTarget("https://evil.example/mtm")).toBeNull()
    expect(mtmRouteReturnTarget("/mtm/routes")).toBeNull()
  })

  it("keeps agent, day, and catalogue type when handing assignment back to route planning", () => {
    const plannerHref = mtmRoutePlannerHref({
      agentId: "agent-1",
      date: "2026-08-22",
      direction: "DOCTOR",
    })
    expect(plannerHref).toBe(
      "/mtm/routes?planAgentId=agent-1&planDate=2026-08-22&planDirection=DOCTOR",
    )

    const catalogue = new URL(mtmRouteAssignmentCatalogHref({
      agentId: "agent-1",
      date: "2026-08-22",
      direction: "PHARMACY",
    }), "https://leaddrive.test")
    expect(catalogue.pathname).toBe("/mtm/customers")
    expect(catalogue.searchParams.get("scope")).toBe("ALL")
    expect(catalogue.searchParams.get("objectType")).toBe("PHARMACY")

    expect(mtmRouteAssignmentHandoffFromSearchParams(catalogue.searchParams)).toEqual({
      agentId: "agent-1",
      date: "2026-08-22",
      direction: "PHARMACY",
      returnTo: "/mtm/routes?planAgentId=agent-1&planDate=2026-08-22&planDirection=PHARMACY",
    })
  })

  it("rejects unsafe assignment return URLs and preserves a safe handoff through catalogue filters", () => {
    const unsafe = new URLSearchParams({
      routeAgentId: "agent-1",
      routeDate: "2026-08-22",
      routeDirection: "DOCTOR",
      routeReturnTo: "https://evil.example/mtm/routes",
    })
    const safeFallback = mtmRouteAssignmentHandoffFromSearchParams(unsafe)
    expect(safeFallback?.returnTo).toBe(
      "/mtm/routes?planAgentId=agent-1&planDate=2026-08-22&planDirection=DOCTOR",
    )

    const rewritten = appendMtmRouteAssignmentHandoff(
      new URLSearchParams({ query: "nigar" }),
      safeFallback,
    )
    expect(rewritten.get("query")).toBe("nigar")
    expect(rewritten.get("routeAgentId")).toBe("agent-1")
    expect(rewritten.get("routeReturnTo")).toBe(safeFallback?.returnTo)
  })
})
