import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  delegated: vi.fn(), registered: vi.fn(), failure: vi.fn(), transaction: vi.fn(), audit: vi.fn(), settings: vi.fn(),
}))
vi.mock("@/lib/with-workforce-rls-auth", () => ({
  withWorkforceSessionExceptionQueueAuth: (handler: unknown) => { mocks.registered(handler); return mocks.delegated },
}))
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction, mtmAuditLog: { create: mocks.audit } } }))
vi.mock("@/lib/mtm-settings", () => ({ getMtmSettings: mocks.settings }))
vi.mock("@/lib/workforce/sensitive-operation-log", () => ({ logWorkforceSensitiveOperationFailure: mocks.failure }))
import { GET } from "@/app/api/v1/workforce/exception-reports/route"

beforeEach(() => {
  mocks.delegated.mockReset(); mocks.failure.mockReset(); mocks.transaction.mockReset(); mocks.audit.mockReset(); mocks.settings.mockReset()
})
describe("aggregate report containment outside the unchanged authorization boundary", () => {
  it("registers the existing exception-queue authorization boundary once", () => {
    expect(mocks.registered).toHaveBeenCalledTimes(1)
  })
  it.each([
    [401, "UNAUTHORIZED"], [403, "TENANT_CAPABILITY_DISABLED"], [403, "WORKFORCE_POLICY_ADMIN_REQUIRED"],
    [403, "WORKFORCE_GRANULAR_ACCESS_REQUIRED"], [429, "RATE_LIMITED"], [503, "WORKFORCE_GRANULAR_ACCESS_UNAVAILABLE"],
  ])("keeps delegated status%s/code%s/body while replacing cacheable headers", async (status, code) => {
    const body = JSON.stringify({ error: "Delegated denial", code })
    const delegated = new Response(body, { status, headers: { "cache-control": "public, max-age=600", "x-wrapper-marker": "preserved", "retry-after": "61" } })
    mocks.delegated.mockResolvedValue(delegated)
    const request = new NextRequest("http://localhost/api/v1/workforce/exception-reports")
    const response = await GET(request)
    expect(mocks.delegated).toHaveBeenCalledExactlyOnceWith(request)
    expect(response).toBe(delegated); expect(response.status).toBe(status); expect(await response.text()).toBe(body)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(response.headers.get("x-wrapper-marker")).toBe("preserved"); expect(response.headers.get("retry-after")).toBe("61")
    expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled(); expect(mocks.settings).not.toHaveBeenCalled()
    expect(mocks.failure).not.toHaveBeenCalled()
  })
  it("forwards an explicitly supplied route context without changing a successful body", async () => {
    const request = new NextRequest("http://localhost/api/v1/workforce/exception-reports"), context = { params: Promise.resolve({}) }
    mocks.delegated.mockResolvedValue(new Response('{"success":true}', { status: 200 }))
    const response = await GET(request, context)
    expect(mocks.delegated).toHaveBeenCalledExactlyOnceWith(request, context)
    expect(response.status).toBe(200); expect(await response.text()).toBe('{"success":true}')
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })
  it("contains a thrown wrapper failure with a fixed private503 and privacy-safe log", async () => {
    mocks.delegated.mockRejectedValue(new Error("PRIVATE_WRAPPER_PAYLOAD"))
    const response = await GET(new NextRequest("http://localhost/api/v1/workforce/exception-reports"))
    expect(response.status).toBe(503)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(await response.json()).toEqual({ error: "Workforce exception reporting is unavailable", code: "WORKFORCE_EXCEPTION_REPORT_UNAVAILABLE" })
    expect(mocks.failure).toHaveBeenCalledExactlyOnceWith({ operation: "read-exception-case-report" })
    expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled()
  })
})
