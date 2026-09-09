import { describe, expect, it } from "vitest"

import { resolveDashboardWidgets } from "@/lib/dashboard/resolve-widgets"
import { DASHBOARD_WIDGET_GROUPS, DASHBOARD_WIDGETS } from "@/lib/dashboard/widget-registry"

const loyaltyWidgetIds = ["loyaltyMembers", "loyaltyPoints30d", "loyaltyRedemptions30d"]

describe("dashboard loyalty widgets", () => {
  it("registers loyalty widgets under the loyalty group", () => {
    expect(DASHBOARD_WIDGET_GROUPS).toContain("loyalty")

    const loyaltyWidgets = DASHBOARD_WIDGETS.filter((widget) => loyaltyWidgetIds.includes(widget.id))
    expect(loyaltyWidgets.map((widget) => widget.id)).toEqual(loyaltyWidgetIds)
    expect(loyaltyWidgets.every((widget) => widget.category === "loyalty")).toBe(true)
    expect(loyaltyWidgets.every((widget) => widget.module === "loyalty")).toBe(true)
    expect(loyaltyWidgets.every((widget) => widget.size === "standard")).toBe(true)
  })

  it("shows loyalty widgets only when the tenant has the loyalty module", () => {
    const withoutLoyalty = resolveDashboardWidgets({
      role: "manager",
      org: { plan: "tier-25", role: "manager", modules: { crm: true, sales: true } },
    }).map((widget) => widget.id)

    expect(withoutLoyalty).not.toContain("loyaltyMembers")
    expect(withoutLoyalty).not.toContain("loyaltyPoints30d")
    expect(withoutLoyalty).not.toContain("loyaltyRedemptions30d")

    const withLoyalty = resolveDashboardWidgets({
      role: "manager",
      org: { plan: "tier-25", role: "manager", modules: { crm: true, sales: true, loyalty: true } },
    }).map((widget) => widget.id)

    expect(withLoyalty).toEqual(expect.arrayContaining(loyaltyWidgetIds))
  })
})
