import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { workforcePolicyDefinitionHash } from "@/lib/workforce/policy-definition"

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), auth: vi.fn((handler: unknown) => handler), failure: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: { workforcePolicy: { findMany: mocks.findMany } } }))
vi.mock("@/lib/with-workforce-rls-auth", () => ({ withWorkforceSessionPolicyConfigurationAuth: mocks.auth }))
vi.mock("@/lib/workforce/sensitive-operation-log", () => ({ logWorkforceSensitiveOperationFailure: mocks.failure }))
import { GET } from "@/app/api/v1/workforce/configuration/policies/compare/route"
const definition = { expectedWorkSeconds: 28800, lateGraceSeconds: 300, undertimeToleranceSeconds: 0, overtimeThresholdSeconds: 0, longPauseThresholdSeconds: null }
const row = (id: string, version: number) => ({ id, version, organizationId: "org", teamId: null, status: "ACTIVE" as const, name: "Policy", effectiveFrom: new Date("2026-01-01"), effectiveTo: null, definition, definitionHash: workforcePolicyDefinitionHash(definition) })
const auth = { orgId: "org", userId: "admin", role: "admin" }
const call = GET as unknown as (request: NextRequest, auth: typeof auth) => Promise<Response>
const request = (query: string) => new NextRequest("http://localhost/api/v1/workforce/configuration/policies/compare?" + query, { headers: { "x-organization-id": "foreign" } })
beforeEach(() => { mocks.findMany.mockReset(); mocks.failure.mockReset() })

describe("bounded policy-version comparison administrative API", () => {
  it("uses the existing session-only policy configuration boundary", () => {
    expect(mocks.auth).toHaveBeenCalledTimes(1)
  })
  it("reads only two exact session-tenant policies, minimizes output and never trusts forged organization headers", async () => {
    mocks.findMany.mockResolvedValue([row("after", 2), row("before", 1)])
    const response = await call(request("from=before&to=after"), auth), body = await response.json()
    expect(response.status).toBe(200)
    expect(mocks.findMany).toHaveBeenCalledWith({ where: { organizationId: "org", id: { in: ["before", "after"] } }, take: 2, select: { id: true, organizationId: true, teamId: true, version: true, status: true, name: true, effectiveFrom: true, effectiveTo: true, definition: true, definitionHash: true } })
    expect(body.data.comparison.from.id).toBe("before")
    expect(body.data.comparison.to.id).toBe("after")
    expect(JSON.stringify(body)).not.toMatch(/organizationId|createdBy|activatedBy|\"definition\"/)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })
  it.each(["", "from=before", "from=before&to=before", "from=before&to=after&from=other", "from=before&to=after&org=foreign", "from=%00bad&to=after", "from=" + "a".repeat(192) + "&to=after"])("rejects malformed or ambiguous query %s before storage", async query => {
    const response = await call(request(query), auth)
    expect(response.status).toBe(400)
    expect(mocks.findMany).not.toHaveBeenCalled()
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })
  it("treats absent or foreign versions as generic unavailable without returning records", async () => {
    mocks.findMany.mockResolvedValue([row("before", 1)])
    const response = await call(request("from=before&to=foreign"), auth), body = await response.json()
    expect(response.status).toBe(404)
    expect(body.code).toBe("WORKFORCE_POLICY_COMPARISON_NOT_FOUND")
    expect(JSON.stringify(body)).not.toMatch(/before|foreign|Policy/)
  })
  it("refuses same-tenant versions in different scopes", async () => {
    mocks.findMany.mockResolvedValue([row("before", 1), { ...row("after", 2), teamId: "team" }])
    const response = await call(request("from=before&to=after"), auth)
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe("WORKFORCE_POLICY_COMPARISON_SCOPE_MISMATCH")
  })
  it("refuses signed-definition drift", async () => {
    mocks.findMany.mockResolvedValue([row("before", 1), { ...row("after", 2), definitionHash: "0".repeat(64) }])
    const response = await call(request("from=before&to=after"), auth)
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe("WORKFORCE_POLICY_COMPARISON_INTEGRITY_INVALID")
  })
  it("logs only a fixed operation and returns an unavailable response on storage failure", async () => {
    mocks.findMany.mockRejectedValue(new Error("PRIVATE_DATABASE_PAYLOAD"))
    const response = await call(request("from=before&to=after"), auth), body = await response.json()
    expect(response.status).toBe(503)
    expect(mocks.failure).toHaveBeenCalledExactlyOnceWith({ operation: "configuration-policy-version-comparison" })
    expect(JSON.stringify(body)).not.toContain("PRIVATE_DATABASE_PAYLOAD")
  })
})
