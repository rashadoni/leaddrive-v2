// @vitest-environment jsdom
/**
 * In the browser checkPermission reads the session's map (set by the dashboard
 * layout), so a button an organization's role may now use is shown, and one it
 * may no longer use is not (lib/role-access.ts).
 */
import { afterEach, expect, it } from "vitest"
import { cleanRoleAccess, setClientRoleAccess } from "@/lib/role-access"
import { enforcedAccessLevel } from "@/lib/user-access-summary"

afterEach(() => setClientRoleAccess(null))

it("the browser asks the session's map, so the buttons say what the server allows", () => {
  const map = cleanRoleAccess({ sales: { contacts: "full" }, support: { deals: "none" } }).map
  expect(enforcedAccessLevel("sales", "contacts")).toBe("edit")
  setClientRoleAccess(map)
  expect(enforcedAccessLevel("sales", "contacts")).toBe("full")
  expect(enforcedAccessLevel("support", "deals")).toBe("none")
  expect(enforcedAccessLevel("support", "deals", {})).toBe("view")
})
