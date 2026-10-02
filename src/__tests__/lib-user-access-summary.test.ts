import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { accessibleNavItems, navItems, orgFromSession } from "@/lib/nav-items"
import { PERMISSION_MODULE_TO_MODULE_ID } from "@/lib/permissions"
import {
  HIDEABLE_MODULE_SCOPES, moduleAccessOutcome, settingsAccessOutcome,
} from "@/lib/user-access-summary"
import {
  USER_HIDEABLE_MODULE_IDS, applyUserModuleMask, effectiveHiddenModules, hideableIdForGateModule,
  type UserHideableId,
} from "@/lib/user-module-access"

// The owner, 2026-10-02, looking at a manager left with Route & Field alone:
// "I don't understand how the Roles section and the user's own settings fit
// together." The role table said one thing, the ticks another, and nothing
// showed the result. These are the rows the user card now draws. No mocks —
// the real role matrix, the real mask, the real menu.

const outcomes = (role: string, hidden: readonly string[] = []) =>
  Object.fromEntries(USER_HIDEABLE_MODULE_IDS.map((id) => [id, moduleAccessOutcome(role, hidden, id).outcome]))

const ROUTE_AND_FIELD_ONLY = USER_HIDEABLE_MODULE_IDS.filter((id) => id !== "mtm")

describe("what one person gets — modules", () => {
  it("a manager left with Route & Field alone: full there, hidden everywhere else", () => {
    const result = outcomes("manager", ROUTE_AND_FIELD_ONLY)

    expect(result.mtm).toBe("full")
    const rest = Object.entries(result).filter(([id]) => id !== "mtm").map(([, outcome]) => outcome)
    expect([...new Set(rest)]).toEqual(["hidden"])
  })

  it("the same ticks under the Sales role give view-and-edit in Route & Field, not delete", () => {
    expect(outcomes("sales", ROUTE_AND_FIELD_ONLY).mtm).toBe("edit")
  })

  it("names the scopes when a role treats one module unevenly", () => {
    const sales = moduleAccessOutcome("sales", [], "sales")

    expect(sales.outcome).toBe("mixed")
    expect(sales.parts).toEqual([
      { level: "full", scopes: ["deals"] },
      { level: "edit", scopes: ["leads", "offers"] },
    ])
  })

  it("says a visible module is useless to the role instead of implying access", () => {
    // The ticketing agent has no finance scope at all; Support reads invoices
    // and nothing else there.
    expect(moduleAccessOutcome("ticketing", [], "finance").outcome).toBe("none")
    const finance = moduleAccessOutcome("support", [], "finance")
    expect(finance.outcome).toBe("mixed")
    expect(finance.parts[finance.parts.length - 1].level).toBe("none")
  })

  it("a viewer reads every module and changes none", () => {
    expect([...new Set(Object.values(outcomes("viewer")))]).toEqual(["view"])
  })

  it("an admin gets everything whatever ticks are stored on the row", () => {
    expect([...new Set(Object.values(outcomes("admin", ROUTE_AND_FIELD_ONLY)))]).toEqual(["full"])
  })

  it("a role the engine does not know gets nothing in any visible module", () => {
    expect([...new Set(Object.values(outcomes("regional-lead")))]).toEqual(["none"])
  })
})

describe("what one person gets — Settings", () => {
  it("is the role's doing alone", () => {
    expect(settingsAccessOutcome("admin", [])).toEqual({ outcome: "full", pages: [] })
    expect(settingsAccessOutcome("viewer", [])).toEqual({ outcome: "view", pages: [] })
    expect(settingsAccessOutcome("sales", [])).toEqual({ outcome: "personal", pages: [] })
    expect(settingsAccessOutcome("regional-lead", [])).toEqual({ outcome: "personal", pages: [] })
  })

  it("a manager also gets the audit journal — until a module is hidden from them", () => {
    expect(settingsAccessOutcome("manager", [])).toEqual({ outcome: "personal", pages: ["auditLogSettings"] })
    expect(settingsAccessOutcome("manager", ["finance"])).toEqual({ outcome: "personal", pages: [] })
  })

  it("promises exactly the Settings pages the person's menu will show", () => {
    const tenant = {
      plan: "enterprise",
      addons: [] as string[],
      modules: { crm: true, sales: true, finance: true, mtm: true, settings: true, ai: true, voip: true },
    }
    const mismatches: string[] = []
    for (const role of ["manager", "sales", "support", "ticketing", "regional-lead"]) {
      for (const hidden of [[], ROUTE_AND_FIELD_ONLY]) {
        const effective = effectiveHiddenModules(role, hidden)
        const menu = accessibleNavItems(orgFromSession({
          ...tenant, role, hiddenModules: effective, modules: applyUserModuleMask(tenant, effective),
        })).filter((item) => item.group === "Settings").map((item) => item.tKey).sort()
        const promised = [...settingsAccessOutcome(role, hidden).pages, "notificationSettings"].sort()
        if (JSON.stringify(menu) !== JSON.stringify(promised)) {
          mismatches.push(`${role}/${hidden.length}: menu ${menu} vs card ${promised}`)
        }
      }
    }
    expect(mismatches).toEqual([])
  })
})

describe("the card's rows cannot drift from enforcement or from the copy", () => {
  it("covers every hideable module", () => {
    expect(Object.keys(HIDEABLE_MODULE_SCOPES).sort()).toEqual([...USER_HIDEABLE_MODULE_IDS].sort())
  })

  it("files each scope under the module the API gate puts it in", () => {
    const misfiled: string[] = []
    for (const [id, scopes] of Object.entries(HIDEABLE_MODULE_SCOPES)) {
      expect(scopes.length).toBeGreaterThan(0)
      for (const scope of scopes) {
        const gate = hideableIdForGateModule(PERMISSION_MODULE_TO_MODULE_ID[scope] ?? scope)
        if (gate !== id) misfiled.push(`${scope}: card says ${id}, gate says ${gate}`)
      }
    }
    expect(misfiled).toEqual([])
  })

  it.each(["en", "ru", "az"])("%s has every label a row can show", (locale) => {
    const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
    const missing: string[] = []

    for (const outcome of ["full", "edit", "view", "none", "hidden", "mixed"]) {
      if (!messages.settingsUsers[`accessLevel_${outcome}`]) missing.push(`settingsUsers.accessLevel_${outcome}`)
    }
    for (const outcome of ["full", "view", "personal", "personalPlus"]) {
      if (!messages.settingsUsers[`accessSettings_${outcome}`]) missing.push(`settingsUsers.accessSettings_${outcome}`)
    }
    // A scope is named only inside a "mixed" row, which needs two scopes.
    const named = (Object.keys(HIDEABLE_MODULE_SCOPES) as UserHideableId[])
      .map((id) => HIDEABLE_MODULE_SCOPES[id])
      .filter((scopes) => scopes.length > 1)
      .flat()
    for (const scope of named) {
      if (!messages.settings[`module_${scope}`]) missing.push(`settings.module_${scope}`)
    }
    for (const item of navItems.filter((candidate) => candidate.group === "Settings")) {
      if (!messages.nav[item.tKey]) missing.push(`nav.${item.tKey}`)
    }
    for (const hint of ["moduleHint_settings", "moduleHint_users"]) {
      if (!messages.settings[hint]) missing.push(`settings.${hint}`)
    }
    expect(missing).toEqual([])
  })

  it("the user card and the role table both read the enforced level, not a copy of it", () => {
    const card = readFileSync("src/app/(dashboard)/settings/users/page.tsx", "utf8")
    const table = readFileSync("src/app/(dashboard)/settings/roles/page.tsx", "utf8")

    expect(card).toContain("moduleAccessOutcome(form.role, form.hiddenModules, option.id)")
    expect(card).toContain("settingsAccessOutcome(form.role, form.hiddenModules)")
    expect(table).toContain("const enforcedLevel = enforcedAccessLevel")
  })
})
