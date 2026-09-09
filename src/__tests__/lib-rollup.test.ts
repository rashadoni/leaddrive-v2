/**
 * Tests for N6 Rollup Summary slice 1 — pure aggregator + filter + engine.
 * No DB. Deterministic synthetic child rows.
 */
import { describe, it, expect } from "vitest"
import { aggregate, coerceNumeric } from "@/lib/rollup/aggregator"
import {
  evaluatePredicate,
  matchesFilter,
  parseFilterSpec,
} from "@/lib/rollup/filter"
import { computeForParent, computeRollups } from "@/lib/rollup/engine"
import type { RollupSpec } from "@/lib/rollup/types"

/* ─── coerceNumeric ───────────────────────────────────────────────────── */

describe("N6 — coerceNumeric", () => {
  it("returns finite numbers as-is", () => {
    expect(coerceNumeric(42)).toBe(42)
    expect(coerceNumeric(-3.14)).toBe(-3.14)
    expect(coerceNumeric(0)).toBe(0)
  })

  it("NaN/Infinity → null", () => {
    expect(coerceNumeric(NaN)).toBeNull()
    expect(coerceNumeric(Infinity)).toBeNull()
    expect(coerceNumeric(-Infinity)).toBeNull()
  })

  it("null + undefined → null", () => {
    expect(coerceNumeric(null)).toBeNull()
    expect(coerceNumeric(undefined)).toBeNull()
  })

  it("booleans → 0/1", () => {
    expect(coerceNumeric(true)).toBe(1)
    expect(coerceNumeric(false)).toBe(0)
  })

  it("numeric strings parse, with trim", () => {
    expect(coerceNumeric("123")).toBe(123)
    expect(coerceNumeric("  -45.6  ")).toBe(-45.6)
  })

  it("non-numeric strings → null", () => {
    expect(coerceNumeric("hello")).toBeNull()
    expect(coerceNumeric("")).toBeNull()
  })

  it("Date → epoch ms (lets min/max work on date columns)", () => {
    const d = new Date("2026-05-17T00:00:00Z")
    expect(coerceNumeric(d)).toBe(d.getTime())
  })
})

/* ─── aggregate ───────────────────────────────────────────────────────── */

describe("N6 — aggregate", () => {
  it("count returns array length regardless of value type", () => {
    expect(aggregate("count", [1, "x", null, true])).toBe(4)
    expect(aggregate("count", [])).toBe(0)
  })

  it("sum / avg / min / max ignore non-numeric values", () => {
    const vals = [10, 20, null, "30", "x", true, false]
    // Coerced: 10, 20, null→skip, "30"→30, "x"→null→skip, true→1, false→0
    // Numeric set: [10, 20, 30, 1, 0]
    expect(aggregate("sum", vals)).toBe(61)
    expect(aggregate("avg", vals)).toBeCloseTo(61 / 5, 6)
    expect(aggregate("min", vals)).toBe(0)
    expect(aggregate("max", vals)).toBe(30)
  })

  it("returns null when all values are non-numeric", () => {
    expect(aggregate("sum", ["x", null, NaN])).toBeNull()
    expect(aggregate("avg", ["x", null, NaN])).toBeNull()
    expect(aggregate("min", ["x", null, NaN])).toBeNull()
    expect(aggregate("max", ["x", null, NaN])).toBeNull()
  })

  it("sum/avg reject Date values (meaningless ms aggregate); min/max keep them", () => {
    const d1 = new Date("2026-01-01T00:00:00Z")
    const d2 = new Date("2026-06-01T00:00:00Z")
    // sum/avg → null because Date values are rejected.
    expect(aggregate("sum", [d1, d2])).toBeNull()
    expect(aggregate("avg", [d1, d2])).toBeNull()
    // min/max → ordering still works on epoch ms.
    expect(aggregate("min", [d1, d2])).toBe(d1.getTime())
    expect(aggregate("max", [d1, d2])).toBe(d2.getTime())
  })

  it("count on empty array is 0 (not null) — meaningful zero", () => {
    expect(aggregate("count", [])).toBe(0)
  })

  it("sum on empty is null — caller distinguishes from zero", () => {
    expect(aggregate("sum", [])).toBeNull()
  })

  it("avg of single value equals the value", () => {
    expect(aggregate("avg", [42])).toBe(42)
  })

  it("min/max of single value equals the value", () => {
    expect(aggregate("min", [-3])).toBe(-3)
    expect(aggregate("max", [-3])).toBe(-3)
  })
})

/* ─── evaluatePredicate + matchesFilter ───────────────────────────────── */

describe("N6 — evaluatePredicate", () => {
  it("eq + ne with strict equality", () => {
    expect(evaluatePredicate({ stage: "won" }, { field: "stage", op: "eq", value: "won" })).toBe(true)
    expect(evaluatePredicate({ stage: "won" }, { field: "stage", op: "eq", value: "lost" })).toBe(false)
    expect(evaluatePredicate({ stage: "won" }, { field: "stage", op: "ne", value: "lost" })).toBe(true)
  })

  it("gt / gte / lt / lte coerce stringified numbers (foot-gun fix)", () => {
    // Previously: "100" vs 50 was compared lexicographically ("100" < "50"
    // because '1' < '5'), so gt returned false. Now compareScalar coerces
    // the string side via the same coerceNumeric the aggregator uses.
    expect(
      evaluatePredicate({ amount: "100" }, { field: "amount", op: "gt", value: 50 })
    ).toBe(true)
    expect(
      evaluatePredicate({ amount: "100" }, { field: "amount", op: "lt", value: 50 })
    ).toBe(false)
    expect(
      evaluatePredicate({ amount: "100" }, { field: "amount", op: "gte", value: 100 })
    ).toBe(true)
  })

  it("gt / gte / lt / lte for numbers", () => {
    const r = { amount: 100 }
    expect(evaluatePredicate(r, { field: "amount", op: "gt", value: 50 })).toBe(true)
    expect(evaluatePredicate(r, { field: "amount", op: "gt", value: 100 })).toBe(false)
    expect(evaluatePredicate(r, { field: "amount", op: "gte", value: 100 })).toBe(true)
    expect(evaluatePredicate(r, { field: "amount", op: "lt", value: 200 })).toBe(true)
    expect(evaluatePredicate(r, { field: "amount", op: "lte", value: 100 })).toBe(true)
  })

  it("gt with null field is false (NaN comparison)", () => {
    expect(
      evaluatePredicate({ amount: null }, { field: "amount", op: "gt", value: 0 })
    ).toBe(false)
  })

  it("in / nin", () => {
    expect(
      evaluatePredicate({ stage: "won" }, { field: "stage", op: "in", value: ["won", "closed_won"] })
    ).toBe(true)
    expect(
      evaluatePredicate({ stage: "lost" }, { field: "stage", op: "nin", value: ["won"] })
    ).toBe(true)
    expect(
      evaluatePredicate({ stage: "won" }, { field: "stage", op: "in", value: "not-an-array" })
    ).toBe(false)
  })

  it("isnull / notnull", () => {
    expect(evaluatePredicate({ x: null }, { field: "x", op: "isnull" })).toBe(true)
    expect(evaluatePredicate({ x: undefined }, { field: "x", op: "isnull" })).toBe(true)
    expect(evaluatePredicate({ x: 0 }, { field: "x", op: "notnull" })).toBe(true)
    expect(evaluatePredicate({ x: null }, { field: "x", op: "notnull" })).toBe(false)
  })

  it("date eq + ne against malformed string literal both return false (consistent)", () => {
    // Previously: ne against malformed date returned true (NaN !== anything).
    // Now both eq and ne return false on incomparable values — matches
    // SQL three-valued-logic for NULL-like incomparable comparisons.
    const d = new Date("2026-05-17T00:00:00Z")
    expect(
      evaluatePredicate({ dueAt: d }, { field: "dueAt", op: "eq", value: "banana" })
    ).toBe(false)
    expect(
      evaluatePredicate({ dueAt: d }, { field: "dueAt", op: "ne", value: "banana" })
    ).toBe(false)
  })

  it("date eq compares epoch ms (Date column vs string literal)", () => {
    const d = new Date("2026-05-17T00:00:00Z")
    expect(
      evaluatePredicate(
        { dueAt: d },
        { field: "dueAt", op: "eq", value: "2026-05-17T00:00:00Z" }
      )
    ).toBe(true)
  })
})

describe("N6 — matchesFilter", () => {
  it("empty spec matches every record", () => {
    expect(matchesFilter({ x: 1 }, [])).toBe(true)
    expect(matchesFilter({}, [])).toBe(true)
  })

  it("AND-joins predicates", () => {
    const filter = [
      { field: "stage", op: "eq" as const, value: "won" },
      { field: "amount", op: "gt" as const, value: 1000 },
    ]
    expect(matchesFilter({ stage: "won", amount: 5000 }, filter)).toBe(true)
    expect(matchesFilter({ stage: "won", amount: 500 }, filter)).toBe(false)
    expect(matchesFilter({ stage: "lost", amount: 5000 }, filter)).toBe(false)
  })
})

describe("N6 — parseFilterSpec", () => {
  it("null returns empty spec", () => {
    expect(parseFilterSpec(null)).toEqual([])
  })

  it("array of valid predicates parses", () => {
    const spec = parseFilterSpec([
      { field: "stage", op: "eq", value: "won" },
      { field: "amount", op: "gt", value: 1000 },
    ])
    expect(spec).toHaveLength(2)
  })

  it("non-array throws", () => {
    expect(() => parseFilterSpec("bogus")).toThrow(/array of predicates/)
  })

  it("missing field throws", () => {
    expect(() => parseFilterSpec([{ op: "eq", value: 1 }])).toThrow(/string `field`/)
  })

  it("unsupported op throws", () => {
    expect(() => parseFilterSpec([{ field: "x", op: "regex", value: "y" }])).toThrow(
      /unsupported op/
    )
  })
})

/* ─── computeRollups engine ───────────────────────────────────────────── */

describe("N6 — computeRollups", () => {
  const mkSpec = (overrides: Partial<RollupSpec> = {}): RollupSpec => ({
    id: "rf_1",
    name: "deal_count",
    parentEntity: "company",
    childEntity: "deal",
    aggregate: "count",
    aggregateField: null,
    parentKey: "companyId",
    filter: [],
    ...overrides,
  })

  it("count groups children by parentKey", () => {
    const spec = mkSpec()
    const r = computeRollups({
      spec,
      parentIds: ["c1", "c2", "c3"],
      children: [
        { companyId: "c1", stage: "won" },
        { companyId: "c1", stage: "lost" },
        { companyId: "c2", stage: "won" },
      ],
    })
    expect(r).toHaveLength(3)
    expect(r.find(x => x.parentId === "c1")?.numericValue).toBe(2)
    expect(r.find(x => x.parentId === "c2")?.numericValue).toBe(1)
    // Parent with zero matches → numericValue null + childCount 0.
    const c3 = r.find(x => x.parentId === "c3")!
    expect(c3.numericValue).toBe(0) // count is meaningful zero
    expect(c3.childCount).toBe(0)
  })

  it("sum aggregates aggregateField across grouped children", () => {
    const spec = mkSpec({ aggregate: "sum", aggregateField: "valueAmount" })
    const r = computeRollups({
      spec,
      parentIds: ["c1"],
      children: [
        { companyId: "c1", valueAmount: 1000 },
        { companyId: "c1", valueAmount: 2500 },
        { companyId: "c2", valueAmount: 999 }, // belongs to another parent — ignored
      ],
    })
    expect(r[0].numericValue).toBe(3500)
    expect(r[0].childCount).toBe(2)
  })

  it("filter excludes children before aggregation", () => {
    const spec = mkSpec({
      aggregate: "sum",
      aggregateField: "valueAmount",
      filter: [{ field: "stage", op: "eq", value: "won" }],
    })
    const r = computeRollups({
      spec,
      parentIds: ["c1"],
      children: [
        { companyId: "c1", stage: "won", valueAmount: 1000 },
        { companyId: "c1", stage: "lost", valueAmount: 9000 }, // filtered out
        { companyId: "c1", stage: "won", valueAmount: 2000 },
      ],
    })
    expect(r[0].numericValue).toBe(3000) // only won deals
    expect(r[0].childCount).toBe(2)
  })

  it("min/max over filtered set", () => {
    const spec = mkSpec({
      aggregate: "min",
      aggregateField: "amount",
      filter: [{ field: "status", op: "eq", value: "paid" }],
    })
    const r = computeRollups({
      spec,
      parentIds: ["d1"],
      children: [
        { companyId: "d1", status: "paid", amount: 100 },
        { companyId: "d1", status: "open", amount: 50 },
        { companyId: "d1", status: "paid", amount: 200 },
      ],
    })
    expect(r[0].numericValue).toBe(100)
  })

  it("ignores children with null parentKey", () => {
    const spec = mkSpec()
    const r = computeRollups({
      spec,
      parentIds: ["c1"],
      children: [
        { companyId: "c1" },
        { companyId: null },
        { companyId: undefined },
      ],
    })
    expect(r[0].numericValue).toBe(1)
  })

  it("ignores parents present in children but absent from parentIds", () => {
    const spec = mkSpec()
    const r = computeRollups({
      spec,
      parentIds: ["c1"], // c2 NOT listed
      children: [
        { companyId: "c1" },
        { companyId: "c2" },
      ],
    })
    expect(r).toHaveLength(1)
    expect(r[0].parentId).toBe("c1")
  })

  it("throws when sum/avg/min/max called without aggregateField", () => {
    const spec = mkSpec({ aggregate: "sum", aggregateField: null })
    expect(() =>
      computeRollups({
        spec,
        parentIds: ["c1"],
        children: [{ companyId: "c1", valueAmount: 100 }],
      })
    ).toThrow(/requires aggregateField/)
  })

  it("non-numeric aggregateField values are skipped (childCount counts inclusion, not contribution)", () => {
    const spec = mkSpec({ aggregate: "sum", aggregateField: "amount" })
    const r = computeRollups({
      spec,
      parentIds: ["c1"],
      children: [
        { companyId: "c1", amount: 100 },
        { companyId: "c1", amount: "not-a-number" },
        { companyId: "c1", amount: null },
      ],
    })
    expect(r[0].numericValue).toBe(100)
    // childCount captures all three rows (passed the filter); coercion is a separate step.
    expect(r[0].childCount).toBe(3)
  })
})

/* ─── computeForParent ────────────────────────────────────────────────── */

describe("N6 — computeForParent", () => {
  it("parent with zero matching children — count → 0, sum → null", () => {
    const countSpec: RollupSpec = {
      id: "rf_count",
      name: "open_tickets",
      parentEntity: "company",
      childEntity: "ticket",
      aggregate: "count",
      aggregateField: null,
      parentKey: "companyId",
      filter: [{ field: "status", op: "eq", value: "open" }],
    }
    const r1 = computeForParent(countSpec, "co1", [
      { companyId: "co1", status: "closed" }, // filtered out
    ])
    expect(r1.numericValue).toBe(0)
    expect(r1.childCount).toBe(0)

    const sumSpec: RollupSpec = { ...countSpec, aggregate: "sum", aggregateField: "amount" }
    const r2 = computeForParent(sumSpec, "co1", [
      { companyId: "co1", status: "closed", amount: 100 }, // filtered out
    ])
    expect(r2.numericValue).toBeNull()
    expect(r2.childCount).toBe(0)
  })

  it("convenience wrapper returns one result for the requested parent", () => {
    const spec: RollupSpec = {
      id: "rf_1",
      name: "open_ticket_count",
      parentEntity: "company",
      childEntity: "ticket",
      aggregate: "count",
      aggregateField: null,
      parentKey: "companyId",
      filter: [{ field: "status", op: "ne", value: "closed" }],
    }
    const r = computeForParent(spec, "co1", [
      { companyId: "co1", status: "open" },
      { companyId: "co1", status: "closed" },
      { companyId: "co1", status: "in_progress" },
    ])
    expect(r.parentId).toBe("co1")
    expect(r.numericValue).toBe(2) // open + in_progress
  })
})
