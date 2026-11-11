/**
 * An organization's own rights for its roles (owner, 2026-11-11: «я как админ
 * почему не могу менять роли» → «Да, делай»; «у админа должны быть доступы»).
 * The map an admin saves is what checkPermission — the gate of every route —
 * answers with; admin, Settings, Users and Audit cannot be touched.
 */
import { afterEach, describe, expect, it } from "vitest"
import { checkPermission, type Role } from "@/lib/permissions"
import { cleanRoleAccess, readRoleAccess, setClientRoleAccess } from "@/lib/role-access"
import { moduleAccessDenial } from "@/lib/api-auth"
import { orgRoleAccess, rememberRoleAccess } from "@/lib/role-access-server"
import { runWithTenant } from "@/lib/rls-context"
import { enforcedAccessLevel } from "@/lib/user-access-summary"

afterEach(() => setClientRoleAccess(null))

describe("what an organization may change", () => {
  it("keeps editable cells and refuses admin, superadmin, Settings, Users, Audit and unknown levels", () => {
    const { map, rejected } = cleanRoleAccess({
      sales: { contacts: "full", settings: "full", deals: "none" },
      support: { deals: "none", users: "view" },
      admin: { deals: "none" },
      superadmin: { contacts: "none" },
      viewer: { reports: "everything" },
      manager: "full",
    })
    expect(map).toEqual({ sales: { contacts: "full", deals: "none" }, support: { deals: "none" } })
    expect(rejected.sort()).toEqual(["admin.deals", "manager", "sales.settings", "superadmin.contacts", "support.users", "viewer.reports"].sort())
  })

  it("reads only the roleAccess key of the organization's settings, and nothing from a hand-edited row", () => {
    expect(readRoleAccess({ roleAccess: { sales: { deals: "view" } }, permissions: { sales: { deals: "none" } } })).toEqual({ sales: { deals: "view" } })
    expect(readRoleAccess(null)).toEqual({})
    expect(readRoleAccess({ roleAccess: { admin: { deals: "none" } } })).toEqual({})
  })
})

describe("checkPermission with the organization's map", () => {
  const map = cleanRoleAccess({ sales: { contacts: "full", deals: "view" }, support: { deals: "none" }, viewer: { reports: "none" } }).map

  it("widens: Satış → Kontaktlar «Tam» may delete, which the built-in «Redaktə» may not", () => {
    expect(checkPermission("sales", "contacts", "delete", {})).toBe(false)
    expect(checkPermission("sales", "contacts", "delete", map)).toBe(true)
    expect(checkPermission("sales", "contacts", "export", map)).toBe(true)
  })

  it("narrows: Satış → Sövdələşmələr «Baxış» reads but no longer writes; Dəstək → «Yoxdur» does not even read", () => {
    expect(checkPermission("sales", "deals", "write", {})).toBe(true)
    expect([checkPermission("sales", "deals", "read", map), checkPermission("sales", "deals", "write", map), checkPermission("sales", "deals", "delete", map)]).toEqual([true, false, false])
    expect(checkPermission("support", "deals", "read", map)).toBe(false)
    // The viewer reads everything through a wildcard; the organization's «Yoxdur» still wins.
    expect(checkPermission("viewer", "reports", "read", map)).toBe(false)
    expect(checkPermission("viewer", "contacts", "read", map)).toBe(true)
  })

  it("leaves the admin whole, and every cell nobody changed as built in", () => {
    for (const action of ["read", "write", "delete", "export", "admin"] as const) {
      expect(checkPermission("admin", "deals", action, map)).toBe(true)
      expect(checkPermission("admin", "settings", action, map)).toBe(true)
    }
    for (const [role, scope] of [["sales", "leads"], ["support", "tickets"], ["manager", "deals"]] as Array<[Role, string]>) {
      for (const action of ["read", "write", "delete", "export"] as const) {
        expect(checkPermission(role, scope, action, map)).toBe(checkPermission(role, scope, action, {}))
      }
    }
  })
})

describe("the server gate", () => {
  const ORG = "org-zeytun"
  const OTHER = "org-other"

  it("refuses by the organization's map before the route runs — and only in that organization", () => {
    rememberRoleAccess(ORG, { roleAccess: { support: { deals: "none" }, sales: { contacts: "full" } } })
    rememberRoleAccess(OTHER, {})
    const support = { role: "support" as Role, orgId: ORG }
    expect(moduleAccessDenial(support, null, "deals", "read")?.status).toBe(403)
    expect(moduleAccessDenial({ ...support, orgId: OTHER }, null, "deals", "read")).toBeNull()
    expect(moduleAccessDenial({ role: "sales" as Role, orgId: ORG }, null, "contacts", "delete")).toBeNull()
    expect(moduleAccessDenial({ role: "sales" as Role, orgId: OTHER }, null, "contacts", "delete")?.status).toBe(403)
  })

  it("a map set from a server render never reaches the server's checks", () => {
    setClientRoleAccess({ sales: { deals: "none" } })
    expect(checkPermission("sales", "deals", "read")).toBe(true)
  })

  it("a route's own checkPermission inside the tenant answers with that tenant's map", async () => {
    rememberRoleAccess(ORG, { roleAccess: { sales: { deals: "view" } } })
    expect(orgRoleAccess(ORG)).toEqual({ sales: { deals: "view" } })
    expect(await runWithTenant(ORG, () => checkPermission("sales", "deals", "write"))).toBe(false)
    expect(await runWithTenant(OTHER, () => checkPermission("sales", "deals", "write"))).toBe(true)
  })
})
