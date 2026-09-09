// withRls route factory: resolves {orgId, session} under RLS bypass (auth() hits
// Prisma — must not fail-closed before orgId is known), then runs the handler body
// under runWithTenant (.run — snapshot-proof, the fix for the 2026-06-11 incident
// where guard-frame enterTenantContext was trapped in next-auth's auth() snapshot).
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"
import { getRlsContext, rlsStorage } from "@/lib/rls-context"

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn(),
  requireAuth: vi.fn(),
  requireSessionAuth: vi.fn(),
  isAuthError: vi.fn((value: unknown) => value instanceof NextResponse),
}))
import { getOrgId, getSession, requireAuth, requireSessionAuth } from "@/lib/api-auth"
import { withRls, withRlsSessionAuth } from "@/lib/with-rls"

const req = () => new NextRequest("http://localhost/api/v1/test")
const fakeSession = { orgId: "org-a", role: "admin", userId: "u1" } as never

describe("withRls factory", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rlsStorage.enterWith(undefined as never) // reset any leaked context
  })

  it("resolves {orgId,session} UNDER BYPASS, then runs the handler UNDER TENANT context (the critical ordering)", async () => {
    let ctxDuringResolve: unknown
    ;(getSession as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      ctxDuringResolve = getRlsContext() // auth/session lookup must see bypass, not fail-closed
      return fakeSession
    })
    let ctxDuringHandler: unknown
    let authPassed: unknown
    const handler = vi.fn(async (_req: unknown, auth: { orgId: string }) => {
      ctxDuringHandler = getRlsContext() // body must see tenant org-a
      authPassed = auth // factory must PASS {orgId, session} (no re-resolve in body)
      return new Response("ok")
    })

    const res = await withRls(handler)(req())

    expect(ctxDuringResolve).toEqual({ bypass: true })
    expect(ctxDuringHandler).toEqual({ orgId: "org-a" })
    expect(authPassed).toEqual({ orgId: "org-a", session: fakeSession })
    expect(await res.text()).toBe("ok")
  })

  it("falls back to getOrgId when there is no session (mobile-JWT / api-key path)", async () => {
    ;(getSession as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(getOrgId as ReturnType<typeof vi.fn>).mockResolvedValue("org-b")
    let authPassed: unknown
    const handler = vi.fn(async (_req: unknown, auth: unknown) => {
      authPassed = auth
      return new Response("ok")
    })
    await withRls(handler)(req())
    expect(authPassed).toEqual({ orgId: "org-b", session: null })
  })

  it("returns 401 and does NOT call the handler when no orgId (no session + getOrgId null)", async () => {
    ;(getSession as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(getOrgId as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const handler = vi.fn()
    const res = await withRls(handler)(req())
    expect(res.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
  })

  it("threads req + auth({orgId,session}) + route ctx (params) through to the handler unchanged", async () => {
    ;(getSession as ReturnType<typeof vi.fn>).mockResolvedValue(fakeSession)
    const handler = vi.fn(async () => new Response("ok"))
    const r = req()
    const routeCtx = { params: Promise.resolve({ id: "1" }) }
    await withRls(handler)(r, routeCtx)
    expect(handler).toHaveBeenCalledWith(r, { orgId: "org-a", session: fakeSession }, routeCtx)
  })
})

describe("withRlsSessionAuth factory", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rlsStorage.enterWith(undefined as never)
  })

  it("runs a browser session handler in the resolved tenant context", async () => {
    ;(requireSessionAuth as ReturnType<typeof vi.fn>).mockResolvedValue(fakeSession)
    const handler = vi.fn(async () => {
      expect(getRlsContext()).toEqual({ orgId: "org-a" })
      return new Response("ok")
    })

    const res = await withRlsSessionAuth(handler)(req())

    expect(res.status).toBe(200)
    expect(handler).toHaveBeenCalledWith(expect.any(NextRequest), fakeSession, undefined)
  })

  it("does not call requireAuth/API-key fallback after session-only denial", async () => {
    ;(requireSessionAuth as ReturnType<typeof vi.fn>).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    )
    ;(requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
      orgId: "org-api",
      userId: "api-key-owner",
      role: "admin",
    })
    const handler = vi.fn()
    const request = new NextRequest("http://localhost/api/v1/users/me", {
      method: "PATCH",
      headers: { authorization: "Bearer ld_valid_key" },
    })

    const res = await withRlsSessionAuth(handler)(request)

    expect(res.status).toBe(401)
    expect(requireAuth).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
  })
})
