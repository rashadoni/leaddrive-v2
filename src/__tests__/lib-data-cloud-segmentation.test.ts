/**
 * Tests for G4 Data Cloud Segmentation slice 1 — query-validator +
 * in-memory query-evaluator pure helpers. No DB.
 */
import { describe, expect, it } from "vitest"
import { validateQuery } from "@/lib/data-cloud-segmentation/query-validator"
import { evaluateQuery } from "@/lib/data-cloud-segmentation/query-evaluator"
import {
  FIELD_OP_COMPATIBILITY,
  FIELD_TYPE_MAP,
  MAX_QUERY_CHILDREN,
  MAX_QUERY_DEPTH,
  QUERY_COMPARISON_OPS,
  QUERY_LOGIC_OPS,
  type EvaluatorInput,
  type EvaluatorProfile,
  type QueryNode,
} from "@/lib/data-cloud-segmentation/types"

const NOW = new Date("2026-05-17T12:00:00Z")

function profile(overrides: Partial<EvaluatorProfile> = {}): EvaluatorProfile {
  return {
    totalSpent: 1000,
    lifetimeOrderCount: 10,
    firstSeenAt: new Date("2025-01-01T00:00:00Z"),
    lastSeenAt: new Date("2026-05-10T00:00:00Z"),
    channelsActive: ["contact", "web_chat_session"],
    primaryCurrency: "USD",
    emailNormalized: "test@example.com",
    phoneNormalized: "+994501234567",
    ...overrides,
  }
}

function mkInput(
  p: Partial<EvaluatorProfile> = {},
  insights: EvaluatorInput["insights"] = {},
  asOf: Date = NOW
): EvaluatorInput {
  return { profile: profile(p), insights, asOf }
}

function ok(root: QueryNode) {
  return { type: "subtree" as const, logic: "and" as const, children: [root] }
}

/**
 * Narrow `EvaluatorResult` to its happy-path `matched` boolean. Throws
 * on `{ ok: false }` so a bug in the evaluator surfaces as a test
 * failure rather than as silent `undefined.matched`.
 */
function matched(root: QueryNode, input: EvaluatorInput): boolean {
  const r = evaluateQuery(root, input)
  if (!r.ok) throw new Error(`evaluator runtime error: ${r.error}`)
  return r.matched
}

/* ─── Validator ───────────────────────────────────────────────────────── */

describe("G4 — validateQuery (shape)", () => {
  it("rejects non-object root", () => {
    const r = validateQuery({ root: "not-an-object" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/must be an object/)
  })

  it("rejects missing type field", () => {
    const r = validateQuery({ root: { foo: "bar" } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/node\.type must be/)
  })

  it("rejects unknown type", () => {
    const r = validateQuery({ root: { type: "frob" } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/node\.type/)
  })

  it("rejects empty subtree children", () => {
    const r = validateQuery({
      root: { type: "subtree", logic: "and", children: [] },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/non-empty array/)
  })

  it("rejects `not` subtree with multiple children", () => {
    const r = validateQuery({
      root: {
        type: "subtree",
        logic: "not",
        children: [
          { type: "condition", field: { source: "profile", path: "totalSpent" }, op: "gt", value: 100 },
          { type: "condition", field: { source: "profile", path: "lifetimeOrderCount" }, op: "gt", value: 5 },
        ],
      },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/"not".*exactly 1 child/)
  })

  it("rejects unknown logic op", () => {
    const r = validateQuery({
      root: { type: "subtree", logic: "xor", children: [{ type: "condition" }] },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects depth > MAX_QUERY_DEPTH", () => {
    // Nest 10 subtrees deep — exceeds default 8.
    let inner: unknown = {
      type: "condition",
      field: { source: "profile", path: "totalSpent" },
      op: "gt",
      value: 100,
    }
    for (let i = 0; i < 10; i++) {
      inner = { type: "subtree", logic: "and", children: [inner] }
    }
    const r = validateQuery({ root: inner })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/depth.*exceeds max/)
  })

  it("honours custom maxDepth override", () => {
    const tree = {
      type: "subtree",
      logic: "and",
      children: [
        {
          type: "subtree",
          logic: "and",
          children: [
            {
              type: "condition",
              field: { source: "profile", path: "totalSpent" },
              op: "gt",
              value: 100,
            },
          ],
        },
      ],
    }
    // maxDepth=1 → root + 1 nested = depth 2 → exceeds limit.
    expect(validateQuery({ root: tree, maxDepth: 1 }).ok).toBe(false)
    // maxDepth=3 → fits.
    expect(validateQuery({ root: tree, maxDepth: 3 }).ok).toBe(true)
  })
})

describe("G4 — validateQuery (field + op)", () => {
  it("rejects unknown profile field", () => {
    const r = validateQuery({
      root: {
        type: "condition",
        field: { source: "profile", path: "secretBackdoor" },
        op: "eq",
        value: 1,
      },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/unknown field/)
  })

  it("rejects insight path without .value/.confidence suffix", () => {
    const r = validateQuery({
      root: {
        type: "condition",
        field: { source: "insight", path: "ltv" },
        op: "gt",
        value: 100,
      },
    })
    expect(r.ok).toBe(false)
  })

  it("accepts insight path with .value suffix", () => {
    const r = validateQuery({
      root: {
        type: "condition",
        field: { source: "insight", path: "ltv.value" },
        op: "gt",
        value: 100,
      },
    })
    expect(r.ok).toBe(true)
  })

  it("accepts insight path with .confidence suffix", () => {
    const r = validateQuery({
      root: {
        type: "condition",
        field: { source: "insight", path: "churn_risk.confidence" },
        op: "gte",
        value: 0.5,
      },
    })
    expect(r.ok).toBe(true)
  })

  it("rejects unknown comparison op", () => {
    const r = validateQuery({
      root: {
        type: "condition",
        field: { source: "profile", path: "totalSpent" },
        op: "modulo",
        value: 100,
      },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects gt on a boolean-typed field (op-type compatibility)", () => {
    // The schema doesn't currently have a boolean field on profile,
    // but the compatibility map's `boolean` row rejects gt — test via
    // matrix lookup.
    expect(FIELD_OP_COMPATIBILITY.boolean.includes("gt")).toBe(false)
  })

  it("rejects contains on a number field", () => {
    const r = validateQuery({
      root: {
        type: "condition",
        field: { source: "profile", path: "totalSpent" },
        op: "contains",
        value: "foo",
      },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/op "contains" is not allowed/)
  })

  it("accepts contains on channelsActive (string_array)", () => {
    const r = validateQuery({
      root: {
        type: "condition",
        field: { source: "profile", path: "channelsActive" },
        op: "contains",
        value: "web_chat_session",
      },
    })
    expect(r.ok).toBe(true)
  })

  it("rejects `in` with empty array", () => {
    const r = validateQuery({
      root: {
        type: "condition",
        field: { source: "profile", path: "primaryCurrency" },
        op: "in",
        value: [],
      },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects `between` with non-2-element array", () => {
    const r = validateQuery({
      root: {
        type: "condition",
        field: { source: "profile", path: "totalSpent" },
        op: "between",
        value: [100],
      },
    })
    expect(r.ok).toBe(false)
  })

  it("accepts `between` with [lo, hi] array", () => {
    const r = validateQuery({
      root: {
        type: "condition",
        field: { source: "profile", path: "totalSpent" },
        op: "between",
        value: [100, 5000],
      },
    })
    expect(r.ok).toBe(true)
  })

  it("rejects days_ago_lt with negative number", () => {
    const r = validateQuery({
      root: {
        type: "condition",
        field: { source: "profile", path: "lastSeenAt" },
        op: "days_ago_lt",
        value: -5,
      },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects days_ago_gte with non-integer", () => {
    const r = validateQuery({
      root: {
        type: "condition",
        field: { source: "profile", path: "lastSeenAt" },
        op: "days_ago_gte",
        value: 7.5,
      },
    })
    expect(r.ok).toBe(false)
  })

  it("accepts isnull on any nullable field, value ignored", () => {
    const r = validateQuery({
      root: {
        type: "condition",
        field: { source: "profile", path: "emailNormalized" },
        op: "isnull",
        value: "this-value-doesn't-matter",
      },
    })
    expect(r.ok).toBe(true)
  })

  it("rejects eq on a number with string value (type mismatch)", () => {
    const r = validateQuery({
      root: {
        type: "condition",
        field: { source: "profile", path: "totalSpent" },
        op: "eq",
        value: "100",
      },
    })
    expect(r.ok).toBe(false)
  })
})

/* ─── Evaluator ───────────────────────────────────────────────────────── */

describe("G4 — evaluateQuery (basic ops)", () => {
  it("eq matches numeric field", () => {
    const root: QueryNode = {
      type: "condition",
      field: { source: "profile", path: "totalSpent" },
      op: "eq",
      value: 1000,
    }
    expect(evaluateQuery(root, mkInput())).toEqual({ ok: true, matched: true })
  })

  it("gt does NOT match equal values (strict)", () => {
    const root: QueryNode = {
      type: "condition",
      field: { source: "profile", path: "totalSpent" },
      op: "gt",
      value: 1000,
    }
    expect(evaluateQuery(root, mkInput())).toEqual({ ok: true, matched: false })
  })

  it("gte matches equal values (inclusive)", () => {
    const root: QueryNode = {
      type: "condition",
      field: { source: "profile", path: "totalSpent" },
      op: "gte",
      value: 1000,
    }
    expect(evaluateQuery(root, mkInput())).toEqual({ ok: true, matched: true })
  })

  it("between is inclusive on both ends", () => {
    const root: QueryNode = {
      type: "condition",
      field: { source: "profile", path: "totalSpent" },
      op: "between",
      value: [1000, 2000],
    }
    expect(matched(root, mkInput())).toBe(true)
    // Below range
    expect(matched(root, mkInput({ totalSpent: 999 }))).toBe(false)
    // Above range
    expect(matched(root, mkInput({ totalSpent: 2001 }))).toBe(false)
    // At upper bound — inclusive
    expect(matched(root, mkInput({ totalSpent: 2000 }))).toBe(true)
  })

  it("in matches list membership", () => {
    const root: QueryNode = {
      type: "condition",
      field: { source: "profile", path: "primaryCurrency" },
      op: "in",
      value: ["USD", "EUR", "GBP"],
    }
    expect(matched(root, mkInput())).toBe(true)
    expect(matched(root, mkInput({ primaryCurrency: "AZN" }))).toBe(false)
  })

  it("contains matches string_array membership", () => {
    const root: QueryNode = {
      type: "condition",
      field: { source: "profile", path: "channelsActive" },
      op: "contains",
      value: "web_chat_session",
    }
    expect(matched(root, mkInput())).toBe(true)
    expect(
      matched(root, mkInput({ channelsActive: ["contact"] }))
    ).toBe(false)
  })

  it("starts_with matches string prefix", () => {
    const root: QueryNode = {
      type: "condition",
      field: { source: "profile", path: "emailNormalized" },
      op: "starts_with",
      value: "test@",
    }
    expect(matched(root, mkInput())).toBe(true)
  })

  it("isnull matches null fields", () => {
    const root: QueryNode = {
      type: "condition",
      field: { source: "profile", path: "emailNormalized" },
      op: "isnull",
      value: null,
    }
    expect(matched(root, mkInput())).toBe(false)
    expect(matched(root, mkInput({ emailNormalized: null }))).toBe(true)
  })

  it("not_null is the inverse of isnull", () => {
    const root: QueryNode = {
      type: "condition",
      field: { source: "profile", path: "phoneNormalized" },
      op: "not_null",
      value: null,
    }
    expect(matched(root, mkInput())).toBe(true)
    expect(matched(root, mkInput({ phoneNormalized: null }))).toBe(false)
  })
})

describe("G4 — evaluateQuery (date / days_ago)", () => {
  it("days_ago_lt matches when fewer days have passed", () => {
    // lastSeenAt: 2026-05-10; NOW: 2026-05-17 → 7 days ago
    const root: QueryNode = {
      type: "condition",
      field: { source: "profile", path: "lastSeenAt" },
      op: "days_ago_lt",
      value: 30,
    }
    expect(matched(root, mkInput())).toBe(true)
  })

  it("days_ago_gte matches when MORE days have passed", () => {
    const root: QueryNode = {
      type: "condition",
      field: { source: "profile", path: "lastSeenAt" },
      op: "days_ago_gte",
      value: 5,
    }
    expect(matched(root, mkInput())).toBe(true) // 7 >= 5
  })

  it("days_ago_lt returns false when actual is null", () => {
    const root: QueryNode = {
      type: "condition",
      field: { source: "profile", path: "lastSeenAt" },
      op: "days_ago_lt",
      value: 30,
    }
    expect(matched(root, mkInput({ lastSeenAt: null }))).toBe(false)
  })

  it("date gt comparison works with ISO-string values", () => {
    const root: QueryNode = {
      type: "condition",
      field: { source: "profile", path: "firstSeenAt" },
      op: "gt",
      value: "2024-12-31T00:00:00Z",
    }
    expect(matched(root, mkInput())).toBe(true)
  })
})

describe("G4 — evaluateQuery (insight access)", () => {
  it("reads insight.value when present", () => {
    const root: QueryNode = {
      type: "condition",
      field: { source: "insight", path: "ltv.value" },
      op: "gt",
      value: 500,
    }
    expect(
      matched(root, mkInput({}, { ltv: { value: 1200, confidence: 1 } }))
    ).toBe(true)
    expect(
      matched(root, mkInput({}, { ltv: { value: 100, confidence: 1 } }))
    ).toBe(false)
  })

  it("reads insight.confidence", () => {
    const root: QueryNode = {
      type: "condition",
      field: { source: "insight", path: "churn_risk.confidence" },
      op: "gte",
      value: 0.5,
    }
    expect(
      matched(root, mkInput({}, { churn_risk: { value: 0.8, confidence: 0.7 } }))
    ).toBe(true)
  })

  it("absent insight = no match (does not crash)", () => {
    const root: QueryNode = {
      type: "condition",
      field: { source: "insight", path: "ltv.value" },
      op: "gt",
      value: 100,
    }
    expect(matched(root, mkInput({}, {}))).toBe(false)
  })

  it("isnull on absent insight = true", () => {
    const root: QueryNode = {
      type: "condition",
      field: { source: "insight", path: "ltv.value" },
      op: "isnull",
      value: null,
    }
    expect(matched(root, mkInput({}, {}))).toBe(true)
  })
})

describe("G4 — evaluateQuery (logic combinators)", () => {
  it("AND requires all children to match", () => {
    const root: QueryNode = {
      type: "subtree",
      logic: "and",
      children: [
        { type: "condition", field: { source: "profile", path: "totalSpent" }, op: "gt", value: 500 },
        { type: "condition", field: { source: "profile", path: "lifetimeOrderCount" }, op: "gte", value: 5 },
      ],
    }
    expect(matched(root, mkInput())).toBe(true)
    // One fails
    expect(matched(root, mkInput({ lifetimeOrderCount: 2 }))).toBe(false)
  })

  it("OR matches if ANY child matches", () => {
    const root: QueryNode = {
      type: "subtree",
      logic: "or",
      children: [
        { type: "condition", field: { source: "profile", path: "totalSpent" }, op: "gt", value: 999999 },
        { type: "condition", field: { source: "profile", path: "lifetimeOrderCount" }, op: "gte", value: 5 },
      ],
    }
    expect(matched(root, mkInput())).toBe(true) // 2nd child matches
  })

  it("NOT inverts a single child", () => {
    const root: QueryNode = {
      type: "subtree",
      logic: "not",
      children: [
        { type: "condition", field: { source: "profile", path: "totalSpent" }, op: "gt", value: 999999 },
      ],
    }
    expect(matched(root, mkInput())).toBe(true) // child = false, !false = true
  })

  it("nested AND-of-OR composes correctly", () => {
    // (totalSpent > 500) AND (currency IN ['USD','EUR'] OR lastSeen < 30d)
    const root: QueryNode = {
      type: "subtree",
      logic: "and",
      children: [
        {
          type: "condition",
          field: { source: "profile", path: "totalSpent" },
          op: "gt",
          value: 500,
        },
        {
          type: "subtree",
          logic: "or",
          children: [
            {
              type: "condition",
              field: { source: "profile", path: "primaryCurrency" },
              op: "in",
              value: ["USD", "EUR"],
            },
            {
              type: "condition",
              field: { source: "profile", path: "lastSeenAt" },
              op: "days_ago_lt",
              value: 30,
            },
          ],
        },
      ],
    }
    expect(matched(root, mkInput())).toBe(true)
  })
})

describe("G4 — registry drift guards", () => {
  it("FIELD_TYPE_MAP has all profile-side fields documented in the spec", () => {
    const expected = [
      "totalSpent",
      "lifetimeOrderCount",
      "firstSeenAt",
      "lastSeenAt",
      "channelsActive",
      "primaryCurrency",
      "emailNormalized",
      "phoneNormalized",
    ]
    expect(Object.keys(FIELD_TYPE_MAP).sort()).toEqual(expected.sort())
  })

  it("QUERY_COMPARISON_OPS covers all 15 spec operators", () => {
    expect(QUERY_COMPARISON_OPS).toHaveLength(15)
  })

  it("QUERY_LOGIC_OPS has exactly 3 (and / or / not)", () => {
    expect(QUERY_LOGIC_OPS).toEqual(["and", "or", "not"])
  })

  it("FIELD_OP_COMPATIBILITY maps every FieldType", () => {
    for (const fieldType of Object.values(FIELD_TYPE_MAP)) {
      expect(FIELD_OP_COMPATIBILITY[fieldType]).toBeDefined()
      expect(FIELD_OP_COMPATIBILITY[fieldType].length).toBeGreaterThan(0)
    }
  })

  it("MAX_QUERY_DEPTH is 8 (default — caller can override)", () => {
    expect(MAX_QUERY_DEPTH).toBe(8)
  })

  it("MAX_QUERY_CHILDREN is 32 (width DoS cap)", () => {
    expect(MAX_QUERY_CHILDREN).toBe(32)
  })

  it("FIELD_OP_COMPATIBILITY.boolean is reserved (no boolean field yet)", () => {
    // Pin the reserved row so when slice-2 adds a boolean field
    // (`isVip`, `isSubscribed`, etc.) the change is visible here and
    // the matrix doesn't drift without a paired field-map update.
    expect(FIELD_OP_COMPATIBILITY.boolean).toEqual(["eq", "neq", "isnull", "not_null"])
    const booleanFieldsToday = Object.entries(FIELD_TYPE_MAP).filter(
      ([, t]) => t === "boolean"
    )
    expect(booleanFieldsToday).toHaveLength(0)
  })
})

/* ─── Defense-in-depth + post-architect fixes ─────────────────────────── */

describe("G4 — width cap (DoS guard)", () => {
  it("rejects subtree with > MAX_QUERY_CHILDREN children", () => {
    const children = Array.from({ length: MAX_QUERY_CHILDREN + 1 }, () => ({
      type: "condition" as const,
      field: { source: "profile" as const, path: "totalSpent" },
      op: "gt" as const,
      value: 100,
    }))
    const r = validateQuery({ root: { type: "subtree", logic: "and", children } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/exceeds MAX_QUERY_CHILDREN/)
  })

  it("accepts subtree with exactly MAX_QUERY_CHILDREN children", () => {
    const children = Array.from({ length: MAX_QUERY_CHILDREN }, () => ({
      type: "condition" as const,
      field: { source: "profile" as const, path: "totalSpent" },
      op: "gt" as const,
      value: 100,
    }))
    const r = validateQuery({ root: { type: "subtree", logic: "and", children } })
    expect(r.ok).toBe(true)
  })
})

describe("G4 — date value type (validator / evaluator parity)", () => {
  it("validator accepts ISO string for date field", () => {
    const r = validateQuery({
      root: {
        type: "condition",
        field: { source: "profile", path: "lastSeenAt" },
        op: "gt",
        value: "2026-01-01T00:00:00Z",
      },
    })
    expect(r.ok).toBe(true)
  })

  it("validator accepts epoch-ms number for date field", () => {
    // Prevents the "validator rejects what evaluator would have
    // matched" trap — `compareNumeric` happily takes a number on the
    // date branch.
    const r = validateQuery({
      root: {
        type: "condition",
        field: { source: "profile", path: "lastSeenAt" },
        op: "gt",
        value: Date.UTC(2026, 0, 1),
      },
    })
    expect(r.ok).toBe(true)
  })

  it("validator accepts Date instance for date field (in-process caller)", () => {
    const r = validateQuery({
      root: {
        type: "condition",
        field: { source: "profile", path: "lastSeenAt" },
        op: "gt",
        value: new Date("2026-01-01T00:00:00Z"),
      },
    })
    expect(r.ok).toBe(true)
  })

  it("validator rejects boolean for date field", () => {
    const r = validateQuery({
      root: {
        type: "condition",
        field: { source: "profile", path: "lastSeenAt" },
        op: "gt",
        value: true,
      },
    })
    expect(r.ok).toBe(false)
  })

  it("evaluator agrees on epoch-ms vs ISO string vs Date for the same date field", () => {
    const isoQ: QueryNode = {
      type: "condition",
      field: { source: "profile", path: "lastSeenAt" },
      op: "gt",
      value: "2026-01-01T00:00:00Z",
    }
    const numQ: QueryNode = {
      type: "condition",
      field: { source: "profile", path: "lastSeenAt" },
      op: "gt",
      value: Date.UTC(2026, 0, 1),
    }
    const dateQ: QueryNode = {
      type: "condition",
      field: { source: "profile", path: "lastSeenAt" },
      op: "gt",
      value: new Date("2026-01-01T00:00:00Z"),
    }
    // mkInput defaults lastSeenAt to 2026-05-10 — all three should match.
    expect(matched(isoQ, mkInput())).toBe(true)
    expect(matched(numQ, mkInput())).toBe(true)
    expect(matched(dateQ, mkInput())).toBe(true)
  })
})

describe("G4 — evaluator allowlist (defense-in-depth)", () => {
  it("rejects prototype-chain profile paths even if validator bypassed", () => {
    // Hand-craft a malformed query that didn't go through the validator
    // (simulating a slice-2 helper that mutates a tree post-validation
    // or a test fixture). resolveFieldValue MUST refuse __proto__ etc.
    const badRoot = {
      type: "condition" as const,
      field: { source: "profile" as const, path: "__proto__" },
      op: "not_null" as const,
      value: null,
    } as QueryNode
    // not_null returns true if resolveFieldValue() returns non-null.
    // Allowlist guard forces null → not_null = false (not match).
    expect(matched(badRoot, mkInput())).toBe(false)
  })

  it("rejects constructor / toString prototype keys", () => {
    for (const evilKey of ["constructor", "toString", "hasOwnProperty"]) {
      const root = {
        type: "condition" as const,
        field: { source: "profile" as const, path: evilKey },
        op: "not_null" as const,
        value: null,
      } as QueryNode
      expect(matched(root, mkInput())).toBe(false)
    }
  })

  it("rejects malformed insight inner (only .value / .confidence allowed)", () => {
    const root = {
      type: "condition" as const,
      field: { source: "insight" as const, path: "ltv.__proto__" },
      op: "not_null" as const,
      value: null,
    } as QueryNode
    expect(matched(root, mkInput({}, { ltv: { value: 1000, confidence: 1 } }))).toBe(false)
  })
})

/* ─── Unused-import sanity (ok wrapper) ───────────────────────────────── */

describe("G4 — ok() helper produces a valid AND subtree", () => {
  it("wraps a condition in an AND subtree (used in higher-level tests)", () => {
    const node = ok({
      type: "condition",
      field: { source: "profile", path: "totalSpent" },
      op: "gt",
      value: 100,
    })
    expect(node.type).toBe("subtree")
    expect(node.logic).toBe("and")
    expect(node.children).toHaveLength(1)
  })
})
