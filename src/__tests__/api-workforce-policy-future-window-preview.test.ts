import { Prisma } from "@prisma/client"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { workforcePolicyDefinitionHash } from "@/lib/workforce/policy-definition"

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), setting: vi.fn(),
  auth: vi.fn((handler: unknown) => handler), failure: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }))
vi.mock("@/lib/mtm-settings", () => ({ MTM_SETTING_DEFAULTS: { timezone: "Asia/Baku" } }))
vi.mock("@/lib/with-workforce-rls-auth", () => ({ withWorkforceSessionPolicyConfigurationAuth: mocks.auth }))
vi.mock("@/lib/workforce/sensitive-operation-log", () => ({ logWorkforceSensitiveOperationFailure: mocks.failure }))
import { GET } from "@/app/api/v1/workforce/configuration/policies/[id]/window-preview/route"
const definition = { expectedWorkSeconds: 28800, lateGraceSeconds: 0, undertimeToleranceSeconds: 0, overtimeThresholdSeconds: 0, longPauseThresholdSeconds: null }
const draft = () => ({ id: "draft", organizationId: "org", teamId: null, name: "Future policy", version: 2, status: "DRAFT" as const,
  effectiveFrom: new Date("2026-10-05"), effectiveTo: null, definition, definitionHash: workforcePolicyDefinitionHash(definition) })
const auth = { orgId: "org", userId: "reader", role: "viewer" }
const call = GET as unknown as (request: NextRequest, principal: typeof auth, context: { params: Promise<{ id: string }> }) => Promise<Response>
const request = (query = "") => new NextRequest("http://localhost/api/v1/workforce/configuration/policies/draft/window-preview" + query,
  { headers: { "x-organization-id": "foreign", "x-workforce-organization-id": "foreign" } })
const run = (query = "", id = "draft") => call(request(query), auth, { params: Promise.resolve({ id }) })
const projection = { id: true, organizationId: true, teamId: true, version: true, status: true, name: true,
  effectiveFrom: true, effectiveTo: true, definition: true, definitionHash: true }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-04T23:30:00Z"))
  for (const fn of [mocks.transaction, mocks.findFirst, mocks.findMany, mocks.setting, mocks.failure]) fn.mockReset()
  mocks.findFirst.mockResolvedValue(draft()); mocks.findMany.mockResolvedValue([]); mocks.setting.mockResolvedValue({ value: "UTC" })
  mocks.transaction.mockImplementation(async (handler: (tx: unknown) => Promise<unknown>) => handler({
    workforcePolicy: { findFirst: mocks.findFirst, findMany: mocks.findMany }, mtmSetting: { findFirst: mocks.setting },
  }))
})
afterEach(() => { vi.useRealTimers() })

describe("coherent minimal session-tenant future-window administrative read", () => {
  it("uses the existing HR policy session boundary", () => { expect(mocks.auth).toHaveBeenCalledTimes(1) })
  it("uses one RR transaction, exact tenant/scope,100+1lookahead and server timezone setting only", async () => {
    const response = await run(), body = await response.json()
    expect(response.status).toBe(200)
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
    expect(mocks.findFirst).toHaveBeenCalledExactlyOnceWith({ where: { id: "draft", organizationId: "org" }, select: projection })
    expect(mocks.setting).toHaveBeenCalledExactlyOnceWith({ where: { organizationId: "org", key: "timezone" }, select: { value: true } })
    expect(mocks.findMany).toHaveBeenCalledExactlyOnceWith({ where: { organizationId: "org", teamId: null, status: "ACTIVE" },
      select: projection, orderBy: [{ effectiveFrom: "asc" }, { id: "asc" }], take: 101 })
    expect(body.data.preview.currentDate).toBe("2026-10-04")
    expect(body.data.preview.timezone).toBe("UTC")
    expect(body.data.preview.observedAt).toBe("2026-10-04T23:30:00.000Z")
    expect(JSON.stringify(body)).not.toMatch(/organizationId|definitionHash|expectedWorkSeconds|foreign|createdBy/)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("vary")).toBe("Cookie"); expect(response.headers.get("x-content-type-options")).toBe("nosniff")
  })
  it("uses exact TEAM scope without organization fallback", async () => {
    mocks.findFirst.mockResolvedValue({ ...draft(), teamId: "team" }); await run()
    expect(mocks.findMany.mock.calls[0][0].where).toEqual({ organizationId: "org", teamId: "team", status: "ACTIVE" })
  })
  it.each([null, { value: null }, { value: 3 }])("uses canonical default Asia/Baku for absent/nonstring timezone %s", async setting => {
    mocks.setting.mockResolvedValue(setting)
    const response = await run()
    expect(response.status).toBe(409) // Organization-local date is already Oct5: draft is not future.
    expect((await response.json()).code).toBe("WORKFORCE_POLICY_WINDOW_NOT_FUTURE_DRAFT")
  })
  it("uses canonical UTC fallback for invalid configured timezone", async () => {
    mocks.setting.mockResolvedValue({ value: "Invalid/Timezone" });const response = await run()
    expect(response.status).toBe(200);expect((await response.json()).data.preview.timezone).toBe("UTC")
  })
  it.each(["?organizationId=foreign", "?date=2026-01-01", "?draft=other&draft=another"])("rejects extra query %s before storage", async query => {
    expect((await run(query)).status).toBe(400);expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it.each(["", "\u0000private", "a".repeat(192)])("rejects malformed id before storage", async id => {
    expect((await run("", id)).status).toBe(400);expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it("returns generic404 without loading a foreign/missing draft's scope or timezone", async () => {
    mocks.findFirst.mockResolvedValue(null);const response = await run(),body = await response.json()
    expect(response.status).toBe(404);expect(JSON.stringify(body)).not.toMatch(/Future policy|foreign/)
    expect(mocks.findMany).not.toHaveBeenCalled();expect(mocks.setting).not.toHaveBeenCalled()
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })
  it("does not return an unsafe partial preview after lookahead overflow", async () => {
    mocks.findMany.mockResolvedValue(Array.from({ length: 101 }, () => ({ ...draft(), status: "ACTIVE" })))
    const response = await run(), body = await response.json();expect(response.status).toBe(409)
    expect(body.code).toBe("WORKFORCE_POLICY_WINDOW_LIMIT_EXCEEDED");expect(body.data).toBeUndefined()
  })
  it("rejects full-definition drift with fixed safe409", async () => {
    mocks.findFirst.mockResolvedValue({ ...draft(), definitionHash: "0".repeat(64) })
    const response = await run();expect(response.status).toBe(409)
    expect((await response.json()).code).toBe("WORKFORCE_POLICY_WINDOW_INTEGRITY_INVALID")
  })
  it("logs only the fixed operation on storage failure", async () => {
    mocks.findMany.mockRejectedValue(new Error("PRIVATE_DATABASE_PAYLOAD"))
    const response = await run(),body = await response.json();expect(response.status).toBe(503)
    expect(mocks.failure).toHaveBeenCalledExactlyOnceWith({ operation: "configuration-policy-future-window-preview" })
    expect(JSON.stringify(body)).not.toContain("PRIVATE_DATABASE_PAYLOAD")
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })
})
