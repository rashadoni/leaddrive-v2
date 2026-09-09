/**
 * Tests for C5 Pardot / Account Engagement slice 1 — 4 pure helpers + types.
 * No DB.
 */
import { describe, expect, it } from "vitest"
import {
  allowedNextAccount,
  allowedNextEnrollment,
  allowedNextJourney,
  isAccountTerminal,
  isEnrollmentTerminal,
  isJourneyTerminal,
  transitionAccount,
  transitionEnrollment,
  transitionJourney,
} from "@/lib/account-engagement/state-machine"
import {
  __CLASSIFIER_INTERNALS,
  classifySignal,
} from "@/lib/account-engagement/intent-signal-classifier"
import {
  __GRADE_INTERNALS,
  calculateAccountGrade,
} from "@/lib/account-engagement/account-grade-calculator"
import {
  __SCORE_INTERNALS,
  calculateAccountScore,
} from "@/lib/account-engagement/account-score-calculator"
import {
  ACCOUNT_LIFECYCLE_STAGES,
  ACCOUNT_LIFECYCLE_TRANSITIONS,
  EMPLOYEE_BANDS,
  ENROLLMENT_STATUSES,
  ENROLLMENT_TRANSITIONS,
  GRADES,
  ICP_TIERS,
  JOURNEY_GOAL_KINDS,
  JOURNEY_STATUSES,
  JOURNEY_TRANSITIONS,
  SIGNAL_CATEGORIES,
  SIGNAL_KINDS,
  type AccountLifecycleStage,
  type EnrollmentStatus,
  type JourneyStatus,
  type ScoreSignal,
  type SignalKind,
} from "@/lib/account-engagement/types"

/* ─── Drift guards ───────────────────────────────────────────────────── */

describe("C5 — enum drift guards", () => {
  it("account lifecycle stages cardinality is 7", () => {
    expect(ACCOUNT_LIFECYCLE_STAGES).toHaveLength(7)
  })
  it("icp tiers cardinality is 5", () => {
    expect(ICP_TIERS).toHaveLength(5)
  })
  it("grades cardinality is 6", () => {
    expect(GRADES).toHaveLength(6)
  })
  it("employee bands cardinality is 5", () => {
    expect(EMPLOYEE_BANDS).toHaveLength(5)
  })
  it("signal kinds cardinality is 10", () => {
    expect(SIGNAL_KINDS).toHaveLength(10)
  })
  it("signal categories cardinality is 4", () => {
    expect(SIGNAL_CATEGORIES).toHaveLength(4)
  })
  it("journey statuses cardinality is 4", () => {
    expect(JOURNEY_STATUSES).toHaveLength(4)
  })
  it("journey goal kinds cardinality is 4", () => {
    expect(JOURNEY_GOAL_KINDS).toHaveLength(4)
  })
  it("enrollment statuses cardinality is 5", () => {
    expect(ENROLLMENT_STATUSES).toHaveLength(5)
  })

  it("account transition targets all valid", () => {
    for (const s of ACCOUNT_LIFECYCLE_STAGES) {
      for (const t of ACCOUNT_LIFECYCLE_TRANSITIONS[s])
        expect(ACCOUNT_LIFECYCLE_STAGES).toContain(t)
    }
  })
  it("journey transition targets all valid", () => {
    for (const s of JOURNEY_STATUSES) {
      for (const t of JOURNEY_TRANSITIONS[s])
        expect(JOURNEY_STATUSES).toContain(t)
    }
  })
  it("enrollment transition targets all valid", () => {
    for (const s of ENROLLMENT_STATUSES) {
      for (const t of ENROLLMENT_TRANSITIONS[s])
        expect(ENROLLMENT_STATUSES).toContain(t)
    }
  })
})

/* ─── Account state machine ──────────────────────────────────────────── */

describe("C5 — account state machine", () => {
  it("target → engaged → mql → sql → opportunity → customer happy path", () => {
    expect(transitionAccount("target", "engaged").ok).toBe(true)
    expect(transitionAccount("engaged", "mql").ok).toBe(true)
    expect(transitionAccount("mql", "sql").ok).toBe(true)
    expect(transitionAccount("sql", "opportunity").ok).toBe(true)
    expect(transitionAccount("opportunity", "customer").ok).toBe(true)
  })

  it("downgrades allowed: engaged → target, mql → engaged, sql → mql, opportunity → sql", () => {
    expect(transitionAccount("engaged", "target").ok).toBe(true)
    expect(transitionAccount("mql", "engaged").ok).toBe(true)
    expect(transitionAccount("sql", "mql").ok).toBe(true)
    expect(transitionAccount("opportunity", "sql").ok).toBe(true)
  })

  it("can churn from any stage", () => {
    for (const s of ACCOUNT_LIFECYCLE_STAGES) {
      if (s === "churned") continue
      expect(transitionAccount(s, "churned").ok).toBe(true)
    }
  })

  it("churned can re-engage to target (re-engagement campaign)", () => {
    expect(transitionAccount("churned", "target").ok).toBe(true)
  })

  it("customer → mql rejected (must churn before re-funnel)", () => {
    expect(transitionAccount("customer", "mql").ok).toBe(false)
  })

  it("target → mql rejected (must pass through engaged)", () => {
    expect(transitionAccount("target", "mql").ok).toBe(false)
  })

  it("no-op rejected", () => {
    expect(transitionAccount("mql", "mql").ok).toBe(false)
  })

  it("unknown rejected", () => {
    expect(
      transitionAccount("nirvana" as AccountLifecycleStage, "target").ok
    ).toBe(false)
    expect(transitionAccount(null, "target").ok).toBe(false)
  })

  it("isAccountTerminal — none of the lifecycle stages are terminal (all reachable)", () => {
    // Even churned can transition back to target.
    for (const s of ACCOUNT_LIFECYCLE_STAGES) {
      expect(isAccountTerminal(s)).toBe(false)
    }
  })

  it("allowedNextAccount introspection", () => {
    expect([...allowedNextAccount("opportunity")]).toEqual([
      "customer",
      "sql",
      "churned",
    ])
  })
})

/* ─── Journey state machine ──────────────────────────────────────────── */

describe("C5 — journey state machine", () => {
  it("draft → active legal", () => {
    expect(transitionJourney("draft", "active").ok).toBe(true)
  })
  it("active → paused → active round-trip", () => {
    expect(transitionJourney("active", "paused").ok).toBe(true)
    expect(transitionJourney("paused", "active").ok).toBe(true)
  })
  it("archived terminal", () => {
    expect(isJourneyTerminal("archived")).toBe(true)
    for (const t of JOURNEY_STATUSES) {
      if (t === "archived") continue
      expect(transitionJourney("archived", t).ok).toBe(false)
    }
  })
  it("draft → paused rejected", () => {
    expect(transitionJourney("draft", "paused").ok).toBe(false)
  })

  it("allowedNextJourney introspection", () => {
    expect([...allowedNextJourney("active")]).toEqual(["paused", "archived"])
  })
})

/* ─── Enrollment state machine ───────────────────────────────────────── */

describe("C5 — enrollment state machine", () => {
  it("enrolled → in_progress → goal_met happy path", () => {
    expect(transitionEnrollment("enrolled", "in_progress").ok).toBe(true)
    expect(transitionEnrollment("in_progress", "goal_met").ok).toBe(true)
  })
  it("can exit / fail from enrolled or in_progress", () => {
    expect(transitionEnrollment("enrolled", "exited").ok).toBe(true)
    expect(transitionEnrollment("enrolled", "failed").ok).toBe(true)
    expect(transitionEnrollment("in_progress", "exited").ok).toBe(true)
    expect(transitionEnrollment("in_progress", "failed").ok).toBe(true)
  })
  it("goal_met / exited / failed terminal", () => {
    expect(isEnrollmentTerminal("goal_met")).toBe(true)
    expect(isEnrollmentTerminal("exited")).toBe(true)
    expect(isEnrollmentTerminal("failed")).toBe(true)
  })
  it("enrolled → goal_met rejected (must pass in_progress)", () => {
    expect(transitionEnrollment("enrolled", "goal_met").ok).toBe(false)
  })

  it("allowedNextEnrollment introspection", () => {
    expect([...allowedNextEnrollment("in_progress")]).toEqual([
      "goal_met",
      "exited",
      "failed",
    ])
  })
})

/* ─── Intent signal classifier ───────────────────────────────────────── */

describe("C5 — intent signal classifier", () => {
  it("form_submission → high_intent / MQL-qualifying", () => {
    const r = classifySignal({ signalKind: "form_submission" })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.classification.category).toBe("high_intent")
      expect(r.classification.mqlQualifying).toBe(true)
      expect(r.classification.defaultWeight).toBe(25)
    }
  })

  it("chat_high_intent → high_intent / MQL-qualifying", () => {
    const r = classifySignal({ signalKind: "chat_high_intent" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.classification.mqlQualifying).toBe(true)
  })

  it("page_view_research → passive / not MQL", () => {
    const r = classifySignal({ signalKind: "page_view_research" })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.classification.category).toBe("passive")
      expect(r.classification.mqlQualifying).toBe(false)
    }
  })

  it("page_view_high_intent → high_intent / NOT MQL-qualifying alone", () => {
    // High-intent signal but doesn't promote to MQL on its own —
    // multiple high-intent signals or a form/chat needed for MQL.
    const r = classifySignal({ signalKind: "page_view_high_intent" })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.classification.category).toBe("high_intent")
      expect(r.classification.mqlQualifying).toBe(false)
      expect(r.classification.defaultWeight).toBe(10)
    }
  })

  it("competitor_research → high_intent / NOT MQL alone", () => {
    const r = classifySignal({ signalKind: "competitor_research" })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.classification.category).toBe("high_intent")
      expect(r.classification.mqlQualifying).toBe(false)
      expect(r.classification.defaultWeight).toBe(15)
    }
  })

  it("third_party_intent → third_party category", () => {
    const r = classifySignal({ signalKind: "third_party_intent" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.classification.category).toBe("third_party")
  })

  it("rejects unknown signalKind", () => {
    const r = classifySignal({ signalKind: "telepathy" as SignalKind })
    expect(r.ok).toBe(false)
  })

  it("rejects non-string resourceRef", () => {
    const r = classifySignal({
      signalKind: "form_submission",
      resourceRef: 42 as never,
    })
    expect(r.ok).toBe(false)
  })

  it("CLASSIFICATION_TABLE pins every SignalKind", () => {
    for (const kind of SIGNAL_KINDS) {
      expect(__CLASSIFIER_INTERNALS.CLASSIFICATION_TABLE[kind]).toBeDefined()
      const entry = __CLASSIFIER_INTERNALS.CLASSIFICATION_TABLE[kind]
      expect(SIGNAL_CATEGORIES).toContain(entry.category)
      expect(entry.defaultWeight).toBeGreaterThanOrEqual(1)
      expect(entry.defaultWeight).toBeLessThanOrEqual(100)
    }
  })

  it("high_intent weights > engaged > passive (ordering invariant)", () => {
    const t = __CLASSIFIER_INTERNALS.CLASSIFICATION_TABLE
    expect(t.form_submission.defaultWeight).toBeGreaterThan(
      t.content_download.defaultWeight
    )
    expect(t.content_download.defaultWeight).toBeGreaterThan(
      t.page_view_research.defaultWeight
    )
  })

  it("MQL-qualifying signals come ONLY from high_intent category", () => {
    const t = __CLASSIFIER_INTERNALS.CLASSIFICATION_TABLE
    for (const kind of SIGNAL_KINDS) {
      if (t[kind].mqlQualifying) {
        expect(t[kind].category).toBe("high_intent")
      }
    }
  })
})

/* ─── Account grade calculator ───────────────────────────────────────── */

describe("C5 — account grade calculator", () => {
  it("tier_1 strategic enterprise above min revenue → A", () => {
    const r = calculateAccountGrade({
      icpTier: "tier_1",
      employeeBand: "strategic",
      industrySlug: "saas",
      targetIndustries: ["saas", "fintech"],
      annualRevenueUsd: 100_000_000,
      minRevenueUsd: 10_000_000,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      // 30 + 25 + 25 + 20 = 100 → A
      expect(r.breakdown.grade).toBe("A")
      expect(r.breakdown.rawScore).toBe(100)
    }
  })

  it("tier_4 micro below revenue → D or F", () => {
    const r = calculateAccountGrade({
      icpTier: "tier_4",
      employeeBand: "micro",
      industrySlug: "construction",
      targetIndustries: ["saas"],
      annualRevenueUsd: 100_000,
      minRevenueUsd: 1_000_000,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      // 6 + 3 + 5 + ~1 = ~15 → F
      expect(r.breakdown.grade).toBe("F")
    }
  })

  it("disqualified industry → F regardless of other scores", () => {
    const r = calculateAccountGrade({
      icpTier: "tier_1",
      employeeBand: "strategic",
      industrySlug: "competitor",
      targetIndustries: ["saas"],
      disqualifiedIndustries: ["competitor"],
      annualRevenueUsd: 1_000_000_000,
      minRevenueUsd: 1_000_000,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.breakdown.grade).toBe("F")
      expect(r.breakdown.rationale).toMatch(/disqualified/)
    }
  })

  it("unscored + no data → unassigned", () => {
    const r = calculateAccountGrade({
      icpTier: "unscored",
      employeeBand: null,
      industrySlug: null,
      targetIndustries: [],
      annualRevenueUsd: null,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.breakdown.grade).toBe("unassigned")
  })

  it("tier_2 mid-market industry match → A (just over 80 threshold)", () => {
    const r = calculateAccountGrade({
      icpTier: "tier_2",
      employeeBand: "mid_market",
      industrySlug: "saas",
      targetIndustries: ["saas"],
      annualRevenueUsd: 50_000_000,
      minRevenueUsd: 10_000_000,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      // 22 + 14 + 25 + 20 = 81 → A (just over threshold)
      expect(r.breakdown.grade).toBe("A")
      expect(r.breakdown.rawScore).toBe(81)
    }
  })

  it("revenue below threshold gives partial credit (scaled)", () => {
    const r = calculateAccountGrade({
      icpTier: "tier_2",
      employeeBand: "mid_market",
      industrySlug: "saas",
      targetIndustries: ["saas"],
      annualRevenueUsd: 5_000_000,
      minRevenueUsd: 10_000_000,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      // revenue at 50% of threshold → revenueComponent = 5
      expect(r.breakdown.revenueComponent).toBe(5)
    }
  })

  it("no targetIndustries (empty list) → neutral industry credit", () => {
    const r = calculateAccountGrade({
      icpTier: "tier_1",
      employeeBand: "enterprise",
      industrySlug: "anything",
      targetIndustries: [],
      annualRevenueUsd: 100_000_000,
      minRevenueUsd: 10_000_000,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.breakdown.industryComponent).toBe(10)
  })

  it("rejects unknown icpTier", () => {
    const r = calculateAccountGrade({
      icpTier: "tier_0" as never,
      employeeBand: null,
      industrySlug: null,
      targetIndustries: [],
      annualRevenueUsd: null,
    })
    expect(r.ok).toBe(false)
  })

  it("rejects unknown employeeBand", () => {
    const r = calculateAccountGrade({
      icpTier: "tier_1",
      employeeBand: "mega" as never,
      industrySlug: null,
      targetIndustries: [],
      annualRevenueUsd: null,
    })
    expect(r.ok).toBe(false)
  })

  it("rejects negative annualRevenueUsd", () => {
    const r = calculateAccountGrade({
      icpTier: "tier_1",
      employeeBand: "enterprise",
      industrySlug: "saas",
      targetIndustries: ["saas"],
      annualRevenueUsd: -1000,
    })
    expect(r.ok).toBe(false)
  })

  it("rejects non-array targetIndustries", () => {
    const r = calculateAccountGrade({
      icpTier: "tier_1",
      employeeBand: null,
      industrySlug: null,
      targetIndustries: null as never,
      annualRevenueUsd: null,
    })
    expect(r.ok).toBe(false)
  })

  it("ICP_COMPONENT — tier_1 > tier_2 > tier_3 > tier_4 > unscored", () => {
    const t = __GRADE_INTERNALS.ICP_COMPONENT_BY_TIER
    expect(t.tier_1).toBeGreaterThan(t.tier_2)
    expect(t.tier_2).toBeGreaterThan(t.tier_3)
    expect(t.tier_3).toBeGreaterThan(t.tier_4)
    expect(t.tier_4).toBeGreaterThan(t.unscored)
  })

  it("BAND_COMPONENT — strategic > enterprise > mid_market > small > micro", () => {
    const b = __GRADE_INTERNALS.BAND_COMPONENT
    expect(b.strategic).toBeGreaterThan(b.enterprise)
    expect(b.enterprise).toBeGreaterThan(b.mid_market)
    expect(b.mid_market).toBeGreaterThan(b.small)
    expect(b.small).toBeGreaterThan(b.micro)
  })
})

/* ─── Account engagement score calculator ────────────────────────────── */

describe("C5 — account engagement score calculator", () => {
  function sigAt(
    kind: SignalKind,
    weight: number,
    iso: string
  ): ScoreSignal {
    return {
      signalKind: kind,
      weight,
      occurredAt: new Date(iso),
    }
  }

  it("zero signals → score 0", () => {
    const r = calculateAccountScore({
      signals: [],
      asOf: new Date("2026-05-15T12:00:00Z"),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.breakdown.score).toBe(0)
      expect(r.breakdown.signalCount).toBe(0)
    }
  })

  it("single high-weight signal at asOf → full weight contributes", () => {
    const r = calculateAccountScore({
      signals: [sigAt("form_submission", 25, "2026-05-15T12:00:00Z")],
      asOf: new Date("2026-05-15T12:00:00Z"),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.breakdown.score).toBe(25)
      expect(r.breakdown.byCategory.high_intent).toBe(25)
    }
  })

  it("signal from 14 days ago (default half-life) contributes half weight", () => {
    const r = calculateAccountScore({
      signals: [sigAt("form_submission", 100, "2026-05-01T12:00:00Z")],
      asOf: new Date("2026-05-15T12:00:00Z"),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.breakdown.rawTotal).toBeCloseTo(50, 1)
    }
  })

  it("signal from 28 days ago contributes 1/4 weight", () => {
    const r = calculateAccountScore({
      signals: [sigAt("form_submission", 100, "2026-04-17T12:00:00Z")],
      asOf: new Date("2026-05-15T12:00:00Z"),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.breakdown.rawTotal).toBeCloseTo(25, 1)
    }
  })

  it("score capped at 100 even with high rawTotal", () => {
    const signals: ScoreSignal[] = []
    for (let i = 0; i < 50; i++) {
      signals.push(sigAt("form_submission", 25, "2026-05-15T12:00:00Z"))
    }
    const r = calculateAccountScore({
      signals,
      asOf: new Date("2026-05-15T12:00:00Z"),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.breakdown.score).toBe(100)
      expect(r.breakdown.rawTotal).toBe(50 * 25)
    }
  })

  it("custom cap honored", () => {
    const r = calculateAccountScore({
      signals: [sigAt("form_submission", 100, "2026-05-15T12:00:00Z")],
      asOf: new Date("2026-05-15T12:00:00Z"),
      cap: 50,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.breakdown.score).toBe(50)
  })

  it("custom halfLife — shorter = faster decay", () => {
    const r1 = calculateAccountScore({
      signals: [sigAt("form_submission", 100, "2026-05-08T12:00:00Z")],
      asOf: new Date("2026-05-15T12:00:00Z"),
      halfLifeDays: 7,
    })
    expect(r1.ok).toBe(true)
    if (r1.ok) {
      // 7 days ago with 7-day halfLife → 50% contribution
      expect(r1.breakdown.rawTotal).toBeCloseTo(50, 1)
    }
  })

  it("ancient signals dropped — older than 5 × halfLife", () => {
    const r = calculateAccountScore({
      signals: [
        sigAt("form_submission", 25, "2025-12-01T12:00:00Z"), // ancient
        sigAt("form_submission", 25, "2026-05-15T12:00:00Z"), // current
      ],
      asOf: new Date("2026-05-15T12:00:00Z"),
      halfLifeDays: 14,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.breakdown.signalCount).toBe(1)
      expect(r.breakdown.droppedAncientSignals).toBe(1)
    }
  })

  it("per-category aggregation", () => {
    const r = calculateAccountScore({
      signals: [
        sigAt("page_view_research", 5, "2026-05-15T12:00:00Z"), // passive
        sigAt("content_download", 5, "2026-05-15T12:00:00Z"), // engaged
        sigAt("form_submission", 25, "2026-05-15T12:00:00Z"), // high_intent
        sigAt("third_party_intent", 5, "2026-05-15T12:00:00Z"), // third_party
      ],
      asOf: new Date("2026-05-15T12:00:00Z"),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.breakdown.byCategory.passive).toBeCloseTo(5, 1)
      expect(r.breakdown.byCategory.engaged).toBeCloseTo(5, 1)
      expect(r.breakdown.byCategory.high_intent).toBeCloseTo(25, 1)
      expect(r.breakdown.byCategory.third_party).toBeCloseTo(5, 1)
    }
  })

  it("rejects future-dated signal (occurredAt > asOf)", () => {
    const r = calculateAccountScore({
      signals: [sigAt("form_submission", 25, "2026-05-20T12:00:00Z")],
      asOf: new Date("2026-05-15T12:00:00Z"),
    })
    expect(r.ok).toBe(false)
  })

  it("rejects zero-weight signal", () => {
    const r = calculateAccountScore({
      signals: [sigAt("form_submission", 0, "2026-05-15T12:00:00Z")],
      asOf: new Date("2026-05-15T12:00:00Z"),
    })
    expect(r.ok).toBe(false)
  })

  it("rejects weight > 100", () => {
    const r = calculateAccountScore({
      signals: [sigAt("form_submission", 200, "2026-05-15T12:00:00Z")],
      asOf: new Date("2026-05-15T12:00:00Z"),
    })
    expect(r.ok).toBe(false)
  })

  it("rejects non-finite asOf", () => {
    const r = calculateAccountScore({
      signals: [],
      asOf: new Date("invalid"),
    })
    expect(r.ok).toBe(false)
  })

  it("rejects unknown signalKind", () => {
    const r = calculateAccountScore({
      signals: [
        {
          signalKind: "alien" as SignalKind,
          weight: 25,
          occurredAt: new Date("2026-05-15T12:00:00Z"),
        },
      ],
      asOf: new Date("2026-05-15T12:00:00Z"),
    })
    expect(r.ok).toBe(false)
  })

  it("rejects non-positive halfLife", () => {
    const r = calculateAccountScore({
      signals: [],
      asOf: new Date("2026-05-15T12:00:00Z"),
      halfLifeDays: 0,
    })
    expect(r.ok).toBe(false)
  })

  it("rejects non-array signals", () => {
    const r = calculateAccountScore({
      signals: null as never,
      asOf: new Date("2026-05-15T12:00:00Z"),
    })
    expect(r.ok).toBe(false)
  })

  it("DEFAULT_HALF_LIFE_DAYS = 14", () => {
    expect(__SCORE_INTERNALS.DEFAULT_HALF_LIFE_DAYS).toBe(14)
  })

  it("ANCIENT_HALF_LIVES = 5 (signals older than 70 days dropped at default halfLife)", () => {
    expect(__SCORE_INTERNALS.ANCIENT_HALF_LIVES).toBe(5)
  })
})

/* ─── Terminal-set drift ─────────────────────────────────────────────── */

describe("C5 — terminal-set drift", () => {
  it("account terminals: none (churned re-engages)", () => {
    const terminals = ACCOUNT_LIFECYCLE_STAGES.filter((s) => isAccountTerminal(s))
    expect(terminals).toHaveLength(0)
  })

  it("journey terminals: { archived }", () => {
    expect(
      [...JOURNEY_STATUSES.filter((s) => isJourneyTerminal(s))].sort()
    ).toEqual(["archived"])
  })

  it("enrollment terminals: { exited, failed, goal_met }", () => {
    expect(
      [...ENROLLMENT_STATUSES.filter((s) => isEnrollmentTerminal(s))].sort()
    ).toEqual(["exited", "failed", "goal_met"])
  })

  it("active states NOT terminal", () => {
    expect(isJourneyTerminal("active" as JourneyStatus)).toBe(false)
    expect(isEnrollmentTerminal("in_progress" as EnrollmentStatus)).toBe(false)
  })
})
