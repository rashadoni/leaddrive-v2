import { describe, expect, it } from "vitest"
import { filterToolsByTenantModules, getEnabledTools, getToolModule } from "@/lib/ai/tools"

const toolNames = (tools: Array<{ name: string }>) => tools.map((tool) => tool.name)

describe("AI tools tenant module gate", () => {
  it("maps write and read tools to tenant modules where gating is required", () => {
    expect(getToolModule("create_deal")).toBe("sales")
    expect(getToolModule("update_deal_stage")).toBe("sales")
    expect(getToolModule("create_ticket")).toBe("support")
    expect(getToolModule("list_invoices")).toBe("finance")
    expect(getToolModule("list_contacts")).toBe("crm")
  })

  it("filters wildcard tools to modules enabled for the tenant", () => {
    const filtered = toolNames(filterToolsByTenantModules(getEnabledTools(["*"]), {
      plan: "enterprise",
      addons: [],
      modules: { crm: true },
    }))

    expect(filtered).toContain("add_note")
    expect(filtered).toContain("create_task")
    expect(filtered).toContain("update_contact")
    expect(filtered).toContain("list_contacts")
    expect(filtered).toContain("list_tasks")
    expect(filtered).not.toContain("create_deal")
    expect(filtered).not.toContain("update_deal_stage")
    expect(filtered).not.toContain("list_deals")
    expect(filtered).not.toContain("create_ticket")
    expect(filtered).not.toContain("list_tickets")
    expect(filtered).not.toContain("list_invoices")
  })

  it("keeps sales tools when sales is enabled and support is disabled", () => {
    const filtered = toolNames(filterToolsByTenantModules(getEnabledTools(["create_deal", "create_ticket", "list_deals"]), {
      plan: "enterprise",
      addons: [],
      modules: { crm: true, sales: true },
    }))

    expect(filtered).toEqual(["create_deal", "list_deals"])
  })
})
