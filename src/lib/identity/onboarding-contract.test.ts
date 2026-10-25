import { describe, expect, it } from "vitest"
import { IdentityOnboardingInput } from "./onboarding-contract"
const plan = { application: "TIME", role: "EMPLOYEE", status: "ACTIVE", grantVersion: 1,
  actorId: "reviewed-time-card", membershipVersion: 1, membershipStatus: "ACTIVE" }
const review = { userId: "reviewed-person", phone: "+994507770099", application: "TIME", expectedAccountVersion: 4,
  expectedCredentialEpoch: 1, expectedContactRevision: 1, applications: [plan], reviewReference: "explicit-review", requestId: "review-request" }

describe("first-login review boundary", () => {
  it("requires an existing reviewed mobile membership for the requested application", () => {
    expect(IdentityOnboardingInput.safeParse(review).success).toBe(true)
    for (const applications of [[], [{ ...plan, application: "ROUTE_FIELD", role: "AGENT" }], [{ ...plan, status: "REVOKED" }],
      [{ ...plan, actorId: null }], [{ ...plan, membershipStatus: "REVOKED" }], [plan, plan]]) {
      expect(IdentityOnboardingInput.safeParse({ ...review, applications }).success).toBe(false)
    }
  })
  it("requires explicit immutable HR metadata when adding Time during Field cutover", () => {
    const fieldPlan = { ...plan, application: "ROUTE_FIELD", role: "AGENT", actorId: "reviewed-field-card" }
    const timeEnrollment = { position: "Analyst", teamId: null, departmentId: null, hireDate: "2026-10-25" }
    const upgrade = { ...review, applications: [fieldPlan], timeEnrollment }
    expect(IdentityOnboardingInput.safeParse(upgrade).success).toBe(true)
    for (const candidate of [{ ...upgrade, timeEnrollment: undefined }, { ...upgrade, application: "ROUTE_FIELD" },
      { ...upgrade, applications: [plan] }, { ...upgrade, timeEnrollment: { ...timeEnrollment, password: "forbidden" } },
      { ...upgrade, timeEnrollment: { ...timeEnrollment, departmentId: "existing", newDepartmentName: "new" } }]) {
      expect(IdentityOnboardingInput.safeParse(candidate).success).toBe(false)
    }
  })
  it.each(["organizationId", "password", "issuerAuthority", "cutoverAt", "expiresAt"])("does not admit caller-owned %s", field => {
    expect(IdentityOnboardingInput.safeParse({ ...review, [field]: "forged" }).success).toBe(false)
  })
  it("requires all lifecycle revisions and rejects implicit membership fields", () => {
    for (const field of ["expectedAccountVersion", "expectedCredentialEpoch", "expectedContactRevision"]) {
      for (const value of [undefined, 0, -1, 1.5, 2_147_483_647]) expect(IdentityOnboardingInput.safeParse({ ...review, [field]: value }).success).toBe(false)
    }
    expect(IdentityOnboardingInput.safeParse({ ...review, applications: [{ ...plan, membershipVersion: undefined }] }).success).toBe(false)
  })
})
