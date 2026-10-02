import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { accessibleNavItems, navItems, orgFromSession } from "@/lib/nav-items"
import { PERMISSION_MODULE_TO_MODULE_ID } from "@/lib/permissions"
import {
  ASSIGNABLE_FIELD_CARD_ROLES, FIELD_CARD_ROLES, HIDEABLE_MODULE_SCOPES,
  fieldAccessOutcome, moduleAccessOutcome, settingsAccessOutcome,
} from "@/lib/user-access-summary"
import { VALID_MTM_AGENT_ROLES } from "@/lib/mtm/territory-scope"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
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

describe("what one person gets — Route & Field needs an employee card", () => {
  it("a web admin acts over the whole organization without one", () => {
    expect(fieldAccessOutcome("admin", null)).toEqual({ kind: "organization" })
    expect(fieldAccessOutcome("superadmin", { role: "AGENT" })).toEqual({ kind: "organization" })
  })

  it("everyone else acts as their card, and without one is refused", () => {
    expect(fieldAccessOutcome("manager", null)).toEqual({ kind: "missing" })
    expect(fieldAccessOutcome("manager", { role: "MANAGER" })).toEqual({ kind: "card", role: "MANAGER" })
    expect(fieldAccessOutcome("sales", { role: "AGENT" })).toEqual({ kind: "card", role: "AGENT" })
    // A card whose role the engine does not know resolves to no actor at all.
    expect(fieldAccessOutcome("manager", { role: "OWNER" })).toEqual({ kind: "missing" })
  })

  it("agrees with the resolver every field route uses", async () => {
    const actorFor = async (webRole: string, card: { role: string } | null) => resolveMtmRouteActor(
      {
        mtmAgent: {
          findFirst: async () => (card ? { id: "card-1", role: card.role, canPlanOwnRoutes: true, canSelfPublishRoutes: false } : null),
          findUnique: async () => null,
          findMany: async () => [],
          count: async () => 1,
        },
        mtmTeam: { findFirst: async () => null, findMany: async () => [] },
      } as unknown as Parameters<typeof resolveMtmRouteActor>[0],
      { organizationId: "org-1", userId: "u-1", webRole },
    )
    const disagreements: string[] = []
    for (const webRole of ["admin", "manager", "sales", "viewer"]) {
      for (const card of [null, { role: "AGENT" }, { role: "MANAGER" }, { role: "OWNER" }]) {
        const actor = await actorFor(webRole, card)
        const outcome = fieldAccessOutcome(webRole, card)
        const expected = actor === null ? "missing" : actor.agentId === null ? "organization" : "card"
        if (outcome.kind !== expected) disagreements.push(`${webRole}/${card?.role ?? "none"}: ${outcome.kind} vs ${expected}`)
      }
    }
    expect(disagreements).toEqual([])
  })

  it("knows exactly the roles the field engine knows, and hands out the ones the Agents form does", () => {
    expect([...FIELD_CARD_ROLES].sort()).toEqual([...VALID_MTM_AGENT_ROLES].sort())
    const form = readFileSync("src/components/mtm/agent-form.tsx", "utf8")
    const offered = [...form.matchAll(/<option value="(AGENT|SUPERVISOR|MANAGER|ADMIN)">/g)].map((match) => match[1])
    expect([...ASSIGNABLE_FIELD_CARD_ROLES].sort()).toEqual([...new Set(offered)].sort())
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
    for (const role of FIELD_CARD_ROLES) {
      for (const key of [`fieldRole_${role}`, `fieldRoleShort_${role}`]) {
        if (!messages.settingsUsers[key]) missing.push(`settingsUsers.${key}`)
      }
    }
    for (const key of ["fieldScopeNoticeTitle", "fieldScopeNoticeBody", "fieldScopeRequired"]) {
      if (!messages.mtmApiErrors[key]) missing.push(`mtmApiErrors.${key}`)
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
