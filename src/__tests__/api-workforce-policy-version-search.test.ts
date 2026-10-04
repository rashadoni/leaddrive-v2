import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ findMany: vi.fn(), auth: vi.fn((handler: unknown) => handler), failure: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: { workforcePolicy: { findMany: mocks.findMany } } }))
vi.mock("@/lib/with-workforce-rls-auth", () => ({ withWorkforceSessionPolicyConfigurationAuth: mocks.auth }))
vi.mock("@/lib/workforce/sensitive-operation-log", () => ({ logWorkforceSensitiveOperationFailure: mocks.failure }))
import { GET } from "@/app/api/v1/workforce/configuration/policies/search/route"
const auth = { orgId: "org", userId: "admin", role: "admin" }
const call = GET as unknown as (request: NextRequest, context: typeof auth) => Promise<Response>
const request = (query: string) => new NextRequest("http://localhost/api/v1/workforce/configuration/policies/search?" + query, { headers: { "x-organization-id": "foreign" } })
beforeEach(() => { mocks.findMany.mockReset(); mocks.failure.mockReset() })
describe("bounded named policy comparison choices", () => {
  it("uses the existing session-only policy boundary", () => expect(mocks.auth).toHaveBeenCalledTimes(1))
  it("returns at most20 with truthful hasMore and minimizes its exact session-tenant query", async () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({ id: "policy-" + index, name: "Policy", version: index + 1, status: "ACTIVE", teamId: null, team: null }))
    mocks.findMany.mockResolvedValue(rows)
    const response = await call(request("q=%20Po%20"), auth), body = await response.json()
    expect(response.status).toBe(200)
    expect(body.data).toEqual({ policies: rows.slice(0, 20), query: "Po", limit: 20, hasMore: true })
    expect(mocks.findMany).toHaveBeenCalledWith({ where: { organizationId: "org", name: { contains: "Po", mode: "insensitive" } }, orderBy: [{ version: "desc" }, { id: "asc" }], take: 21, select: { id: true, name: true, version: true, status: true, teamId: true, team: { select: { name: true } } } })
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(JSON.stringify(body)).not.toMatch(/organizationId|definition|createdBy|employee/)
  })
  it("distinguishes a complete empty search", async () => {
    mocks.findMany.mockResolvedValue([])
    const response = await call(request("q=missing"), auth)
    expect((await response.json()).data).toEqual({ policies: [], query: "missing", limit: 20, hasMore: false })
  })
  it.each(["", "q=x", "q=" + "a".repeat(101), "q=%00bad", "q=ab&q=cd", "q=ab&org=foreign"])("rejects ambiguous or invalid input %s before storage", async query => {
    expect((await call(request(query), auth)).status).toBe(400)
    expect(mocks.findMany).not.toHaveBeenCalled()
  })
  it("logs only the fixed operation and never returns storage payload", async () => {
    mocks.findMany.mockRejectedValue(new Error("PRIVATE_DATABASE_PAYLOAD"))
    const response = await call(request("q=ab"), auth), body = await response.json()
    expect(response.status).toBe(503)
    expect(mocks.failure).toHaveBeenCalledExactlyOnceWith({ operation: "configuration-policy-version-search" })
    expect(JSON.stringify(body)).not.toContain("PRIVATE_DATABASE_PAYLOAD")
  })
})
