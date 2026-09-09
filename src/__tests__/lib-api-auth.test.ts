import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    apiKey: { findFirst: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    user: { findUnique: vi.fn() },
    organization: { findUnique: vi.fn() },
    // Required by resolveMobileAuth (mobile-auth.ts revocation check).
    // Routes in lib-api-auth.test.ts don't exercise mobile /mtm/ paths, so
    // we default to returning null (no agent found → mobile auth rejected).
    mtmAgent: { findFirst: vi.fn().mockResolvedValue(null) },
  },
}))

vi.mock("@/lib/permissions", () => ({
  checkPermission: vi.fn().mockReturnValue(true),
  resolveModuleFromPath: vi.fn().mockReturnValue(null),
  methodToAction: vi.fn().mockReturnValue("read"),
  // api-auth now imports the bridge from permissions — the mock must provide it
  // or the gate's `PERMISSION_MODULE_TO_MODULE_ID[resolved]` throws.
  PERMISSION_MODULE_TO_MODULE_ID: { kb: "knowledge-base", inbox: "omnichannel", "energy-utilities": "energy" },
}))

vi.mock("@/lib/modules", () => ({
  hasModule: vi.fn().mockReturnValue(true),
  moduleRecordFromOrgFields: vi.fn((fields: { features?: unknown; modules?: unknown }) => {
    const modules: Record<string, boolean> = {}
    if (Array.isArray(fields.features)) {
      for (const feature of fields.features) {
        if (typeof feature === "string") modules[feature] = true
      }
    }
    if (fields.modules && typeof fields.modules === "object" && !Array.isArray(fields.modules)) {
      for (const [key, enabled] of Object.entries(fields.modules)) {
        if (typeof enabled === "boolean") modules[key] = enabled
      }
    }
    return modules
  }),
  // `deals` + `energy` present so the module gate actually runs for the
  // disabled-module + bridge (energy-utilities→energy) 403 tests below.
  MODULE_REGISTRY: { deals: { name: "Deals", requires: [] }, energy: { name: "Energy", requires: [] } },
}))

vi.mock("@/lib/mobile-auth", () => ({
  getMobileAuth: vi.fn().mockReturnValue(null),
  resolveMobileAuth: vi.fn().mockResolvedValue(null),
}))

vi.mock("crypto", () => ({
  default: {
    createHash: vi.fn().mockReturnValue({
      update: vi.fn().mockReturnValue({
        digest: vi.fn().mockReturnValue("hashed-key"),
      }),
    }),
  },
}))

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { checkPermission, resolveModuleFromPath, methodToAction } from "@/lib/permissions"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { hasModule } from "@/lib/modules"
import {
  getSession,
  getOrgId,
  requireAuth,
  requireSessionAuth,
  isAuthError,
  orgHasModule,
} from "@/lib/api-auth"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeRequest(url: string, method = "GET", headers?: Record<string, string>) {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method,
    headers: headers || {},
  })
}

const validSession = {
  user: {
    id: "user-1",
    email: "test@test.com",
    name: "Test User",
    organizationId: "org-1",
    role: "admin",
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({
    isActive: true,
    plan: "starter",
    addons: [],
    features: [],
  } as any)
})

// ===========================================================================
// getSession
// ===========================================================================
describe("getSession", () => {
  it("returns AuthResult from valid session", async () => {
    vi.mocked(auth).mockResolvedValue(validSession as any)
    const result = await getSession(makeRequest("/api/v1/contacts"))
    expect(result).toEqual({
      orgId: "org-1",
      userId: "user-1",
      role: "admin",
      email: "test@test.com",
      name: "Test User",
      principalType: "session",
    })
  })

  it("returns null when no session", async () => {
    vi.mocked(auth).mockResolvedValue(null as any)
    const result = await getSession(makeRequest("/api/v1/contacts"))
    expect(result).toBeNull()
  })

  it("returns null when session has no user", async () => {
    vi.mocked(auth).mockResolvedValue({ user: null } as any)
    const result = await getSession(makeRequest("/api/v1/contacts"))
    expect(result).toBeNull()
  })

  it("returns null when 2FA verification is pending", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { ...validSession.user, needs2fa: true },
    } as never)
    const result = await getSession(makeRequest("/api/v1/contacts"))
    expect(result).toBeNull()
  })

  it("returns null when 2FA setup is pending", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { ...validSession.user, needsSetup2fa: true },
    } as any)
    const result = await getSession(makeRequest("/api/v1/contacts"))
    expect(result).toBeNull()
  })

  it("returns null for inactive organization", async () => {
    const organizationId = `inactive-org-${Date.now()}`
    vi.mocked(auth).mockResolvedValue({
      user: { ...validSession.user, organizationId },
    } as any)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      isActive: false,
      plan: "starter",
      addons: [],
      features: [],
    } as any)
    const result = await getSession(makeRequest("/api/v1/contacts"))
    expect(result).toBeNull()
  })

  it("revokes a warmed browser session immediately when the organization is disabled", async () => {
    const organizationId = `fresh-org-status-${Date.now()}`
    vi.mocked(auth).mockResolvedValue({
      user: { ...validSession.user, organizationId },
    } as any)
    vi.mocked(prisma.organization.findUnique)
      .mockResolvedValueOnce({ isActive: true } as any)
      .mockResolvedValueOnce({ isActive: false } as any)

    expect(await getSession(makeRequest("/api/v1/contacts"))).not.toBeNull()
    expect(await getSession(makeRequest("/api/v1/contacts"))).toBeNull()
    expect(prisma.organization.findUnique).toHaveBeenCalledTimes(2)
  })

  it("returns null when auth() throws", async () => {
    vi.mocked(auth).mockRejectedValue(new Error("auth failure"))
    const result = await getSession(makeRequest("/api/v1/contacts"))
    expect(result).toBeNull()
  })

  it("defaults role to viewer when missing", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u-1", email: "a@b.com", name: "A", organizationId: "o-1" } } as any)
    const result = await getSession(makeRequest("/api/v1/contacts"))
    expect(result?.role).toBe("viewer")
  })
})

// ===========================================================================
// requireSessionAuth
// ===========================================================================
describe("requireSessionAuth", () => {
  it("passes a valid browser session", async () => {
    vi.mocked(auth).mockResolvedValue(validSession as any)

    const result = await requireSessionAuth(makeRequest("/api/v1/users/me", "PATCH"))

    expect(result).not.toBeInstanceOf(NextResponse)
    expect(result).toMatchObject({ orgId: "org-1", userId: "user-1", role: "admin" })
  })

  it("never falls back to a valid API key", async () => {
    vi.mocked(auth).mockResolvedValue(null as any)
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValue({
      id: "key-1",
      organizationId: "org-api",
      createdBy: "owner-user",
      name: "Owner automation",
      scopes: ["write:users"],
      expiresAt: null,
      organization: { isActive: true },
    } as any)

    const req = makeRequest("/api/v1/users/me", "PATCH", {
      authorization: "Bearer ld_valid_key",
    })
    const result = await requireSessionAuth(req)

    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(401)
    expect(prisma.apiKey.findFirst).not.toHaveBeenCalled()
  })

  it("never falls back to a privileged mobile JWT", async () => {
    vi.mocked(auth).mockResolvedValue(null as any)
    vi.mocked(getMobileAuth).mockReturnValue({
      agentId: "agent-admin-shaped",
      organizationId: "org-mobile",
      role: "MANAGER",
      regionId: null,
      teamId: null,
    } as any)

    const result = await requireSessionAuth(makeRequest(
      "/api/v1/users/user-1",
      "DELETE",
      { authorization: "Bearer privileged.mobile.jwt" },
    ))

    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(401)
    // requireSessionAuth resolves Auth.js only; it must not even inspect the
    // mobile principal, regardless of its synthetic management-shaped role.
    expect(getMobileAuth).not.toHaveBeenCalled()
  })

  it("preserves the 2FA gate", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { ...validSession.user, needs2fa: true },
    } as any)

    const result = await requireSessionAuth(makeRequest("/api/v1/users/me"))

    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(403)
  })

  it("preserves the active-organization gate", async () => {
    const organizationId = `session-only-inactive-${Date.now()}`
    vi.mocked(auth).mockResolvedValue({
      user: { ...validSession.user, organizationId },
    } as any)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      isActive: false,
      plan: "starter",
      addons: [],
      features: [],
    } as any)

    const result = await requireSessionAuth(makeRequest("/api/v1/users/me"))

    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(403)
  })

  it("preserves tenant-host binding", async () => {
    const organizationId = `session-only-tenant-${Date.now()}`
    vi.mocked(auth).mockResolvedValue({
      user: { ...validSession.user, organizationId },
    } as any)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      slug: "tenant-a",
      isActive: true,
      plan: "starter",
      addons: [],
      features: [],
    } as any)

    const result = await requireSessionAuth(makeRequest("/api/v1/users/me", "GET", {
      "x-tenant-slug": "tenant-b",
    }))

    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(403)
  })
})

// ===========================================================================
// getOrgId
// ===========================================================================
describe("getOrgId", () => {
  it("returns orgId from session", async () => {
    vi.mocked(auth).mockResolvedValue(validSession as any)
    const orgId = await getOrgId(makeRequest("/api/v1/contacts"))
    expect(orgId).toBe("org-1")
  })

  it("does not resolve orgId while 2FA verification is pending", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { ...validSession.user, needs2fa: true },
    } as any)
    vi.mocked(getMobileAuth).mockReturnValue(null)
    const orgId = await getOrgId(makeRequest("/api/v1/contacts"))
    expect(orgId).toBeNull()
  })

  it("rejects mobile auth on non-MTM paths (FIX 2: path-scoped)", async () => {
    // Mobile JWTs are only accepted in the explicit versioned MTM namespace.
    // A mobile token on /api/v1/contacts must NOT resolve an orgId.
    vi.mocked(auth).mockResolvedValue(null as any)
    vi.mocked(getMobileAuth).mockReturnValue({
      agentId: "agent-1",
      userId: "user-1",
      orgId: "org-mobile",
      email: "agent@test.com",
      name: "Agent",
      role: "agent",
    })

    const orgId = await getOrgId(makeRequest("/api/v1/contacts"))
    expect(orgId).toBeNull()
  })

  it("accepts a mobile JWT on the explicit v2 MTM namespace", async () => {
    vi.mocked(auth).mockResolvedValue(null as any)
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      agentId: "agent-1",
      userId: "user-1",
      orgId: "org-mobile",
      email: "agent@test.com",
      name: "Agent",
      role: "agent",
    } as never)

    expect(await getOrgId(makeRequest("/api/v2/mtm/mobile/sync/routes"))).toBe("org-mobile")
  })

  it("does not resolve a mobile JWT for an unlisted v2 MTM path", async () => {
    vi.mocked(auth).mockResolvedValue(null as any)
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      agentId: "agent-1",
      userId: "user-1",
      orgId: "org-mobile",
      email: "agent@test.com",
      name: "Agent",
      role: "agent",
    } as never)

    expect(await getOrgId(makeRequest("/api/v2/mtm/mobile/unknown"))).toBeNull()
    expect(resolveMobileAuth).not.toHaveBeenCalled()
  })

  it("falls back to API key auth with scope check", async () => {
    vi.mocked(auth).mockResolvedValue(null as any)
    vi.mocked(getMobileAuth).mockReturnValue(null)
    vi.mocked(resolveModuleFromPath).mockReturnValue("contacts" as any)
    vi.mocked(methodToAction).mockReturnValue("read" as any)

    vi.mocked(prisma.apiKey.findFirst).mockResolvedValue({
      id: "key-1",
      organizationId: "org-api",
      createdBy: "user-1",
      name: "Test Key",
      scopes: ["read:contacts"],
      expiresAt: null,
      organization: { isActive: true },
    } as any)

    const req = makeRequest("/api/v1/contacts", "GET", { authorization: "Bearer ld_test_key_123" })
    const orgId = await getOrgId(req)
    expect(orgId).toBe("org-api")
  })

  it("returns null when API key lacks required scope", async () => {
    vi.mocked(auth).mockResolvedValue(null as any)
    vi.mocked(getMobileAuth).mockReturnValue(null)
    vi.mocked(resolveModuleFromPath).mockReturnValue("deals" as any)
    vi.mocked(methodToAction).mockReturnValue("read" as any)

    vi.mocked(prisma.apiKey.findFirst).mockResolvedValue({
      id: "key-1",
      organizationId: "org-api",
      createdBy: "user-1",
      name: "Test Key",
      scopes: ["read:contacts"],
      expiresAt: null,
      organization: { isActive: true },
    } as any)

    const req = makeRequest("/api/v1/deals", "GET", { authorization: "Bearer ld_test_key_123" })
    const orgId = await getOrgId(req)
    expect(orgId).toBeNull()
  })

  it("denies API keys on routes without an explicit scope mapping", async () => {
    vi.mocked(auth).mockResolvedValue(null as any)
    vi.mocked(getMobileAuth).mockReturnValue(null)
    vi.mocked(resolveModuleFromPath).mockReturnValue(null)
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValue({
      id: "key-unscoped",
      organizationId: "org-api",
      createdBy: "user-1",
      name: "Unscoped key",
      scopes: ["read:contacts"],
      expiresAt: null,
      organization: { isActive: true },
    } as any)

    const orgId = await getOrgId(makeRequest(
      "/api/v1/unmapped-sensitive-route",
      "GET",
      { authorization: "Bearer ld_test_key_123" },
    ))

    expect(orgId).toBeNull()
  })

  it("denies an API key immediately after its tenant module is disabled", async () => {
    vi.mocked(auth).mockResolvedValue(null as any)
    vi.mocked(getMobileAuth).mockReturnValue(null)
    vi.mocked(resolveModuleFromPath).mockReturnValue("deals" as any)
    vi.mocked(methodToAction).mockReturnValue("read" as any)
    vi.mocked(hasModule).mockReturnValueOnce(false)
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValue({
      id: "key-disabled-module",
      organizationId: "org-api",
      createdBy: "user-1",
      name: "Deals key",
      scopes: ["read:deals"],
      expiresAt: null,
      organization: { isActive: true, plan: "starter", addons: [], features: [], modules: { deals: false } },
    } as any)

    const orgId = await getOrgId(makeRequest(
      "/api/v1/deals",
      "GET",
      { authorization: "Bearer ld_test_key_123" },
    ))

    expect(orgId).toBeNull()
  })

  it("returns null when all auth methods fail", async () => {
    vi.mocked(auth).mockResolvedValue(null as any)
    vi.mocked(getMobileAuth).mockReturnValue(null)
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValue(null)

    const orgId = await getOrgId(makeRequest("/api/v1/contacts"))
    expect(orgId).toBeNull()
  })
})

// ===========================================================================
// requireAuth
// ===========================================================================
describe("requireAuth", () => {
  it("returns AuthResult for valid session", async () => {
    vi.mocked(auth).mockResolvedValue(validSession as any)
    vi.mocked(resolveModuleFromPath).mockReturnValue(null)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      isActive: true, plan: "starter", addons: [], features: [],
    } as any)

    const result = await requireAuth(makeRequest("/api/v1/contacts"))
    expect(result).not.toBeInstanceOf(NextResponse)
    expect((result as any).orgId).toBe("org-1")
    expect((result as any).userId).toBe("user-1")
  })

  it("returns 401 when no auth available", async () => {
    vi.mocked(auth).mockResolvedValue(null as any)
    vi.mocked(getMobileAuth).mockReturnValue(null)
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValue(null)

    const result = await requireAuth(makeRequest("/api/v1/contacts"))
    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(401)
  })

  it("rejects mobile JWT with 401 (FIX 1: requireAuth is for web sessions + API keys only)", async () => {
    // requireAuth must NEVER accept a mobile JWT — it bypasses RBAC, org-status,
    // tenant-binding, and password-changed checks. The mobile app uses getOrgId
    // + requireMobileAuth instead.
    vi.mocked(auth).mockResolvedValue(null as any)
    vi.mocked(getMobileAuth).mockReturnValue({
      agentId: "agent-1",
      userId: "user-m",
      orgId: "org-m",
      email: "agent@test.com",
      name: "Agent",
      role: "agent",
    })

    const result = await requireAuth(makeRequest("/api/v1/contacts"))
    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(401)
    const body = await (result as NextResponse).json()
    expect(body.message).toContain("Mobile tokens are not permitted")
  })

  it("returns 403 for permission denied", async () => {
    vi.mocked(auth).mockResolvedValue(validSession as any)
    vi.mocked(resolveModuleFromPath).mockReturnValue("settings" as any)
    vi.mocked(methodToAction).mockReturnValue("write" as any)
    vi.mocked(checkPermission).mockReturnValue(false)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      isActive: true, plan: "starter", addons: [], features: [],
    } as any)

    const result = await requireAuth(makeRequest("/api/v1/settings", "POST"))
    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(403)
  })

  it("returns 403 when the resolved module is disabled for the org", async () => {
    // The paid-feature gate: a tenant without `deals` enabled cannot hit the
    // deals API even with a valid session + permission. hasModule → false.
    vi.mocked(auth).mockResolvedValue(validSession as any)
    vi.mocked(resolveModuleFromPath).mockReturnValue("deals" as any)
    vi.mocked(methodToAction).mockReturnValue("read" as any)
    vi.mocked(checkPermission).mockReturnValue(true)
    vi.mocked(hasModule).mockReturnValue(false)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      isActive: true, plan: "starter", addons: [], features: ["core"],
    } as any)

    const result = await requireAuth(makeRequest("/api/v1/deals"))
    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(403)
    const json = await (result as NextResponse).json()
    expect(json.message || json.error).toContain("not enabled")
  })

  it("bridges a permissions-name module to its ModuleId and gates it (energy-utilities → energy)", async () => {
    // resolveModuleFromPath returns the permissions vocabulary "energy-utilities"
    // which is NOT a ModuleId; the bridge maps it to "energy" so the gate runs
    // instead of being silently skipped.
    vi.mocked(auth).mockResolvedValue(validSession as any)
    vi.mocked(resolveModuleFromPath).mockReturnValue("energy-utilities" as any)
    vi.mocked(methodToAction).mockReturnValue("read" as any)
    vi.mocked(checkPermission).mockReturnValue(true)
    vi.mocked(hasModule).mockReturnValue(false)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      isActive: true, plan: "starter", addons: [], features: ["core"],
    } as any)

    const result = await requireAuth(makeRequest("/api/v1/energy/metering"))
    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(403)
    const json = await (result as NextResponse).json()
    // The message names the BRIDGED ModuleId "energy", NOT the raw permissions
    // name "energy-utilities" — proving the bridge mapped it (not a passthrough).
    expect(json.message).toContain('"energy"')
    expect(json.message).not.toContain("energy-utilities")
  })

  it("returns 403 for inactive organization", async () => {
    // Use a unique orgId to avoid the in-memory orgCache from previous tests
    const uniqueOrgId = `org-inactive-${Date.now()}`
    vi.mocked(auth).mockResolvedValue({
      user: { ...validSession.user, organizationId: uniqueOrgId },
    } as any)
    vi.mocked(resolveModuleFromPath).mockReturnValue(null)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      isActive: false,
      plan: "starter",
      addons: [],
      features: [],
    } as any)

    const result = await requireAuth(makeRequest("/api/v1/contacts"))
    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(403)
    const json = await (result as NextResponse).json()
    expect(json.error).toContain("deactivated")
  })

  it("returns 403 when 2FA verification is pending (needs2fa)", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { ...validSession.user, needs2fa: true },
    } as any)

    const result = await requireAuth(makeRequest("/api/v1/contacts"))
    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(403)
    const json = await (result as NextResponse).json()
    expect(json.error).toContain("2FA")
  })

  it("returns 403 when 2FA setup is pending (needsSetup2fa)", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { ...validSession.user, needsSetup2fa: true },
    } as any)

    const result = await requireAuth(makeRequest("/api/v1/contacts"))
    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(403)
  })

  it("returns AuthResult via API key fallback with valid scope", async () => {
    vi.mocked(auth).mockResolvedValue(null as any)
    vi.mocked(getMobileAuth).mockReturnValue(null)
    vi.mocked(resolveModuleFromPath).mockReturnValue("contacts" as any)
    vi.mocked(methodToAction).mockReturnValue("read" as any)

    vi.mocked(prisma.apiKey.findFirst).mockResolvedValue({
      id: "key-1",
      organizationId: "org-api",
      createdBy: "user-api",
      name: "API Key",
      scopes: ["read:contacts"],
      expiresAt: null,
      organization: { isActive: true },
    } as any)

    const req = makeRequest("/api/v1/contacts", "GET", { authorization: "Bearer ld_test_key" })
    const result = await requireAuth(req, "contacts", "read")
    expect(result).not.toBeInstanceOf(NextResponse)
    expect(result).toMatchObject({ orgId: "org-api", principalType: "api_key" })
  })

  it("rejects an otherwise-valid API key from an inactive organization", async () => {
    vi.mocked(auth).mockResolvedValue(null as any)
    vi.mocked(getMobileAuth).mockReturnValue(null)
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValue({
      id: "key-inactive-org",
      organizationId: "org-inactive-api",
      createdBy: "user-api",
      name: "API Key",
      scopes: ["read:contacts"],
      expiresAt: null,
      organization: { isActive: false },
    } as any)

    const req = makeRequest("/api/v1/contacts", "GET", { authorization: "Bearer ld_test_key" })
    const result = await requireAuth(req, "contacts", "read")
    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(401)
  })

  it("returns 403 when API key missing required scope", async () => {
    vi.mocked(auth).mockResolvedValue(null as any)
    vi.mocked(getMobileAuth).mockReturnValue(null)

    vi.mocked(prisma.apiKey.findFirst).mockResolvedValue({
      id: "key-1",
      organizationId: "org-api",
      createdBy: "user-api",
      name: "API Key",
      scopes: ["read:contacts"],
      expiresAt: null,
      organization: { isActive: true },
    } as any)

    const req = makeRequest("/api/v1/deals", "POST", { authorization: "Bearer ld_test_key" })
    const result = await requireAuth(req, "deals", "write")
    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(403)
  })

  // ─── Cross-tenant binding (defense-in-depth) ─────────────
  // Middleware already blocks mismatched subdomain+session at the edge, but
  // a direct API call (Host-spoof, race, or someone stripping middleware)
  // must also be blocked by requireAuth. When x-tenant-slug is set, it must
  // match the slug of the session's organization.

  it("returns 403 when x-tenant-slug does not match session org slug", async () => {
    // Session for LeadDrive org; request coming to afigroup.leaddrivecrm.org
    const uniqueOrgId = `org-leaddrive-${Date.now()}`
    vi.mocked(auth).mockResolvedValue({
      user: { ...validSession.user, organizationId: uniqueOrgId },
    } as any)
    vi.mocked(resolveModuleFromPath).mockReturnValue(null)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      id: uniqueOrgId,
      slug: "leaddrive", // actual slug on the org row
      isActive: true,
      plan: "starter",
      addons: [],
      features: [],
    } as any)

    const req = makeRequest("/api/v1/contacts", "GET", { "x-tenant-slug": "afigroup" })
    const result = await requireAuth(req)
    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(403)
    const json = await (result as NextResponse).json()
    expect(json.error).toBe("Forbidden")
    expect(JSON.stringify(json).toLowerCase()).not.toContain("tenant")
  })

  it("passes when x-tenant-slug matches session org slug", async () => {
    const uniqueOrgId = `org-afi-${Date.now()}`
    vi.mocked(auth).mockResolvedValue({
      user: { ...validSession.user, organizationId: uniqueOrgId },
    } as any)
    vi.mocked(resolveModuleFromPath).mockReturnValue(null)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      id: uniqueOrgId,
      slug: "afigroup",
      isActive: true,
      plan: "starter",
      addons: [],
      features: [],
    } as any)

    const req = makeRequest("/api/v1/contacts", "GET", { "x-tenant-slug": "afigroup" })
    const result = await requireAuth(req)
    expect(result).not.toBeInstanceOf(NextResponse)
    expect((result as any).orgId).toBe(uniqueOrgId)
  })

  it("returns 403 when superadmin session slug does not match x-tenant-slug", async () => {
    const uniqueOrgId = `org-sa-${Date.now()}`
    vi.mocked(auth).mockResolvedValue({
      user: { ...validSession.user, organizationId: uniqueOrgId, role: "superadmin" },
    } as any)
    vi.mocked(resolveModuleFromPath).mockReturnValue(null)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      id: uniqueOrgId,
      slug: "leaddrive",
      isActive: true,
      plan: "starter",
      addons: [],
      features: [],
    } as any)

    // Superadmin on afigroup subdomain with a LeadDrive session is still
    // cross-tenant. Admin work should happen through the app-host admin surface.
    const req = makeRequest("/api/v1/contacts", "GET", { "x-tenant-slug": "afigroup" })
    const result = await requireAuth(req)
    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(403)
    const json = await (result as NextResponse).json()
    expect(json.error).toBe("Forbidden")
    expect(JSON.stringify(json).toLowerCase()).not.toContain("tenant")
  })

  it("returns 403 when API-key's org slug does not match x-tenant-slug", async () => {
    vi.mocked(auth).mockResolvedValue(null as any)
    vi.mocked(getMobileAuth).mockReturnValue(null)
    // Resolve the API-key scope so this request reaches the tenant-binding
    // guard instead of being rejected earlier as an unscoped API route.
    vi.mocked(resolveModuleFromPath).mockReturnValue("contacts" as any)
    const uniqueOrgId = `org-apikey-xt-${Date.now()}`

    vi.mocked(prisma.apiKey.findFirst).mockResolvedValue({
      id: "key-1",
      organizationId: uniqueOrgId,
      createdBy: "user-api",
      name: "API Key",
      scopes: ["read:contacts"],
      expiresAt: null,
      organization: { isActive: true },
    } as any)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      id: uniqueOrgId,
      slug: "leaddrive",
    } as any)

    const req = makeRequest("/api/v1/contacts", "GET", {
      authorization: "Bearer ld_test_key",
      "x-tenant-slug": "afigroup",
    })
    const result = await requireAuth(req)
    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(403)
    const json = await (result as NextResponse).json()
    expect(json.error).toBe("Forbidden")
    expect(JSON.stringify(json).toLowerCase()).not.toContain("tenant")
  })

  it("does not run cross-tenant check when x-tenant-slug is absent", async () => {
    // e.g. app.leaddrivecrm.org or marketing — middleware doesn't inject
    // x-tenant-slug there. requireAuth must still succeed on normal auth.
    const uniqueOrgId = `org-noslug-${Date.now()}`
    vi.mocked(auth).mockResolvedValue({
      user: { ...validSession.user, organizationId: uniqueOrgId },
    } as any)
    vi.mocked(resolveModuleFromPath).mockReturnValue(null)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      id: uniqueOrgId,
      slug: "leaddrive",
      isActive: true,
      plan: "starter",
      addons: [],
      features: [],
    } as any)

    const req = makeRequest("/api/v1/contacts", "GET")
    const result = await requireAuth(req)
    expect(result).not.toBeInstanceOf(NextResponse)
    expect((result as any).orgId).toBe(uniqueOrgId)
  })
})

// ===========================================================================
// isAuthError
// ===========================================================================
describe("isAuthError", () => {
  it("returns true for NextResponse", () => {
    const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    expect(isAuthError(response)).toBe(true)
  })

  it("returns false for AuthResult", () => {
    const authResult = {
      orgId: "org-1",
      userId: "user-1",
      role: "admin" as const,
      email: "test@test.com",
      name: "Test",
    }
    expect(isAuthError(authResult as any)).toBe(false)
  })
})

// ===========================================================================
// orgHasModule — module gate for getSession/getOrgId-based routes
// ===========================================================================
describe("orgHasModule", () => {
  it("materialises features→modules and delegates to hasModule", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      isActive: true, plan: "tier-25", addons: ["ai"], features: ["quotes", "deals"],
    } as any)
    vi.mocked(hasModule).mockReturnValue(true)

    const result = await orgHasModule("org-ohm-materialise", "crm")
    expect(result).toBe(true)
    const [ctx, modId] = vi.mocked(hasModule).mock.calls[0]
    // features stay legacy-id data — materialised verbatim; the GROUP id is
    // what callers gate on post-narrow-union (hasModule 3b expands legacy ids).
    expect(ctx).toEqual({ plan: "tier-25", addons: ["ai"], modules: { quotes: true, deals: true } })
    expect(modId).toBe("crm")
  })

  it("returns hasModule's verdict (disabled module → false)", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      isActive: true, plan: "starter", addons: [], features: ["core"],
    } as any)
    vi.mocked(hasModule).mockReturnValue(false)
    expect(await orgHasModule("org-ohm-disabled", "crm")).toBe(false)
  })

  it("fails OPEN (returns true) on a DB error — the route's own query fails too", async () => {
    vi.mocked(prisma.organization.findUnique).mockRejectedValue(new Error("db down"))
    // hasModule is mocked but vi.clearAllMocks() resets it to return undefined;
    // set it explicitly so the orgHasModule return value reflects the fallback behaviour.
    vi.mocked(hasModule).mockReturnValue(true)
    expect(await orgHasModule("org-ohm-dberror", "crm")).toBe(true)
  })
})
