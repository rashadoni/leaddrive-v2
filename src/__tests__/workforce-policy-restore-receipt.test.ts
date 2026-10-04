import { describe, expect, it } from "vitest"
import { validWorkforcePolicyRestoreReceipt, workforcePolicyRestoreDateKey,
  type WorkforcePolicyRestoreSource, type WorkforcePolicyRestoreRequest } from "@/lib/workforce/policy-restore-receipt"

const source: WorkforcePolicyRestoreSource = { id: "recorded-source", name: "Recorded policy", version: 2,
  status: "RETIRED", teamId: "team", teamName: "Operations", definitionHash: "a".repeat(64) }
const request: WorkforcePolicyRestoreRequest = { operationId: "opaque-operation", expectedSourceVersion: 2,
  expectedSourceDefinitionHash: source.definitionHash, name: "New draft", effectiveFrom: "2026-12-01" }
const receipt = () => ({ schemaVersion: 1, basis: "CREATION_RECEIPT_ONLY_NOT_CURRENT_STATE", replayed: false,
  creation: { policyId: "new-policy", teamId: source.teamId, version: 5, name: request.name,
    effectiveFrom: request.effectiveFrom, effectiveTo: null, definitionHash: source.definitionHash,
    createdAt: "2026-10-04T12:01:02.003Z", statusAtCreation: "DRAFT", sourcePolicyId: source.id, sourceVersion: 2 } })
describe("original policy creation receipt bound to a captured request", () => {
  it("accepts fresh201 and exact200 replay without assuming a live draft", () => {
    expect(validWorkforcePolicyRestoreReceipt(receipt(), 201, source, request)).toBe(true)
    expect(validWorkforcePolicyRestoreReceipt({ ...receipt(), replayed: true }, 200, source, request)).toBe(true)
  })
  it.each([null, {}, { ...receipt(), basis: "CURRENT_POLICY" }, { ...receipt(), schemaVersion: 2 },
    { ...receipt(), replayed: true }, { ...receipt(), replayed: "false" }, { ...receipt(), creation: null }])("rejects a malformed or mismatched envelope", value => {
    expect(validWorkforcePolicyRestoreReceipt(value, 201, source, request)).toBe(false)
  })
  it.each([{ policyId: source.id }, { policyId: "" }, { policyId: "bad\u007f" }, { teamId: null }, { version: 2 },
    { version: Number.MAX_SAFE_INTEGER + 1 }, { name: "Different" }, { effectiveFrom: "2026-12-02" },
    { effectiveTo: "2026-12-31" }, { definitionHash: "b".repeat(64) }, { statusAtCreation: "ACTIVE" },
    { sourcePolicyId: "foreign" }, { sourceVersion: 1 }, { createdAt: "2026-02-30T12:01:02.003Z" },
    { createdAt: "2026-10-04T12:01:02+00:00" }])("rejects changed creation identity/content/scope/original status", changed => {
    expect(validWorkforcePolicyRestoreReceipt({ ...receipt(), creation: { ...receipt().creation, ...changed } }, 201, source, request)).toBe(false)
  })
  it("rejects successful-looking receipts on other status codes and mismatched captured source", () => {
    for (const status of [200, 202, 409, 503]) expect(validWorkforcePolicyRestoreReceipt(receipt(), status, source, request)).toBe(false)
    expect(validWorkforcePolicyRestoreReceipt(receipt(), 201, source, { ...request, expectedSourceVersion: 1 })).toBe(false)
    expect(validWorkforcePolicyRestoreReceipt(receipt(), 201, source, { ...request, expectedSourceDefinitionHash: "b".repeat(64) })).toBe(false)
  })
  it.each(["2026-02-30", "2026-2-01", "2026-12-01T00:00:00Z", "invalid"])("rejects invalid or timestamp form date %s", value => {
    expect(workforcePolicyRestoreDateKey(value)).toBe(false)
  })
  it("accepts a real leap day without inventing the organization's current date", () => {
    expect(workforcePolicyRestoreDateKey("2028-02-29")).toBe(true)
  })
})
