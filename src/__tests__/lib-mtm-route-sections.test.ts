/**
 * «Календарь» and «Маршруты» without repeats (owner, 2026-10-15). Each section
 * offers its own views; a view of the other section, asked for by a link or
 * remembered from before, opens the section's own default instead.
 */
import { describe, expect, it } from "vitest"
import { canUseMtmRouteView, defaultMtmRouteView, type MtmRouteViewMode } from "@/lib/mtm/route-sections"

const ALL: MtmRouteViewMode[] = ["calendar", "week", "list", "approvals", "agent", "matrix"]

describe("the route sections", () => {
  it("gives the calendar the month and the team week, the routes the list and the approvals", () => {
    expect(ALL.filter((mode) => canUseMtmRouteView(mode, true, "calendar"))).toEqual(["calendar", "week", "agent", "matrix"])
    expect(ALL.filter((mode) => canUseMtmRouteView(mode, true, "routes"))).toEqual(["list", "approvals", "agent", "matrix"])
    expect(defaultMtmRouteView("calendar")).toBe("calendar")
    expect(defaultMtmRouteView("routes")).toBe("list")
  })

  it("keeps the team week and the approvals for those who review the team", () => {
    expect(ALL.filter((mode) => canUseMtmRouteView(mode, false, "calendar"))).toEqual(["calendar", "agent", "matrix"])
    expect(ALL.filter((mode) => canUseMtmRouteView(mode, false, "routes"))).toEqual(["list", "agent", "matrix"])
  })
})
