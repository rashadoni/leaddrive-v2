/**
 * getPortalUser — token resolution (Phase 0: native Bearer + web cookie).
 *
 * Native clients send the JWT as `Authorization: Bearer`; the web sends the
 * httpOnly `portal-token` cookie. getPortalUser prefers the header, falls back
 * to the cookie, and verifies the same way for both. A verified token is then
 * revalidated against current contact and organization state. We mock those
 * boundaries and load the real module so the actual resolution logic is exercised.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest"

const { headersMock, cookiesMock, jwtVerifyMock, contactFindFirstMock, runWithTenantMock } = vi.hoisted(() => ({
  headersMock: vi.fn(),
  cookiesMock: vi.fn(),
  jwtVerifyMock: vi.fn(),
  contactFindFirstMock: vi.fn(),
  runWithTenantMock: vi.fn(),
}))

vi.mock("next/headers", () => ({ headers: headersMock, cookies: cookiesMock }))
vi.mock("@/lib/prisma", () => ({
  prisma: { contact: { findFirst: contactFindFirstMock } },
}))
vi.mock("@/lib/rls-context", () => ({
  runWithTenant: runWithTenantMock,
}))
vi.mock("@/lib/session-invalidation", () => ({
  createSessionFingerprint: vi.fn(() => "current-portal-fingerprint"),
  hasCurrentSessionFingerprint: vi.fn((presented: unknown, current: string) => presented === current),
}))
vi.mock("jose", () => ({
  SignJWT: class {
    setProtectedHeader() {
      return this
    }
    setExpirationTime() {
      return this
    }
    setIssuedAt() {
      return this
    }
    sign() {
      return Promise.resolve("signed")
    }
  },
  jwtVerify: jwtVerifyMock,
}))

let getPortalUser: (typeof import("@/lib/portal-auth"))["getPortalUser"]
beforeAll(async () => {
  process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || "test-secret-key"
  ;({ getPortalUser } = await import("@/lib/portal-auth"))
})

const PAYLOAD = {
  contactId: "c-1",
  organizationId: "org-1",
  companyId: null,
  fullName: "Jane",
  email: "j@x.com",
  portalSessionFingerprint: "current-portal-fingerprint",
}
const PORTAL_USER = {
  contactId: "c-1",
  organizationId: "org-1",
  companyId: null,
  fullName: "Jane",
  email: "j@x.com",
}
const ACTIVE_CONTACT = {
  id: "c-1",
  organizationId: "org-1",
  companyId: null,
  fullName: "Jane",
  email: "j@x.com",
  portalPasswordHash: "$2b$12$current-portal-password-hash",
}

function withHeaders(authz: string | null) {
  headersMock.mockResolvedValue({ get: (k: string) => (k.toLowerCase() === "authorization" ? authz : null) } as never)
}
function withCookie(token: string | undefined) {
  cookiesMock.mockResolvedValue({
    get: (k: string) => (k === "portal-token" && token ? { value: token } : undefined),
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  jwtVerifyMock.mockResolvedValue({ payload: PAYLOAD })
  contactFindFirstMock.mockResolvedValue(ACTIVE_CONTACT)
  runWithTenantMock.mockImplementation(async (_orgId: string, fn: () => unknown) => await fn())
})

describe("getPortalUser — Bearer + cookie resolution", () => {
  it("uses the Bearer header token when present (ignores the cookie)", async () => {
    withHeaders("Bearer header-jwt")
    withCookie("cookie-jwt")
    const u = await getPortalUser()
    expect(u?.contactId).toBe("c-1")
    expect(jwtVerifyMock).toHaveBeenCalledWith("header-jwt", expect.anything())
  })

  it("falls back to the cookie when there is no Authorization header", async () => {
    withHeaders(null)
    withCookie("cookie-jwt")
    await getPortalUser()
    expect(jwtVerifyMock).toHaveBeenCalledWith("cookie-jwt", expect.anything())
  })

  it("ignores a non-Bearer scheme and falls back to the cookie", async () => {
    withHeaders("Basic abc123")
    withCookie("cookie-jwt")
    await getPortalUser()
    expect(jwtVerifyMock).toHaveBeenCalledWith("cookie-jwt", expect.anything())
  })

  it("returns null when neither header nor cookie carries a token", async () => {
    withHeaders(null)
    withCookie(undefined)
    const u = await getPortalUser()
    expect(u).toBeNull()
    expect(jwtVerifyMock).not.toHaveBeenCalled()
  })

  it("returns null when an empty Bearer value and no cookie are present", async () => {
    withHeaders("Bearer ")
    withCookie(undefined)
    const u = await getPortalUser()
    expect(u).toBeNull()
    expect(jwtVerifyMock).not.toHaveBeenCalled()
  })

  it("returns null when the token fails verification", async () => {
    withHeaders("Bearer bad-jwt")
    withCookie(undefined)
    jwtVerifyMock.mockRejectedValue(new Error("bad signature"))
    const u = await getPortalUser()
    expect(u).toBeNull()
  })

  it("returns the freshly revalidated active contact", async () => {
    withHeaders("Bearer ok")
    withCookie(undefined)
    const u = await getPortalUser()
    expect(u).toEqual(PORTAL_USER)
  })

  it("rejects a pre-issued token after its organization is suspended", async () => {
    withHeaders("Bearer pre-issued-token")
    withCookie(undefined)
    contactFindFirstMock.mockResolvedValueOnce(null)

    const u = await getPortalUser()

    expect(u).toBeNull()
    expect(runWithTenantMock).toHaveBeenCalledWith("org-1", expect.any(Function))
    expect(contactFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: "c-1",
        organizationId: "org-1",
        isActive: true,
        portalAccessEnabled: true,
        organization: { isActive: true },
      },
      select: {
        id: true,
        organizationId: true,
        companyId: true,
        fullName: true,
        email: true,
        portalPasswordHash: true,
      },
    })
  })

  it("rejects a token after the portal password credential changes", async () => {
    withHeaders("Bearer stale-token")
    withCookie(undefined)
    jwtVerifyMock.mockResolvedValueOnce({
      payload: { ...PAYLOAD, portalSessionFingerprint: "stale-portal-fingerprint" },
    })

    expect(await getPortalUser()).toBeNull()
  })
})
