import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Reading the team roster is `users:read`; administering users is `settings`.
 *
 * The list route asked for `settings:read`, so a manager — who holds
 * `users:read` precisely so they can assign work — got a 403, while a viewer,
 * who reads everything by wildcard, sailed through. The lead page turned that
 * 403 into an empty array, leaving a reassignment picker whose only option was
 * "unassigned": a control that offered to strip the lead's owner.
 *
 * Widening the gate is only half of it. The full record carries the security
 * posture of every colleague — 2FA state, the phone that verifies it, when the
 * password was last reset, how often they sign in. Whoever is admitted to pick
 * a name must not receive that, so the second test is the one that matters.
 */

const findMany = vi.fn(async (args?: unknown): Promise<unknown[]> => {
  void args
  return []
})
const findFirst = vi.fn(async (args?: unknown): Promise<unknown> => {
  void args
  return null
})
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findMany, findFirst } },
  logAudit: vi.fn(),
}))

vi.mock("@/lib/api-auth", () => ({
  orgHasModule: vi.fn(async () => true),
  moduleDisabledResponse: vi.fn((moduleId: string) =>
    new Response(JSON.stringify({ error: "Forbidden", moduleId }), { status: 403 })),
}))

let authRole = "manager"
let authPrincipalType: "session" | "api_key" = "session"
type MockAuth = {
  orgId: string
  userId: string
  role: string
  email: string
  name: string
  principalType: "session" | "api_key"
}
type MockHandler = (req: unknown, auth: MockAuth, ctx: unknown) => Promise<Response> | Response
vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: MockHandler) => {
    // The gate itself is asserted separately below; here we drive the body.
    return (req: unknown) =>
      handler(req, {
        orgId: "org_1",
        userId: "u_1",
        role: authRole,
        email: "x@y.z",
        name: "X",
        principalType: authPrincipalType,
      }, {})
  },
  withRlsSessionAuth: (handler: MockHandler) => {
    return (req: unknown, ctx: unknown) =>
      handler(req, {
        orgId: "org_1",
        userId: "u_1",
        role: authRole,
        email: "x@y.z",
        name: "X",
        principalType: "session",
      }, ctx)
  },
}))

import { checkPermission, type Role } from "@/lib/permissions"

function selectedFields(callArg: unknown): Record<string, boolean> {
  return (callArg as { select: Record<string, boolean> }).select
}

describe("who may read the team roster", () => {
  it("manager holds users:read but not settings:read", () => {
    // The premise. If this ever flips, the route's gate must be revisited
    // rather than the test relaxed.
    expect(checkPermission("manager" as Role, "users", "read")).toBe(true)
    expect(checkPermission("manager" as Role, "settings", "read")).toBe(false)
  })

  it("sales, support, and ticketing still cannot read it", () => {
    for (const role of ["sales", "support", "ticketing"] as Role[]) {
      expect(checkPermission(role, "users", "read")).toBe(false)
    }
  })

  it("viewer retains its existing read-only wildcard semantics", () => {
    expect(checkPermission("viewer", "users", "read")).toBe(true)
    expect(checkPermission("viewer", "users", "write")).toBe(false)
  })

  it("the route is gated on users:read, and writes stay on settings", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync("src/app/api/v1/users/route.ts", "utf8"),
    )
    expect(source).toContain('withRlsAuth("users", "read"')
    expect(source).toContain("export const POST = withRlsSessionAuth(")
    expect(source).toContain('checkPermission(authResult.role, "settings", "write")')

    const detailSource = await import("fs").then(fs =>
      fs.readFileSync("src/app/api/v1/users/[id]/route.ts", "utf8"),
    )
    expect(detailSource).toContain("export const GET = withRlsSessionAuth(")
    expect(detailSource).toContain('checkPermission(session.role, "users", "read")')
  })
})

describe("what the roster returns", () => {
  beforeEach(() => {
    findMany.mockClear()
    authPrincipalType = "session"
  })

  const SECURITY_FIELDS = [
    "totpEnabled", "require2fa", "smsAuthEnabled", "verifiedPhone",
    "passwordChangedAt", "lastLogin", "loginCount", "phone",
  ]

  it("withholds every account-security field from a manager", async () => {
    authRole = "manager"
    const { GET } = await import("@/app/api/v1/users/route")
    await (GET as unknown as (r: unknown) => Promise<Response>)({} as unknown)
    expect(findMany).toHaveBeenCalledOnce()
    const select = selectedFields(findMany.mock.calls[0][0])
    for (const field of SECURITY_FIELDS) {
      expect(select, `manager must not receive ${field}`).not.toHaveProperty(field)
    }
    // Still useful for picking someone to hand work to.
    expect(select).toHaveProperty("id")
    expect(select).toHaveProperty("name")
  })

  it("still gives an administrator the whole record", async () => {
    authRole = "admin"
    const { GET } = await import("@/app/api/v1/users/route")
    await (GET as unknown as (r: unknown) => Promise<Response>)({} as unknown)
    const select = selectedFields(findMany.mock.calls.at(-1)![0])
    for (const field of SECURITY_FIELDS) {
      expect(select, `administration screen still needs ${field}`).toHaveProperty(field)
    }
  })

  it("does not treat the viewer read wildcard as account-security administration", async () => {
    authRole = "viewer"
    const { GET } = await import("@/app/api/v1/users/route")
    await (GET as unknown as (r: unknown) => Promise<Response>)({} as unknown)
    const select = selectedFields(findMany.mock.calls.at(-1)![0])
    for (const field of SECURITY_FIELDS) {
      expect(select, `viewer must not receive ${field}`).not.toHaveProperty(field)
    }
  })

  it("never treats an API key's synthetic admin role as a browser administrator", async () => {
    authRole = "admin"
    authPrincipalType = "api_key"
    const { GET } = await import("@/app/api/v1/users/route")
    await (GET as unknown as (r: unknown) => Promise<Response>)({} as unknown)
    const select = selectedFields(findMany.mock.calls.at(-1)![0])
    for (const field of SECURITY_FIELDS) {
      expect(select, `API key must not receive ${field}`).not.toHaveProperty(field)
    }
    expect(select).toEqual(expect.objectContaining({ id: true, name: true, email: true }))
  })
})

describe("GET /api/v1/users/[id]", () => {
  beforeEach(() => {
    findFirst.mockClear()
    findFirst.mockResolvedValue({ id: "u_2", name: "Target" })
  })

  const params = { params: Promise.resolve({ id: "u_2" }) }
  type DetailGet = (req: unknown, ctx: typeof params) => Promise<Response>
  const SECURITY_FIELDS = [
    "totpEnabled", "require2fa", "smsAuthEnabled", "verifiedPhone",
    "passwordChangedAt", "lastLogin", "loginCount", "phone",
  ]

  it.each(["sales", "support", "ticketing"])("denies a %s without users:read before querying", async (role) => {
    authRole = role
    const { GET } = await import("@/app/api/v1/users/[id]/route")
    const response = await (GET as unknown as DetailGet)({} as unknown, params)

    expect(response.status).toBe(403)
    expect(findFirst).not.toHaveBeenCalled()
  })

  it.each(["manager", "viewer"])("returns only the shared roster projection to %s", async (role) => {
    authRole = role
    const { GET } = await import("@/app/api/v1/users/[id]/route")
    const response = await (GET as unknown as DetailGet)({} as unknown, params)

    expect(response.status).toBe(200)
    const select = selectedFields(findFirst.mock.calls.at(-1)![0])
    expect(select).toEqual(expect.objectContaining({ id: true, name: true, email: true, isAvailable: true }))
    for (const field of SECURITY_FIELDS) {
      expect(select, `${role} must not receive ${field}`).not.toHaveProperty(field)
    }
  })

  it("returns the full administration projection to an admin", async () => {
    authRole = "admin"
    const { GET } = await import("@/app/api/v1/users/[id]/route")
    const response = await (GET as unknown as DetailGet)({} as unknown, params)

    expect(response.status).toBe(200)
    const select = selectedFields(findFirst.mock.calls.at(-1)![0])
    for (const field of SECURITY_FIELDS) {
      expect(select, `admin projection needs ${field}`).toHaveProperty(field)
    }
  })
})
