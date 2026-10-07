import { decideWorkforceAccess, type WorkforceAccessGrant, type WorkforceResourceScope } from "@/lib/workforce/access-control"

/** Explicit human findings; attendance corrections never manufacture these. */
export const WORKFORCE_EXCEPTION_OUTCOME_DECISIONS = [
  "CLASSIFY_FALSE_POSITIVE",
  "CLASSIFY_CONFIRMED_EXCEPTION",
  "APPEAL_FULLY_UPHELD",
  "APPEAL_PARTIALLY_UPHELD",
  "APPEAL_REJECTED",
] as const
export type WorkforceExceptionOutcomeDecision = typeof WORKFORCE_EXCEPTION_OUTCOME_DECISIONS[number]

export function isWorkforceExceptionOutcomeDecision(code: string): code is WorkforceExceptionOutcomeDecision {
  return (WORKFORCE_EXCEPTION_OUTCOME_DECISIONS as readonly string[]).includes(code)
}

export function workforceExceptionOutcomeDimension(code: WorkforceExceptionOutcomeDecision): "classification" | "appeal" {
  return code.startsWith("CLASSIFY_") ? "classification" : "appeal"
}

/** Caller must first validate the complete, bounded lifecycle/revision stream. */
export function currentWorkforceExceptionOutcomes(decisions: readonly { decisionCode: string }[]): {
  classification: "FALSE_POSITIVE" | "CONFIRMED_EXCEPTION" | null
  appeal: "FULLY_UPHELD" | "PARTIALLY_UPHELD" | "REJECTED" | null
} {
  let classification: "FALSE_POSITIVE" | "CONFIRMED_EXCEPTION" | null = null
  let appeal: "FULLY_UPHELD" | "PARTIALLY_UPHELD" | "REJECTED" | null = null
  for (const { decisionCode } of decisions) {
    if (decisionCode === "REOPEN_FOR_REVIEW") { classification = null; appeal = null }
    if (decisionCode === "CLASSIFY_FALSE_POSITIVE") classification = "FALSE_POSITIVE"
    if (decisionCode === "CLASSIFY_CONFIRMED_EXCEPTION") classification = "CONFIRMED_EXCEPTION"
    if (decisionCode === "APPEAL_FULLY_UPHELD") appeal = "FULLY_UPHELD"
    if (decisionCode === "APPEAL_PARTIALLY_UPHELD") appeal = "PARTIALLY_UPHELD"
    if (decisionCode === "APPEAL_REJECTED") appeal = "REJECTED"
  }
  return { classification, appeal }
}

/** Preserve every existing role; only scoped, live HR_ADMIN grants qualify. */
export function canRecordWorkforceExceptionOutcome(input: {
  organizationId: string
  principalUserId: string
  resource: WorkforceResourceScope
  grants: readonly WorkforceAccessGrant[]
  now?: Date
}): boolean {
  return decideWorkforceAccess({
    ...input,
    selfAgentId: null,
    permission: "TEAM_EXCEPTION_DECIDE",
    grants: input.grants.filter((grant) => grant.role === "HR_ADMIN"),
  }).allowed
}
