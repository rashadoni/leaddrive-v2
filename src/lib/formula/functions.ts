/**
 * Built-in function library — Salesforce-formula subset.
 *
 * Categories: math, string, logical, date, type. Each function declares
 * its arity (min/max) and is pure. Evaluator pre-evaluates ALL arguments
 * eagerly — except `IF`, which uses lazy branch evaluation (handled
 * inline in evaluator.ts; not registered here).
 *
 * Adding a function:
 *   1. Implement as `(args: FormulaValue[]) => FormulaValue`
 *   2. Register in `BUILTIN_FUNCTIONS` with arity bounds.
 *
 * Part of N4 Formula fields (Phase 2 roadmap, slice 1).
 */
import { FormulaError, type FormulaValue } from "./types"

export interface FunctionSpec {
  name: string
  minArgs: number
  maxArgs: number
  /** Optional: lazy = evaluator handles argument evaluation. */
  lazy?: boolean
  impl?: (args: FormulaValue[]) => FormulaValue
}

/* ─── Math ────────────────────────────────────────────────────────────── */

function asNumber(v: FormulaValue, name: string): number {
  if (v === null) throw new FormulaError("null_arg", `${name}: null argument not allowed`)
  if (typeof v === "number") return v
  if (typeof v === "string") {
    const n = Number(v)
    if (!Number.isFinite(n)) throw new FormulaError("not_a_number", `${name}: '${v}' is not a number`)
    return n
  }
  if (typeof v === "boolean") return v ? 1 : 0
  if (v instanceof Date) return v.getTime()
  throw new FormulaError("type_error", `${name}: expected number, got ${typeof v}`)
}

function asString(v: FormulaValue, name: string): string {
  if (v === null) return ""
  if (typeof v === "string") return v
  if (typeof v === "number") return String(v)
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE"
  if (v instanceof Date) return v.toISOString()
  throw new FormulaError("type_error", `${name}: cannot convert to string`)
}

function asBoolean(v: FormulaValue, name: string): boolean {
  if (typeof v === "boolean") return v
  if (v === null) return false
  if (typeof v === "number") return v !== 0
  if (typeof v === "string") return v.length > 0
  if (v instanceof Date) return true
  throw new FormulaError("type_error", `${name}: expected boolean`)
}

function asDate(v: FormulaValue, name: string): Date {
  if (v instanceof Date) return v
  if (typeof v === "string") {
    const d = new Date(v)
    if (Number.isNaN(d.getTime())) throw new FormulaError("bad_date", `${name}: '${v}' is not a valid date`)
    return d
  }
  if (typeof v === "number") return new Date(v)
  throw new FormulaError("type_error", `${name}: expected date`)
}

/* ─── Function implementations ────────────────────────────────────────── */

const fnAbs = (args: FormulaValue[]) => Math.abs(asNumber(args[0], "ABS"))
const fnRound = (args: FormulaValue[]) => {
  const n = asNumber(args[0], "ROUND")
  const d = args.length > 1 ? Math.floor(asNumber(args[1], "ROUND")) : 0
  const f = Math.pow(10, d)
  return Math.round(n * f) / f
}
const fnCeiling = (args: FormulaValue[]) => Math.ceil(asNumber(args[0], "CEILING"))
const fnFloor = (args: FormulaValue[]) => Math.floor(asNumber(args[0], "FLOOR"))
const fnMin = (args: FormulaValue[]) => Math.min(...args.map(a => asNumber(a, "MIN")))
const fnMax = (args: FormulaValue[]) => Math.max(...args.map(a => asNumber(a, "MAX")))
const fnMod = (args: FormulaValue[]) => {
  const a = asNumber(args[0], "MOD")
  const b = asNumber(args[1], "MOD")
  if (b === 0) throw new FormulaError("div_by_zero", "MOD: division by zero")
  return a - Math.floor(a / b) * b
}
const fnSqrt = (args: FormulaValue[]) => {
  const n = asNumber(args[0], "SQRT")
  if (n < 0) throw new FormulaError("domain_error", "SQRT: negative argument")
  return Math.sqrt(n)
}
const fnPower = (args: FormulaValue[]) => Math.pow(asNumber(args[0], "POWER"), asNumber(args[1], "POWER"))

/* String functions */
const fnLen = (args: FormulaValue[]) => asString(args[0], "LEN").length
const fnLeft = (args: FormulaValue[]) => {
  const s = asString(args[0], "LEFT")
  const n = Math.floor(asNumber(args[1], "LEFT"))
  return s.slice(0, Math.max(0, n))
}
const fnRight = (args: FormulaValue[]) => {
  const s = asString(args[0], "RIGHT")
  const n = Math.floor(asNumber(args[1], "RIGHT"))
  return n <= 0 ? "" : s.slice(-n)
}
const fnMid = (args: FormulaValue[]) => {
  const s = asString(args[0], "MID")
  const start = Math.floor(asNumber(args[1], "MID")) - 1 // Salesforce: 1-indexed
  const len = Math.floor(asNumber(args[2], "MID"))
  if (start < 0 || len < 0) return ""
  return s.substring(start, start + len)
}
const fnUpper = (args: FormulaValue[]) => asString(args[0], "UPPER").toUpperCase()
const fnLower = (args: FormulaValue[]) => asString(args[0], "LOWER").toLowerCase()
const fnTrim = (args: FormulaValue[]) => asString(args[0], "TRIM").trim()
const fnContains = (args: FormulaValue[]) => asString(args[0], "CONTAINS").includes(asString(args[1], "CONTAINS"))
const fnBegins = (args: FormulaValue[]) => asString(args[0], "BEGINS").startsWith(asString(args[1], "BEGINS"))
const fnSubstitute = (args: FormulaValue[]) => {
  const s = asString(args[0], "SUBSTITUTE")
  const find = asString(args[1], "SUBSTITUTE")
  const replace = asString(args[2], "SUBSTITUTE")
  return find === "" ? s : s.split(find).join(replace)
}
const fnConcat = (args: FormulaValue[]) => args.map((a, i) => asString(a, `CONCAT[${i}]`)).join("")

/* Logical (AND/OR/NOT are handled as operators; functional forms here) */
const fnIsBlank = (args: FormulaValue[]) => {
  const v = args[0]
  if (v === null) return true
  if (typeof v === "string") return v.length === 0
  return false
}
const fnIsNull = (args: FormulaValue[]) => args[0] === null
const fnIsNumber = (args: FormulaValue[]) => typeof args[0] === "number" && Number.isFinite(args[0])

/* Date functions */
const fnYear = (args: FormulaValue[]) => asDate(args[0], "YEAR").getFullYear()
const fnMonth = (args: FormulaValue[]) => asDate(args[0], "MONTH").getMonth() + 1
const fnDay = (args: FormulaValue[]) => asDate(args[0], "DAY").getDate()
const fnDate = (args: FormulaValue[]) => {
  // Reject month/day out-of-range explicitly — JS Date silently rolls over
  // (DATE(2026, 13, 1) → Jan 2027 in raw Date constructor), but Salesforce
  // surfaces the error so the user sees their bug.
  const y = Math.floor(asNumber(args[0], "DATE"))
  const monthInput = Math.floor(asNumber(args[1], "DATE"))
  const d = Math.floor(asNumber(args[2], "DATE"))
  if (monthInput < 1 || monthInput > 12) {
    throw new FormulaError("bad_date", `DATE: month must be 1-12, got ${monthInput}`)
  }
  if (d < 1 || d > 31) {
    throw new FormulaError("bad_date", `DATE: day must be 1-31, got ${d}`)
  }
  if (y < 1900 || y > 9999) {
    throw new FormulaError("bad_date", `DATE: year must be 1900-9999, got ${y}`)
  }
  const result = new Date(y, monthInput - 1, d)
  // Final sanity: e.g. DATE(2026, 2, 30) — Feb 30 doesn't exist; rolls to Mar 2.
  if (result.getMonth() !== monthInput - 1 || result.getDate() !== d) {
    throw new FormulaError("bad_date", `DATE: ${y}-${monthInput}-${d} is not a valid date`)
  }
  return result
}
const fnDays = (args: FormulaValue[]) => {
  // Days between two dates (end - start). Floor to whole days.
  const a = asDate(args[0], "DAYS")
  const b = asDate(args[1], "DAYS")
  const ms = a.getTime() - b.getTime()
  return Math.floor(ms / 86_400_000)
}
// TODAY()/NOW() — lazy; evaluator injects context.now
const fnToday = (_args: FormulaValue[], now?: Date) => {
  const d = now ?? new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}
const fnNow = (_args: FormulaValue[], now?: Date) => new Date((now ?? new Date()).getTime())

/* Type coercion */
const fnText = (args: FormulaValue[]) => asString(args[0], "TEXT")
const fnValue = (args: FormulaValue[]) => asNumber(args[0], "VALUE")
const fnNumberFn = (args: FormulaValue[]) => asNumber(args[0], "NUMBER")

/* ─── Registry ────────────────────────────────────────────────────────── */

export const BUILTIN_FUNCTIONS: Record<string, FunctionSpec> = {
  // Math
  ABS: { name: "ABS", minArgs: 1, maxArgs: 1, impl: fnAbs },
  ROUND: { name: "ROUND", minArgs: 1, maxArgs: 2, impl: fnRound },
  CEILING: { name: "CEILING", minArgs: 1, maxArgs: 1, impl: fnCeiling },
  FLOOR: { name: "FLOOR", minArgs: 1, maxArgs: 1, impl: fnFloor },
  MIN: { name: "MIN", minArgs: 1, maxArgs: 32, impl: fnMin },
  MAX: { name: "MAX", minArgs: 1, maxArgs: 32, impl: fnMax },
  MOD: { name: "MOD", minArgs: 2, maxArgs: 2, impl: fnMod },
  SQRT: { name: "SQRT", minArgs: 1, maxArgs: 1, impl: fnSqrt },
  POWER: { name: "POWER", minArgs: 2, maxArgs: 2, impl: fnPower },

  // String
  LEN: { name: "LEN", minArgs: 1, maxArgs: 1, impl: fnLen },
  LEFT: { name: "LEFT", minArgs: 2, maxArgs: 2, impl: fnLeft },
  RIGHT: { name: "RIGHT", minArgs: 2, maxArgs: 2, impl: fnRight },
  MID: { name: "MID", minArgs: 3, maxArgs: 3, impl: fnMid },
  UPPER: { name: "UPPER", minArgs: 1, maxArgs: 1, impl: fnUpper },
  LOWER: { name: "LOWER", minArgs: 1, maxArgs: 1, impl: fnLower },
  TRIM: { name: "TRIM", minArgs: 1, maxArgs: 1, impl: fnTrim },
  CONTAINS: { name: "CONTAINS", minArgs: 2, maxArgs: 2, impl: fnContains },
  BEGINS: { name: "BEGINS", minArgs: 2, maxArgs: 2, impl: fnBegins },
  SUBSTITUTE: { name: "SUBSTITUTE", minArgs: 3, maxArgs: 3, impl: fnSubstitute },
  CONCAT: { name: "CONCAT", minArgs: 1, maxArgs: 32, impl: fnConcat },

  // Logical
  IF: { name: "IF", minArgs: 3, maxArgs: 3, lazy: true }, // evaluator-handled
  ISBLANK: { name: "ISBLANK", minArgs: 1, maxArgs: 1, impl: fnIsBlank },
  ISNULL: { name: "ISNULL", minArgs: 1, maxArgs: 1, impl: fnIsNull },
  ISNUMBER: { name: "ISNUMBER", minArgs: 1, maxArgs: 1, impl: fnIsNumber },

  // Date
  TODAY: { name: "TODAY", minArgs: 0, maxArgs: 0, impl: fnToday },
  NOW: { name: "NOW", minArgs: 0, maxArgs: 0, impl: fnNow },
  YEAR: { name: "YEAR", minArgs: 1, maxArgs: 1, impl: fnYear },
  MONTH: { name: "MONTH", minArgs: 1, maxArgs: 1, impl: fnMonth },
  DAY: { name: "DAY", minArgs: 1, maxArgs: 1, impl: fnDay },
  DATE: { name: "DATE", minArgs: 3, maxArgs: 3, impl: fnDate },
  DAYS: { name: "DAYS", minArgs: 2, maxArgs: 2, impl: fnDays },

  // Type coercion
  TEXT: { name: "TEXT", minArgs: 1, maxArgs: 1, impl: fnText },
  VALUE: { name: "VALUE", minArgs: 1, maxArgs: 1, impl: fnValue },
  NUMBER: { name: "NUMBER", minArgs: 1, maxArgs: 1, impl: fnNumberFn },
}

export { asNumber, asString, asBoolean, asDate }
