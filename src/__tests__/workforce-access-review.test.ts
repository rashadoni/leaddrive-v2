import { describe, expect, it } from "vitest"
import {
  reviewWorkforceAccess,
  WorkforceAccessReviewError,
  type WorkforceAccessReviewGrant,
} from "@/lib/workforce/access-review"

const NOW = new Date("2026-09-13T12:00:00.000Z")

function grant(
  id: string,
  overrides: Partial<WorkforceAccessReviewGrant> = {},
): WorkforceAccessReviewGrant {
  return {
    id,
    organizationId: "org-1",
    principalUserId: "user-1",
    role: "HR_ADMIN",
    scope: { kind: "ORGANIZATION" },
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveUntil: null,
    revokedAt: null,
    principalState: "ACTIVE",
    ...overrides,
  }
}

describe("Workforce access review", () => {
  it("attributes freshness to the exact grant and never auto-revokes", () => {
    const result = reviewWorkforceAccess({
      organizationId: "org-1",
      now: NOW,
      grants: [grant("grant-used"), grant("grant-stale")],
      actions: [{ grantId: "grant-used", occurredAt: new Date("2026-09-12T12:00:00.000Z") }],
    })

    expect(result).toMatchObject({
      grantsExamined: 2,
      actionsExamined: 1,
      activityEvidence: "COMPLETE",
      findingCounts: { STALE_PRIVILEGED_ASSIGNMENT: 1 },
      automaticAction: "NONE",
      nextAction: "ACCOUNTABLE_HUMAN_REVIEW",
    })
    expect(result.findings).toEqual([
      { grantId: "grant-stale", codes: ["STALE_PRIVILEGED_ASSIGNMENT"] },
    ])
  })

  it("does not label grants stale when exact-grant activity evidence is unavailable", () => {
    const result = reviewWorkforceAccess({
      organizationId: "org-1",
      now: NOW,
      grants: [grant("grant-without-usage-ledger")],
      actions: [],
      activityEvidenceComplete: false,
    })

    expect(result.activityEvidence).toBe("UNAVAILABLE")
    expect(result.findings).toEqual([])
    expect(result.findingCounts.STALE_PRIVILEGED_ASSIGNMENT).toBeUndefined()
  })

  it("finds inactive principals, expired rows and actions outside the grant window", () => {
    const expired = grant("grant-expired", {
      principalState: "INACTIVE",
      effectiveUntil: new Date("2026-08-01T00:00:00.000Z"),
    })
    const result = reviewWorkforceAccess({
      organizationId: "org-1",
      now: NOW,
      grants: [expired],
      actions: [{ grantId: expired.id, occurredAt: new Date("2026-08-02T00:00:00.000Z") }],
    })

    expect(result.findings[0]).toEqual({
      grantId: expired.id,
      codes: [
        "EXPIRED_UNREVOKED",
        "PRINCIPAL_INACTIVE",
        "ACTION_OUTSIDE_GRANT_WINDOW",
      ],
    })
  })

  it("reports both sides of an incompatible active role pair", () => {
    const result = reviewWorkforceAccess({
      organizationId: "org-1",
      now: NOW,
      grants: [
        grant("grant-scheduler", { role: "SCHEDULER" }),
        grant("grant-approver", { role: "TIME_APPROVER" }),
      ],
      actions: [
        { grantId: "grant-scheduler", occurredAt: new Date("2026-09-12T00:00:00.000Z") },
        { grantId: "grant-approver", occurredAt: new Date("2026-09-12T00:00:00.000Z") },
      ],
    })

    expect(result.findingCounts).toEqual({ INCOMPATIBLE_ACTIVE_ROLES: 2 })
    expect(result.findings.map((item) => item.grantId)).toEqual([
      "grant-scheduler",
      "grant-approver",
    ])
  })

  it("fails closed on cross-tenant activity and unbounded input", () => {
    expect(() => reviewWorkforceAccess({
      organizationId: "org-1",
      now: NOW,
      grants: [grant("foreign", { organizationId: "org-2" })],
      actions: [],
    })).toThrowError(new WorkforceAccessReviewError("WORKFORCE_ACCESS_REVIEW_SCOPE_MISMATCH"))

    expect(() => reviewWorkforceAccess({
      organizationId: "org-1",
      now: NOW,
      grants: Array.from({ length: 1_001 }, (_, index) => grant(`grant-${index}`)),
      actions: [],
    })).toThrowError(new WorkforceAccessReviewError("WORKFORCE_ACCESS_REVIEW_LIMIT_EXCEEDED"))
  })
})
