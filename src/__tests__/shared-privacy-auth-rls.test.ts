import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"
import { getRlsContext, rlsStorage } from "@/lib/rls-context"
vi.mock("@/lib/api-auth", () => ({ getOrgId: vi.fn(), getSession: vi.fn(), requireAuth: vi.fn(), requireSessionAuth: vi.fn(), isAuthError: (value: unknown) => value instanceof NextResponse }))
import { getSession, requireAuth, requireSessionAuth } from "@/lib/api-auth"
import { withRls, withRlsAuth, withRlsSessionAuth } from "@/lib/with-rls"

const CANARY = "PRIVATE_SYNTHETIC_person@example.invalid_Bearer_secret"
const req = () => new NextRequest(`http://localhost/api/v1/test?private=${CANARY}`, { headers: { authorization: CANARY } })
const session = { orgId: "test-org", role: "admin", userId: "test-user" } as never
const cases = [
  { name: "resolve", resolve: getSession, wrap: withRls },
  { name: "permission", resolve: requireAuth, wrap: (handler: Parameters<typeof withRlsAuth>[2]) => withRlsAuth(undefined, undefined, handler) },
  { name: "session", resolve: requireSessionAuth, wrap: withRlsSessionAuth },
] as const
beforeEach(() => { vi.clearAllMocks(); rlsStorage.enterWith(undefined as never) })
afterEach(() => vi.restoreAllMocks())

describe.each(cases)("shared auth/RLS $name failure boundary", ({ resolve, wrap }) => {
  it.each([new Error(CANARY), CANARY, { message: CANARY, cause: { headers: CANARY } }])("returns 401 without serializing the thrown value or request", async thrown => {
    const sink = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.mocked(resolve).mockRejectedValue(thrown)
    const handler = vi.fn()
    const response = await wrap(handler)(req())
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: "Unauthorized" })
    expect(handler).not.toHaveBeenCalled()
    expect(sink).toHaveBeenCalledOnce()
    expect(JSON.stringify(sink.mock.calls)).not.toContain(CANARY)
    expect(sink.mock.calls[0]).toEqual(["[application] operation failed", { operation: expect.stringMatching(/^auth-rls-/) }])
  })
  it("does not inspect hostile error properties and survives a failing destination", async () => {
    const inspected = vi.fn(() => { throw new Error(CANARY) })
    const thrown = new Proxy({}, { get: inspected, ownKeys: inspected, getOwnPropertyDescriptor: inspected })
    vi.mocked(resolve).mockImplementation(async () => { throw thrown })
    vi.spyOn(console, "error").mockImplementation(() => { throw new Error("synthetic sink unavailable") })
    expect((await wrap(vi.fn())(req())).status).toBe(401)
    expect(inspected).not.toHaveBeenCalled()
  })
  it("retains tenant context and exact downstream rejection after successful auth", async () => {
    vi.mocked(resolve).mockResolvedValue(session)
    const sink = vi.spyOn(console, "error").mockImplementation(() => {})
    const thrown = new Error(CANARY)
    const handler = vi.fn(async () => { expect(getRlsContext()).toEqual({ orgId: "test-org" }); throw thrown })
    await expect(wrap(handler)(req())).rejects.toBe(thrown)
    expect(handler).toHaveBeenCalledOnce()
    expect(sink).not.toHaveBeenCalled()
  })
})
