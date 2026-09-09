/**
 * Tests for R8 Public Sector Cloud slice 1 — 4 pure helpers + types.
 * No DB.
 */
import { describe, expect, it } from "vitest"
import {
  allowedNextCase,
  allowedNextCitizen,
  allowedNextGrant,
  allowedNextLicense,
  canTransitionCase,
  isCaseTerminal,
  isCitizenTerminal,
  isGrantTerminal,
  isLicenseTerminal,
  transitionCase,
  transitionCitizen,
  transitionGrant,
  transitionLicense,
} from "@/lib/public-sector/state-machine"
import {
  __ROUTING_INTERNALS,
  routeCase,
} from "@/lib/public-sector/case-routing-classifier"
import {
  __LICENSE_INTERNALS,
  calculateLicenseExpiration,
} from "@/lib/public-sector/license-expiration-calculator"
import { calculateGrantDisbursement } from "@/lib/public-sector/grant-disbursement-calculator"
import {
  AUTHORITY_LEVELS,
  CASE_PRIORITIES,
  CASE_STATUSES,
  CASE_TRANSITIONS,
  CASE_TYPES,
  CITIZEN_STATUSES,
  CITIZEN_TRANSITIONS,
  DISBURSEMENT_SCHEDULES,
  GRANT_STATUSES,
  GRANT_TRANSITIONS,
  LICENSE_STATUSES,
  LICENSE_TRANSITIONS,
  LICENSE_TYPES,
  OFFICIAL_ROLES,
  type CaseStatus,
  type CitizenStatus,
  type GrantStatus,
  type LicenseStatus,
} from "@/lib/public-sector/types"

/* ─── Drift guards ───────────────────────────────────────────────────── */

describe("R8 — enum drift guards", () => {
  it("citizen statuses cardinality is 3", () => {
    expect(CITIZEN_STATUSES).toHaveLength(3)
  })
  it("case statuses cardinality is 8", () => {
    expect(CASE_STATUSES).toHaveLength(8)
  })
  it("case types cardinality is 9", () => {
    expect(CASE_TYPES).toHaveLength(9)
  })
  it("case priorities cardinality is 4", () => {
    expect(CASE_PRIORITIES).toHaveLength(4)
  })
  it("license statuses cardinality is 7", () => {
    expect(LICENSE_STATUSES).toHaveLength(7)
  })
  it("license types cardinality is 9", () => {
    expect(LICENSE_TYPES).toHaveLength(9)
  })
  it("grant statuses cardinality is 8", () => {
    expect(GRANT_STATUSES).toHaveLength(8)
  })
  it("official roles cardinality is 7", () => {
    expect(OFFICIAL_ROLES).toHaveLength(7)
  })
  it("authority levels cardinality is 3", () => {
    expect(AUTHORITY_LEVELS).toHaveLength(3)
  })
  it("disbursement schedules cardinality is 4", () => {
    expect(DISBURSEMENT_SCHEDULES).toHaveLength(4)
  })

  it("citizen transition targets all valid", () => {
    for (const s of CITIZEN_STATUSES) {
      for (const t of CITIZEN_TRANSITIONS[s])
        expect(CITIZEN_STATUSES).toContain(t)
    }
  })
  it("case transition targets all valid", () => {
    for (const s of CASE_STATUSES) {
      for (const t of CASE_TRANSITIONS[s]) expect(CASE_STATUSES).toContain(t)
    }
  })
  it("license transition targets all valid", () => {
    for (const s of LICENSE_STATUSES) {
      for (const t of LICENSE_TRANSITIONS[s])
        expect(LICENSE_STATUSES).toContain(t)
    }
  })
  it("grant transition targets all valid", () => {
    for (const s of GRANT_STATUSES) {
      for (const t of GRANT_TRANSITIONS[s]) expect(GRANT_STATUSES).toContain(t)
    }
  })
})

/* ─── Citizen state machine ──────────────────────────────────────────── */

describe("R8 — citizen state machine", () => {
  it("active → inactive → active round-trip legal", () => {
    expect(transitionCitizen("active", "inactive").ok).toBe(true)
    expect(transitionCitizen("inactive", "active").ok).toBe(true)
  })
  it("deceased terminal", () => {
    expect(isCitizenTerminal("deceased")).toBe(true)
  })
  it("unknown / null rejected", () => {
    expect(transitionCitizen("alien" as CitizenStatus, "active").ok).toBe(
      false
    )
    expect(transitionCitizen(null, "active").ok).toBe(false)
  })
  it("no-op rejected", () => {
    expect(transitionCitizen("active", "active").ok).toBe(false)
  })
})

/* ─── Case state machine ─────────────────────────────────────────────── */

describe("R8 — case state machine", () => {
  it("submitted → intake → assigned → in_progress → resolved", () => {
    expect(transitionCase("submitted", "intake").ok).toBe(true)
    expect(transitionCase("intake", "assigned").ok).toBe(true)
    expect(transitionCase("assigned", "in_progress").ok).toBe(true)
    expect(transitionCase("in_progress", "resolved").ok).toBe(true)
  })

  it("can withdraw from any non-terminal status", () => {
    expect(transitionCase("submitted", "withdrawn").ok).toBe(true)
    expect(transitionCase("intake", "withdrawn").ok).toBe(true)
    expect(transitionCase("assigned", "withdrawn").ok).toBe(true)
    expect(transitionCase("in_progress", "withdrawn").ok).toBe(true)
  })

  it("can deny from submitted, intake, assigned, in_progress, escalated", () => {
    expect(transitionCase("submitted", "denied").ok).toBe(true)
    expect(transitionCase("escalated", "denied").ok).toBe(true)
  })

  it("escalated → resolved | denied (cannot withdraw from escalated)", () => {
    expect(transitionCase("escalated", "resolved").ok).toBe(true)
    expect(transitionCase("escalated", "denied").ok).toBe(true)
    expect(transitionCase("escalated", "withdrawn").ok).toBe(false)
  })

  it("in_progress → escalated legal (operator escalates mid-work)", () => {
    expect(transitionCase("in_progress", "escalated").ok).toBe(true)
  })

  it("cannot skip intake (submitted → assigned blocked)", () => {
    expect(transitionCase("submitted", "assigned").ok).toBe(false)
  })

  it("resolved / denied / withdrawn terminal", () => {
    expect(isCaseTerminal("resolved")).toBe(true)
    expect(isCaseTerminal("denied")).toBe(true)
    expect(isCaseTerminal("withdrawn")).toBe(true)
  })

  it("allowedNextCase introspection", () => {
    expect([...allowedNextCase("submitted")]).toEqual([
      "intake",
      "denied",
      "withdrawn",
    ])
    expect([...allowedNextCase("in_progress")]).toEqual([
      "resolved",
      "escalated",
      "denied",
      "withdrawn",
    ])
    expect([...allowedNextCase("resolved")]).toEqual([])
  })
})

/* ─── Context-aware case transition (slice-2 wrapper) ───────────────── */

describe("R8 — canTransitionCase (slice-2 context-aware wrapper)", () => {
  it("escalated → resolved allowed for supervisor authority", () => {
    const r = canTransitionCase("escalated", "resolved", {
      assignedAuthorityLevel: "supervisor",
    })
    expect(r.ok).toBe(true)
  })

  it("escalated → denied allowed for director authority", () => {
    const r = canTransitionCase("escalated", "denied", {
      assignedAuthorityLevel: "director",
    })
    expect(r.ok).toBe(true)
  })

  it("escalated → resolved REJECTED for line authority (supervisor required)", () => {
    const r = canTransitionCase("escalated", "resolved", {
      assignedAuthorityLevel: "line",
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("supervisor authority")
      expect(r.error).toContain("line")
    }
  })

  it("escalated → denied REJECTED for line authority", () => {
    const r = canTransitionCase("escalated", "denied", {
      assignedAuthorityLevel: "line",
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("supervisor authority")
    }
  })

  it("escalated decision REJECTED with null authority (unassigned)", () => {
    const r = canTransitionCase("escalated", "resolved", {
      assignedAuthorityLevel: null,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("unassigned")
    }
  })

  it("non-escalated transitions ignore authority context", () => {
    // in_progress → resolved: line officer can drive (it's the
    // normal path that doesn't go through escalation).
    const r = canTransitionCase("in_progress", "resolved", {
      assignedAuthorityLevel: "line",
    })
    expect(r.ok).toBe(true)
  })

  it("in_progress → escalated allowed for any authority (escalation is one-way push)", () => {
    const r = canTransitionCase("in_progress", "escalated", {
      assignedAuthorityLevel: "line",
    })
    expect(r.ok).toBe(true)
  })

  it("illegal state-machine transition short-circuits BEFORE authority check", () => {
    // escalated → submitted is illegal (escalated is one-way → terminal).
    // Even with director authority, the state-machine error wins.
    const r = canTransitionCase("escalated", "submitted", {
      assignedAuthorityLevel: "director",
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("illegal case transition")
    }
  })
})

/* ─── License state machine ──────────────────────────────────────────── */

describe("R8 — license state machine", () => {
  it("applied → under_review → issued happy path", () => {
    expect(transitionLicense("applied", "under_review").ok).toBe(true)
    expect(transitionLicense("under_review", "issued").ok).toBe(true)
  })

  it("issued → expired | suspended | revoked", () => {
    expect(transitionLicense("issued", "expired").ok).toBe(true)
    expect(transitionLicense("issued", "suspended").ok).toBe(true)
    expect(transitionLicense("issued", "revoked").ok).toBe(true)
  })

  it("suspended → issued (reinstatement) | revoked", () => {
    expect(transitionLicense("suspended", "issued").ok).toBe(true)
    expect(transitionLicense("suspended", "revoked").ok).toBe(true)
  })

  it("cannot skip under_review (applied → issued blocked)", () => {
    expect(transitionLicense("applied", "issued").ok).toBe(false)
  })

  it("cannot resurrect from expired / revoked / denied", () => {
    expect(isLicenseTerminal("expired")).toBe(true)
    expect(isLicenseTerminal("revoked")).toBe(true)
    expect(isLicenseTerminal("denied")).toBe(true)
    for (const t of LICENSE_STATUSES) {
      if (t === "expired") continue
      expect(transitionLicense("expired", t).ok).toBe(false)
    }
  })

  it("allowedNextLicense introspection", () => {
    expect([...allowedNextLicense("issued")]).toEqual([
      "expired",
      "suspended",
      "revoked",
    ])
    expect([...allowedNextLicense("suspended")]).toEqual(["issued", "revoked"])
  })
})

/* ─── Grant state machine ────────────────────────────────────────────── */

describe("R8 — grant state machine", () => {
  it("submitted → under_review → approved → disbursing → disbursed", () => {
    expect(transitionGrant("submitted", "under_review").ok).toBe(true)
    expect(transitionGrant("under_review", "approved").ok).toBe(true)
    expect(transitionGrant("approved", "disbursing").ok).toBe(true)
    expect(transitionGrant("disbursing", "disbursed").ok).toBe(true)
  })

  it("can cancel from approved or disbursing", () => {
    expect(transitionGrant("approved", "cancelled").ok).toBe(true)
    expect(transitionGrant("disbursing", "cancelled").ok).toBe(true)
  })

  it("can withdraw from submitted or under_review only", () => {
    expect(transitionGrant("submitted", "withdrawn").ok).toBe(true)
    expect(transitionGrant("under_review", "withdrawn").ok).toBe(true)
    expect(transitionGrant("approved", "withdrawn").ok).toBe(false)
  })

  it("can deny from under_review only", () => {
    expect(transitionGrant("under_review", "denied").ok).toBe(true)
    expect(transitionGrant("submitted", "denied").ok).toBe(false)
    expect(transitionGrant("approved", "denied").ok).toBe(false)
  })

  it("disbursed / denied / withdrawn / cancelled terminal", () => {
    expect(isGrantTerminal("disbursed")).toBe(true)
    expect(isGrantTerminal("denied")).toBe(true)
    expect(isGrantTerminal("withdrawn")).toBe(true)
    expect(isGrantTerminal("cancelled")).toBe(true)
  })

  it("allowedNextGrant introspection", () => {
    expect([...allowedNextGrant("under_review")]).toEqual([
      "approved",
      "denied",
      "withdrawn",
    ])
  })
})

/* ─── Case routing classifier ────────────────────────────────────────── */

describe("R8 — case routing classifier", () => {
  it("benefits_application → benefits queue, routine, 30-day deadline", () => {
    const r = routeCase({ caseType: "benefits_application" })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.route.agencySlug).toBe("benefits")
      expect(r.route.suggestedPriority).toBe("routine")
      expect(r.route.statutoryResponseDays).toBe(30)
    }
  })

  it("records_request → records-foia, elevated, 20-day FOIA deadline", () => {
    const r = routeCase({ caseType: "records_request" })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.route.agencySlug).toBe("records-foia")
      expect(r.route.statutoryResponseDays).toBe(20)
    }
  })

  it("inquiry has NO statutory deadline (null)", () => {
    const r = routeCase({ caseType: "inquiry" })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.route.statutoryResponseDays).toBeNull()
    }
  })

  it("priorityOverride wins over base priority", () => {
    const r = routeCase({
      caseType: "benefits_application",
      priorityOverride: "emergency",
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.route.suggestedPriority).toBe("emergency")
  })

  it("appeal → appeals, urgent, 90-day deadline", () => {
    const r = routeCase({ caseType: "appeal" })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.route.agencySlug).toBe("appeals")
      expect(r.route.suggestedPriority).toBe("urgent")
      expect(r.route.statutoryResponseDays).toBe(90)
    }
  })

  it("hearing_request → hearings, urgent, 60-day", () => {
    const r = routeCase({ caseType: "hearing_request" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.route.statutoryResponseDays).toBe(60)
  })

  it("complaint → ombudsman queue", () => {
    const r = routeCase({ caseType: "complaint" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.route.agencySlug).toBe("ombudsman")
  })

  it("rejects unknown caseType", () => {
    const r = routeCase({ caseType: "ufo_sighting" as never })
    expect(r.ok).toBe(false)
  })

  it("rejects unknown priorityOverride", () => {
    const r = routeCase({
      caseType: "complaint",
      priorityOverride: "instant" as never,
    })
    expect(r.ok).toBe(false)
  })

  it("rejects non-string jurisdictionSlug", () => {
    const r = routeCase({
      caseType: "complaint",
      jurisdictionSlug: 42 as never,
    })
    expect(r.ok).toBe(false)
  })

  it("ROUTING_TABLE pins every caseType", () => {
    for (const t of CASE_TYPES) {
      expect(__ROUTING_INTERNALS.ROUTING_TABLE[t]).toBeDefined()
      const entry = __ROUTING_INTERNALS.ROUTING_TABLE[t]
      expect(entry.agencySlug.length).toBeGreaterThan(0)
      expect(CASE_PRIORITIES).toContain(entry.basePriority)
    }
  })

  it("statutoryResponseDays are positive or null", () => {
    for (const t of CASE_TYPES) {
      const d = __ROUTING_INTERNALS.ROUTING_TABLE[t].statutoryResponseDays
      if (d !== null) {
        expect(d).toBeGreaterThan(0)
      }
    }
  })
})

/* ─── License expiration calculator ──────────────────────────────────── */

describe("R8 — license expiration calculator", () => {
  it("driver license — 4 year term, 30-day grace", () => {
    const r = calculateLicenseExpiration({
      licenseType: "driver",
      issuedAt: new Date("2026-05-15T00:00:00Z"),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.expiration.termYears).toBe(4)
      expect(r.expiration.gracePeriodDays).toBe(30)
      // ~4 years after = mid-2030
      expect(r.expiration.expiresAt.getUTCFullYear()).toBe(2030)
    }
  })

  it("food_service — 1 year, NO grace", () => {
    const r = calculateLicenseExpiration({
      licenseType: "food_service",
      issuedAt: new Date("2026-05-15T00:00:00Z"),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.expiration.termYears).toBe(1)
      expect(r.expiration.gracePeriodDays).toBe(0)
    }
  })

  it("professional — 2 year, 60-day grace", () => {
    const r = calculateLicenseExpiration({
      licenseType: "professional",
      issuedAt: new Date("2026-05-15T00:00:00Z"),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.expiration.termYears).toBe(2)
      expect(r.expiration.gracePeriodDays).toBe(60)
    }
  })

  it("event_permit — fractional 1/365 year = exactly 1 calendar day (slice-2 fix)", () => {
    // Slice-1 used 365.25-day-year for ALL terms which made
    // event_permit (1/365 yr) come out ~59 seconds short of 24h.
    // Slice-2: termYears<1 uses Math.round on (termYears × 365) days,
    // so event_permit lands on the EXACT next-day boundary.
    const r = calculateLicenseExpiration({
      licenseType: "event_permit",
      issuedAt: new Date("2026-05-15T00:00:00Z"),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.expiration.termYears).toBeCloseTo(1 / 365, 6)
      const diffMs =
        r.expiration.expiresAt.getTime() - new Date("2026-05-15T00:00:00Z").getTime()
      const ONE_DAY = 24 * 60 * 60 * 1000
      // EXACTLY 1 day now — no drift.
      expect(diffMs).toBe(ONE_DAY)
      // The exact expiresAt should be 2026-05-16T00:00:00Z.
      expect(r.expiration.expiresAt.toISOString()).toBe("2026-05-16T00:00:00.000Z")
    }
  })

  it("sub-year termYearsOverride (e.g. 30 days = 30/365 yr) rounds to whole days", () => {
    // termYearsOverride = 30/365 (≈ 0.0822). Expected: 30 days exactly,
    // not 30 × 365.25/365 = 30.02 days = 30d 30min.
    const r = calculateLicenseExpiration({
      licenseType: "event_permit",
      issuedAt: new Date("2026-05-15T00:00:00Z"),
      termYearsOverride: 30 / 365,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      const diffMs =
        r.expiration.expiresAt.getTime() - new Date("2026-05-15T00:00:00Z").getTime()
      const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000
      expect(diffMs).toBe(THIRTY_DAYS)
    }
  })

  it("long-term licenses keep 365.25-day-year leap-year averaging", () => {
    // Driver license = 4 years default. Should use 365.25-day average
    // — over 4 years that's 1461 days = 4 × 365 + 1 leap day.
    // Slice-2 change only affects termYears<1; multi-year licenses
    // continue using 365.25-day-year averaging.
    const r = calculateLicenseExpiration({
      licenseType: "driver",
      issuedAt: new Date("2026-05-15T00:00:00Z"),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      const diffDays =
        (r.expiration.expiresAt.getTime() -
          new Date("2026-05-15T00:00:00Z").getTime()) /
        (24 * 60 * 60 * 1000)
      expect(diffDays).toBeCloseTo(4 * 365.25, 4)
    }
  })

  it("termYearsOverride wins over default", () => {
    const r = calculateLicenseExpiration({
      licenseType: "driver",
      issuedAt: new Date("2026-05-15T00:00:00Z"),
      termYearsOverride: 1,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.expiration.termYears).toBe(1)
  })

  it("rejects unknown licenseType", () => {
    const r = calculateLicenseExpiration({
      licenseType: "alien_visa" as never,
      issuedAt: new Date("2026-05-15T00:00:00Z"),
    })
    expect(r.ok).toBe(false)
  })

  it("rejects non-finite issuedAt", () => {
    const r = calculateLicenseExpiration({
      licenseType: "driver",
      issuedAt: new Date("invalid"),
    })
    expect(r.ok).toBe(false)
  })

  it("rejects non-positive termYearsOverride", () => {
    const r = calculateLicenseExpiration({
      licenseType: "driver",
      issuedAt: new Date("2026-05-15T00:00:00Z"),
      termYearsOverride: 0,
    })
    expect(r.ok).toBe(false)
  })

  it("TERM_YEARS_DEFAULT pins every licenseType", () => {
    for (const t of LICENSE_TYPES) {
      expect(__LICENSE_INTERNALS.TERM_YEARS_DEFAULT[t]).toBeGreaterThan(0)
      expect(
        __LICENSE_INTERNALS.GRACE_PERIOD_DAYS[t]
      ).toBeGreaterThanOrEqual(0)
    }
  })
})

/* ─── Grant disbursement calculator ──────────────────────────────────── */

describe("R8 — grant disbursement calculator", () => {
  it("lump_sum — 1 tranche on startDate, full amount", () => {
    const r = calculateGrantDisbursement({
      approvedAmount: 50_000,
      schedule: "lump_sum",
      startDate: new Date("2026-05-15T00:00:00Z"),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.plan.tranches).toHaveLength(1)
      expect(r.plan.tranches[0].amount).toBe(50_000)
      expect(r.plan.totalScheduled).toBe(50_000)
    }
  })

  it("quarterly — 4 tranches of equal amount", () => {
    const r = calculateGrantDisbursement({
      approvedAmount: 100_000,
      schedule: "quarterly",
      startDate: new Date("2026-05-15T00:00:00Z"),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.plan.tranches).toHaveLength(4)
      for (const t of r.plan.tranches) {
        expect(t.amount).toBe(25_000)
      }
      expect(r.plan.totalScheduled).toBe(100_000)
    }
  })

  it("monthly — 12 tranches summing to approvedAmount", () => {
    const r = calculateGrantDisbursement({
      approvedAmount: 120_000,
      schedule: "monthly",
      startDate: new Date("2026-05-15T00:00:00Z"),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.plan.tranches).toHaveLength(12)
      expect(r.plan.totalScheduled).toBe(120_000)
    }
  })

  it("monthly with rounding — last tranche absorbs cents", () => {
    // 100 / 12 = 8.333... so most tranches round, last absorbs.
    const r = calculateGrantDisbursement({
      approvedAmount: 100,
      schedule: "monthly",
      startDate: new Date("2026-05-15T00:00:00Z"),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      // First 11 = 8.33 each, last = 100 - 11*8.33 = 100 - 91.63 = 8.37
      expect(r.plan.totalScheduled).toBe(100)
      expect(r.plan.tranches[0].amount).toBe(8.33)
      expect(r.plan.tranches[11].amount).toBeCloseTo(8.37, 2)
    }
  })

  it("milestone — caller-supplied percentages", () => {
    const r = calculateGrantDisbursement({
      approvedAmount: 200_000,
      schedule: "milestone",
      startDate: new Date("2026-05-15T00:00:00Z"),
      milestoneCount: 3,
      milestonePercentages: [40, 30, 30],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.plan.tranches).toHaveLength(3)
      expect(r.plan.tranches[0].amount).toBe(80_000)
      expect(r.plan.tranches[1].amount).toBe(60_000)
      expect(r.plan.tranches[2].amount).toBe(60_000)
      expect(r.plan.totalScheduled).toBe(200_000)
    }
  })

  it("milestone — rejects missing milestoneCount", () => {
    const r = calculateGrantDisbursement({
      approvedAmount: 100,
      schedule: "milestone",
      startDate: new Date("2026-05-15T00:00:00Z"),
    })
    expect(r.ok).toBe(false)
  })

  it("milestone — rejects milestonePercentages != milestoneCount length", () => {
    const r = calculateGrantDisbursement({
      approvedAmount: 100,
      schedule: "milestone",
      startDate: new Date("2026-05-15T00:00:00Z"),
      milestoneCount: 3,
      milestonePercentages: [50, 50], // length 2 != 3
    })
    expect(r.ok).toBe(false)
  })

  it("milestone — rejects percentages not summing to 100", () => {
    const r = calculateGrantDisbursement({
      approvedAmount: 100,
      schedule: "milestone",
      startDate: new Date("2026-05-15T00:00:00Z"),
      milestoneCount: 2,
      milestonePercentages: [40, 40], // sum = 80
    })
    expect(r.ok).toBe(false)
  })

  it("milestone — accepts percentages within 0.01 tolerance", () => {
    const r = calculateGrantDisbursement({
      approvedAmount: 100,
      schedule: "milestone",
      startDate: new Date("2026-05-15T00:00:00Z"),
      milestoneCount: 3,
      milestonePercentages: [33.33, 33.33, 33.34],
    })
    expect(r.ok).toBe(true)
  })

  it("milestone — rejects negative percentage", () => {
    const r = calculateGrantDisbursement({
      approvedAmount: 100,
      schedule: "milestone",
      startDate: new Date("2026-05-15T00:00:00Z"),
      milestoneCount: 2,
      milestonePercentages: [120, -20], // sum = 100 but negative present
    })
    expect(r.ok).toBe(false)
  })

  it("milestone — rejects milestoneCount < 2", () => {
    const r = calculateGrantDisbursement({
      approvedAmount: 100,
      schedule: "milestone",
      startDate: new Date("2026-05-15T00:00:00Z"),
      milestoneCount: 1,
      milestonePercentages: [100],
    })
    expect(r.ok).toBe(false)
  })

  it("milestone — rejects milestoneCount > 100", () => {
    const r = calculateGrantDisbursement({
      approvedAmount: 100,
      schedule: "milestone",
      startDate: new Date("2026-05-15T00:00:00Z"),
      milestoneCount: 101,
      milestonePercentages: Array.from({ length: 101 }, () => 100 / 101),
    })
    expect(r.ok).toBe(false)
  })

  it("rejects negative approvedAmount", () => {
    const r = calculateGrantDisbursement({
      approvedAmount: -100,
      schedule: "lump_sum",
      startDate: new Date("2026-05-15T00:00:00Z"),
    })
    expect(r.ok).toBe(false)
  })

  it("rejects non-finite startDate", () => {
    const r = calculateGrantDisbursement({
      approvedAmount: 100,
      schedule: "lump_sum",
      startDate: new Date("invalid"),
    })
    expect(r.ok).toBe(false)
  })

  it("rejects unknown schedule", () => {
    const r = calculateGrantDisbursement({
      approvedAmount: 100,
      schedule: "biennial" as never,
      startDate: new Date("2026-05-15T00:00:00Z"),
    })
    expect(r.ok).toBe(false)
  })

  it("zero approved amount → single zero tranche (lump sum)", () => {
    const r = calculateGrantDisbursement({
      approvedAmount: 0,
      schedule: "lump_sum",
      startDate: new Date("2026-05-15T00:00:00Z"),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.plan.tranches[0].amount).toBe(0)
      expect(r.plan.totalScheduled).toBe(0)
    }
  })

  it("quarterly tranche dates are 90 days apart", () => {
    const r = calculateGrantDisbursement({
      approvedAmount: 100,
      schedule: "quarterly",
      startDate: new Date("2026-05-15T00:00:00Z"),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      const t0 = r.plan.tranches[0].scheduledDate.getTime()
      const t1 = r.plan.tranches[1].scheduledDate.getTime()
      const ninetyDays = 90 * 24 * 60 * 60 * 1000
      expect(t1 - t0).toBe(ninetyDays)
    }
  })
})

/* ─── Terminal-set drift ─────────────────────────────────────────────── */

describe("R8 — terminal-set drift", () => {
  it("citizen terminals: { deceased }", () => {
    expect(
      [...CITIZEN_STATUSES.filter((s) => isCitizenTerminal(s))].sort()
    ).toEqual(["deceased"])
  })

  it("case terminals: { denied, resolved, withdrawn }", () => {
    expect(
      [...CASE_STATUSES.filter((s) => isCaseTerminal(s))].sort()
    ).toEqual(["denied", "resolved", "withdrawn"])
  })

  it("license terminals: { denied, expired, revoked }", () => {
    expect(
      [...LICENSE_STATUSES.filter((s) => isLicenseTerminal(s))].sort()
    ).toEqual(["denied", "expired", "revoked"])
  })

  it("grant terminals: { cancelled, denied, disbursed, withdrawn }", () => {
    expect(
      [...GRANT_STATUSES.filter((s) => isGrantTerminal(s))].sort()
    ).toEqual(["cancelled", "denied", "disbursed", "withdrawn"])
  })

  it("active state NOT terminal across all 4 entities", () => {
    expect(isCitizenTerminal("active" as CitizenStatus)).toBe(false)
    expect(isCaseTerminal("in_progress" as CaseStatus)).toBe(false)
    expect(isLicenseTerminal("issued" as LicenseStatus)).toBe(false)
    expect(isGrantTerminal("approved" as GrantStatus)).toBe(false)
  })
})
