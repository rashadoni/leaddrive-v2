/**
 * Tests for M5 CLM slice 1 — 4 pure helpers. No DB.
 */
import { describe, expect, it } from "vitest"
import {
  allowedNextStatuses,
  canTransition,
  isContractStatus,
  isTerminal,
} from "@/lib/contract-lifecycle/state-machine"
import { substituteClauses } from "@/lib/contract-lifecycle/clause-substituter"
import { routeApproval } from "@/lib/contract-lifecycle/approval-router"
import { scheduleRenewalAlerts } from "@/lib/contract-lifecycle/renewal-alert-scheduler"
import {
  CONTRACT_STATUSES,
  CONTRACT_TRANSITIONS,
  RENEWAL_ALERT_WINDOWS,
  STAGE_DECISIONS,
  STAGE_STATUSES,
  VARIABLE_TYPES,
  type ApprovalStageState,
  type ContractStatus,
  type TemplateClause,
  type TemplateVariable,
} from "@/lib/contract-lifecycle/types"

const MS_PER_DAY = 24 * 60 * 60 * 1000

/* ─── State machine ───────────────────────────────────────────────────── */

describe("M5 — state-machine", () => {
  it("accepts every canonical status", () => {
    for (const s of CONTRACT_STATUSES) expect(isContractStatus(s)).toBe(true)
  })

  it("rejects unknown / mis-cased / padded values", () => {
    for (const s of ["", "Draft", "draft ", "ACTIVE", "renewed!", 42, null, undefined]) {
      expect(isContractStatus(s)).toBe(false)
    }
  })

  it("allows draft → pending_approval", () => {
    expect(canTransition({ from: "draft", to: "pending_approval" })).toEqual({ ok: true })
  })

  it("allows draft → cancelled", () => {
    expect(canTransition({ from: "draft", to: "cancelled" })).toEqual({ ok: true })
  })

  it("allows pending_approval → approved", () => {
    expect(canTransition({ from: "pending_approval", to: "approved" })).toEqual({ ok: true })
  })

  it("allows active → renewing / expired / terminated", () => {
    for (const to of ["renewing", "expired", "terminated"] as const) {
      expect(canTransition({ from: "active", to })).toEqual({ ok: true })
    }
  })

  it("rejects backward jumps", () => {
    const r = canTransition({ from: "active", to: "draft" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/not allowed/)
  })

  it("rejects renewed → anything (terminal)", () => {
    for (const to of ["draft", "active", "renewing"] as const) {
      const r = canTransition({ from: "renewed", to })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toMatch(/terminal state/)
    }
  })

  it("rejects self-transition (caller must short-circuit no-op)", () => {
    const r = canTransition({ from: "active", to: "active" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/to itself/)
  })

  it("rejects unknown from / to", () => {
    expect(canTransition({ from: "bogus" as ContractStatus, to: "draft" }).ok).toBe(false)
    expect(canTransition({ from: "draft", to: "bogus" as ContractStatus }).ok).toBe(false)
  })

  it("allowedNextStatuses matches CONTRACT_TRANSITIONS", () => {
    for (const s of CONTRACT_STATUSES) {
      expect(allowedNextStatuses(s)).toEqual(CONTRACT_TRANSITIONS[s])
    }
  })

  it("isTerminal identifies the 5 terminal states", () => {
    const terminals = ["renewed", "expired", "terminated", "rejected", "cancelled"] as const
    for (const s of CONTRACT_STATUSES) {
      expect(isTerminal(s)).toBe(terminals.includes(s as (typeof terminals)[number]))
    }
  })
})

/* ─── Clause substituter ──────────────────────────────────────────────── */

describe("M5 — clause-substituter", () => {
  function spec(): TemplateVariable[] {
    return [
      { name: "clientName", type: "string", required: true },
      { name: "monthlyFee", type: "number", required: true },
      { name: "startDate", type: "date", required: true },
      { name: "autoRenew", type: "boolean", required: false, default: false },
    ]
  }

  function clauses(): TemplateClause[] {
    return [
      { id: "intro", title: "Intro", body: "This agreement is between {{clientName}} and Acme." },
      {
        id: "fee",
        title: "Fees",
        body: "Monthly fee: {{monthlyFee}} starting {{startDate}}.",
      },
      {
        id: "renewal",
        title: "Auto-renewal",
        body: "Contract auto-renews annually.",
        conditional: { var: "autoRenew", equals: true },
      },
    ]
  }

  it("renders all clauses when values are complete", () => {
    const r = substituteClauses({
      clauses: clauses(),
      variables: spec(),
      values: {
        clientName: "Beta Corp",
        monthlyFee: 5000,
        startDate: new Date("2026-06-01T00:00:00Z"),
        autoRenew: true,
      },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.clauses).toHaveLength(3)
      expect(r.clauses[0].body).toBe("This agreement is between Beta Corp and Acme.")
      expect(r.clauses[1].body).toBe("Monthly fee: 5000 starting 2026-06-01T00:00:00.000Z.")
      expect(r.clauses[2].body).toBe("Contract auto-renews annually.")
      expect(r.clauses[2].skipped).toBe(false)
      expect(r.renderedBody).toContain("Beta Corp")
      expect(r.renderedBody).toContain("Auto-renewal")
    }
  })

  it("skips conditional clause when condition fails", () => {
    const r = substituteClauses({
      clauses: clauses(),
      variables: spec(),
      values: {
        clientName: "Beta Corp",
        monthlyFee: 5000,
        startDate: new Date("2026-06-01T00:00:00Z"),
        autoRenew: false,
      },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.clauses[2].skipped).toBe(true)
      expect(r.renderedBody).not.toContain("Auto-renewal")
    }
  })

  it("uses declared default for missing optional", () => {
    const r = substituteClauses({
      clauses: clauses(),
      variables: spec(),
      values: {
        clientName: "Beta Corp",
        monthlyFee: 5000,
        startDate: new Date("2026-06-01T00:00:00Z"),
        // autoRenew omitted → default false → conditional fails → skipped
      },
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.clauses[2].skipped).toBe(true)
  })

  it("reports missing required vars", () => {
    const r = substituteClauses({
      clauses: clauses(),
      variables: spec(),
      values: { clientName: "Beta Corp" } as never,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.missingVars.sort()).toEqual(["monthlyFee", "startDate"])
    }
  })

  it("treats empty-string required as missing", () => {
    const r = substituteClauses({
      clauses: clauses(),
      variables: spec(),
      values: {
        clientName: "",
        monthlyFee: 5000,
        startDate: new Date("2026-06-01T00:00:00Z"),
      },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.missingVars).toContain("clientName")
  })

  it("reports type mismatches", () => {
    const r = substituteClauses({
      clauses: clauses(),
      variables: spec(),
      values: {
        clientName: "Beta Corp",
        monthlyFee: "five thousand" as never,
        startDate: new Date("2026-06-01T00:00:00Z"),
      },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.typeMismatches.find((t) => t.name === "monthlyFee")).toBeDefined()
    }
  })

  it("reports unknown var refs in clauses", () => {
    const r = substituteClauses({
      clauses: [
        { id: "x", title: "X", body: "Hello {{undeclaredVar}}!" },
      ],
      variables: spec(),
      values: {
        clientName: "Beta Corp",
        monthlyFee: 5000,
        startDate: new Date("2026-06-01T00:00:00Z"),
      },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.unknownVars).toContain("undeclaredVar")
  })

  it("rejects spec with duplicate variable names", () => {
    const r = substituteClauses({
      clauses: clauses(),
      variables: [
        { name: "clientName", type: "string", required: true },
        { name: "clientName", type: "number", required: false },
      ],
      values: {} as never,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      // Spec-level errors surface via the typeMismatches __spec__ row.
      expect(r.typeMismatches.find((t) => t.name === "__spec__")).toBeDefined()
    }
  })

  it("rejects spec with unknown variable type", () => {
    const r = substituteClauses({
      clauses: clauses(),
      variables: [{ name: "x", type: "uuid" as never, required: true }],
      values: { x: "abc" },
    })
    expect(r.ok).toBe(false)
  })

  it("accepts ISO string for date variable", () => {
    const r = substituteClauses({
      clauses: clauses(),
      variables: spec(),
      values: {
        clientName: "Beta Corp",
        monthlyFee: 5000,
        startDate: "2026-06-01T00:00:00Z",
        autoRenew: false,
      },
    })
    expect(r.ok).toBe(true)
  })
})

/* ─── Approval router ─────────────────────────────────────────────────── */

describe("M5 — approval-router", () => {
  const NOW = new Date("2026-05-17T12:00:00Z")

  // Real CLM workflow: full chain created with all stages "pending"
  // upfront, lowest-order stage is the active one.
  function freshChainOfN(n: number): ApprovalStageState[] {
    return Array.from({ length: n }, (_, i) => ({
      order: i + 1,
      status: "pending" as const,
    }))
  }

  it("approve advances lowest-pending order to next", () => {
    const r = routeApproval({
      stages: freshChainOfN(3),
      stageOrder: 1,
      decision: "approve",
      decidedBy: "u1",
      at: NOW,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.chainApproved).toBe(false)
      expect(r.chainRejected).toBe(false)
      expect(r.nextPendingOrder).toBe(2)
      expect(r.updates).toHaveLength(1)
      expect(r.updates[0]).toMatchObject({ order: 1, status: "approved", decidedBy: "u1" })
    }
  })

  it("approve final stage marks chainApproved", () => {
    const r = routeApproval({
      stages: [
        {
          order: 1,
          status: "approved",
          decidedBy: "u1",
          decidedAt: new Date(NOW.getTime() - 86400000),
        },
        { order: 2, status: "pending" },
      ],
      stageOrder: 2,
      decision: "approve",
      decidedBy: "u2",
      at: NOW,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.chainApproved).toBe(true)
      expect(r.chainRejected).toBe(false)
      expect(r.nextPendingOrder).toBeNull()
      expect(r.updates).toHaveLength(1)
      expect(r.updates[0]).toMatchObject({ order: 2, status: "approved", decidedBy: "u2" })
    }
  })

  it("approve middle stage of full upfront chain points to next pending", () => {
    const r = routeApproval({
      stages: [
        {
          order: 1,
          status: "approved",
          decidedBy: "u1",
          decidedAt: new Date(NOW.getTime() - 86400000),
        },
        { order: 2, status: "pending" },
        { order: 3, status: "pending" },
      ],
      stageOrder: 2,
      decision: "approve",
      decidedBy: "u2",
      at: NOW,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.chainApproved).toBe(false)
      expect(r.nextPendingOrder).toBe(3)
    }
  })

  it("reject middle stage shorts the chain (later pending → skipped)", () => {
    const r = routeApproval({
      stages: [
        {
          order: 1,
          status: "approved",
          decidedBy: "u1",
          decidedAt: new Date(NOW.getTime() - 86400000),
        },
        { order: 2, status: "pending" },
        { order: 3, status: "pending" },
      ],
      stageOrder: 2,
      decision: "reject",
      decidedBy: "u2",
      at: NOW,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.chainRejected).toBe(true)
      expect(r.chainApproved).toBe(false)
      expect(r.nextPendingOrder).toBeNull()
      const rejected = r.updates.find((u) => u.order === 2)
      const skipped = r.updates.find((u) => u.order === 3)
      expect(rejected?.status).toBe("rejected")
      expect(skipped?.status).toBe("skipped")
    }
  })

  it("reject first stage marks all later pending → skipped", () => {
    const r = routeApproval({
      stages: freshChainOfN(3),
      stageOrder: 1,
      decision: "reject",
      decidedBy: "u1",
      at: NOW,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.chainRejected).toBe(true)
      // Stage 1 → rejected, stages 2 & 3 → skipped.
      expect(r.updates).toHaveLength(3)
      expect(r.updates.find((u) => u.order === 1)?.status).toBe("rejected")
      expect(r.updates.find((u) => u.order === 2)?.status).toBe("skipped")
      expect(r.updates.find((u) => u.order === 3)?.status).toBe("skipped")
    }
  })

  it("rejects acting on out-of-order stage (skip earlier pending)", () => {
    const r = routeApproval({
      stages: [
        { order: 1, status: "pending" },
        { order: 2, status: "pending" },
      ],
      stageOrder: 2,
      decision: "approve",
      decidedBy: "u",
      at: NOW,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/not.*current-pending/)
  })

  it("rejects chain with terminal stage above a pending one (gap)", () => {
    const r = routeApproval({
      stages: [
        { order: 1, status: "pending" },
        { order: 2, status: "approved", decidedBy: "u", decidedAt: NOW },
      ],
      stageOrder: 1,
      decision: "approve",
      decidedBy: "u",
      at: NOW,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/gap in advance/)
  })

  it("rejects acting on already-terminal stage", () => {
    const r = routeApproval({
      stages: [
        {
          order: 1,
          status: "approved",
          decidedBy: "u1",
          decidedAt: new Date(NOW.getTime() - 86400000),
        },
        { order: 2, status: "pending" },
      ],
      stageOrder: 1,
      decision: "approve",
      decidedBy: "u1-again",
      at: NOW,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/only "pending"/)
  })

  it("rejects unknown decision", () => {
    const r = routeApproval({
      stages: [{ order: 1, status: "pending" }],
      stageOrder: 1,
      decision: "abstain" as never,
      decidedBy: "u",
      at: NOW,
    })
    expect(r.ok).toBe(false)
  })

  it("rejects empty decidedBy / invalid at", () => {
    expect(
      routeApproval({
        stages: [{ order: 1, status: "pending" }],
        stageOrder: 1,
        decision: "approve",
        decidedBy: "",
        at: NOW,
      }).ok
    ).toBe(false)
    expect(
      routeApproval({
        stages: [{ order: 1, status: "pending" }],
        stageOrder: 1,
        decision: "approve",
        decidedBy: "u",
        at: new Date(NaN),
      }).ok
    ).toBe(false)
  })

  it("rejects non-contiguous order", () => {
    const r = routeApproval({
      stages: [
        { order: 1, status: "approved", decidedBy: "u", decidedAt: NOW },
        { order: 3, status: "pending" },
      ],
      stageOrder: 3,
      decision: "approve",
      decidedBy: "u",
      at: NOW,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/contiguous/)
  })

  it("rejects stageOrder not in chain", () => {
    const r = routeApproval({
      stages: [{ order: 1, status: "pending" }],
      stageOrder: 99,
      decision: "approve",
      decidedBy: "u",
      at: NOW,
    })
    expect(r.ok).toBe(false)
  })

  it("approves a single-stage chain in one shot", () => {
    const r = routeApproval({
      stages: [{ order: 1, status: "pending" }],
      stageOrder: 1,
      decision: "approve",
      decidedBy: "u",
      at: NOW,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.chainApproved).toBe(true)
      expect(r.nextPendingOrder).toBeNull()
    }
  })
})

/* ─── Renewal alert scheduler ─────────────────────────────────────────── */

describe("M5 — renewal-alert-scheduler", () => {
  const NOW = new Date("2026-05-17T00:00:00Z")

  it("schedules all 5 windows for a contract ending 100 days out", () => {
    const endDate = new Date(NOW.getTime() + 100 * MS_PER_DAY)
    const r = scheduleRenewalAlerts({ contractId: "c1", endDate, asOf: NOW })
    expect(r.alerts).toHaveLength(5)
    expect(r.skippedPastDue).toHaveLength(0)
    // Largest window first (chronological order).
    expect(r.alerts[0].daysBeforeExpiry).toBe(90)
    expect(r.alerts[4].daysBeforeExpiry).toBe(7)
    // 90-day fires at endDate - 90 days = NOW + 10 days.
    const expected90 = new Date(NOW.getTime() + 10 * MS_PER_DAY)
    expect(r.alerts[0].dueAt.getTime()).toBe(expected90.getTime())
  })

  it("skips past-due windows", () => {
    // Contract expires in 25 days — 90/60/30 windows already past.
    const endDate = new Date(NOW.getTime() + 25 * MS_PER_DAY)
    const r = scheduleRenewalAlerts({ contractId: "c2", endDate, asOf: NOW })
    expect(r.alerts.map((a) => a.daysBeforeExpiry)).toEqual([14, 7])
    expect(r.skippedPastDue.sort((a, b) => b - a)).toEqual([90, 60, 30])
  })

  it("emits empty when endDate is null/undefined", () => {
    expect(scheduleRenewalAlerts({ contractId: "c3", endDate: null, asOf: NOW }).alerts).toEqual([])
    expect(scheduleRenewalAlerts({ contractId: "c4", endDate: undefined, asOf: NOW }).alerts).toEqual([])
  })

  it("emits empty when endDate is invalid", () => {
    expect(
      scheduleRenewalAlerts({ contractId: "c5", endDate: new Date(NaN), asOf: NOW }).alerts
    ).toEqual([])
  })

  it("emits empty when asOf is invalid", () => {
    expect(
      scheduleRenewalAlerts({ contractId: "c6", endDate: new Date(NOW.getTime() + 100 * MS_PER_DAY), asOf: new Date(NaN) }).alerts
    ).toEqual([])
  })

  it("respects custom windows subset", () => {
    const endDate = new Date(NOW.getTime() + 100 * MS_PER_DAY)
    const r = scheduleRenewalAlerts({
      contractId: "c7",
      endDate,
      asOf: NOW,
      windows: [90, 7],
    })
    expect(r.alerts.map((a) => a.daysBeforeExpiry)).toEqual([90, 7])
  })

  it("filters out non-canonical window numbers from custom list", () => {
    const endDate = new Date(NOW.getTime() + 100 * MS_PER_DAY)
    const r = scheduleRenewalAlerts({
      contractId: "c8",
      endDate,
      asOf: NOW,
      windows: [90, 45 as never, 7],
    })
    expect(r.alerts.map((a) => a.daysBeforeExpiry)).toEqual([90, 7])
  })

  it("emits empty when contract already expired", () => {
    const endDate = new Date(NOW.getTime() - 5 * MS_PER_DAY)
    const r = scheduleRenewalAlerts({ contractId: "c9", endDate, asOf: NOW })
    expect(r.alerts).toEqual([])
    expect(r.skippedPastDue.sort((a, b) => b - a)).toEqual([90, 60, 30, 14, 7])
  })

  it("at-boundary (exactly at window) is treated as past-due", () => {
    // Contract expires in exactly 90 days → 90-day fire would be NOW → past-due.
    const endDate = new Date(NOW.getTime() + 90 * MS_PER_DAY)
    const r = scheduleRenewalAlerts({ contractId: "c10", endDate, asOf: NOW })
    expect(r.alerts.find((a) => a.daysBeforeExpiry === 90)).toBeUndefined()
    expect(r.skippedPastDue).toContain(90)
  })
})

/* ─── Registry drift guards ───────────────────────────────────────────── */

describe("M5 — registry drift guards", () => {
  it("CONTRACT_STATUSES has exactly 10 states", () => {
    expect(CONTRACT_STATUSES).toHaveLength(10)
  })

  it("STAGE_STATUSES has exactly 5 states", () => {
    expect(STAGE_STATUSES).toEqual(["pending", "approved", "rejected", "skipped", "superseded"])
  })

  it("STAGE_DECISIONS has exactly 2", () => {
    expect(STAGE_DECISIONS).toEqual(["approve", "reject"])
  })

  it("RENEWAL_ALERT_WINDOWS pinned to [90, 60, 30, 14, 7]", () => {
    expect(RENEWAL_ALERT_WINDOWS).toEqual([90, 60, 30, 14, 7])
  })

  it("VARIABLE_TYPES pinned to [string, number, date, boolean]", () => {
    expect(VARIABLE_TYPES).toEqual(["string", "number", "date", "boolean"])
  })

  it("CONTRACT_TRANSITIONS covers every status", () => {
    for (const s of CONTRACT_STATUSES) {
      expect(CONTRACT_TRANSITIONS[s]).toBeDefined()
    }
  })

  it("Terminal states are exactly 5", () => {
    const terminals = CONTRACT_STATUSES.filter((s) => CONTRACT_TRANSITIONS[s].length === 0)
    expect(terminals.sort()).toEqual(
      ["cancelled", "expired", "rejected", "renewed", "terminated"].sort()
    )
  })

  it("approved → cancelled remains allowed (pre-countersign abandonment)", () => {
    // Architect-pass-1 doc-clash fix: clarified that `cancelled` means
    // "before contract takes effect", which legitimately includes the
    // approved-but-not-yet-active phase. Pin the transition so the
    // intent doesn't drift back.
    expect(CONTRACT_TRANSITIONS.approved).toContain("cancelled")
  })

  it("active → cancelled stays forbidden (post-active uses terminated)", () => {
    expect(CONTRACT_TRANSITIONS.active).not.toContain("cancelled")
  })
})

/* ─── Post-architect fixes (slice-1 pass 1 closes) ────────────────────── */

describe("M5 — clause-substituter defense-in-depth", () => {
  const spec: TemplateVariable[] = [
    { name: "clientName", type: "string", required: true },
  ]
  const baseClauses: TemplateClause[] = [
    { id: "x", title: "X", body: "Hi {{clientName}}." },
  ]

  it("flags conditional referencing undeclared var via unknownVars", () => {
    // Architect-flagged: previously the unknownVars sweep only walked
    // body refs, not conditional `var`. A template author could ref
    // `toString` in a conditional and slip past the guard.
    const r = substituteClauses({
      clauses: [
        ...baseClauses,
        {
          id: "y",
          title: "Y",
          body: "static body",
          conditional: { var: "undeclaredCond", equals: true },
        },
      ],
      variables: spec,
      values: { clientName: "Beta" },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.unknownVars).toContain("undeclaredCond")
  })

  it("rejects spec with __proto__ variable name", () => {
    const r = substituteClauses({
      clauses: baseClauses,
      variables: [
        { name: "clientName", type: "string", required: true },
        { name: "__proto__", type: "string", required: false },
      ],
      values: { clientName: "Beta" },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(
        r.typeMismatches.find((t) => t.name === "__spec__" && /reserved/.test(t.got))
      ).toBeDefined()
    }
  })

  it("rejects spec with constructor / prototype variable names", () => {
    for (const evil of ["constructor", "prototype"]) {
      const r = substituteClauses({
        clauses: baseClauses,
        variables: [
          { name: "clientName", type: "string", required: true },
          { name: evil, type: "string", required: false },
        ],
        values: { clientName: "Beta" },
      })
      expect(r.ok).toBe(false)
    }
  })

  it("does NOT leak prototype-chain reads via conditional path", () => {
    // Even if the spec accidentally exposed a forbidden name, the
    // dict is now Object.create(null) so `effective.toString` returns
    // undefined rather than the native Function. We can't directly
    // observe `effective`, but the conditional path would either:
    //   (a) hit unknownVars guard (now extended to conditionals), or
    //   (b) evaluate undefined === <equals> → false → skip clause.
    // Either way, no leak.
    const r = substituteClauses({
      clauses: [
        {
          id: "x",
          title: "X",
          body: "body",
          // `toString` is not declared in spec → unknownVars flag fires.
          conditional: { var: "toString", equals: "function () { ... }" },
        },
      ],
      variables: spec,
      values: { clientName: "Beta" },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.unknownVars).toContain("toString")
  })

  it("ignores forbidden keys in caller-supplied values (extras pass)", () => {
    // Architect-pass-2: the `extras` loop in the substituter skips
    // FORBIDDEN_VAR_NAMES before assigning into effective. To actually
    // exercise the guard, we use `constructor` (enumerable in an
    // object literal — unlike `__proto__` which is a setter and
    // doesn't show up in `Object.keys`). The substituter must:
    //   (a) NOT throw on the bad key,
    //   (b) NOT leak the native `Object.constructor` reference into
    //       effective (which would otherwise be a Function passed
    //       into typeof checks downstream).
    const r = substituteClauses({
      clauses: baseClauses,
      variables: spec,
      values: {
        clientName: "Beta",
        constructor: "malicious string" as never,
      },
    })
    // The forbidden key is silently dropped from extras; body
    // references only clientName, so render succeeds.
    expect(r.ok).toBe(true)
  })

  it("rejects body ref to forbidden key (defense-in-depth, double-coverage)", () => {
    // Even if the substituter's extras-loop guard somehow failed,
    // the unknownVars sweep flags `{{constructor}}` because
    // `constructor` is not declared in the spec — second line of
    // defense.
    const r = substituteClauses({
      clauses: [
        { id: "x", title: "X", body: "Hi {{clientName}}, type: {{constructor}}." },
      ],
      variables: spec,
      values: { clientName: "Beta" },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.unknownVars).toContain("constructor")
  })
})
