import { vi } from "vitest"

/**
 * Rows kept in memory and filtered through the query a handler really sends.
 *
 * A test that compares `where` objects proves only that the query has the
 * shape its author expected. These helpers evaluate the subset of Prisma's
 * `where` the MTM home endpoints use over plain rows, so a test can ask the
 * question that matters — does the number on the screen equal the number of
 * rows the list returns to the same reader — and fail when a scope or a date
 * bound is dropped.
 *
 * Supported: equality, `null`, `in`, `not`, `gte`/`gt`/`lte`/`lt` (numbers
 * and dates), `some` over an array, `is` and nested relation objects, `OR`,
 * `AND`. `findMany` honours `distinct` and `take` (not `orderBy` — give the
 * rows in the order the test needs); `groupBy` honours `by`, `_count._all`,
 * `_min`, `_max`.
 */

export type Row = Record<string, unknown>

type Query = {
  where?: Row
  distinct?: string[]
  take?: number
  by?: string[]
  _min?: Record<string, boolean>
  _max?: Record<string, boolean>
}

function holds(value: unknown, condition: unknown): boolean {
  if (condition === null) return value === null || value === undefined
  if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime()
  if (typeof condition !== "object") return value === condition
  const rule = condition as Record<string, unknown>
  if ("in" in rule) return (rule.in as unknown[]).includes(value)
  if ("not" in rule) return !holds(value, rule.not)
  if ("some" in rule) return Array.isArray(value) && value.some((entry) => rowMatches(entry as Row, rule.some as Row))
  if ("is" in rule) return value !== null && value !== undefined && rowMatches(value as Row, rule.is as Row)
  const comparisons = ["gte", "gt", "lte", "lt"].filter((key) => key in rule)
  if (comparisons.length > 0) {
    if (!(value instanceof Date) && typeof value !== "number") return false
    const left = Number(value)
    return comparisons.every((key) => {
      const right = Number(rule[key])
      return key === "gte" ? left >= right : key === "gt" ? left > right : key === "lte" ? left <= right : left < right
    })
  }
  return value !== null && value !== undefined && rowMatches(value as Row, rule)
}

export function rowMatches(row: Row, where: Row | undefined): boolean {
  if (!where) return true
  return Object.entries(where).every(([key, condition]) => {
    if (condition === undefined) return true
    if (key === "OR") return (condition as Row[]).some((branch) => rowMatches(row, branch))
    if (key === "AND") return (condition as Row[]).every((branch) => rowMatches(row, branch))
    return holds(row[key], condition)
  })
}

function extreme(rows: Row[], fields: Record<string, boolean> | undefined, pick: (left: number, right: number) => boolean) {
  return Object.fromEntries(Object.keys(fields ?? {}).map((field) => {
    const values = rows.map((row) => row[field]).filter((value): value is Date => value instanceof Date)
    return [field, values.reduce<Date | null>((best, value) => (!best || pick(value.getTime(), best.getTime()) ? value : best), null)]
  }))
}

/** Makes a mocked Prisma model answer `findMany`, `aggregate`, `count` and `groupBy` from `rows`. */
export function serveRows(model: { findMany: unknown; aggregate: unknown; count: unknown; groupBy: unknown }, rows: Row[]): void {
  vi.mocked(model.groupBy as (query: Query) => Promise<unknown>).mockImplementation(async (query: Query = {}) => {
    const found = new Map<string, Row[]>()
    for (const row of rows.filter((candidate) => rowMatches(candidate, query.where))) {
      const key = (query.by ?? []).map((field) => String(row[field])).join("|")
      found.set(key, [...(found.get(key) ?? []), row])
    }
    return [...found.values()].map((group) => ({
      ...Object.fromEntries((query.by ?? []).map((field) => [field, group[0][field]])),
      _count: { _all: group.length },
      _min: extreme(group, query._min, (left, right) => left < right),
      _max: extreme(group, query._max, (left, right) => left > right),
    }))
  })
  vi.mocked(model.findMany as (query: Query) => Promise<unknown>).mockImplementation(async (query: Query = {}) => {
    let found = rows.filter((row) => rowMatches(row, query.where))
    if (query.distinct) {
      const seen = new Set<string>()
      found = found.filter((row) => {
        const key = query.distinct!.map((field) => String(row[field])).join("|")
        return seen.has(key) ? false : (seen.add(key), true)
      })
    }
    return query.take ? found.slice(0, query.take) : found
  })
  vi.mocked(model.aggregate as (query: Query) => Promise<unknown>).mockImplementation(async (query: Query = {}) => {
    const found = rows.filter((row) => rowMatches(row, query.where))
    return {
      _count: { _all: found.length },
      _min: extreme(found, query._min, (left, right) => left < right),
      _max: extreme(found, query._max, (left, right) => left > right),
    }
  })
  vi.mocked(model.count as (query: Query) => Promise<unknown>).mockImplementation(async (query: Query = {}) => rows.filter((row) => rowMatches(row, query.where)).length)
}
