import { describe, expect, it } from "vitest"
import {
  WORKFORCE_EXCEPTION_DRAFT_POLICY_VERSION,
  WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_V1,
} from "@/lib/workforce/exception-policy-draft"
import {
  WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_HASH_V1,
  resolveWorkforceExceptionPolicyDraftRevision,
  type WorkforceExceptionPolicyRevisionRecord,
} from "@/lib/workforce/exception-policy-revision"
import { workforcePolicyDefinitionHash } from "@/lib/workforce/policy-definition"

function revision(
  overrides: Partial<WorkforceExceptionPolicyRevisionRecord> = {},
): WorkforceExceptionPolicyRevisionRecord {
  return {
    id: "policy-revision-1",
    organizationId: "org-policy-proof",
    revision: 1,
    operationId: "policy-revision-operation-1",
    policyVersion: WORKFORCE_EXCEPTION_DRAFT_POLICY_VERSION,
    definition: WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_V1,
    definitionHash: WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_HASH_V1,
    recordedByUserId: "user-policy-owner",
    recordReasonCode: "OWNER_APPROVED_DRAFT",
    createdAt: new Date("2026-09-27T05:00:00.000Z"),
    ...overrides,
  }
}

describe("Workforce exception policy revision resolver", () => {
  it("pins the exact owner-approved recommended-v1 definition hash", () => {
    expect(workforcePolicyDefinitionHash(WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_V1))
      .toBe(WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_HASH_V1)
    expect(WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_V1.activation)
      .toBe("DRAFT_ONLY_NO_TENANT_EFFECT")
  })

  it("keeps an empty tenant revision stream unavailable", () => {
    expect(resolveWorkforceExceptionPolicyDraftRevision([])).toEqual({
      status: "UNAVAILABLE",
      code: "WORKFORCE_EXCEPTION_POLICY_REVISION_MISSING",
    })
  })

  it("returns only the latest exact, contiguous draft revision", () => {
    const result = resolveWorkforceExceptionPolicyDraftRevision([
      revision(),
      revision({
        id: "policy-revision-2",
        revision: 2,
        operationId: "policy-revision-operation-2",
        recordReasonCode: "TENANT_RECORDED_DRAFT",
        createdAt: new Date("2026-09-27T05:01:00.000Z"),
      }),
    ])

    expect(result).toEqual({
      status: "VALID_DRAFT",
      revisionId: "policy-revision-2",
      organizationId: "org-policy-proof",
      revision: 2,
      policyVersion: "recommended-v1",
      definitionHash: WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_HASH_V1,
      definition: WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_V1,
    })
  })

  it.each([
    ["gap", [revision({ revision: 2 })]],
    ["mixed tenant", [revision(), revision({
      id: "policy-revision-2",
      organizationId: "org-other",
      revision: 2,
      operationId: "policy-revision-operation-2",
    })]],
    ["duplicate id", [revision(), revision({
      revision: 2,
      operationId: "policy-revision-operation-2",
    })]],
    ["duplicate operation", [revision(), revision({
      id: "policy-revision-2",
      revision: 2,
    })]],
    ["invalid reason", [revision({ recordReasonCode: "free text" })]],
    ["invalid actor", [revision({ recordedByUserId: " " })]],
    ["invalid timestamp", [revision({ createdAt: new Date("invalid") })]],
    ["malformed row", [revision(), null as never]],
  ])("fails closed for an invalid %s stream", (_label, records) => {
    expect(resolveWorkforceExceptionPolicyDraftRevision(records)).toEqual({
      status: "INVALID",
      code: "WORKFORCE_EXCEPTION_POLICY_REVISION_STREAM_INVALID",
    })
  })

  it.each([
    ["unknown version", revision({ policyVersion: "recommended-v2" })],
    ["unknown hash", revision({ definitionHash: "0".repeat(64) })],
    ["non-canonical hash case", revision({
      definitionHash: WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_HASH_V1.toUpperCase(),
    })],
    ["modified definition", revision({
      definition: {
        ...WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_V1,
        automatedOutcomes: "ALLOWED",
      },
    })],
  ])("fails closed for an unsupported %s", (_label, record) => {
    expect(resolveWorkforceExceptionPolicyDraftRevision([record])).toEqual({
      status: "INVALID",
      code: "WORKFORCE_EXCEPTION_POLICY_REVISION_UNSUPPORTED",
    })
  })
})
