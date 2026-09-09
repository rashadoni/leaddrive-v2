/**
 * mobile-auth-scope.test.ts
 *
 * Tests for the mobile-JWT permission/scope security fix:
 *   FIX 1 — requireAuth rejects mobile JWTs with 401.
 *   FIX 2 — getOrgId accepts mobile JWTs ONLY under /api/v1/mtm/.
 *   FIX 3 — resolveMobileAuth re-checks agent ACTIVE + org isActive + linked-user isActive (revocation).
 *   FIX 4 — middleware (best-effort; Edge-safe atob; primary enforcement is FIX 1+2).
 *
 * MTM app endpoints remain unaffected (app-unbroken assertions).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

// ---------------------------------------------------------------------------
// Shared mocks — declared before any imports from the modules under test
// ---------------------------------------------------------------------------
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    apiKey: { findFirst: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
    organization: { findUnique: vi.fn() },
    mtmAgent: { findFirst: vi.fn() },
  },
}))

vi.mock("@/lib/permissions", () => ({
  checkPermission: vi.fn().mockReturnValue(true),
  // Match the real resolver for the API-key regression requests below. An
  // unmapped route remains deny-by-default in getOrgId.
  resolveModuleFromPath: vi.fn((path: string) =>
    path.startsWith("/api/v1/contacts") ? "contacts" : null
  ),
  methodToAction: vi.fn().mockReturnValue("read"),
  PERMISSION_MODULE_TO_MODULE_ID: { kb: "knowledge-base", inbox: "omnichannel" },
}))

vi.mock("@/lib/modules", () => ({
  hasModule: vi.fn().mockReturnValue(true),
  moduleRecordFromOrgFields: vi.fn().mockReturnValue({ mtm: true }),
  MODULE_REGISTRY: {},
}))

// We do NOT mock getMobileAuth — we let the real implementation run so the
// token detection logic is exercised. But we mock jwt.verify so we can
// generate synthetic tokens without a real NEXTAUTH_SECRET.
vi.mock("jsonwebtoken", () => ({
  default: {
    verify: vi.fn(),
    sign: vi.fn().mockReturnValue("signed-token"),
  },
}))

// We need prisma available in mobile-auth (for resolveMobileAuth).
// The prisma mock above covers it. We also need to stub NEXTAUTH_SECRET
// so requireJwtSecret() doesn't throw.
vi.stubEnv("NEXTAUTH_SECRET", "test-secret-for-mobile-auth-tests")

import jwt from "jsonwebtoken"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getOrgId, requireAuth } from "@/lib/api-auth"
import { JWT_SECRET, resolveMobileAuth, requireMobileAuth } from "@/lib/mobile-auth"
import { createSessionFingerprint } from "@/lib/session-invalidation"
import { hasModule, moduleRecordFromOrgFields } from "@/lib/modules"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeRequest(path: string, method = "GET", headers?: Record<string, string>): NextRequest {
  return new NextRequest(new URL(`http://app.leaddrivecrm.org${path}`), {
    method,
    headers: headers ?? {},
  })
}

function makeRequestWithMobileBearer(path: string): NextRequest {
  return makeRequest(path, "GET", { authorization: "Bearer mobile-jwt-token" })
}

const TEST_SECRET = JWT_SECRET
const AGENT_PASSWORD_HASH = "$2b$12$agent-hash"
const USER_PASSWORD_HASH = "$2b$12$user-hash"
const USER_PASSWORD_CHANGED_AT = new Date("2026-08-11T12:00:00.123Z")

const MOBILE_PAYLOAD = {
  agentId: "agent-42",
  userId: "user-99",
  orgId: "org-mtm",
  email: "agent@field.com",
  name: "Field Agent",
  role: "AGENT",
  agentSessionFingerprint: createSessionFingerprint({
    principalId: "agent-42",
    passwordHash: AGENT_PASSWORD_HASH,
    secret: TEST_SECRET,
  }),
  userSessionFingerprint: createSessionFingerprint({
    principalId: "user-99",
    passwordHash: USER_PASSWORD_HASH,
    passwordChangedAt: USER_PASSWORD_CHANGED_AT,
    secret: TEST_SECRET,
  }),
}

const ACTIVE_ORG = { isActive: true }
const INACTIVE_ORG = { isActive: false }
const ACTIVE_AGENT = {
  role: "AGENT",
  status: "ACTIVE",
  userId: "user-99",
  passwordHash: AGENT_PASSWORD_HASH,
  organization: ACTIVE_ORG,
}
const SUSPENDED_AGENT = { ...ACTIVE_AGENT, status: "SUSPENDED" }
const INACTIVE_AGENT = { ...ACTIVE_AGENT, status: "INACTIVE" }
const ACTIVE_AGENT_DEAD_ORG = { ...ACTIVE_AGENT, organization: INACTIVE_ORG }
const ACTIVE_USER = {
  isActive: true,
  passwordHash: USER_PASSWORD_HASH,
  passwordChangedAt: USER_PASSWORD_CHANGED_AT,
}
const DEACTIVATED_USER = { ...ACTIVE_USER, isActive: false }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(hasModule).mockReturnValue(true)
  vi.mocked(moduleRecordFromOrgFields).mockReturnValue({ mtm: true })
  // Default: no web session
  vi.mocked(auth).mockResolvedValue(null as any)
  // Default: jwt.verify returns mobile payload (token looks like a mobile JWT)
  vi.mocked(jwt.verify).mockReturnValue(MOBILE_PAYLOAD as any)
  // Default: no API key
  vi.mocked(prisma.apiKey.findFirst).mockResolvedValue(null)
  // Default: org active
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({
    isActive: true, plan: "starter", addons: [], features: [],
  } as any)
  // Default: linked user active (FIX C)
  vi.mocked(prisma.user.findFirst).mockResolvedValue(ACTIVE_USER as any)
})

// ===========================================================================
// FIX 3 — resolveMobileAuth revocation check (direct unit tests)
// ===========================================================================
describe("resolveMobileAuth — revocation check", () => {
  it("ACCEPTED: active agent + active org under /mtm/ → returns MobileAuthResult", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(ACTIVE_AGENT as any)
    const req = makeRequestWithMobileBearer("/api/v1/mtm/visits")
    const result = await resolveMobileAuth(req)
    expect(result).not.toBeNull()
    expect(result?.agentId).toBe("agent-42")
    expect(result?.orgId).toBe("org-mtm")
  })

  it("SECURITY: uses the current DB role instead of a stale elevated JWT role", async () => {
    vi.mocked(jwt.verify).mockReturnValue({ ...MOBILE_PAYLOAD, role: "MANAGER" } as any)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(ACTIVE_AGENT as any)

    const result = await resolveMobileAuth(makeRequestWithMobileBearer("/api/v1/mtm/mobile/tasks"))

    expect(result?.role).toBe("AGENT")
    expect(prisma.mtmAgent.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ role: true }),
    }))
  })

  it("REJECTED: agent status SUSPENDED → returns null", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(SUSPENDED_AGENT as any)
    const req = makeRequestWithMobileBearer("/api/v1/mtm/visits")
    const result = await resolveMobileAuth(req)
    expect(result).toBeNull()
  })

  it("REJECTED: agent status INACTIVE → returns null", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(INACTIVE_AGENT as any)
    const req = makeRequestWithMobileBearer("/api/v1/mtm/visits")
    const result = await resolveMobileAuth(req)
    expect(result).toBeNull()
  })

  it("REJECTED: agent ACTIVE but org.isActive === false → returns null", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(ACTIVE_AGENT_DEAD_ORG as any)
    const req = makeRequestWithMobileBearer("/api/v1/mtm/visits")
    const result = await resolveMobileAuth(req)
    expect(result).toBeNull()
  })

  it("ACCEPTED: legacy tenant retains Workforce access after Route & Field is disabled", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(ACTIVE_AGENT as any)
    // The first lookup resolves Route & Field. The second one retains the
    // established Workforce compatibility entitlement until an explicit
    // `workforce-hrm: false` marker is written for the tenant.
    vi.mocked(hasModule).mockReturnValueOnce(false)

    const result = await resolveMobileAuth(makeRequestWithMobileBearer("/api/v1/mtm/visits"))

    expect(result?.tenantCapabilities).toEqual({
      routeField: false,
      workforceHrm: true,
      attendanceQr: false,
      attendanceDeviceTrust: false,
    })
  })

  it("ACCEPTED: an active Workforce-only tenant receives no Route & Field capability", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      ...ACTIVE_AGENT,
      organization: {
        isActive: true,
        plan: "enterprise",
        addons: [],
        features: ["workforce-hrm"],
        modules: { mtm: false, "workforce-hrm": true },
      },
    } as any)
    // Route & Field uses the first `hasModule(..., "mtm")` lookup. The
    // explicit Workforce flag remains authoritative for the second resolver.
    vi.mocked(hasModule).mockReturnValueOnce(false)

    const result = await resolveMobileAuth(makeRequestWithMobileBearer("/api/v1/mtm/mobile/workday"))

    expect(result?.tenantCapabilities).toEqual({
      routeField: false,
      workforceHrm: true,
      attendanceQr: false,
      attendanceDeviceTrust: false,
    })
  })

  it("ACCEPTED: Workforce attendance add-ons remain explicit and independently scoped", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      ...ACTIVE_AGENT,
      organization: {
        isActive: true,
        plan: "enterprise",
        addons: [],
        features: ["workforce-hrm", "attendance-qr", "attendance-device-trust"],
        modules: {
          mtm: false,
          "workforce-hrm": true,
          "attendance-qr": true,
          "attendance-device-trust": true,
        },
      },
    } as any)
    vi.mocked(hasModule).mockReturnValueOnce(false)

    const result = await resolveMobileAuth(makeRequestWithMobileBearer("/api/v1/mtm/mobile/workday"))

    expect(result?.tenantCapabilities).toMatchObject({
      workforceHrm: true,
      attendanceQr: true,
      attendanceDeviceTrust: true,
    })
  })

  it("REJECTED: a tenant with both independently disabled capabilities receives no mobile JWT session", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      ...ACTIVE_AGENT,
      organization: {
        isActive: true,
        plan: "enterprise",
        addons: [],
        features: [],
        modules: { mtm: false, "workforce-hrm": false },
      },
    } as any)
    vi.mocked(hasModule).mockReturnValueOnce(false)

    const result = await resolveMobileAuth(makeRequestWithMobileBearer("/api/v1/mtm/mobile/workday"))

    expect(result).toBeNull()
  })

  it.each(["route-field", "workforce-hrm"] as const)(
    "admits an independently enabled %s tenant",
    async (capabilityId) => {
      vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
        ...ACTIVE_AGENT,
        organization: {
          isActive: true,
          plan: "enterprise",
          addons: [],
          features: [capabilityId],
          modules: { [capabilityId]: true },
        },
      } as any)
      vi.mocked(hasModule).mockImplementation((context, moduleId) => context.modules?.[moduleId] === true)

      const request = makeRequestWithMobileBearer("/api/v1/mtm/mobile/bootstrap")
      expect(await resolveMobileAuth(request)).toMatchObject({
        orgId: "org-mtm",
        agentId: "agent-42",
        tenantCapabilities: {
          routeField: capabilityId === "route-field",
          workforceHrm: capabilityId === "workforce-hrm",
        },
      })
    },
  )

  it("REJECTED: agent not found in DB → returns null", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(null)
    const req = makeRequestWithMobileBearer("/api/v1/mtm/visits")
    const result = await resolveMobileAuth(req)
    expect(result).toBeNull()
  })

  it("REJECTED: DB error → fails CLOSED (returns null)", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockRejectedValue(new Error("db down"))
    const req = makeRequestWithMobileBearer("/api/v1/mtm/visits")
    const result = await resolveMobileAuth(req)
    expect(result).toBeNull()
  })

  it("REJECTED: agent password changed after token issuance", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      ...ACTIVE_AGENT,
      passwordHash: "$2b$12$new-agent-hash",
    } as any)

    const result = await resolveMobileAuth(makeRequestWithMobileBearer("/api/v1/mtm/visits"))

    expect(result).toBeNull()
  })

  it("REJECTED: linked CRM password changed after token issuance", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(ACTIVE_AGENT as any)
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      ...ACTIVE_USER,
      passwordHash: "$2b$12$new-user-hash",
      passwordChangedAt: new Date("2026-08-11T12:00:00.900Z"),
    } as any)

    const result = await resolveMobileAuth(makeRequestWithMobileBearer("/api/v1/mtm/visits"))

    expect(result).toBeNull()
  })

  it("REJECTED: legacy mobile token without credential fingerprints", async () => {
    const legacyPayload: Record<string, unknown> = { ...MOBILE_PAYLOAD }
    delete legacyPayload.agentSessionFingerprint
    delete legacyPayload.userSessionFingerprint
    vi.mocked(jwt.verify).mockReturnValue(legacyPayload as any)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(ACTIVE_AGENT as any)

    const result = await resolveMobileAuth(makeRequestWithMobileBearer("/api/v1/mtm/visits"))

    expect(result).toBeNull()
  })

  it("returns null when no Bearer token at all", async () => {
    const req = makeRequest("/api/v1/mtm/visits")
    const result = await resolveMobileAuth(req)
    expect(result).toBeNull()
  })

  it("returns null when token is an API key (ld_ prefix)", async () => {
    const req = makeRequest("/api/v1/mtm/visits", "GET", { authorization: "Bearer ld_test_key" })
    const result = await resolveMobileAuth(req)
    expect(result).toBeNull()
  })
})

// ===========================================================================
// FIX 2 — getOrgId: mobile JWT accepted ONLY under /api/v1/mtm/
// ===========================================================================
describe("getOrgId — FIX 2: mobile JWT path scoping", () => {
  it("ACCEPTED (app unbroken): mobile JWT on /api/v1/mtm/visits → org resolved", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(ACTIVE_AGENT as any)
    const req = makeRequestWithMobileBearer("/api/v1/mtm/visits")
    const orgId = await getOrgId(req)
    expect(orgId).toBe("org-mtm")
  })

  it("ACCEPTED (app unbroken): mobile JWT on /api/v1/mtm/mobile/sync/push → org resolved", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(ACTIVE_AGENT as any)
    const req = makeRequestWithMobileBearer("/api/v1/mtm/mobile/sync/push")
    const orgId = await getOrgId(req)
    expect(orgId).toBe("org-mtm")
  })

  it("REJECTED (hole closed): mobile JWT on /api/v1/contacts → org NOT resolved", async () => {
    const req = makeRequestWithMobileBearer("/api/v1/contacts")
    const orgId = await getOrgId(req)
    expect(orgId).toBeNull()
  })

  it("REJECTED (hole closed): mobile JWT on /api/v1/deals → org NOT resolved", async () => {
    const req = makeRequestWithMobileBearer("/api/v1/deals")
    const orgId = await getOrgId(req)
    expect(orgId).toBeNull()
  })

  it("REJECTED (hole closed): mobile JWT on /api/v1/webhooks/manage → org NOT resolved", async () => {
    const req = makeRequestWithMobileBearer("/api/v1/webhooks/manage")
    const orgId = await getOrgId(req)
    expect(orgId).toBeNull()
  })

  it("REJECTED (hole closed): mobile JWT on /api/v1/finance/bank-accounts → org NOT resolved", async () => {
    const req = makeRequestWithMobileBearer("/api/v1/finance/bank-accounts")
    const orgId = await getOrgId(req)
    expect(orgId).toBeNull()
  })

  it("REJECTED (revocation): mobile JWT on MTM path but agent SUSPENDED → org NOT resolved", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(SUSPENDED_AGENT as any)
    const req = makeRequestWithMobileBearer("/api/v1/mtm/visits")
    const orgId = await getOrgId(req)
    expect(orgId).toBeNull()
  })

  it("REJECTED (revocation): mobile JWT on MTM path but org deactivated → org NOT resolved", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(ACTIVE_AGENT_DEAD_ORG as any)
    const req = makeRequestWithMobileBearer("/api/v1/mtm/visits")
    const orgId = await getOrgId(req)
    expect(orgId).toBeNull()
  })

  it("web session on any path → still works (session path untouched)", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "u-1", email: "a@b.com", name: "A", organizationId: "org-web", role: "admin" },
    } as any)
    const req = makeRequest("/api/v1/contacts")
    const orgId = await getOrgId(req)
    expect(orgId).toBe("org-web")
  })

  it("API key on any path → still works (API key path untouched)", async () => {
    vi.mocked(jwt.verify).mockImplementation(() => { throw new Error("not a mobile jwt") })
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValue({
      id: "key-1",
      organizationId: "org-api",
      createdBy: "user-api",
      name: "Key",
      scopes: ["read:contacts"],
      expiresAt: null,
      organization: { isActive: true },
    } as any)
    const req = makeRequest("/api/v1/contacts", "GET", { authorization: "Bearer ld_test_key" })
    const orgId = await getOrgId(req)
    expect(orgId).toBe("org-api")
  })
})

// ===========================================================================
// FIX 1 — requireAuth: mobile JWT always rejected
// ===========================================================================
describe("requireAuth — FIX 1: mobile JWT rejected", () => {
  it("REJECTED (hole closed): mobile JWT on requireAuth route → 401", async () => {
    const req = makeRequestWithMobileBearer("/api/v1/contacts")
    const result = await requireAuth(req)
    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(401)
    const body = await (result as NextResponse).json()
    expect(body.message).toContain("Mobile tokens are not permitted")
  })

  it("REJECTED (hole closed): mobile JWT on requireAuth even under /api/v1/mtm/ path → 401", async () => {
    // requireAuth is for web sessions + API keys. The MTM requireAuth route
    // (settings PUT) is admin-only and not called by the app.
    const req = makeRequestWithMobileBearer("/api/v1/mtm/settings")
    const result = await requireAuth(req)
    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(401)
  })

  it("PASSES (untouched): web session on requireAuth route → AuthResult returned", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "u-1", email: "a@b.com", name: "A", organizationId: "org-web", role: "admin" },
    } as any)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      isActive: true, plan: "starter", addons: [], features: [],
    } as any)
    const req = makeRequest("/api/v1/contacts")
    const result = await requireAuth(req)
    expect(result).not.toBeInstanceOf(NextResponse)
    expect((result as any).orgId).toBe("org-web")
  })

  it("PASSES (untouched): API key on requireAuth route → AuthResult returned", async () => {
    // jwt.verify throws so getMobileAuth returns null (not a mobile JWT)
    vi.mocked(jwt.verify).mockImplementation(() => { throw new Error("not a jwt") })
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValue({
      id: "key-1",
      organizationId: "org-api",
      createdBy: "user-api",
      name: "Key",
      scopes: ["read:contacts"],
      expiresAt: null,
      organization: { isActive: true },
    } as any)
    const req = makeRequest("/api/v1/contacts", "GET", { authorization: "Bearer ld_test_key" })
    const result = await requireAuth(req, "contacts", "read")
    expect(result).not.toBeInstanceOf(NextResponse)
    expect((result as any).orgId).toBe("org-api")
  })

  it("PASSES (untouched): no auth at all → 401 (standard unauth)", async () => {
    vi.mocked(jwt.verify).mockImplementation(() => { throw new Error("no token") })
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValue(null)
    const req = makeRequest("/api/v1/contacts")
    const result = await requireAuth(req)
    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(401)
  })
})

// ===========================================================================
// FIX 3 — requireMobileAuth: revocation integrated
// ===========================================================================
describe("requireMobileAuth — revocation integrated", () => {
  it("ACCEPTED (app unbroken): active agent + active org → MobileAuthResult", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(ACTIVE_AGENT as any)
    const req = makeRequestWithMobileBearer("/api/v1/mtm/mobile/profile")
    const result = await requireMobileAuth(req)
    expect(result).not.toBeInstanceOf(NextResponse)
    expect((result as any).agentId).toBe("agent-42")
  })

  it("REJECTED (revocation): suspended agent → 401", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(SUSPENDED_AGENT as any)
    const req = makeRequestWithMobileBearer("/api/v1/mtm/mobile/profile")
    const result = await requireMobileAuth(req)
    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(401)
  })

  it("REJECTED (revocation): org deactivated → 401", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(ACTIVE_AGENT_DEAD_ORG as any)
    const req = makeRequestWithMobileBearer("/api/v1/mtm/mobile/profile")
    const result = await requireMobileAuth(req)
    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(401)
  })

  it("REJECTED: no mobile token → 401", async () => {
    const req = makeRequest("/api/v1/mtm/mobile/profile")
    const result = await requireMobileAuth(req)
    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(401)
  })
})

// ===========================================================================
// FIX C — resolveMobileAuth: linked-user isActive revocation
// ===========================================================================
describe("resolveMobileAuth — FIX C: linked-user revocation", () => {
  it("ACCEPTED: active agent + active linked user → returns MobileAuthResult", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(ACTIVE_AGENT as any)
    vi.mocked(prisma.user.findFirst).mockResolvedValue(ACTIVE_USER as any)
    const req = makeRequestWithMobileBearer("/api/v1/mtm/visits")
    const result = await resolveMobileAuth(req)
    expect(result).not.toBeNull()
    expect(result?.agentId).toBe("agent-42")
  })

  it("REJECTED: active agent but linked user is deactivated (isActive=false) → returns null", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(ACTIVE_AGENT as any)
    vi.mocked(prisma.user.findFirst).mockResolvedValue(DEACTIVATED_USER as any)
    const req = makeRequestWithMobileBearer("/api/v1/mtm/visits")
    const result = await resolveMobileAuth(req)
    expect(result).toBeNull()
  })

  it("REJECTED: active agent but linked user not found in DB → returns null", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(ACTIVE_AGENT as any)
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null)
    const req = makeRequestWithMobileBearer("/api/v1/mtm/visits")
    const result = await resolveMobileAuth(req)
    expect(result).toBeNull()
  })

  it("ACCEPTED: no userId in token payload (no linked-user check performed) → returns MobileAuthResult", async () => {
    // A mobile JWT without userId — the FIX C check is skipped.
    const PAYLOAD_NO_USER = {
      agentId: "agent-42",
      userId: undefined,
      orgId: "org-mtm",
      email: "a@b.com",
      name: "A",
      role: "AGENT",
      agentSessionFingerprint: MOBILE_PAYLOAD.agentSessionFingerprint,
    }
    vi.mocked(jwt.verify).mockReturnValue(PAYLOAD_NO_USER as any)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ ...ACTIVE_AGENT, userId: null } as any)
    // user.findFirst should NOT be called when userId is absent
    const req = makeRequestWithMobileBearer("/api/v1/mtm/visits")
    const result = await resolveMobileAuth(req)
    expect(result).not.toBeNull()
    expect(prisma.user.findFirst).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// FIX 4 — middleware mobile-JWT scope guard (unit-level simulation)
// ===========================================================================
// The middleware itself runs in the Edge runtime and is hard to unit-test
// with vitest (it imports next/server internals). These tests verify the
// LOGIC through the resolveMobileAuth / getOrgId layer that the middleware
// depends on — confirming that a mobile JWT on a non-MTM path is blocked.
// Direct middleware integration tests live in e2e / integration test suites.
describe("FIX 4 (middleware logic via getOrgId) — mobile JWT on non-MTM paths", () => {
  it("mobile JWT on /api/v1/contacts → getOrgId returns null (middleware would block)", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(ACTIVE_AGENT as any)
    const req = makeRequestWithMobileBearer("/api/v1/contacts")
    const orgId = await getOrgId(req)
    expect(orgId).toBeNull()
  })

  it("mobile JWT on /api/v1/invoices → getOrgId returns null", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(ACTIVE_AGENT as any)
    const req = makeRequestWithMobileBearer("/api/v1/invoices")
    const orgId = await getOrgId(req)
    expect(orgId).toBeNull()
  })

  it("web session Bearer (no agentId) on non-MTM path → NOT blocked (passes through)", async () => {
    // Simulate a web session token that jwt.verify does not return agentId for
    vi.mocked(jwt.verify).mockImplementation(() => { throw new Error("not a mobile jwt") })
    vi.mocked(auth).mockResolvedValue({
      user: { id: "u-1", email: "a@b.com", name: "A", organizationId: "org-web", role: "admin" },
    } as any)
    const req = makeRequest("/api/v1/contacts")
    const orgId = await getOrgId(req)
    expect(orgId).toBe("org-web")
  })

  it("API key (ld_ prefix) on non-MTM path → NOT blocked", async () => {
    vi.mocked(jwt.verify).mockImplementation(() => { throw new Error("not a jwt") })
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValue({
      id: "key-1", organizationId: "org-api", createdBy: "user-api",
      name: "Key", scopes: ["read:contacts"], expiresAt: null,
      organization: { isActive: true },
    } as any)
    const req = makeRequest("/api/v1/contacts", "GET", { authorization: "Bearer ld_test_key" })
    const orgId = await getOrgId(req)
    expect(orgId).toBe("org-api")
  })

  it("malformed token (not a JWT) → NOT blocked, falls through as unauthenticated", async () => {
    vi.mocked(jwt.verify).mockImplementation(() => { throw new Error("malformed") })
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValue(null)
    const req = makeRequest("/api/v1/contacts", "GET", { authorization: "Bearer not.a.valid.jwt.at.all" })
    const orgId = await getOrgId(req)
    expect(orgId).toBeNull() // null = unauthenticated, not a crash
  })
})
