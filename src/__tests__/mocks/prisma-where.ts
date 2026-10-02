/**
 * Evaluates the part of a Prisma `where` the MTM list filters use, against
 * plain rows — so a test can ask «which clients does this filter find?»
 * instead of comparing the shape of the query. Relations are nested arrays
 * (to-many) or objects (to-one) on the row.
 */
type Row = Record<string, unknown>
type Where = Record<string, unknown>

const OPERATORS = new Set([
  "equals", "not", "in", "notIn", "contains", "startsWith", "endsWith",
  "gt", "gte", "lt", "lte", "mode",
])

const isPlainObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date)
)

function comparable(value: unknown): number | string | null {
  if (value instanceof Date) return value.getTime()
  if (typeof value === "number" || typeof value === "string") return value
  return null
}

function scalarMatches(actual: unknown, filter: Record<string, unknown>): boolean {
  const fold = (value: unknown) => (
    filter.mode === "insensitive" && typeof value === "string" ? value.toLowerCase() : value
  )
  for (const [operator, expected] of Object.entries(filter)) {
    if (operator === "mode") continue
    if (operator === "equals") {
      if (expected === null ? actual != null : fold(actual) !== fold(expected)) return false
    } else if (operator === "not") {
      if (expected === null ? actual == null : fold(actual) === fold(expected)) return false
    } else if (operator === "in") {
      if (!(expected as unknown[]).map(fold).includes(fold(actual))) return false
    } else if (operator === "notIn") {
      if ((expected as unknown[]).map(fold).includes(fold(actual))) return false
    } else if (operator === "contains" || operator === "startsWith" || operator === "endsWith") {
      if (typeof actual !== "string") return false
      const haystack = fold(actual) as string
      const needle = fold(expected) as string
      const found = operator === "contains"
        ? haystack.includes(needle)
        : operator === "startsWith" ? haystack.startsWith(needle) : haystack.endsWith(needle)
      if (!found) return false
    } else {
      const left = comparable(actual)
      const right = comparable(expected)
      if (left === null || right === null) return false
      if (operator === "gt" && !(left > right)) return false
      if (operator === "gte" && !(left >= right)) return false
      if (operator === "lt" && !(left < right)) return false
      if (operator === "lte" && !(left <= right)) return false
    }
  }
  return true
}

export function matchesPrismaWhere(row: Row, where: Where | undefined | null): boolean {
  if (!where) return true
  for (const [key, condition] of Object.entries(where)) {
    if (condition === undefined) continue
    if (key === "AND") {
      const all = Array.isArray(condition) ? condition : [condition]
      if (!all.every((item) => matchesPrismaWhere(row, item as Where))) return false
      continue
    }
    if (key === "OR") {
      if (!(condition as Where[]).some((item) => matchesPrismaWhere(row, item))) return false
      continue
    }
    if (key === "NOT") {
      const none = Array.isArray(condition) ? condition : [condition]
      if (none.some((item) => matchesPrismaWhere(row, item as Where))) return false
      continue
    }
    const actual = row[key]
    if (!isPlainObject(condition)) {
      if (condition === null ? actual != null : actual !== condition) return false
      continue
    }
    const keys = Object.keys(condition)
    if (keys.some((name) => name === "some" || name === "none" || name === "every")) {
      const related = (Array.isArray(actual) ? actual : []) as Row[]
      if ("some" in condition && !related.some((item) => matchesPrismaWhere(item, condition.some as Where))) return false
      if ("none" in condition && related.some((item) => matchesPrismaWhere(item, condition.none as Where))) return false
      if ("every" in condition && !related.every((item) => matchesPrismaWhere(item, condition.every as Where))) return false
      continue
    }
    if (keys.length > 0 && keys.every((name) => OPERATORS.has(name))) {
      if (!scalarMatches(actual, condition)) return false
      continue
    }
    // A to-one relation: the nested object is itself a where.
    if (!isPlainObject(actual) || !matchesPrismaWhere(actual, condition)) return false
  }
  return true
}
