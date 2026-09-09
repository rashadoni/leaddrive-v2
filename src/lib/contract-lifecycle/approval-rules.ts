/**
 * Conditional Approval Routing — CLM Slice 3b.
 *
 * Two pure functions (no Prisma dependency) that implement the rule-engine:
 *
 *   evaluateRuleConditions(rule, contract) → boolean
 *     Evaluates the rule's JSON conditions against a contract's attributes
 *     and returns true if the rule's match criteria are met.
 *
 *   applyApprovalRules(baseStages, rules, contract) → StageSpec[]
 *     Applies all matching rules (in creation order) to a base stage list,
 *     inserting or removing stages, then renumbers order 1..N contiguously.
 *     Throws ApprovalRulesCapError if the final stage count exceeds MAX_STAGES.
 *
 * Both functions are intentionally free of side effects so they can be
 * unit-tested without a DB or HTTP context.
 */

import { Prisma } from "@prisma/client"

// ─── Constants ────────────────────────────────────────────────────────────────

/** Hard cap on total stages after rule application. */
export const MAX_STAGES = 10

/** Sentinel error thrown when the cap is exceeded. */
export class ApprovalRulesCapError extends Error {
  constructor(public readonly count: number) {
    super(
      `Approval stage cap exceeded: ${count} stages after rule application (max ${MAX_STAGES}). ` +
        "Reduce the number of add_stage actions or the base stage count.",
    )
    this.name = "ApprovalRulesCapError"
  }
}

// ─── Domain types ─────────────────────────────────────────────────────────────

/** Supported contract fields that can be referenced in conditions. */
export type ConditionField = "value" | "type" | "currency"

/** Operators the condition engine understands. */
export type ConditionOperator = "gte" | "lte" | "gt" | "lt" | "eq" | "neq" | "in"

/** A single condition within a rule. */
export interface RuleCondition {
  field: ConditionField
  operator: ConditionOperator
  /** number for value comparisons; string for eq/neq; string[] for "in". */
  value: number | string | string[]
}

/** A minimal view of a ContractApprovalRule as stored in DB (conditions is Json). */
export interface ApprovalRuleInput {
  id: string
  conditions: unknown // parsed from Json — may be any shape; we validate at runtime
  matchLogic: string // "all" | "any"
  createdAt: Date
  actions: ApprovalRuleActionInput[]
}

/** A minimal view of a ContractApprovalRuleAction. */
export interface ApprovalRuleActionInput {
  actionType: string // "add_stage" | "skip_stage"
  stageLabel: string | null
  assigneeUserId: string | null
  assigneeRole: string | null
  atPosition: number | null
  sortOrder: number
}

/** A stage in the approval chain (input or output of applyApprovalRules). */
export interface StageSpec {
  label: string
  assigneeUserId?: string | null
  assigneeRole?: string | null
  /** SLA for this stage in hours. Carried through rule application unchanged. */
  slaHours?: number | null
}

/** The contract attributes the rule engine needs to evaluate conditions. */
export interface ContractForRuleEval {
  valueAmount?: Prisma.Decimal | null
  type: string
  currency: string
}

// ─── evaluateRuleConditions ───────────────────────────────────────────────────

/**
 * Evaluate all conditions in a rule against a contract and return true if
 * the rule's match criteria (all / any) are satisfied.
 *
 * Fail-safe behaviour:
 *   - Non-array / fundamentally malformed `conditions` → rule is NON-MATCHING
 *     (returns false). An explicit validated empty `[]` keeps vacuous-true
 *     for "always add stage" rules authored via CRUD (which now requires ≥1 entry).
 *   - Unknown field or operator → individual condition evaluates false.
 */
export function evaluateRuleConditions(
  rule: Pick<ApprovalRuleInput, "conditions" | "matchLogic">,
  contract: ContractForRuleEval,
): boolean {
  // FIX 4: A non-array at the top level means the DB row is malformed.
  // Distinguish from an explicit empty array: non-array → fail closed (false).
  if (!Array.isArray(rule.conditions)) return false

  const conditions = parseConditions(rule.conditions)

  // If the RAW conditions array was non-empty but ALL entries were invalid (e.g.
  // ["garbage"] or [{bad:1}]) → parseConditions filtered them all out → fail closed.
  // Only an explicitly empty raw array [] may be vacuous-true (legacy "always match"
  // rows that pre-date the CRUD ≥1 condition requirement).
  if (conditions.length === 0 && rule.conditions.length > 0) return false

  // Empty validated array from an explicitly empty raw array → vacuous true.
  // Note: CRUD now requires ≥1 condition, so this path only occurs for legacy rows.
  if (conditions.length === 0) return true

  const results = conditions.map((cond) => evaluateSingleCondition(cond, contract))

  return rule.matchLogic === "any" ? results.some(Boolean) : results.every(Boolean)
}

function evaluateSingleCondition(
  cond: RuleCondition,
  contract: ContractForRuleEval,
): boolean {
  const { field, operator, value: condValue } = cond

  // Unknown operator → fail-safe false (checked first — prevents accidentally matching)
  const VALID_OPERATORS: ConditionOperator[] = ["gte", "lte", "gt", "lt", "eq", "neq", "in"]
  if (!VALID_OPERATORS.includes(operator)) return false

  // Resolve the contract attribute for the field.
  // FIX 5: for numeric comparisons, keep valueAmount as Prisma.Decimal and compare
  // via Decimal arithmetic to avoid JS float precision loss on large values.
  if (field === "value") {
    if (contract.valueAmount == null) {
      // Null attribute: only "neq" passes.
      return operator === "neq"
    }

    // Numeric operators: coerce condValue to Decimal for precision-safe comparison.
    if (["gte", "lte", "gt", "lt"].includes(operator)) {
      if (typeof condValue !== "number" && typeof condValue !== "string") return false
      let threshold: Prisma.Decimal
      try {
        threshold = new Prisma.Decimal(condValue)
      } catch {
        return false
      }
      const amount = contract.valueAmount
      switch (operator) {
        case "gte": return amount.gte(threshold)
        case "lte": return amount.lte(threshold)
        case "gt":  return amount.gt(threshold)
        case "lt":  return amount.lt(threshold)
        default:    return false
      }
    }

    // eq/neq/in: compare as string representation for Decimal fields.
    const amountStr = contract.valueAmount.toString()
    switch (operator) {
      case "eq":  return amountStr === String(condValue)
      case "neq": return amountStr !== String(condValue)
      case "in":
        if (!Array.isArray(condValue)) return false
        return condValue.includes(amountStr)
      default: return false
    }
  }

  // String fields: type and currency.
  let contractValue: string | null = null
  if (field === "type") {
    contractValue = contract.type
  } else if (field === "currency") {
    contractValue = contract.currency
  } else {
    // Unknown field → fail-safe false
    return false
  }

  if (contractValue === null) {
    // Null attribute: only "neq" passes (null is not equal to anything).
    return operator === "neq"
  }

  switch (operator) {
    case "eq":  return contractValue === condValue
    case "neq": return contractValue !== condValue
    case "in":
      if (!Array.isArray(condValue)) return false
      return condValue.includes(String(contractValue))
    case "gte":
    case "lte":
    case "gt":
    case "lt":
      // Numeric operators don't apply to string fields → fail-safe false.
      return false
    default:
      // Unknown operator → fail-safe false
      return false
  }
}

// ─── applyApprovalRules ───────────────────────────────────────────────────────

/**
 * Apply a list of active ContractApprovalRules to the base stage list.
 *
 * Execution order: rules sorted by createdAt ascending (oldest first), then
 * by id as tiebreaker for determinism. Within a rule, actions are applied
 * in sortOrder ascending.
 *
 * add_stage: inserts a stage at atPosition (1-based, clamped to [1, N+1]);
 *            null atPosition → append.
 * skip_stage: removes ALL stages whose label === stageLabel (case-sensitive).
 *
 * After all rules, stages are renumbered 1..N contiguously.
 *
 * @throws {ApprovalRulesCapError} when the result would exceed MAX_STAGES.
 */
export function applyApprovalRules(
  baseStages: StageSpec[],
  rules: ApprovalRuleInput[],
  contract: ContractForRuleEval,
): StageSpec[] {
  // Work on a mutable copy.
  let stages: StageSpec[] = [...baseStages]

  // Sort rules: oldest first (createdAt asc), then id as tiebreaker.
  const sortedRules = [...rules].sort((a, b) => {
    const dt = a.createdAt.getTime() - b.createdAt.getTime()
    return dt !== 0 ? dt : a.id.localeCompare(b.id)
  })

  for (const rule of sortedRules) {
    if (!evaluateRuleConditions(rule, contract)) continue

    // Sort actions by sortOrder asc.
    const actions = [...rule.actions].sort((a, b) => a.sortOrder - b.sortOrder)

    for (const action of actions) {
      if (action.actionType === "add_stage") {
        const newStage: StageSpec = {
          label: action.stageLabel ?? "Approval",
          assigneeUserId: action.assigneeUserId ?? null,
          assigneeRole: action.assigneeRole ?? null,
        }

        if (action.atPosition == null) {
          // Append
          stages.push(newStage)
        } else {
          // Insert at 1-based position, clamped to valid range [1, stages.length+1].
          const idx = Math.max(0, Math.min(action.atPosition - 1, stages.length))
          stages.splice(idx, 0, newStage)
        }
      } else if (action.actionType === "skip_stage") {
        if (action.stageLabel) {
          stages = stages.filter((s) => s.label !== action.stageLabel)
        }
      }
      // Unknown actionType → silently skip (fail-safe).
    }
  }

  // Cap check before renumbering.
  if (stages.length > MAX_STAGES) {
    throw new ApprovalRulesCapError(stages.length)
  }

  // Return stages as plain StageSpec (order is implicit — callers assign 1..N).
  return stages
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Parse the raw Json `conditions` field into a loose shape list.
 * We do NOT filter out invalid field/operator combinations here — instead we
 * let `evaluateSingleCondition` return false for them so the overall rule
 * fails rather than vacuously succeeding.
 */
function parseConditions(raw: unknown): RuleCondition[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
    .map(
      (c) =>
        ({
          field: c.field,
          operator: c.operator,
          value: c.value,
        }) as RuleCondition,
    )
}
