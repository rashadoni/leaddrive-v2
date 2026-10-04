import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { workforcePolicyDefinitionHash } from "@/lib/workforce/policy-definition"
const mocks = vi.hoisted(() => ({ restore: vi.fn(), failure: vi.fn(), denied: 0,
  auth: vi.fn((handler: (req: NextRequest, auth: { orgId: string; userId: string }, ctx: unknown) => Promise<Response>) =>
    (req: NextRequest, ctx: unknown) => mocks.denied ? Promise.resolve(new Response("denied", { status: mocks.denied }))
      : handler(req, { orgId: "session-org", userId: "session-user" }, ctx)) }))
vi.mock("@/lib/with-workforce-rls-auth", () => ({ withWorkforceSessionPolicyConfigurationAuth: mocks.auth }))
vi.mock("@/lib/workforce/policy-restore-draft", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/workforce/policy-restore-draft")>(), restoreWorkforcePolicyAsDraft: mocks.restore,
}))
vi.mock("@/lib/workforce/sensitive-operation-log", () => ({ logWorkforceSensitiveOperationFailure: mocks.failure }))
import { POST } from "@/app/api/v1/workforce/configuration/policies/[id]/restore-draft/route"
import { WorkforcePolicyRestoreError } from "@/lib/workforce/policy-restore-draft"
const draft = { operationId: "restore:api-example", name: "Restored draft", effectiveFrom: "2026-10-05", expectedSourceVersion: 1,
  expectedSourceDefinitionHash: workforcePolicyDefinitionHash({ expectedWorkSeconds: 0, lateGraceSeconds: 0,
    undertimeToleranceSeconds: 0, overtimeThresholdSeconds: 0, longPauseThresholdSeconds: null }) }
const run = (body: unknown = draft, query = "", id = "source") => POST(new NextRequest("http://localhost/api/v1/workforce/configuration/policies/source/restore-draft" + query,
  { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json", "x-organization-id": "foreign", "x-user-id": "foreign" } }),
{ params: Promise.resolve({ id }) })
function privateHeaders(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("vary")).toBe("Cookie")
  expect(response.headers.get("x-content-type-options")).toBe("nosniff")
}
beforeEach(() => { mocks.restore.mockReset(); mocks.failure.mockReset(); mocks.denied = 0
  mocks.restore.mockResolvedValue({ schemaVersion: 1, basis: "CREATION_RECEIPT_ONLY_NOT_CURRENT_STATE", replayed: false, creation: { policyId: "new-draft" } }) })
describe("strict session-authorized restore POST", () => {
  it("delegates to the existing session-only HR policy boundary and derives tenant/principal from it", async () => {
    const response = await run(); expect(response.status).toBe(201); privateHeaders(response)
    expect(mocks.auth).toHaveBeenCalledTimes(1)
    expect(mocks.restore).toHaveBeenCalledExactlyOnceWith({ organizationId: "session-org", sourcePolicyId: "source", draft,
      audit: expect.objectContaining({ actorUserId: "session-user" }) })
    expect((await response.json()).data.restore.basis).toBe("CREATION_RECEIPT_ONLY_NOT_CURRENT_STATE")
  })
  it("returns the original creation receipt with200 for exact replay", async () => {
    mocks.restore.mockResolvedValue({ replayed: true, basis: "CREATION_RECEIPT_ONLY_NOT_CURRENT_STATE" })
    const response = await run(); expect(response.status).toBe(200); privateHeaders(response)
  })
  it.each([null, "{broken", { ...draft, organizationId: "foreign" }, { ...draft, actorUserId: "foreign" }, { ...draft, definition: {} },
    { ...draft, teamId: "team" }, { ...draft, activate: true }, { ...draft, operationId: "short" },
    { ...draft, expectedSourceVersion: 1.2 }, { ...draft, expectedSourceVersion: Number.MAX_SAFE_INTEGER + 1 },
    { ...draft, effectiveFrom: "2026-02-30" }, { ...draft, name: "\u0000secret" }])("refuses invalid/extra input before writer: %s", async body => {
    const response = await run(body); expect(response.status).toBe(400); privateHeaders(response); expect(mocks.restore).not.toHaveBeenCalled()
  })
  it.each(["?orgId=foreign", "?date=2020-01-01"])("refuses query%s", async query => { expect((await run(draft, query)).status).toBe(400); expect(mocks.restore).not.toHaveBeenCalled() })
  it.each(["", " source", "a".repeat(192), "a\u007f"])("refuses malformed source%s", async id => { expect((await run(draft, "", id)).status).toBe(400); expect(mocks.restore).not.toHaveBeenCalled() })
  it.each([401, 403, 503])("contains delegated authorization%s before writer", async status => {
    mocks.denied = status; const response = await run(); expect(response.status).toBe(status); privateHeaders(response); expect(mocks.restore).not.toHaveBeenCalled()
    // Actual credentials and granular grants are verified separately in hosted API evidence.
  })
  it.each(["WORKFORCE_POLICY_RESTORE_SOURCE_UNAVAILABLE", "WORKFORCE_POLICY_RESTORE_NOT_FUTURE", "WORKFORCE_POLICY_RESTORE_OPERATION_CONFLICT",
    "WORKFORCE_POLICY_RESTORE_INTEGRITY_INVALID"] as const)("uses fixed safe errors for%s", async code => {
    mocks.restore.mockRejectedValue(new WorkforcePolicyRestoreError(code)); const response = await run(); privateHeaders(response)
    expect(response.status).toBe(code.endsWith("SOURCE_UNAVAILABLE") ? 404 : 409)
    const body = await response.json(); expect(body.code).toBe(code); expect(JSON.stringify(body)).not.toMatch(/foreign|session-user|definitionHash/)
  })
  it("keeps an unknown storage result retryable with the same request, no raw error log or payload", async () => {
    mocks.restore.mockRejectedValue(new Error("PRIVATE_DATABASE_PAYLOAD")); const response = await run(); expect(response.status).toBe(503); privateHeaders(response)
    expect(JSON.stringify(await response.json())).not.toContain("PRIVATE_DATABASE_PAYLOAD")
    expect(mocks.failure).toHaveBeenCalledExactlyOnceWith({ operation: "configuration-policy-restore-draft" })
  })
})
