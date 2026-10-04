import { Prisma } from "@prisma/client"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { workforcePolicyDefinitionHash } from "@/lib/workforce/policy-definition"

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), draft: vi.fn(), policies: vi.fn(), setting: vi.fn(),
  employees: vi.fn(), memberships: vi.fn(), execute: vi.fn(), auth: vi.fn((handler: unknown) => handler), failure: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }))
vi.mock("@/lib/mtm-settings", () => ({ MTM_SETTING_DEFAULTS: { timezone: "Asia/Baku" } }))
vi.mock("@/lib/with-workforce-rls-auth", () => ({ withWorkforceSessionPolicyConfigurationAuth: mocks.auth }))
vi.mock("@/lib/workforce/sensitive-operation-log", () => ({ logWorkforceSensitiveOperationFailure: mocks.failure }))
import { GET } from "@/app/api/v1/workforce/configuration/policies/[id]/employee-impact/route"
const definition = { expectedWorkSeconds: 28_800, lateGraceSeconds: 0, undertimeToleranceSeconds: 0,
  overtimeThresholdSeconds: 0, longPauseThresholdSeconds: null, opaque: "PRIVATE_DEFINITION" }
const record = (draft: boolean) => ({ id: draft ? "draft" : "published", organizationId: "org", teamId: null,
  name: draft ? "Future policy" : "Recorded policy", version: draft ? 2 : 1, status: draft ? "DRAFT" : "ACTIVE",
  effectiveFrom: new Date(draft ? "2026-10-06" : "2020-01-01"), effectiveTo: null,
  activatedAt: draft ? null : new Date("2020-01-01"), retiredAt: null,
  definition, definitionHash: workforcePolicyDefinitionHash(definition) })
const auth = { orgId: "org", userId: "reader", role: "viewer" }
const call = GET as unknown as (req: NextRequest, principal: typeof auth, ctx: { params: Promise<{ id: string }> }) => Promise<Response>
const run = (query = "", id = "draft") => call(new NextRequest("http://localhost/api/v1/workforce/configuration/policies/draft/employee-impact" + query,
  { headers: { "x-organization-id": "foreign", "x-workforce-organization-id": "foreign" } }), auth, { params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-04T12:00:00Z"))
  for (const fn of [mocks.transaction, mocks.draft, mocks.policies, mocks.setting, mocks.employees, mocks.memberships, mocks.execute, mocks.failure]) fn.mockReset()
  mocks.draft.mockResolvedValue(record(true)); mocks.policies.mockResolvedValue([record(false)]); mocks.setting.mockResolvedValue({ value: "UTC" })
  mocks.employees.mockResolvedValue([{ id: "private-employee", organizationId: "org", status: "ACTIVE" }])
  mocks.memberships.mockResolvedValue([{ agentId: "private-employee", membershipId: "private-membership", membershipOrganizationId: "org",
    membershipAgentId: "private-employee", teamId: "team", effectiveAt: new Date("2026-10-01") }])
  mocks.transaction.mockImplementation(async (handler: (tx: unknown) => Promise<unknown>) => handler({
    workforcePolicy: { findFirst: mocks.draft, findMany: mocks.policies }, mtmSetting: { findFirst: mocks.setting },
    mtmAgent: { findMany: mocks.employees }, $queryRaw: mocks.memberships, $executeRaw: mocks.execute,
  }))
})
afterEach(() => { vi.useRealTimers() })

describe("session-tenant employee impact administrative read", () => {
  it("uses the existing organization HR policy boundary", () => { expect(mocks.auth).toHaveBeenCalledTimes(1) })
  it("reads complete bounded facts in one RR transaction and returns aggregate private receipts", async () => {
    const response = await run(), body = await response.json()
    expect(response.status).toBe(200)
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5_000, timeout: 15_000 })
    expect(mocks.execute).toHaveBeenCalledTimes(2)
    expect(mocks.draft.mock.calls[0][0].where).toEqual({ id: "draft", organizationId: "org" })
    expect(mocks.policies.mock.calls[0][0]).toMatchObject({ where: { organizationId: "org", status: "ACTIVE" }, take: 101 })
    expect(mocks.employees.mock.calls[0][0]).toEqual({ where: { organizationId: "org", status: "ACTIVE" },
      select: { id: true, organizationId: true, status: true }, orderBy: { id: "asc" }, take: 101 })
    const sql = mocks.memberships.mock.calls[0][0] as Prisma.Sql
    expect(sql.text).toContain('FROM "workforce_employee_team_memberships"')
    expect(sql.text).not.toMatch(/FOR SHARE|FOR UPDATE|advisory|INSERT|UPDATE|DELETE|agent\."teamId"/)
    expect(sql.values.filter(value => value === "org")).toHaveLength(2)
    expect(sql.values).toContain("private-employee")
    expect(sql.values).toContainEqual(new Date("2026-10-06T00:00:00Z"))
    expect(body.data.preview.counts.selectedDraft).toBe(1)
    expect(JSON.stringify(body)).not.toMatch(/private-employee|private-membership|organizationId|PRIVATE_DEFINITION|reader|foreign/)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("vary")).toBe("Cookie"); expect(response.headers.get("x-content-type-options")).toBe("nosniff")
  })
  it.each(["?organizationId=foreign", "?effectiveFrom=2020-01-01", "?teamId=team", "?id=x&id=y"])("rejects query overrides %s before storage", async query => {
    expect((await run(query)).status).toBe(400); expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it.each(["", "\u0000private", "a".repeat(192)])("rejects malformed id before storage", async id => {
    expect((await run("", id)).status).toBe(400); expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it("returns safe404 without reading a foreign/missing draft's employee facts", async () => {
    mocks.draft.mockResolvedValue(null); const response = await run()
    expect(response.status).toBe(404); expect(mocks.employees).not.toHaveBeenCalled(); expect(mocks.setting).not.toHaveBeenCalled()
    expect(mocks.policies).not.toHaveBeenCalled(); expect(mocks.memberships).not.toHaveBeenCalled()
  })
  it.each(["policies", "employees"])("refuses %s sentinel101 before membership query", async kind => {
    if (kind === "policies") mocks.policies.mockResolvedValue(Array.from({ length: 101 }, () => record(false)))
    else mocks.employees.mockResolvedValue(Array.from({ length: 101 }, (_, n) => ({ id: "e" + n, organizationId: "org", status: "ACTIVE" })))
    const response = await run(), body = await response.json()
    expect(response.status).toBe(409); expect(body.code).toBe("WORKFORCE_POLICY_IMPACT_LIMIT_EXCEEDED")
    expect(body.data).toBeUndefined(); expect(mocks.memberships).not.toHaveBeenCalled()
  })
  it("validates damaged hash even when the current employee cohort is empty", async () => {
    mocks.employees.mockResolvedValue([]); mocks.draft.mockResolvedValue({ ...record(true), definitionHash: "0".repeat(64) })
    const response = await run(); expect(response.status).toBe(409)
    expect((await response.json()).code).toBe("WORKFORCE_POLICY_IMPACT_INTEGRITY_INVALID")
  })
  it("returns an honestly empty cohort without issuing membership SQL", async () => {
    mocks.employees.mockResolvedValue([]); const response = await run()
    expect(response.status).toBe(200); expect((await response.json()).data.preview.counts.directoryEmployees).toBe(0)
    expect(mocks.memberships).not.toHaveBeenCalled()
  })
  it.each(["INACTIVE", "SUSPENDED"])("refuses an unexpected %s ORM row before membership SQL", async status => {
    mocks.employees.mockResolvedValue([{ id: "private-employee", organizationId: "org", status }])
    const response = await run(), body = await response.json()
    expect(response.status).toBe(409); expect(body.code).toBe("WORKFORCE_POLICY_IMPACT_RECORD_INVALID")
    expect(body.data).toBeUndefined(); expect(mocks.memberships).not.toHaveBeenCalled()
  })
  it("retains null membership as organization fallback", async () => {
    mocks.memberships.mockResolvedValue([{ agentId: "private-employee", membershipId: null, membershipOrganizationId: null,
      membershipAgentId: null, teamId: null, effectiveAt: null }])
    const response = await run(); expect(response.status).toBe(200)
    expect((await response.json()).data.preview.counts).toMatchObject({ selectedDraft: 1, missingMembership: 1 })
  })
  it.each(["missing employee", "duplicate join", "foreign membership", "partial null membership"])("fails closed for %s", async kind => {
    const row = { agentId: "private-employee", membershipId: "member", membershipOrganizationId: "org",
      membershipAgentId: "private-employee", teamId: "team", effectiveAt: new Date("2026-10-01") }
    if (kind === "missing employee") mocks.memberships.mockResolvedValue([])
    if (kind === "duplicate join") mocks.memberships.mockResolvedValue([row, row])
    if (kind === "foreign membership") mocks.memberships.mockResolvedValue([{ ...row, membershipOrganizationId: "foreign" }])
    if (kind === "partial null membership") mocks.memberships.mockResolvedValue([{ ...row, membershipId: null }])
    const response = await run(); expect(response.status).toBe(409); expect((await response.json()).data).toBeUndefined()
  })
  it.each([null, { value: null }, { value: 3 }])("uses canonical default timezone for missing/nonstring setting %s", async setting => {
    mocks.setting.mockResolvedValue(setting); const response = await run(); expect(response.status).toBe(200)
    expect((await response.json()).data.preview.scopeInstant).toBe("2026-10-05T20:00:00.000Z")
  })
  it("uses canonical UTC fallback for invalid configured timezone", async () => {
    mocks.setting.mockResolvedValue({ value: "Invalid/Timezone" }); const response = await run()
    expect(response.status).toBe(200); expect((await response.json()).data.preview.timezone).toBe("UTC")
  })
  it("refuses today or activated drafts without returning aggregate data", async () => {
    mocks.draft.mockResolvedValue({ ...record(true), effectiveFrom: new Date("2026-10-04") })
    expect((await run()).status).toBe(409); mocks.draft.mockResolvedValue(record(false)); expect((await run()).status).toBe(409)
  })
  it("logs only a fixed label and returns generic503 on SQL/storage failure", async () => {
    mocks.memberships.mockRejectedValue(new Error("PRIVATE_DATABASE_PAYLOAD")); const response = await run(), body = await response.json()
    expect(response.status).toBe(503); expect(JSON.stringify(body)).not.toContain("PRIVATE_DATABASE_PAYLOAD")
    expect(mocks.failure).toHaveBeenCalledExactlyOnceWith({ operation: "configuration-policy-employee-impact-preview" })
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })
})
