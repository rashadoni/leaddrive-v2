/**
 * Tests for CLM Slice-3b: conditional approval routing — pure helpers.
 *
 * Covers:
 *   evaluateRuleConditions — gte/lte/gt/lt/eq/neq/in; all/any; Decimal value;
 *                            unknown field → false; unknown operator → false;
 *                            null valueAmount handling; empty conditions → true
 *   applyApprovalRules    — add at specific position; add (append); skip by label;
 *                           renumber contiguous (1..N); cap exceeded → throw;
 *                           no-match → unchanged; multiple rules; action sortOrder
 */
import { describe, expect, it } from "vitest"
import { Prisma } from "@prisma/client"
import {
  evaluateRuleConditions,
  applyApprovalRules,
  ApprovalRulesCapError,
  MAX_STAGES,
  type ApprovalRuleInput,
  type StageSpec,
  type ContractForRuleEval,
} from "@/lib/contract-lifecycle/approval-rules"

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a real Prisma.Decimal so that .gte/.lte/.gt/.lt methods are available.
 * The production code (FIX 5) uses Decimal arithmetic — the test mock must match.
 */
function dec(n: number | string): Prisma.Decimal {
  return new Prisma.Decimal(String(n))
}

const CONTRACT_BASE: ContractForRuleEval = {
  valueAmount: dec(100_000),
  type: "service_agreement",
  currency: "USD",
}

function makeRule(
  overrides: Partial<ApprovalRuleInput> & { conditions?: ApprovalRuleInput["conditions"] },
): ApprovalRuleInput {
  return {
    id: "rule-1",
    conditions: overrides.conditions ?? [],
    matchLogic: overrides.matchLogic ?? "all",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    actions: overrides.actions ?? [],
    ...overrides,
  }
}

const STAGES_3: StageSpec[] = [
  { label: "Legal" },
  { label: "Finance" },
  { label: "CEO" },
]

// ─── evaluateRuleConditions ───────────────────────────────────────────────────

describe("evaluateRuleConditions", () => {
  describe("gte / lte / gt / lt (numeric)", () => {
    it("gte: true when value >= threshold", () => {
      const rule = makeRule({ conditions: [{ field: "value", operator: "gte", value: 50_000 }] })
      expect(evaluateRuleConditions(rule, CONTRACT_BASE)).toBe(true)
    })

    it("gte: false when value < threshold", () => {
      const rule = makeRule({ conditions: [{ field: "value", operator: "gte", value: 200_000 }] })
      expect(evaluateRuleConditions(rule, CONTRACT_BASE)).toBe(false)
    })

    it("lte: true when value <= threshold", () => {
      const rule = makeRule({ conditions: [{ field: "value", operator: "lte", value: 100_000 }] })
      expect(evaluateRuleConditions(rule, CONTRACT_BASE)).toBe(true)
    })

    it("lte: false when value > threshold", () => {
      const rule = makeRule({ conditions: [{ field: "value", operator: "lte", value: 99_999 }] })
      expect(evaluateRuleConditions(rule, CONTRACT_BASE)).toBe(false)
    })

    it("gt: strict > (equal boundary → false)", () => {
      const rule = makeRule({ conditions: [{ field: "value", operator: "gt", value: 100_000 }] })
      expect(evaluateRuleConditions(rule, CONTRACT_BASE)).toBe(false)
    })

    it("lt: strict < (equal boundary → false)", () => {
      const rule = makeRule({ conditions: [{ field: "value", operator: "lt", value: 100_000 }] })
      expect(evaluateRuleConditions(rule, CONTRACT_BASE)).toBe(false)
    })
  })

  describe("eq / neq (string & number)", () => {
    it("eq: matches contract type", () => {
      const rule = makeRule({ conditions: [{ field: "type", operator: "eq", value: "service_agreement" }] })
      expect(evaluateRuleConditions(rule, CONTRACT_BASE)).toBe(true)
    })

    it("eq: false for wrong type", () => {
      const rule = makeRule({ conditions: [{ field: "type", operator: "eq", value: "nda" }] })
      expect(evaluateRuleConditions(rule, CONTRACT_BASE)).toBe(false)
    })

    it("neq: true when type is different", () => {
      const rule = makeRule({ conditions: [{ field: "type", operator: "neq", value: "nda" }] })
      expect(evaluateRuleConditions(rule, CONTRACT_BASE)).toBe(true)
    })

    it("neq: false when type equals", () => {
      const rule = makeRule({ conditions: [{ field: "type", operator: "neq", value: "service_agreement" }] })
      expect(evaluateRuleConditions(rule, CONTRACT_BASE)).toBe(false)
    })

    it("eq matches currency", () => {
      const rule = makeRule({ conditions: [{ field: "currency", operator: "eq", value: "USD" }] })
      expect(evaluateRuleConditions(rule, CONTRACT_BASE)).toBe(true)
    })
  })

  describe("in operator", () => {
    it("in: true when type is in the list", () => {
      const rule = makeRule({
        conditions: [{ field: "type", operator: "in", value: ["nda", "service_agreement", "msa"] }],
      })
      expect(evaluateRuleConditions(rule, CONTRACT_BASE)).toBe(true)
    })

    it("in: false when type is not in the list", () => {
      const rule = makeRule({
        conditions: [{ field: "type", operator: "in", value: ["nda", "msa"] }],
      })
      expect(evaluateRuleConditions(rule, CONTRACT_BASE)).toBe(false)
    })

    it("in: works with currency", () => {
      const rule = makeRule({
        conditions: [{ field: "currency", operator: "in", value: ["USD", "EUR"] }],
      })
      expect(evaluateRuleConditions(rule, CONTRACT_BASE)).toBe(true)
    })
  })

  describe("matchLogic: all / any", () => {
    const TWO_CONDITIONS: ApprovalRuleInput["conditions"] = [
      { field: "value", operator: "gte", value: 50_000 },
      { field: "type", operator: "eq", value: "nda" }, // this one is false
    ]

    it("all (AND): false when one condition fails", () => {
      const rule = makeRule({ conditions: TWO_CONDITIONS, matchLogic: "all" })
      expect(evaluateRuleConditions(rule, CONTRACT_BASE)).toBe(false)
    })

    it("any (OR): true when at least one condition passes", () => {
      const rule = makeRule({ conditions: TWO_CONDITIONS, matchLogic: "any" })
      expect(evaluateRuleConditions(rule, CONTRACT_BASE)).toBe(true)
    })

    it("any: false when ALL conditions fail", () => {
      const rule = makeRule({
        conditions: [
          { field: "value", operator: "gt", value: 999_999 },
          { field: "type", operator: "eq", value: "nda" },
        ],
        matchLogic: "any",
      })
      expect(evaluateRuleConditions(rule, CONTRACT_BASE)).toBe(false)
    })
  })

  describe("Decimal valueAmount", () => {
    it("converts Decimal to number for comparison", () => {
      const rule = makeRule({ conditions: [{ field: "value", operator: "gte", value: 100_000 }] })
      // dec(100_000) → Number() gives 100_000
      expect(evaluateRuleConditions(rule, { ...CONTRACT_BASE, valueAmount: dec(100_000) })).toBe(true)
    })

    it("null valueAmount: only neq passes", () => {
      const contract: ContractForRuleEval = { ...CONTRACT_BASE, valueAmount: null }
      const ruleNeq = makeRule({ conditions: [{ field: "value", operator: "neq", value: 0 }] })
      const ruleGte = makeRule({ conditions: [{ field: "value", operator: "gte", value: 0 }] })
      expect(evaluateRuleConditions(ruleNeq, contract)).toBe(true)
      expect(evaluateRuleConditions(ruleGte, contract)).toBe(false)
    })
  })

  describe("fail-safe cases", () => {
    it("unknown field → condition evaluates false (all → rule false)", () => {
      const rule = makeRule({
        conditions: [{ field: "jurisdiction" as "value", operator: "eq", value: "US" }],
        matchLogic: "all",
      })
      expect(evaluateRuleConditions(rule, CONTRACT_BASE)).toBe(false)
    })

    it("unknown operator → condition evaluates false", () => {
      const rule = makeRule({
        conditions: [{ field: "value", operator: "between" as "gte", value: 0 }],
      })
      expect(evaluateRuleConditions(rule, CONTRACT_BASE)).toBe(false)
    })

    it("empty conditions array → vacuously true", () => {
      const rule = makeRule({ conditions: [], matchLogic: "all" })
      expect(evaluateRuleConditions(rule, CONTRACT_BASE)).toBe(true)
    })

    it("malformed condition (not an object) is dropped; rest evaluated", () => {
      // The JSON conditions field may contain garbage — parser drops non-conforming entries.
      const rule = makeRule({
        conditions: ["bad_entry", { field: "value", operator: "gte", value: 50_000 }] as ApprovalRuleInput["conditions"],
        matchLogic: "all",
      })
      // Only the valid condition remains → true (100k >= 50k)
      expect(evaluateRuleConditions(rule, CONTRACT_BASE)).toBe(true)
    })

    it("FIX B: non-empty raw conditions array where all entries are invalid → rule does NOT match (fail-closed)", () => {
      // A legacy or manually-inserted DB row may have a non-empty conditions array
      // whose entries are all primitive garbage (strings, numbers) or object garbage
      // (objects with unrecognised keys). parseConditions() filters them all out,
      // leaving length===0.  The raw array was NON-EMPTY, so vacuous-true must NOT
      // apply — the rule must return false (fail-closed).
      const allGarbageCases: ApprovalRuleInput["conditions"][] = [
        ["garbage"],                          // array of a string
        ["garbage", "more garbage"],          // multiple invalid strings
        [42],                                 // array of a number
        [{ bad: 1 }],                         // object but missing field/operator/value shape
        [{ field: "value" }],                 // incomplete condition object (no operator)
        [null, undefined],                    // nullish entries (parseConditions' object check filters these)
      ]
      for (const conditions of allGarbageCases) {
        const rule = makeRule({ conditions, matchLogic: "all" })
        expect(evaluateRuleConditions(rule, CONTRACT_BASE)).toBe(false)
      }
    })

    it("FIX 4: non-array conditions (malformed DB row) → rule does NOT match (false)", () => {
      // A corrupted row may have conditions as a string, object, or null.
      // Must be fail-closed (false), NOT match-all.
      for (const malformed of ["bad", null, 42, { field: "value" }]) {
        const rule = makeRule({ conditions: malformed as ApprovalRuleInput["conditions"] })
        expect(evaluateRuleConditions(rule, CONTRACT_BASE)).toBe(false)
      }
    })
  })

  describe("FIX 5: Decimal-safe value comparison", () => {
    const LARGE_VALUE = "9007199254740993" // > Number.MAX_SAFE_INTEGER (2^53 + 1)
    const THRESHOLD   = "9007199254740992" // 2^53 exactly

    it("correctly applies gte on a value beyond Number.MAX_SAFE_INTEGER", () => {
      // LARGE_VALUE > THRESHOLD → gte(THRESHOLD) must be true
      const contract = { ...CONTRACT_BASE, valueAmount: dec(LARGE_VALUE) }
      const rule = makeRule({ conditions: [{ field: "value", operator: "gte", value: THRESHOLD }] })
      expect(evaluateRuleConditions(rule, contract)).toBe(true)
    })

    it("correctly applies gt on boundary (large === threshold → gt = false)", () => {
      const contract = { ...CONTRACT_BASE, valueAmount: dec(THRESHOLD) }
      const rule = makeRule({ conditions: [{ field: "value", operator: "gt", value: THRESHOLD }] })
      expect(evaluateRuleConditions(rule, contract)).toBe(false)
    })

    it("correctly applies lte on a value at or below threshold", () => {
      const contract = { ...CONTRACT_BASE, valueAmount: dec("999999999999999999") }
      const rule = makeRule({ conditions: [{ field: "value", operator: "lte", value: "999999999999999999" }] })
      expect(evaluateRuleConditions(rule, contract)).toBe(true)
    })

    it("crossing the threshold correctly: LARGE_VALUE > THRESHOLD with gt (should be true)", () => {
      const contract = { ...CONTRACT_BASE, valueAmount: dec(LARGE_VALUE) }
      const rule = makeRule({ conditions: [{ field: "value", operator: "gt", value: THRESHOLD }] })
      expect(evaluateRuleConditions(rule, contract)).toBe(true)
    })
  })
})

// ─── applyApprovalRules ───────────────────────────────────────────────────────

describe("applyApprovalRules", () => {
  function makeAddRule(label: string, atPosition?: number | null): ApprovalRuleInput {
    return makeRule({
      id: `rule-add-${label}`,
      conditions: [], // always matches
      actions: [
        {
          actionType: "add_stage",
          stageLabel: label,
          assigneeUserId: null,
          assigneeRole: null,
          atPosition: atPosition ?? null,
          sortOrder: 0,
        },
      ],
    })
  }

  function makeSkipRule(label: string): ApprovalRuleInput {
    return makeRule({
      id: `rule-skip-${label}`,
      conditions: [],
      actions: [
        {
          actionType: "skip_stage",
          stageLabel: label,
          assigneeUserId: null,
          assigneeRole: null,
          atPosition: null,
          sortOrder: 0,
        },
      ],
    })
  }

  it("no matching rules → base stages returned unchanged", () => {
    const noMatchRule = makeRule({
      conditions: [{ field: "value", operator: "gte", value: 999_999_999 }],
      actions: [{ actionType: "add_stage", stageLabel: "Ghost", assigneeUserId: null, assigneeRole: null, atPosition: null, sortOrder: 0 }],
    })
    const result = applyApprovalRules(STAGES_3, [noMatchRule], CONTRACT_BASE)
    expect(result.map((s) => s.label)).toEqual(["Legal", "Finance", "CEO"])
  })

  it("add_stage (append): new stage appears at end", () => {
    const result = applyApprovalRules(STAGES_3, [makeAddRule("Board")], CONTRACT_BASE)
    expect(result.map((s) => s.label)).toEqual(["Legal", "Finance", "CEO", "Board"])
  })

  it("add_stage at position 1: new stage is first", () => {
    const result = applyApprovalRules(STAGES_3, [makeAddRule("Risk", 1)], CONTRACT_BASE)
    expect(result.map((s) => s.label)).toEqual(["Risk", "Legal", "Finance", "CEO"])
  })

  it("add_stage at position 2: inserted second", () => {
    const result = applyApprovalRules(STAGES_3, [makeAddRule("Risk", 2)], CONTRACT_BASE)
    expect(result.map((s) => s.label)).toEqual(["Legal", "Risk", "Finance", "CEO"])
  })

  it("add_stage at position beyond end: clamped to append", () => {
    const result = applyApprovalRules(STAGES_3, [makeAddRule("Risk", 100)], CONTRACT_BASE)
    expect(result.map((s) => s.label)).toEqual(["Legal", "Finance", "CEO", "Risk"])
  })

  it("skip_stage: removes all stages with matching label", () => {
    // Duplicate label scenario
    const stages: StageSpec[] = [
      { label: "Legal" },
      { label: "Finance" },
      { label: "Legal" }, // duplicate
      { label: "CEO" },
    ]
    const result = applyApprovalRules(stages, [makeSkipRule("Legal")], CONTRACT_BASE)
    expect(result.map((s) => s.label)).toEqual(["Finance", "CEO"])
  })

  it("skip_stage: no match → stages unchanged", () => {
    const result = applyApprovalRules(STAGES_3, [makeSkipRule("Ghost")], CONTRACT_BASE)
    expect(result.map((s) => s.label)).toEqual(["Legal", "Finance", "CEO"])
  })

  it("renumbers contiguously (1..N) regardless of add/skip operations", () => {
    // After skip + add we should have a clean 1-based ordering (implied by position in array).
    const stages: StageSpec[] = [{ label: "Legal" }, { label: "Finance" }]
    const rules = [makeSkipRule("Finance"), makeAddRule("CEO")]
    const result = applyApprovalRules(stages, rules, CONTRACT_BASE)
    // Result: Legal, CEO → no gaps
    expect(result).toHaveLength(2)
    expect(result[0].label).toBe("Legal")
    expect(result[1].label).toBe("CEO")
  })

  it("multiple rules applied in createdAt order", () => {
    const ruleEarly = { ...makeAddRule("First"), id: "r-early", createdAt: new Date("2026-01-01") }
    const ruleLate = { ...makeAddRule("Second"), id: "r-late", createdAt: new Date("2026-06-01") }
    // Pass in reverse creation order to verify sorting
    const result = applyApprovalRules([], [ruleLate, ruleEarly], CONTRACT_BASE)
    expect(result.map((s) => s.label)).toEqual(["First", "Second"])
  })

  it("actions within a rule applied in sortOrder", () => {
    const rule = makeRule({
      conditions: [],
      actions: [
        { actionType: "add_stage", stageLabel: "B", assigneeUserId: null, assigneeRole: null, atPosition: null, sortOrder: 1 },
        { actionType: "add_stage", stageLabel: "A", assigneeUserId: null, assigneeRole: null, atPosition: null, sortOrder: 0 },
      ],
    })
    const result = applyApprovalRules([], [rule], CONTRACT_BASE)
    expect(result.map((s) => s.label)).toEqual(["A", "B"])
  })

  it("cap exceeded → throws ApprovalRulesCapError", () => {
    // Start with MAX_STAGES stages + one add rule → MAX_STAGES + 1 = error.
    const base: StageSpec[] = Array.from({ length: MAX_STAGES }, (_, i) => ({ label: `Stage ${i + 1}` }))
    expect(() => applyApprovalRules(base, [makeAddRule("Extra")], CONTRACT_BASE)).toThrow(
      ApprovalRulesCapError,
    )
  })

  it("exactly MAX_STAGES after rules → no error", () => {
    // Start with MAX_STAGES - 1 + add one → exactly MAX_STAGES.
    const base: StageSpec[] = Array.from({ length: MAX_STAGES - 1 }, (_, i) => ({ label: `Stage ${i + 1}` }))
    expect(() => applyApprovalRules(base, [makeAddRule("Extra")], CONTRACT_BASE)).not.toThrow()
  })

  it("add_stage carries assigneeUserId and assigneeRole", () => {
    const rule = makeRule({
      conditions: [],
      actions: [
        {
          actionType: "add_stage",
          stageLabel: "CFO",
          assigneeUserId: "user-cfo",
          assigneeRole: "director",
          atPosition: null,
          sortOrder: 0,
        },
      ],
    })
    const result = applyApprovalRules([], [rule], CONTRACT_BASE)
    expect(result[0]).toMatchObject({ label: "CFO", assigneeUserId: "user-cfo", assigneeRole: "director" })
  })

  it("rule does not match → stages unchanged (conditional by value)", () => {
    const rule = makeRule({
      conditions: [{ field: "value", operator: "gte", value: 999_999_999 }],
      actions: [{ actionType: "add_stage", stageLabel: "Unreachable", assigneeUserId: null, assigneeRole: null, atPosition: null, sortOrder: 0 }],
    })
    const result = applyApprovalRules(STAGES_3, [rule], CONTRACT_BASE)
    expect(result).toHaveLength(3)
  })
})
