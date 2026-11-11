/**
 * «Rollar və İcazələr»: an admin saves the organization's rights for its roles
 * (lib/role-access.ts). Only an admin; a cell that may not be changed is
 * refused with its name, never quietly dropped; the save takes effect for the
 * next request of this process at once.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const state = vi.hoisted(() => ({
  auth: { orgId: "org-z", userId: "u-admin", role: "admin" } as { orgId: string; userId: string; role: string },
  settings: { hideCustomerPhoneForOperators: true } as Record<string, unknown>,
  audits: [] as unknown[],
  executed: [] as string[],
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsSessionAuth: (handler: (req: NextRequest, auth: unknown) => Promise<Response>) => (req: NextRequest) => handler(req, state.auth),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: vi.fn(async () => ({ settings: state.settings })) },
    $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      state.executed.push(strings.join("?"))
      state.settings = { ...state.settings, roleAccess: JSON.parse(String(values[0])) }
      return 1
    }),
  },
  logAudit: vi.fn(async (...args: unknown[]) => { state.audits.push(args) }),
}))

const { GET, PUT } = await import("@/app/api/v1/settings/role-access/route")
const { checkPermission } = await import("@/lib/permissions")
const { orgRoleAccess } = await import("@/lib/role-access-server")

const put = (body: unknown) => PUT(new NextRequest("http://crm.test/api/v1/settings/role-access", { method: "PUT", body: JSON.stringify(body) }), {} as never)
const get = () => GET(new NextRequest("http://crm.test/api/v1/settings/role-access"), {} as never)

beforeEach(() => {
  state.auth = { orgId: "org-z", userId: "u-admin", role: "admin" }
  state.settings = { hideCustomerPhoneForOperators: true }
  state.audits = []
  state.executed = []
})

describe("PUT /api/v1/settings/role-access", () => {
  it("an admin saves the differences; the other settings stay; the next check in this process follows", async () => {
    const res = await put({ roleAccess: { sales: { contacts: "full" }, support: { deals: "none" } } })
    expect(res.status).toBe(200)
    expect((await res.json()).data.roleAccess).toEqual({ sales: { contacts: "full" }, support: { deals: "none" } })
    expect(state.executed[0]).toContain("jsonb_set")
    expect(state.settings.hideCustomerPhoneForOperators).toBe(true)
    expect(orgRoleAccess("org-z")).toEqual({ sales: { contacts: "full" }, support: { deals: "none" } })
    expect(checkPermission("support", "deals", "read", orgRoleAccess("org-z"))).toBe(false)
    expect(state.audits).toHaveLength(1)
    const back = await get()
    expect((await back.json()).data.roleAccess).toEqual({ sales: { contacts: "full" }, support: { deals: "none" } })
  })

  it("refuses, with their names, cells nobody may change — the admin's and Settings — and writes nothing", async () => {
    const res = await put({ roleAccess: { admin: { deals: "none" }, sales: { settings: "full", contacts: "full" } } })
    expect(res.status).toBe(400)
    expect((await res.json()).rejected.sort()).toEqual(["admin.deals", "sales.settings"])
    expect(state.executed).toEqual([])
  })

  it("only an admin reads or changes it", async () => {
    for (const role of ["manager", "sales", "viewer"]) {
      state.auth = { orgId: "org-z", userId: "u-x", role }
      expect((await put({ roleAccess: { sales: { contacts: "full" } } })).status).toBe(403)
      expect((await get()).status).toBe(403)
    }
    expect(state.executed).toEqual([])
  })

  it("an empty map puts every role back to its built-in rights", async () => {
    await put({ roleAccess: { sales: { contacts: "full" } } })
    const res = await put({ roleAccess: {} })
    expect(res.status).toBe(200)
    expect(orgRoleAccess("org-z")).toEqual({})
    expect(checkPermission("sales", "contacts", "delete", orgRoleAccess("org-z"))).toBe(false)
  })
})
