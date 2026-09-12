import { createHash } from "node:crypto"
import { z } from "zod"
import { isDateKey } from "@/lib/mtm/mobile-week"

const WorkforceDateKeySchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .refine(isDateKey, "Date must be a real calendar date")
const WorkforceTimestampSchema = z.string().datetime({ offset: true })
const WorkforcePositiveSecondsSchema = z.number().int().min(1).max(24 * 60 * 60)

/**
 * The rule set is deliberately supplied by a tenant-approved policy snapshot.
 * This contract has no hidden default: an absent, expired or ambiguous policy
 * routes a manager correction to review instead of guessing employment rules.
 */
export const WorkforceCorrectionBoundsPolicySchema = z.object({
  version: z.string().trim().min(1).max(80),
  effectiveFrom: WorkforceDateKeySchema,
  effectiveTo: WorkforceDateKeySchema.nullable(),
  directCorrectionWindowDays: z.number().int().min(0).max(366),
  maximumWorkdayDurationSeconds: WorkforcePositiveSecondsSchema,
  maximumBoundaryChangeSeconds: z.number().int().min(0).max(24 * 60 * 60),
}).strict().superRefine((value, context) => {
  if (value.effectiveTo != null && value.effectiveTo < value.effectiveFrom) {
    context.addIssue({
      code: "custom",
      path: ["effectiveTo"],
      message: "effectiveTo must not be earlier than effectiveFrom",
    })
  }
})

export type WorkforceCorrectionBoundsPolicy = z.infer<typeof WorkforceCorrectionBoundsPolicySchema>

export const WorkforceCorrectionBoundsAssessmentInputSchema = z.object({
  policy: WorkforceCorrectionBoundsPolicySchema.nullable(),
  workDate: WorkforceDateKeySchema,
  /** The organization-local date supplied by the policy resolver, never a phone clock. */
  evaluationDate: WorkforceDateKeySchema,
  periodState: z.enum(["OPEN", "CLOSED", "UNKNOWN"]),
  currentStartedAt: WorkforceTimestampSchema,
  currentCompletedAt: WorkforceTimestampSchema,
  desiredStartedAt: WorkforceTimestampSchema,
  desiredCompletedAt: WorkforceTimestampSchema,
}).strict().superRefine((value, context) => {
  if (new Date(value.currentCompletedAt).getTime() <= new Date(value.currentStartedAt).getTime()) {
    context.addIssue({
      code: "custom",
      path: ["currentCompletedAt"],
      message: "Current workday must have a positive duration",
    })
  }
  if (new Date(value.desiredCompletedAt).getTime() <= new Date(value.desiredStartedAt).getTime()) {
    context.addIssue({
      code: "custom",
      path: ["desiredCompletedAt"],
      message: "Corrected workday must have a positive duration",
    })
  }
})

export type WorkforceCorrectionBoundsAssessmentInput = z.infer<typeof WorkforceCorrectionBoundsAssessmentInputSchema>

export type WorkforceCorrectionBoundsAssessment = {
  disposition: "DIRECT_ALLOWED" | "REVIEW_REQUIRED"
  code:
    | "WORKFORCE_TIME_CORRECTION_WITHIN_POLICY"
    | "WORKFORCE_TIME_CORRECTION_POLICY_UNCONFIGURED"
    | "WORKFORCE_TIME_CORRECTION_POLICY_NOT_EFFECTIVE"
    | "WORKFORCE_TIME_CORRECTION_PERIOD_NOT_OPEN"
    | "WORKFORCE_TIME_CORRECTION_OUTSIDE_WINDOW"
    | "WORKFORCE_TIME_CORRECTION_DURATION_REVIEW"
    | "WORKFORCE_TIME_CORRECTION_BOUNDARY_REVIEW"
  policy: { version: string; hash: string } | null
  ageDays: number
  desiredDurationSeconds: number
  maximumBoundaryDeltaSeconds: number
}

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

function dateDifferenceDays(start: string, end: string): number {
  return Math.round((utcDate(end).getTime() - utcDate(start).getTime()) / (24 * 60 * 60 * 1000))
}

function canonicalPolicy(policy: WorkforceCorrectionBoundsPolicy): string {
  return JSON.stringify({
    version: policy.version,
    effectiveFrom: policy.effectiveFrom,
    effectiveTo: policy.effectiveTo,
    directCorrectionWindowDays: policy.directCorrectionWindowDays,
    maximumWorkdayDurationSeconds: policy.maximumWorkdayDurationSeconds,
    maximumBoundaryChangeSeconds: policy.maximumBoundaryChangeSeconds,
  })
}

export function workforceCorrectionBoundsPolicyHash(policy: WorkforceCorrectionBoundsPolicy): string {
  const parsed = WorkforceCorrectionBoundsPolicySchema.parse(policy)
  return createHash("sha256").update(canonicalPolicy(parsed)).digest("hex")
}

function review(
  code: Exclude<WorkforceCorrectionBoundsAssessment["code"], "WORKFORCE_TIME_CORRECTION_WITHIN_POLICY">,
  values: Omit<WorkforceCorrectionBoundsAssessment, "disposition" | "code">,
): WorkforceCorrectionBoundsAssessment {
  return { disposition: "REVIEW_REQUIRED", code, ...values }
}

/**
 * Evaluates the policy only. It never writes a correction, decides an appeal,
 * changes an approval revision or interprets a reason. Callers must persist
 * this assessment's policy version/hash beside a later human decision.
 */
export function assessWorkforceCorrectionBounds(
  input: WorkforceCorrectionBoundsAssessmentInput,
): WorkforceCorrectionBoundsAssessment {
  const parsed = WorkforceCorrectionBoundsAssessmentInputSchema.parse(input)
  const currentStartedAt = new Date(parsed.currentStartedAt).getTime()
  const currentCompletedAt = new Date(parsed.currentCompletedAt).getTime()
  const desiredStartedAt = new Date(parsed.desiredStartedAt).getTime()
  const desiredCompletedAt = new Date(parsed.desiredCompletedAt).getTime()
  const ageDays = dateDifferenceDays(parsed.workDate, parsed.evaluationDate)
  const desiredDurationSeconds = (desiredCompletedAt - desiredStartedAt) / 1000
  const maximumBoundaryDeltaSeconds = Math.max(
    Math.abs(desiredStartedAt - currentStartedAt) / 1000,
    Math.abs(desiredCompletedAt - currentCompletedAt) / 1000,
  )

  if (parsed.policy == null) {
    return review("WORKFORCE_TIME_CORRECTION_POLICY_UNCONFIGURED", {
      policy: null,
      ageDays,
      desiredDurationSeconds,
      maximumBoundaryDeltaSeconds,
    })
  }

  const policy = parsed.policy
  const policyReference = { version: policy.version, hash: workforceCorrectionBoundsPolicyHash(policy) }
  const resultValues = { policy: policyReference, ageDays, desiredDurationSeconds, maximumBoundaryDeltaSeconds }
  if (parsed.workDate < policy.effectiveFrom || (policy.effectiveTo != null && parsed.workDate > policy.effectiveTo)) {
    return review("WORKFORCE_TIME_CORRECTION_POLICY_NOT_EFFECTIVE", resultValues)
  }
  if (parsed.periodState !== "OPEN") {
    return review("WORKFORCE_TIME_CORRECTION_PERIOD_NOT_OPEN", resultValues)
  }
  if (ageDays < 0 || ageDays > policy.directCorrectionWindowDays) {
    return review("WORKFORCE_TIME_CORRECTION_OUTSIDE_WINDOW", resultValues)
  }
  if (desiredDurationSeconds > policy.maximumWorkdayDurationSeconds) {
    return review("WORKFORCE_TIME_CORRECTION_DURATION_REVIEW", resultValues)
  }
  if (maximumBoundaryDeltaSeconds > policy.maximumBoundaryChangeSeconds) {
    return review("WORKFORCE_TIME_CORRECTION_BOUNDARY_REVIEW", resultValues)
  }
  return {
    disposition: "DIRECT_ALLOWED",
    code: "WORKFORCE_TIME_CORRECTION_WITHIN_POLICY",
    ...resultValues,
  }
}
