/**
 * Validation engine — declarative formula-based rules.
 *
 * Salesforce-style: a `FormulaValidationRule` carries a formula condition.
 * If the formula evaluates **truthy**, the rule fails — meaning save is
 * blocked (severity=error) or warned (severity=warning). Same convention
 * as Salesforce — the condition expresses what's WRONG, not what's right.
 *
 * Examples:
 *   condition: `{budget} < 0`               errorMessage: "Budget cannot be negative"
 *   condition: `ISBLANK({email})`           errorMessage: "Email required"
 *   condition: `{closeDate} < TODAY()`      errorMessage: "Close date must be in the future"
 *
 * Engine is pure synchronous — accepts the rules array + a record object,
 * returns violations. No Prisma, no I/O.
 *
 * Part of N5 Validation rules (Phase 2 roadmap, slice 1).
 */
import { evaluateFormulaStrict, FormulaError, type FormulaValue } from "@/lib/formula"

export type RuleSeverity = "error" | "warning"

export interface ValidationRuleInput {
  id: string
  name: string
  entityType: string
  condition: string
  errorField?: string | null
  errorMessage: string
  severity: RuleSeverity
  isActive: boolean
}

export interface ValidationViolation {
  ruleId: string
  ruleName: string
  errorField?: string | null
  errorMessage: string
  severity: RuleSeverity
  /** When the formula itself was malformed; rule treated as a "system error". */
  systemError?: boolean
}

export interface EvaluateRulesResult {
  /** Hard failures — severity=error AND condition truthy. Block save. */
  errors: ValidationViolation[]
  /** Soft failures — severity=warning AND condition truthy. Allow save. */
  warnings: ValidationViolation[]
  /** Rules whose formula threw at evaluate-time. Surface to admin, never block user. */
  systemErrors: ValidationViolation[]
}

/**
 * Coerce arbitrary record-shaped object into the formula `fields` context.
 * Drops nested objects (arrays, embedded relations) for slice 1 — formulas
 * can only reference scalar fields. Slice 3 will resolve relation lookups
 * via `LOOKUP({contact}, "email")` once relation pre-resolution lands.
 *
 * Exported so caller tests can verify the coercion shape.
 */
export function recordToContext(record: Record<string, unknown>): Record<string, FormulaValue> {
  const fields: Record<string, FormulaValue> = {}
  for (const [k, v] of Object.entries(record)) {
    if (v === null || v === undefined) {
      fields[k] = null
    } else if (typeof v === "number" && Number.isFinite(v)) {
      fields[k] = v
    } else if (typeof v === "string") {
      fields[k] = v
    } else if (typeof v === "boolean") {
      fields[k] = v
    } else if (v instanceof Date) {
      fields[k] = v
    }
    // Skip arrays / nested objects / functions / NaN / Infinity — undefined
    // is the safest default; formulas using a missing field get null.
  }
  return fields
}

/**
 * Run all active rules for the given entityType against a record.
 * Pure; caller fetches `rules` from Prisma and `record` from the request.
 *
 * @param now - reference moment for TODAY()/NOW() in the formula. Tests
 *   inject a fixed clock; production omits this.
 */
export function evaluateRules(
  rules: ValidationRuleInput[],
  record: Record<string, unknown>,
  now?: Date
): EvaluateRulesResult {
  const result: EvaluateRulesResult = { errors: [], warnings: [], systemErrors: [] }
  const ctx = { fields: recordToContext(record), now }

  for (const rule of rules) {
    if (!rule.isActive) continue

    let conditionResult: FormulaValue
    try {
      conditionResult = evaluateFormulaStrict(rule.condition, ctx)
    } catch (e) {
      // Malformed rule — admin's bug, never block the end user.
      const message = e instanceof FormulaError
        ? `Validation rule '${rule.name}' has a broken formula: ${e.message}`
        : `Validation rule '${rule.name}' threw an unexpected error`
      result.systemErrors.push({
        ruleId: rule.id,
        ruleName: rule.name,
        errorField: rule.errorField,
        errorMessage: message,
        severity: rule.severity,
        systemError: true,
      })
      continue
    }

    if (isTruthy(conditionResult)) {
      const violation: ValidationViolation = {
        ruleId: rule.id,
        ruleName: rule.name,
        errorField: rule.errorField,
        errorMessage: rule.errorMessage,
        severity: rule.severity,
      }
      if (rule.severity === "error") {
        result.errors.push(violation)
      } else {
        result.warnings.push(violation)
      }
    }
  }

  return result
}

/**
 * Truthy semantics matched to formula engine's:
 *   - false, null, 0, ""  → false
 *   - anything else (incl. Date) → true
 */
function isTruthy(v: FormulaValue): boolean {
  if (v === null) return false
  if (v === false) return false
  if (v === 0) return false
  if (v === "") return false
  return true
}
