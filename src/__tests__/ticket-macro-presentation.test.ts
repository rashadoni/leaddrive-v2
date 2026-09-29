import { describe, expect, it } from "vitest"

import {
  actionAssigneeIds,
  allMacroCategories,
  canManageTicketMacros,
  customMacroCategoriesFromSettings,
  macroMatchesQuery,
  moveMacroAction,
  normalizeMacroCategory,
  settingsWithMacroCategories,
  type MacroRecord,
} from "@/lib/ticket-macros/presentation"
import { macroActionsSchema } from "@/lib/ticket-macros/schema"

const macro: MacroRecord = {
  id: "m1",
  name: "Resolve billing issue",
  description: "Reply and close",
  category: "Billing",
  actions: [{ type: "set_status", value: "resolved" }],
  shortcutKey: "Alt+1",
  usageCount: 4,
  isActive: true,
  sortOrder: 0,
}

describe("ticket macro presentation contract", () => {
  it("allows only management roles to mutate the shared library", () => {
    expect(["superadmin", "admin", "manager"].every(canManageTicketMacros)).toBe(true)
    expect(["support", "ticketing", "viewer"].some(canManageTicketMacros)).toBe(false)
  })

  it("normalizes category whitespace without forcing user-facing lowercase", () => {
    expect(normalizeMacroCategory("  Customer   Care  ")).toBe("Customer Care")
  })

  it("reads deduplicated organization categories", () => {
    expect(customMacroCategoriesFromSettings({ ticketMacroCategories: ["VIP", "vip", " Escalation ", 2] })).toEqual(["VIP", "Escalation"])
  })

  it("merges defaults, shared categories and categories already used by macros", () => {
    const categories = allMacroCategories({ ticketMacroCategories: ["VIP"] }, ["Legacy"])
    expect(categories).toEqual(expect.arrayContaining(["general", "billing", "VIP", "Legacy"]))
  })

  it("preserves unrelated organization settings when categories change", () => {
    expect(settingsWithMacroCategories({ timezone: "UTC" }, ["general", "VIP"])).toEqual({
      timezone: "UTC",
      ticketMacroCategories: ["VIP"],
    })
  })

  it("filters by text, category and active state together", () => {
    expect(macroMatchesQuery(macro, "billing", "Billing", "active")).toBe(true)
    expect(macroMatchesQuery(macro, "close", "all", "inactive")).toBe(false)
  })

  it("moves an action in either direction without mutating the input", () => {
    const actions = [{ type: "set_status", value: "resolved" }, { type: "add_tag", value: "done" }] as const
    const moved = moveMacroAction(actions, 1, "up")
    expect(moved.map((action) => action.type)).toEqual(["add_tag", "set_status"])
    expect(actions[0].type).toBe("set_status")
  })

  it("deduplicates scoped assignee identifiers", () => {
    expect(actionAssigneeIds([
      { type: "set_assignee", value: "u1" },
      { type: "set_assignee", value: "u1" },
      { type: "add_tag", value: "vip" },
    ])).toEqual(["u1"])
  })
})

describe("ticket macro action schema", () => {
  it("accepts the supported status and rejects arbitrary stored status values", () => {
    expect(macroActionsSchema.safeParse([{ type: "set_status", value: "closed" }]).success).toBe(true)
    expect(macroActionsSchema.safeParse([{ type: "set_status", value: "destroyed" }]).success).toBe(false)
  })

  it("rejects unknown actions, empty values and oversized action lists", () => {
    expect(macroActionsSchema.safeParse([{ type: "run_script", value: "x" }]).success).toBe(false)
    expect(macroActionsSchema.safeParse([{ type: "add_tag", value: "" }]).success).toBe(false)
    expect(macroActionsSchema.safeParse(Array.from({ length: 26 }, () => ({ type: "add_tag", value: "x" }))).success).toBe(false)
  })
})
