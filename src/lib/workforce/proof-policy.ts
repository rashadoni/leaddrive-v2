import { z } from "zod"

const ACTIONS = ["START", "PAUSE", "RESUME", "FINISH"] as const
const SEGMENT_MODES = ["SITE", "REMOTE", "FIELD", "TRAVEL", "ON_CALL", "EXCEPTION"] as const
const PROOF_METHODS = ["LOCATION", "QR", "DEVICE", "KIOSK", "MANUAL"] as const

export const WorkforceProofActionSchema = z.enum(ACTIONS)
export const WorkforceProofSegmentModeSchema = z.enum(SEGMENT_MODES)
export const WorkforceProofMethodSchema = z.enum(PROOF_METHODS)

export type WorkforceProofAction = z.infer<typeof WorkforceProofActionSchema>
export type WorkforceProofSegmentMode = z.infer<typeof WorkforceProofSegmentModeSchema>
export type WorkforceProofMethod = z.infer<typeof WorkforceProofMethodSchema>

const MethodListSchema = z.array(WorkforceProofMethodSchema).max(PROOF_METHODS.length)
  .refine((methods) => new Set(methods).size === methods.length, "Proof methods must not repeat")

/** A fallback is an explainable next state, never an automatic proof bypass. */
export const WorkforceProofFallbackSchema = z.enum([
  "REVIEW_REQUIRED",
  "MANUAL_REQUEST",
  "KIOSK_OR_BADGE",
])

export const WorkforceProofRuleSchema = z.object({
  action: z.union([WorkforceProofActionSchema, z.literal("ANY")]),
  segmentMode: z.union([WorkforceProofSegmentModeSchema, z.literal("ANY")]),
  allOf: MethodListSchema,
  anyOf: MethodListSchema,
  optional: MethodListSchema,
  fallback: WorkforceProofFallbackSchema,
}).strict().superRefine((value, context) => {
  const groups: Array<[string, WorkforceProofMethod[]]> = [
    ["allOf", value.allOf],
    ["anyOf", value.anyOf],
    ["optional", value.optional],
  ]
  for (let left = 0; left < groups.length; left += 1) {
    for (let right = left + 1; right < groups.length; right += 1) {
      const duplicate = groups[left]![1].find((method) => groups[right]![1].includes(method))
      if (duplicate) {
        context.addIssue({
          code: "custom",
          message: `${duplicate} may appear in only one proof group`,
        })
      }
    }
  }
  if (value.allOf.length === 0 && value.anyOf.length === 0 && value.optional.length === 0) {
    context.addIssue({
      code: "custom",
      message: "A proof rule must declare a required or optional method explicitly",
    })
  }
  if (value.allOf.includes("MANUAL") || value.anyOf.includes("MANUAL")) {
    context.addIssue({
      code: "custom",
      message: "MANUAL is a reviewed fallback, never an automatically satisfied proof requirement",
    })
  }
})

export const WorkforceProofPolicySchema = z.object({
  policyVersion: z.literal("workforce-proof-policy-v1"),
  rules: z.array(WorkforceProofRuleSchema).min(1).max(64),
}).strict().superRefine((value, context) => {
  const seen = new Set<string>()
  for (const rule of value.rules) {
    const key = `${rule.segmentMode}:${rule.action}`
    if (seen.has(key)) {
      context.addIssue({ code: "custom", message: `Duplicate proof rule ${key}` })
    }
    seen.add(key)
  }
})

export type WorkforceProofRule = z.infer<typeof WorkforceProofRuleSchema>
export type WorkforceProofPolicy = z.infer<typeof WorkforceProofPolicySchema>

/**
 * Reversible baseline, not an enabled tenant policy. It makes the recommended
 * office flow explicit (`LOCATION` plus QR/kiosk), while remote/field/travel
 * do not imply location tracking. An authenticated time action remains an
 * upstream server prerequisite and is intentionally not represented as proof.
 */
export const WORKFORCE_PROOF_POLICY_BASELINE_V1: WorkforceProofPolicy = {
  policyVersion: "workforce-proof-policy-v1",
  rules: [
    {
      segmentMode: "SITE",
      action: "ANY",
      allOf: ["LOCATION"],
      anyOf: ["QR", "KIOSK"],
      optional: ["DEVICE"],
      fallback: "REVIEW_REQUIRED",
    },
    {
      segmentMode: "REMOTE",
      action: "ANY",
      allOf: [],
      anyOf: [],
      optional: ["DEVICE"],
      fallback: "REVIEW_REQUIRED",
    },
    {
      segmentMode: "FIELD",
      action: "ANY",
      allOf: [],
      anyOf: [],
      optional: ["LOCATION", "DEVICE"],
      fallback: "REVIEW_REQUIRED",
    },
    {
      segmentMode: "TRAVEL",
      action: "ANY",
      allOf: [],
      anyOf: [],
      optional: ["DEVICE"],
      fallback: "REVIEW_REQUIRED",
    },
    {
      segmentMode: "ON_CALL",
      action: "ANY",
      allOf: [],
      anyOf: [],
      optional: ["DEVICE"],
      fallback: "REVIEW_REQUIRED",
    },
    {
      segmentMode: "EXCEPTION",
      action: "ANY",
      allOf: [],
      anyOf: [],
      optional: ["MANUAL"],
      fallback: "MANUAL_REQUEST",
    },
  ],
}

export class WorkforceProofPolicyError extends Error {
  constructor(
    readonly code: "WORKFORCE_PROOF_POLICY_INVALID" | "WORKFORCE_PROOF_RULE_MISSING",
    message = code,
  ) {
    super(message)
  }
}

function ruleSpecificity(rule: WorkforceProofRule): number {
  return (rule.segmentMode === "ANY" ? 0 : 2) + (rule.action === "ANY" ? 0 : 1)
}

/** Resolves the most specific explicit action/mode rule; ties are prohibited. */
export function resolveWorkforceProofRule(input: {
  policy: WorkforceProofPolicy
  action: WorkforceProofAction
  segmentMode: WorkforceProofSegmentMode
}): WorkforceProofRule {
  const policy = WorkforceProofPolicySchema.safeParse(input.policy)
  if (!policy.success) {
    throw new WorkforceProofPolicyError(
      "WORKFORCE_PROOF_POLICY_INVALID",
      policy.error.issues[0]?.message ?? "Workforce proof policy is invalid",
    )
  }
  const matching = policy.data.rules
    .filter((rule) => (rule.action === "ANY" || rule.action === input.action)
      && (rule.segmentMode === "ANY" || rule.segmentMode === input.segmentMode))
    .sort((left, right) => ruleSpecificity(right) - ruleSpecificity(left))
  const rule = matching[0]
  if (!rule) {
    throw new WorkforceProofPolicyError(
      "WORKFORCE_PROOF_RULE_MISSING",
      `No Workforce proof rule exists for ${input.segmentMode}/${input.action}`,
    )
  }
  return rule
}

export type WorkforceProofEvaluation = {
  policyVersion: string
  status: "SATISFIED" | "REVIEW_REQUIRED"
  matchedRule: Pick<WorkforceProofRule, "action" | "segmentMode" | "allOf" | "anyOf" | "optional" | "fallback">
  suppliedMethods: WorkforceProofMethod[]
  missingAllOf: WorkforceProofMethod[]
  missingAnyOf: WorkforceProofMethod[]
}

/**
 * Determines whether supplied methods satisfy an explicit rule. `SATISFIED`
 * means only the configured proof combination is complete; callers still
 * need server auth, replay checks, policy snapshot and review safeguards.
 */
export function evaluateWorkforceProofMethods(input: {
  policy: WorkforceProofPolicy
  action: WorkforceProofAction
  segmentMode: WorkforceProofSegmentMode
  suppliedMethods: WorkforceProofMethod[]
}): WorkforceProofEvaluation {
  const suppliedMethods = MethodListSchema.parse(input.suppliedMethods)
  const rule = resolveWorkforceProofRule(input)
  const supplied = new Set(suppliedMethods)
  const missingAllOf = rule.allOf.filter((method) => !supplied.has(method))
  const missingAnyOf = rule.anyOf.length > 0 && !rule.anyOf.some((method) => supplied.has(method))
    ? [...rule.anyOf]
    : []

  return {
    policyVersion: input.policy.policyVersion,
    status: missingAllOf.length === 0 && missingAnyOf.length === 0 ? "SATISFIED" : "REVIEW_REQUIRED",
    matchedRule: {
      action: rule.action,
      segmentMode: rule.segmentMode,
      allOf: [...rule.allOf],
      anyOf: [...rule.anyOf],
      optional: [...rule.optional],
      fallback: rule.fallback,
    },
    suppliedMethods,
    missingAllOf,
    missingAnyOf,
  }
}
