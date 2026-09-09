/**
 * Formula evaluator — AST + context → FormulaValue.
 *
 * Pure synchronous evaluation. Recursion bounded by parser (MAX_DEPTH=64).
 * No `eval`, no `Function` constructor, no async — entirely safe to run
 * on user-authored input.
 *
 * Special-cases:
 *   - `IF` is lazy: only the chosen branch is evaluated.
 *   - `AND` and `OR` short-circuit.
 *   - `NOW()` / `TODAY()` accept the context's `now` clock for test
 *     determinism; production omits it for `new Date()`.
 *
 * Part of N4 Formula fields (Phase 2 roadmap, slice 1).
 */
import { FormulaError, type AstNode, type EvaluationContext, type FormulaValue } from "./types"
import { BUILTIN_FUNCTIONS, asBoolean, asNumber, asString } from "./functions"

const MAX_STRING_LEN = 100_000

export function evaluate(ast: AstNode, ctx: EvaluationContext): FormulaValue {
  switch (ast.kind) {
    case "literal":
      return ast.value

    case "field": {
      const v = ctx.fields[ast.name]
      return v === undefined ? null : v
    }

    case "unary": {
      if (ast.op === "NOT") return !asBoolean(evaluate(ast.operand, ctx), "NOT")
      if (ast.op === "-") return -asNumber(evaluate(ast.operand, ctx), "unary minus")
      throw new FormulaError("unknown_op", `Unknown unary op '${ast.op}'`)
    }

    case "binary": {
      // Short-circuit logical ops
      if (ast.op === "AND") {
        const l = asBoolean(evaluate(ast.left, ctx), "AND")
        if (!l) return false
        return asBoolean(evaluate(ast.right, ctx), "AND")
      }
      if (ast.op === "OR") {
        const l = asBoolean(evaluate(ast.left, ctx), "OR")
        if (l) return true
        return asBoolean(evaluate(ast.right, ctx), "OR")
      }

      const l = evaluate(ast.left, ctx)
      const r = evaluate(ast.right, ctx)

      switch (ast.op) {
        case "+": {
          // Numeric add. String concat goes through '&' explicitly.
          return guardFinite(asNumber(l, "+") + asNumber(r, "+"), "+")
        }
        case "-": return guardFinite(asNumber(l, "-") - asNumber(r, "-"), "-")
        case "*": return guardFinite(asNumber(l, "*") * asNumber(r, "*"), "*")
        case "/": {
          const rn = asNumber(r, "/")
          if (rn === 0) throw new FormulaError("div_by_zero", "Division by zero")
          return guardFinite(asNumber(l, "/") / rn, "/")
        }
        case "&": {
          const result = asString(l, "&") + asString(r, "&")
          if (result.length > MAX_STRING_LEN) {
            throw new FormulaError("string_too_long", `Result exceeds ${MAX_STRING_LEN} chars`)
          }
          return result
        }
        case "==": return formulaEquals(l, r)
        case "!=": return !formulaEquals(l, r)
        case "<":  return compare(l, r) < 0
        case "<=": return compare(l, r) <= 0
        case ">":  return compare(l, r) > 0
        case ">=": return compare(l, r) >= 0
      }
      throw new FormulaError("unknown_op", `Unknown binary op '${ast.op}'`)
    }

    case "call": {
      const spec = BUILTIN_FUNCTIONS[ast.name]
      if (!spec) throw new FormulaError("unknown_function", `Unknown function '${ast.name}'`)
      if (ast.args.length < spec.minArgs || ast.args.length > spec.maxArgs) {
        const arity = spec.minArgs === spec.maxArgs
          ? `${spec.minArgs}`
          : `${spec.minArgs}-${spec.maxArgs}`
        throw new FormulaError("arity_error", `${ast.name}: expected ${arity} args, got ${ast.args.length}`)
      }

      // Lazy: IF
      if (spec.lazy && ast.name === "IF") {
        const cond = asBoolean(evaluate(ast.args[0], ctx), "IF")
        return cond ? evaluate(ast.args[1], ctx) : evaluate(ast.args[2], ctx)
      }

      // Date helpers need the context clock
      if (ast.name === "TODAY" || ast.name === "NOW") {
        const fn = spec.impl as (args: FormulaValue[], now?: Date) => FormulaValue
        return fn([], ctx.now)
      }

      // Eager: evaluate all args, dispatch
      if (!spec.impl) throw new FormulaError("internal", `${ast.name}: no impl registered`)
      const argValues = ast.args.map(a => evaluate(a, ctx))
      const result = spec.impl(argValues)
      // Numeric functions can overflow — POWER(2, 2000), ROUND of huge etc.
      // Guard once at the call boundary so downstream arithmetic never sees Infinity.
      if (typeof result === "number") return guardFinite(result, ast.name)
      return result
    }
  }
}

/**
 * Reject Infinity / NaN — overflow protection. Salesforce surfaces an
 * "INVALID_NUMBER" error here; we use the matching `overflow` code.
 */
function guardFinite(n: number, opLabel: string): number {
  if (!Number.isFinite(n)) {
    throw new FormulaError("overflow", `${opLabel}: result is not a finite number (${n})`)
  }
  return n
}

/* ─── Helpers ─────────────────────────────────────────────────────────── */

function formulaEquals(a: FormulaValue, b: FormulaValue): boolean {
  // Nulls equal only each other.
  if (a === null || b === null) return a === b
  // Date comparison by timestamp.
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  // Allow number/string coercion: "5" == 5
  if (typeof a === "number" && typeof b === "string") return a === Number(b)
  if (typeof a === "string" && typeof b === "number") return Number(a) === b
  return a === b
}

function compare(a: FormulaValue, b: FormulaValue): number {
  if (a === null || b === null) {
    throw new FormulaError("null_compare", "Cannot compare null values")
  }
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime()
  if (typeof a === "number" && typeof b === "number") return a - b
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b)
  // Mixed types — coerce both to number.
  return asNumber(a, "compare") - asNumber(b, "compare")
}
