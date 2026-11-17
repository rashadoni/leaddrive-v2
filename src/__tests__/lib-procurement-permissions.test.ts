/**
 * Who may do what in purchasing (docs/sales-procurement/README.md, tasks 1.2–1.3).
 *
 * The expectation is written out by hand on purpose, as in
 * finance-api-authorization.test.ts: a table derived from checkPermission
 * would only prove the matrix agrees with itself.
 */
import { describe, expect, it } from "vitest"
import { ALL_ROLES, MODULES, checkPermission, type Action, type Role } from "@/lib/permissions"
import { LEGACY_MODULE_MAP, hasModule } from "@/lib/modules"
import { DEFAULT_ROLES, getAssignableRoleIds } from "@/lib/org-roles"
import { EDITABLE_ROLES } from "@/lib/role-access"

type Scope = "procurement" | "purchase-requests" | "procurement-costs"
const SCOPES: Scope[] = ["procurement", "purchase-requests", "procurement-costs"]
const ACTIONS: Action[] = ["read", "write", "delete", "export"]

const MAY: Record<Role, Record<Scope, Action[]>> = {
  superadmin: { procurement: ACTIONS, "purchase-requests": ACTIONS, "procurement-costs": ACTIONS },
  admin: { procurement: ACTIONS, "purchase-requests": ACTIONS, "procurement-costs": ACTIONS },
  manager: { procurement: ["read", "write", "delete", "export"], "purchase-requests": ["read", "write", "delete"], "procurement-costs": ["read"] },
  procurement: { procurement: ["read", "write", "delete", "export"], "purchase-requests": ["read", "write"], "procurement-costs": ["read"] },
  finance: { procurement: ["read", "export"], "purchase-requests": ["read"], "procurement-costs": ["read"] },
  // Sales asks to buy for its deal and follows the status — no purchase prices.
  sales: { procurement: ["read"], "purchase-requests": ["read", "write"], "procurement-costs": [] },
  support: { procurement: [], "purchase-requests": [], "procurement-costs": [] },
  ticketing: { procurement: [], "purchase-requests": [], "procurement-costs": [] },
  viewer: { procurement: ["read"], "purchase-requests": ["read"], "procurement-costs": ["read"] },
  reviewer: { procurement: ["read"], "purchase-requests": ["read"], "procurement-costs": ["read"] },
}

describe("purchasing rights", () => {
  it("covers every role", () => {
    expect(Object.keys(MAY).sort()).toEqual([...ALL_ROLES].sort())
  })

  for (const role of ALL_ROLES) {
    it(`${role}: exactly the table`, () => {
      for (const scope of SCOPES) {
        for (const action of ACTIONS) {
          expect(checkPermission(role, scope, action, {}), `${role} ${action} ${scope}`).toBe(MAY[role][scope].includes(action))
        }
      }
    })
  }

  it("no API key can hold a purchasing scope: a purchase order is approved by a person", () => {
    for (const scope of SCOPES) expect(MODULES).not.toContain(scope)
  })

  it("all three scopes are gated by the procurement module, which nobody has unless given it", () => {
    for (const scope of SCOPES) expect(LEGACY_MODULE_MAP[scope]).toBe("procurement")
    expect(hasModule({ plan: "enterprise", modules: { crm: true, sales: true, finance: true } }, "procurement")).toBe(false)
    expect(hasModule({ plan: "enterprise", modules: { crm: true, sales: true, procurement: true } }, "procurement")).toBe(true)
    // A legacy-shaped record never carries it, and a plan never brings it.
    expect(hasModule({ plan: "enterprise", modules: { core: true, deals: true, invoices: true } }, "procurement")).toBe(false)
    expect(hasModule({ plan: "enterprise", modules: undefined }, "procurement")).toBe(false)
  })

  it("both new roles can be given to a person and tuned by the organization", () => {
    const assignable = getAssignableRoleIds()
    for (const role of ["procurement", "finance"]) {
      expect(assignable.has(role), role).toBe(true)
      expect(DEFAULT_ROLES.map((r) => r.id), role).toContain(role)
      expect(EDITABLE_ROLES as readonly string[], role).toContain(role)
    }
  })

  it("purchasing staff work with suppliers as companies and read the deals they buy for", () => {
    expect(checkPermission("procurement", "companies", "write", {})).toBe(true)
    expect(checkPermission("procurement", "deals", "read", {})).toBe(true)
    expect(checkPermission("procurement", "deals", "write", {})).toBe(false)
    expect(checkPermission("procurement", "finance", "read", {})).toBe(false)
    expect(checkPermission("procurement", "settings", "read", {})).toBe(false)
    expect(checkPermission("finance", "finance", "write", {})).toBe(true)
    expect(checkPermission("finance", "deals", "write", {})).toBe(false)
    expect(checkPermission("finance", "users", "read", {})).toBe(false)
  })
})
