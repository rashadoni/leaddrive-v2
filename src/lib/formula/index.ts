/**
 * Formula engine public API — N4 Formula fields (Phase 2).
 *
 * High-level helpers:
 *   - `evaluateFormula(source, context)` → result or null on error
 *   - `evaluateFormulaStrict(source, context)` → result, throws on error
 *   - `validateFormula(source)` → static check with type inference + refs
 *
 * Wiring this into the CustomField runtime (compute on read/write, cache
 * derived values, react to field changes) is slice 2.
 */
import { tokenize } from "./tokenizer"
import { parse } from "./parser"
import { evaluate } from "./evaluator"
import { BUILTIN_FUNCTIONS } from "./functions"

const KNOWN_FN_NAMES = new Set(Object.keys(BUILTIN_FUNCTIONS))
import {
  FormulaError,
  type AstNode,
  type EvaluationContext,
  type FormulaValue,
  type ValidationResult,
  type ValueType,
} from "./types"

/**
 * Strict evaluator — throws on parse / evaluation errors. Use when the
 * caller can present the error (e.g. settings UI live-preview).
 */
export function evaluateFormulaStrict(source: string, ctx: EvaluationContext): FormulaValue {
  const tokens = tokenize(source)
  const ast = parse(tokens)
  return evaluate(ast, ctx)
}

/**
 * Lenient evaluator — returns null on error and reports via the optional
 * `onError` callback. Use when computing derived field values where a
 * single bad row shouldn't blow up the whole list query.
 */
export function evaluateFormula(
  source: string,
  ctx: EvaluationContext,
  onError?: (err: FormulaError) => void
): FormulaValue {
  try {
    return evaluateFormulaStrict(source, ctx)
  } catch (e) {
    if (e instanceof FormulaError) {
      onError?.(e)
      return null
    }
    throw e // unexpected: rethrow
  }
}

/**
 * Validate a formula without evaluating. Returns:
 *   - valid flag
 *   - inferred return type (best-effort)
 *   - all field references the formula depends on
 *   - all function names called
 *
 * UI uses this for the formula-builder live preview to render the
 * "Depends on: {a}, {b}" hint and to detect circular references during
 * save (caller composes the dep-graph check; engine only reports refs).
 */
export function validateFormula(source: string): ValidationResult {
  try {
    const tokens = tokenize(source)
    const ast = parse(tokens)
    const fieldRefs: string[] = []
    const functionCalls: string[] = []
    collectRefs(ast, fieldRefs, functionCalls)
    const fnList = dedupe(functionCalls)
    const unknownFunctions = fnList.filter(n => !KNOWN_FN_NAMES.has(n))
    // Flag the result as invalid if any call references a non-existent function —
    // settings-UI live preview surfaces this without having to actually evaluate.
    if (unknownFunctions.length > 0) {
      return {
        valid: false,
        fieldRefs: dedupe(fieldRefs),
        functionCalls: fnList,
        unknownFunctions,
        error: {
          code: "unknown_function",
          message: `Unknown function(s): ${unknownFunctions.join(", ")}`,
        },
      }
    }
    return {
      valid: true,
      returnType: inferType(ast),
      fieldRefs: dedupe(fieldRefs),
      functionCalls: fnList,
      unknownFunctions: [],
    }
  } catch (e) {
    if (e instanceof FormulaError) {
      return {
        valid: false,
        fieldRefs: [],
        functionCalls: [],
        unknownFunctions: [],
        error: { code: e.code, message: e.message, pos: e.pos },
      }
    }
    throw e
  }
}

function collectRefs(ast: AstNode, fields: string[], funcs: string[]): void {
  switch (ast.kind) {
    case "literal": return
    case "field": fields.push(ast.name); return
    case "unary": collectRefs(ast.operand, fields, funcs); return
    case "binary":
      collectRefs(ast.left, fields, funcs)
      collectRefs(ast.right, fields, funcs)
      return
    case "call":
      funcs.push(ast.name)
      for (const a of ast.args) collectRefs(a, fields, funcs)
      return
  }
}

function inferType(ast: AstNode): ValueType {
  switch (ast.kind) {
    case "literal":
      if (ast.value === null) return "null"
      if (typeof ast.value === "number") return "number"
      if (typeof ast.value === "string") return "string"
      if (typeof ast.value === "boolean") return "boolean"
      if (ast.value instanceof Date) return "date"
      return "null"
    case "field":
      return "string" // best-effort; runtime determines actual type
    case "unary":
      return ast.op === "NOT" ? "boolean" : "number"
    case "binary": {
      const op = ast.op
      if (op === "&") return "string"
      if (op === "AND" || op === "OR" || op === "==" || op === "!=" ||
          op === "<" || op === "<=" || op === ">" || op === ">=") return "boolean"
      return "number"
    }
    case "call": {
      const name = ast.name
      // Quick lookup table for known function return types
      const stringFns = ["LEFT","RIGHT","MID","UPPER","LOWER","TRIM","SUBSTITUTE","CONCAT","TEXT"]
      const numberFns = ["ABS","ROUND","CEILING","FLOOR","MIN","MAX","MOD","SQRT","POWER",
                          "LEN","VALUE","NUMBER","YEAR","MONTH","DAY","DAYS"]
      const boolFns = ["CONTAINS","BEGINS","ISBLANK","ISNULL","ISNUMBER"]
      const dateFns = ["TODAY","NOW","DATE"]
      if (stringFns.includes(name)) return "string"
      if (numberFns.includes(name)) return "number"
      if (boolFns.includes(name)) return "boolean"
      if (dateFns.includes(name)) return "date"
      if (name === "IF") {
        // IF return type is best-effort the type of the then-branch
        return ast.args.length >= 2 ? inferType(ast.args[1]) : "null"
      }
      return "null"
    }
  }
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr))
}

export const FORMULA_FUNCTION_NAMES: readonly string[] = Object.keys(BUILTIN_FUNCTIONS).sort()

export { FormulaError } from "./types"
export type {
  AstNode, EvaluationContext, FormulaValue, ValidationResult, ValueType,
} from "./types"
