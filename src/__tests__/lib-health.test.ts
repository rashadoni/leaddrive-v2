/**
 * Tests for R2 Health Cloud slice 1 — 4 pure helpers + types.
 * No DB.
 */
import { describe, expect, it } from "vitest"
import {
  allowedNextCarePlan,
  allowedNextEncounter,
  allowedNextPatient,
  isCarePlanTerminal,
  isEncounterTerminal,
  isPatientTerminal,
  transitionCarePlan,
  transitionEncounter,
  transitionPatient,
} from "@/lib/health/state-machine"
import {
  __VALIDATOR_INTERNALS,
  validateMedicalRecord,
} from "@/lib/health/medical-record-validator"
import { calculateCarePlanProgress } from "@/lib/health/care-plan-progress-calculator"
import {
  __SCHEDULER_INTERNALS,
  scheduleAppointment,
} from "@/lib/health/appointment-scheduler"
import {
  CARE_PLAN_STATUSES,
  CARE_PLAN_TRANSITIONS,
  ENCOUNTER_STATUSES,
  ENCOUNTER_TRANSITIONS,
  ENCOUNTER_TYPES,
  GOAL_COMPARATORS,
  GOAL_KPI_SOURCES,
  MEDICAL_RECORD_SENSITIVITIES,
  MEDICAL_RECORD_SEVERITIES,
  MEDICAL_RECORD_TYPES,
  PATIENT_STATUSES,
  PATIENT_TRANSITIONS,
  PROVIDER_ROLES,
  type CarePlanGoal,
  type CarePlanStatus,
  type EncounterStatus,
  type ExistingSlot,
  type PatientStatus,
} from "@/lib/health/types"

/* ─── Drift guards — enum cardinality ────────────────────────────────── */

describe("R2 — enum drift guards", () => {
  it("patient statuses cardinality is 4", () => {
    expect(PATIENT_STATUSES).toHaveLength(4)
    expect(new Set(PATIENT_STATUSES).size).toBe(4)
  })

  it("encounter statuses cardinality is 6", () => {
    expect(ENCOUNTER_STATUSES).toHaveLength(6)
    expect(new Set(ENCOUNTER_STATUSES).size).toBe(6)
  })

  it("encounter types cardinality is 5", () => {
    expect(ENCOUNTER_TYPES).toHaveLength(5)
    expect(new Set(ENCOUNTER_TYPES).size).toBe(5)
  })

  it("care plan statuses cardinality is 5", () => {
    expect(CARE_PLAN_STATUSES).toHaveLength(5)
    expect(new Set(CARE_PLAN_STATUSES).size).toBe(5)
  })

  it("medical record types cardinality is 10", () => {
    expect(MEDICAL_RECORD_TYPES).toHaveLength(10)
    expect(new Set(MEDICAL_RECORD_TYPES).size).toBe(10)
  })

  it("medical record severities cardinality is 5", () => {
    expect(MEDICAL_RECORD_SEVERITIES).toHaveLength(5)
  })

  it("medical record sensitivities cardinality is 3", () => {
    expect(MEDICAL_RECORD_SENSITIVITIES).toHaveLength(3)
  })

  it("provider roles cardinality is 8", () => {
    expect(PROVIDER_ROLES).toHaveLength(8)
  })

  it("goal comparators cardinality is 3", () => {
    expect(GOAL_COMPARATORS).toHaveLength(3)
  })

  it("goal kpi sources cardinality is 2", () => {
    expect(GOAL_KPI_SOURCES).toHaveLength(2)
  })

  it("every patient status has a transition entry", () => {
    for (const s of PATIENT_STATUSES) {
      expect(PATIENT_TRANSITIONS[s]).toBeDefined()
    }
  })

  it("every encounter status has a transition entry", () => {
    for (const s of ENCOUNTER_STATUSES) {
      expect(ENCOUNTER_TRANSITIONS[s]).toBeDefined()
    }
  })

  it("every care plan status has a transition entry", () => {
    for (const s of CARE_PLAN_STATUSES) {
      expect(CARE_PLAN_TRANSITIONS[s]).toBeDefined()
    }
  })

  it("every transition target is itself a valid status", () => {
    // catches a future enum-rename leaving stale strings in the table
    for (const s of PATIENT_STATUSES) {
      for (const t of PATIENT_TRANSITIONS[s]) {
        expect(PATIENT_STATUSES).toContain(t)
      }
    }
    for (const s of ENCOUNTER_STATUSES) {
      for (const t of ENCOUNTER_TRANSITIONS[s]) {
        expect(ENCOUNTER_STATUSES).toContain(t)
      }
    }
    for (const s of CARE_PLAN_STATUSES) {
      for (const t of CARE_PLAN_TRANSITIONS[s]) {
        expect(CARE_PLAN_STATUSES).toContain(t)
      }
    }
  })
})

/* ─── Patient state machine ──────────────────────────────────────────── */

describe("R2 — patient state machine", () => {
  it("active → discharged is legal", () => {
    expect(transitionPatient("active", "discharged")).toEqual({ ok: true })
  })

  it("active → deceased is legal", () => {
    expect(transitionPatient("active", "deceased")).toEqual({ ok: true })
  })

  it("discharged → active (re-admit) is legal", () => {
    expect(transitionPatient("discharged", "active")).toEqual({ ok: true })
  })

  it("deceased is terminal — every onward transition rejected", () => {
    for (const target of PATIENT_STATUSES) {
      if (target === "deceased") continue
      const r = transitionPatient("deceased", target)
      expect(r.ok).toBe(false)
    }
    expect(isPatientTerminal("deceased")).toBe(true)
  })

  it("no-op transition rejected", () => {
    const r = transitionPatient("active", "active")
    expect(r.ok).toBe(false)
  })

  it("unknown source / target rejected", () => {
    expect(transitionPatient("zombie", "active").ok).toBe(false)
    expect(transitionPatient("active", "zombie").ok).toBe(false)
    expect(transitionPatient(null, "active").ok).toBe(false)
    expect(transitionPatient("active", undefined).ok).toBe(false)
    expect(transitionPatient(42, "active").ok).toBe(false)
  })

  it("inactive is NOT terminal", () => {
    expect(isPatientTerminal("inactive")).toBe(false)
  })

  it("active is NOT terminal", () => {
    expect(isPatientTerminal("active")).toBe(false)
  })

  it("allowedNextPatient surfaces table row", () => {
    expect([...allowedNextPatient("active")]).toEqual([
      "inactive",
      "discharged",
      "deceased",
    ])
    expect([...allowedNextPatient("deceased")]).toEqual([])
  })

  it("illegal transition: discharged → inactive blocked (only re-admit via active)", () => {
    const r = transitionPatient(
      "discharged" as PatientStatus,
      "inactive" as PatientStatus
    )
    expect(r.ok).toBe(false)
  })
})

/* ─── Encounter state machine ────────────────────────────────────────── */

describe("R2 — encounter state machine", () => {
  it("scheduled → checked_in → in_progress → completed full happy path", () => {
    expect(transitionEncounter("scheduled", "checked_in").ok).toBe(true)
    expect(transitionEncounter("checked_in", "in_progress").ok).toBe(true)
    expect(transitionEncounter("in_progress", "completed").ok).toBe(true)
  })

  it("scheduled → no_show legal", () => {
    expect(transitionEncounter("scheduled", "no_show").ok).toBe(true)
  })

  it("cannot skip checked_in → completed (must go via in_progress)", () => {
    const r = transitionEncounter("checked_in", "completed")
    expect(r.ok).toBe(false)
  })

  it("cannot transition scheduled → completed", () => {
    expect(transitionEncounter("scheduled", "completed").ok).toBe(false)
  })

  it("completed / no_show / cancelled are terminal", () => {
    expect(isEncounterTerminal("completed")).toBe(true)
    expect(isEncounterTerminal("no_show")).toBe(true)
    expect(isEncounterTerminal("cancelled")).toBe(true)
  })

  it("cancellation legal from non-terminal states", () => {
    expect(transitionEncounter("scheduled", "cancelled").ok).toBe(true)
    expect(transitionEncounter("checked_in", "cancelled").ok).toBe(true)
    expect(transitionEncounter("in_progress", "cancelled").ok).toBe(true)
  })

  it("cannot re-cancel a completed encounter", () => {
    expect(transitionEncounter("completed", "cancelled").ok).toBe(false)
  })

  it("allowedNextEncounter table introspection", () => {
    expect([...allowedNextEncounter("scheduled")]).toEqual([
      "checked_in",
      "no_show",
      "cancelled",
    ])
    expect([...allowedNextEncounter("completed")]).toEqual([])
  })

  it("unknown values rejected", () => {
    expect(transitionEncounter("xxx" as EncounterStatus, "scheduled").ok).toBe(
      false
    )
  })
})

/* ─── Care plan state machine ────────────────────────────────────────── */

describe("R2 — care plan state machine", () => {
  it("draft → active legal", () => {
    expect(transitionCarePlan("draft", "active").ok).toBe(true)
  })

  it("draft → completed BLOCKED (must activate first)", () => {
    expect(transitionCarePlan("draft", "completed").ok).toBe(false)
  })

  it("active → paused → active round-trip legal", () => {
    expect(transitionCarePlan("active", "paused").ok).toBe(true)
    expect(transitionCarePlan("paused", "active").ok).toBe(true)
  })

  it("completed terminal", () => {
    for (const target of CARE_PLAN_STATUSES) {
      if (target === "completed") continue
      expect(transitionCarePlan("completed", target).ok).toBe(false)
    }
    expect(isCarePlanTerminal("completed")).toBe(true)
  })

  it("cancelled terminal", () => {
    expect(isCarePlanTerminal("cancelled")).toBe(true)
  })

  it("draft is NOT terminal", () => {
    expect(isCarePlanTerminal("draft")).toBe(false)
  })

  it("allowedNextCarePlan table introspection", () => {
    expect([...allowedNextCarePlan("draft")]).toEqual(["active", "cancelled"])
    expect([...allowedNextCarePlan("active")]).toEqual([
      "paused",
      "completed",
      "cancelled",
    ])
  })

  it("paused → completed BLOCKED (must resume first)", () => {
    const r = transitionCarePlan(
      "paused" as CarePlanStatus,
      "completed" as CarePlanStatus
    )
    expect(r.ok).toBe(false)
  })
})

/* ─── Medical record validator ───────────────────────────────────────── */

describe("R2 — medical record validator", () => {
  it("happy path: diagnosis with all required keys", () => {
    expect(
      validateMedicalRecord({
        recordType: "diagnosis",
        severity: "moderate",
        sensitivity: "normal",
        details: {
          icd10Code: "E11.9",
          description: "Type 2 diabetes mellitus without complications",
          status: "active",
        },
      })
    ).toEqual({ ok: true })
  })

  it("happy path: vital_signs with all optional keys (no required)", () => {
    expect(
      validateMedicalRecord({
        recordType: "vital_signs",
        severity: "informational",
        sensitivity: "normal",
        details: {
          bloodPressureSystolic: 120,
          bloodPressureDiastolic: 80,
          heartRate: 72,
          temperatureCelsius: 36.7,
        },
      })
    ).toEqual({ ok: true })
  })

  it("happy path: vital_signs with empty details (zero required keys)", () => {
    const r = validateMedicalRecord({
      recordType: "vital_signs",
      severity: "informational",
      sensitivity: "normal",
      details: {},
    })
    expect(r.ok).toBe(true)
  })

  it("rejects unknown recordType", () => {
    const r = validateMedicalRecord({
      recordType: "xxx" as never,
      severity: "informational",
      sensitivity: "normal",
      details: {},
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe("recordType")
  })

  it("rejects unknown severity", () => {
    const r = validateMedicalRecord({
      recordType: "vital_signs",
      severity: "deadly" as never,
      sensitivity: "normal",
      details: {},
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe("severity")
  })

  it("rejects unknown sensitivity", () => {
    const r = validateMedicalRecord({
      recordType: "vital_signs",
      severity: "informational",
      sensitivity: "private" as never,
      details: {},
    })
    expect(r.ok).toBe(false)
  })

  it("rejects null details", () => {
    const r = validateMedicalRecord({
      recordType: "vital_signs",
      severity: "informational",
      sensitivity: "normal",
      details: null,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe("details")
  })

  it("rejects array details", () => {
    const r = validateMedicalRecord({
      recordType: "vital_signs",
      severity: "informational",
      sensitivity: "normal",
      details: [],
    })
    expect(r.ok).toBe(false)
  })

  it("rejects Date details", () => {
    const r = validateMedicalRecord({
      recordType: "vital_signs",
      severity: "informational",
      sensitivity: "normal",
      details: new Date(),
    })
    expect(r.ok).toBe(false)
  })

  it("rejects primitive details", () => {
    expect(
      validateMedicalRecord({
        recordType: "vital_signs",
        severity: "informational",
        sensitivity: "normal",
        details: 42,
      }).ok
    ).toBe(false)
  })

  it("rejects missing required key (diagnosis without icd10Code)", () => {
    const r = validateMedicalRecord({
      recordType: "diagnosis",
      severity: "moderate",
      sensitivity: "normal",
      details: {
        description: "...",
        status: "active",
      },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/icd10Code/)
  })

  it("rejects null in required key", () => {
    const r = validateMedicalRecord({
      recordType: "diagnosis",
      severity: "moderate",
      sensitivity: "normal",
      details: {
        icd10Code: null,
        description: "x",
        status: "active",
      },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects undefined in required key", () => {
    const r = validateMedicalRecord({
      recordType: "diagnosis",
      severity: "moderate",
      sensitivity: "normal",
      details: {
        icd10Code: undefined,
        description: "x",
        status: "active",
      },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects extra (non-allowed) key", () => {
    const r = validateMedicalRecord({
      recordType: "diagnosis",
      severity: "moderate",
      sensitivity: "normal",
      details: {
        icd10Code: "E11.9",
        description: "x",
        status: "active",
        unknownExtraKey: "leak",
      },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/unknownExtraKey/)
  })

  it("rejects prototype-chain pollution via constructor", () => {
    // constructor is a writable own property — enumerable when set
    const polluted = Object.assign(Object.create(null), {
      icd10Code: "E11.9",
      description: "x",
      status: "active",
      constructor: "evil",
    }) as Record<string, unknown>
    const r = validateMedicalRecord({
      recordType: "diagnosis",
      severity: "moderate",
      sensitivity: "normal",
      details: polluted,
    })
    expect(r.ok).toBe(false)
  })

  it("rejects prototype-chain pollution via prototype key", () => {
    const polluted: Record<string, unknown> = {
      icd10Code: "E11.9",
      description: "x",
      status: "active",
    }
    Object.defineProperty(polluted, "prototype", {
      enumerable: true,
      value: "evil",
    })
    const r = validateMedicalRecord({
      recordType: "diagnosis",
      severity: "moderate",
      sensitivity: "normal",
      details: polluted,
    })
    expect(r.ok).toBe(false)
  })

  it("rejects prototype-chain pollution via __proto__ as JSON.parse own-key", () => {
    // JSON.parse creates "__proto__" as an OWN data property (not a setter),
    // unlike object literals where __proto__ is the prototype-set sigil.
    // This is the realistic attack vector for prototype pollution from
    // untrusted JSON payloads (e.g. an integration callback). The guard
    // must use Object.prototype.hasOwnProperty.call to catch it.
    const polluted = JSON.parse(
      '{"__proto__":{"polluted":"evil"},"icd10Code":"E11.9","description":"x","status":"active"}'
    ) as Record<string, unknown>
    const r = validateMedicalRecord({
      recordType: "diagnosis",
      severity: "moderate",
      sensitivity: "normal",
      details: polluted,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toMatch(/__proto__/)
    }
  })

  it("internals — every recordType has REQUIRED entry", () => {
    for (const t of MEDICAL_RECORD_TYPES) {
      expect(__VALIDATOR_INTERNALS.REQUIRED_KEYS[t]).toBeDefined()
      expect(__VALIDATOR_INTERNALS.OPTIONAL_KEYS[t]).toBeDefined()
    }
  })

  it("FORBIDDEN_KEYS pins __proto__ / constructor / prototype", () => {
    // Drift guard: shrinking this set re-opens the prototype-pollution
    // attack vectors covered by the three pollution tests above. Pin
    // the contract so future edits to the validator can't silently
    // drop one of these keys.
    expect(__VALIDATOR_INTERNALS.FORBIDDEN_KEYS.has("__proto__")).toBe(true)
    expect(__VALIDATOR_INTERNALS.FORBIDDEN_KEYS.has("constructor")).toBe(true)
    expect(__VALIDATOR_INTERNALS.FORBIDDEN_KEYS.has("prototype")).toBe(true)
    expect(__VALIDATOR_INTERNALS.FORBIDDEN_KEYS.size).toBe(3)
  })

  it("happy paths for every recordType (smoke-coverage)", () => {
    const samples: Record<string, Record<string, unknown>> = {
      visit_summary: {
        reasonForVisit: "annual check",
        assessment: "healthy",
        plan: "follow up in 12mo",
      },
      diagnosis: { icd10Code: "E11.9", description: "T2DM", status: "active" },
      lab_result: { testName: "HbA1c", value: 6.5, unit: "%" },
      procedure: {
        cptCode: "99213",
        description: "office visit",
        performedAt: "2026-05-15",
      },
      medication: {
        name: "metformin",
        dosage: "500mg",
        frequency: "bid",
        route: "po",
        startDate: "2026-01-01",
      },
      allergy: {
        allergen: "penicillin",
        reaction: "rash",
        severity: "moderate",
      },
      immunization: {
        vaccine: "influenza",
        doseNumber: 1,
        administeredAt: "2026-10-01",
      },
      vital_signs: { heartRate: 72 },
      imaging: {
        modality: "MRI",
        bodyPart: "knee",
        findings: "no tear",
        performedAt: "2026-04-12",
      },
      discharge_summary: {
        primaryDiagnosis: "pneumonia",
        instructions: "rest",
      },
    }
    for (const t of MEDICAL_RECORD_TYPES) {
      const r = validateMedicalRecord({
        recordType: t,
        severity: "informational",
        sensitivity: "normal",
        details: samples[t],
      })
      expect(r.ok, `recordType ${t} should validate`).toBe(true)
    }
  })

  it("sensitivity=restricted still passes (gate is RBAC layer in slice-2)", () => {
    expect(
      validateMedicalRecord({
        recordType: "diagnosis",
        severity: "high",
        sensitivity: "restricted",
        details: { icd10Code: "F33.0", description: "MDD", status: "active" },
      }).ok
    ).toBe(true)
  })
})

/* ─── Care plan progress calculator ──────────────────────────────────── */

describe("R2 — care plan progress calculator", () => {
  const goalA: CarePlanGoal = {
    id: "g-a",
    label: "10+ follow-up visits",
    metric: "visits",
    targetValue: 10,
    comparator: "gte",
    kpiSource: "medical_record_count",
  }
  const goalB: CarePlanGoal = {
    id: "g-b",
    label: "<= 2 missed doses",
    metric: "missed",
    targetValue: 2,
    comparator: "lte",
    kpiSource: "medication_adherence",
  }

  it("gte goal — exactly at target = met, progressPct = 100", () => {
    const r = calculateCarePlanProgress({
      goals: [goalA],
      observations: {
        medical_record_count: 10,
        medication_adherence: 0,
      },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.summary.perGoal[0].met).toBe(true)
      expect(r.summary.perGoal[0].progressPct).toBe(100)
      expect(r.summary.goalsMet).toBe(1)
    }
  })

  it("gte goal — half way = not met, progressPct = 50", () => {
    const r = calculateCarePlanProgress({
      goals: [goalA],
      observations: {
        medical_record_count: 5,
        medication_adherence: 0,
      },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.summary.perGoal[0].met).toBe(false)
      expect(r.summary.perGoal[0].progressPct).toBe(50)
    }
  })

  it("gte goal — over target = met, progressPct capped at 100", () => {
    const r = calculateCarePlanProgress({
      goals: [goalA],
      observations: {
        medical_record_count: 25,
        medication_adherence: 0,
      },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.summary.perGoal[0].met).toBe(true)
      expect(r.summary.perGoal[0].progressPct).toBe(100)
    }
  })

  it("lte goal — 0 observed against target 2 = met, progressPct = 100", () => {
    const r = calculateCarePlanProgress({
      goals: [goalB],
      observations: {
        medical_record_count: 0,
        medication_adherence: 0,
      },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.summary.perGoal[0].met).toBe(true)
      expect(r.summary.perGoal[0].progressPct).toBe(100)
    }
  })

  it("lte goal — at target = met, progressPct = 0 (boundary)", () => {
    const r = calculateCarePlanProgress({
      goals: [goalB],
      observations: {
        medical_record_count: 0,
        medication_adherence: 2,
      },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.summary.perGoal[0].met).toBe(true)
      expect(r.summary.perGoal[0].progressPct).toBe(0)
    }
  })

  it("lte goal — observed exceeds target = not met, progressPct = 0", () => {
    const r = calculateCarePlanProgress({
      goals: [goalB],
      observations: {
        medical_record_count: 0,
        medication_adherence: 10,
      },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.summary.perGoal[0].met).toBe(false)
      expect(r.summary.perGoal[0].progressPct).toBe(0)
    }
  })

  it("eq goal — exact match = met, mismatch = not met", () => {
    const eqGoal: CarePlanGoal = {
      id: "g-eq",
      label: "exactly 4 visits",
      metric: "visits",
      targetValue: 4,
      comparator: "eq",
      kpiSource: "medical_record_count",
    }
    const matched = calculateCarePlanProgress({
      goals: [eqGoal],
      observations: { medical_record_count: 4, medication_adherence: 0 },
    })
    expect(matched.ok).toBe(true)
    if (matched.ok) {
      expect(matched.summary.perGoal[0].met).toBe(true)
      expect(matched.summary.perGoal[0].progressPct).toBe(100)
    }
    const mismatched = calculateCarePlanProgress({
      goals: [eqGoal],
      observations: { medical_record_count: 5, medication_adherence: 0 },
    })
    expect(mismatched.ok).toBe(true)
    if (mismatched.ok) {
      expect(mismatched.summary.perGoal[0].met).toBe(false)
      expect(mismatched.summary.perGoal[0].progressPct).toBe(0)
    }
  })

  it("gte goal with target 0 trivially met", () => {
    const zeroGoal: CarePlanGoal = {
      id: "g-zero",
      label: "ok at any count",
      metric: "any",
      targetValue: 0,
      comparator: "gte",
      kpiSource: "medical_record_count",
    }
    const r = calculateCarePlanProgress({
      goals: [zeroGoal],
      observations: { medical_record_count: 0, medication_adherence: 0 },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.summary.perGoal[0].met).toBe(true)
      expect(r.summary.perGoal[0].progressPct).toBe(100)
    }
  })

  it("lte goal with target 0 — observed=0 met, observed>0 not met", () => {
    const zeroGoal: CarePlanGoal = {
      id: "g-zero",
      label: "never miss",
      metric: "missed",
      targetValue: 0,
      comparator: "lte",
      kpiSource: "medication_adherence",
    }
    const met = calculateCarePlanProgress({
      goals: [zeroGoal],
      observations: { medical_record_count: 0, medication_adherence: 0 },
    })
    expect(met.ok).toBe(true)
    if (met.ok) expect(met.summary.perGoal[0].met).toBe(true)
    const notMet = calculateCarePlanProgress({
      goals: [zeroGoal],
      observations: { medical_record_count: 0, medication_adherence: 3 },
    })
    expect(notMet.ok).toBe(true)
    if (notMet.ok) expect(notMet.summary.perGoal[0].met).toBe(false)
  })

  it("aggregates overallPct across goals", () => {
    const r = calculateCarePlanProgress({
      goals: [goalA, goalB],
      observations: {
        medical_record_count: 5, // 50% on goalA
        medication_adherence: 2, // 0% on goalB (at boundary)
      },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.summary.overallPct).toBe(25)
      expect(r.summary.goalsMet).toBe(1)
      expect(r.summary.goalsTotal).toBe(2)
    }
  })

  it("empty goals → overallPct = NaN, total = 0", () => {
    const r = calculateCarePlanProgress({
      goals: [],
      observations: { medical_record_count: 0, medication_adherence: 0 },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(Number.isNaN(r.summary.overallPct)).toBe(true)
      expect(r.summary.goalsTotal).toBe(0)
    }
  })

  it("rejects duplicate goal ids", () => {
    const r = calculateCarePlanProgress({
      goals: [goalA, { ...goalA, label: "dup" }],
      observations: { medical_record_count: 0, medication_adherence: 0 },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects non-finite observation", () => {
    const r = calculateCarePlanProgress({
      goals: [goalA],
      observations: {
        medical_record_count: Number.NaN,
        medication_adherence: 0,
      },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects negative observation", () => {
    const r = calculateCarePlanProgress({
      goals: [goalA],
      observations: { medical_record_count: -5, medication_adherence: 0 },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects goal with negative target", () => {
    const r = calculateCarePlanProgress({
      goals: [{ ...goalA, targetValue: -1 }],
      observations: { medical_record_count: 0, medication_adherence: 0 },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects goal with unknown comparator", () => {
    const r = calculateCarePlanProgress({
      goals: [
        {
          id: "g",
          label: "x",
          metric: "y",
          targetValue: 1,
          comparator: "xx" as never,
          kpiSource: "medical_record_count",
        },
      ],
      observations: { medical_record_count: 1, medication_adherence: 0 },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects goal with empty id", () => {
    const r = calculateCarePlanProgress({
      goals: [{ ...goalA, id: "" }],
      observations: { medical_record_count: 0, medication_adherence: 0 },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects non-array goals", () => {
    const r = calculateCarePlanProgress({
      // deliberately wrong
      goals: null as never,
      observations: { medical_record_count: 0, medication_adherence: 0 },
    })
    expect(r.ok).toBe(false)
  })
})

/* ─── Appointment scheduler ──────────────────────────────────────────── */

describe("R2 — appointment scheduler", () => {
  const PROVIDER = "prov-1"
  const PATIENT = "pat-1"

  function slot(
    id: string,
    startISO: string,
    endISO: string,
    status: EncounterStatus = "scheduled",
    providerId: string = PROVIDER
  ): ExistingSlot {
    return {
      id,
      providerId,
      scheduledStartAt: new Date(startISO),
      scheduledEndAt: new Date(endISO),
      status,
    }
  }

  it("empty calendar — request fits", () => {
    const r = scheduleAppointment({
      request: {
        providerId: PROVIDER,
        patientId: PATIENT,
        scheduledStartAt: new Date("2026-06-01T10:00:00Z"),
        scheduledEndAt: new Date("2026-06-01T10:30:00Z"),
      },
      existingSlots: [],
    })
    expect(r.ok).toBe(true)
  })

  it("back-to-back at boundary allowed when minGap = 0", () => {
    const r = scheduleAppointment({
      request: {
        providerId: PROVIDER,
        patientId: PATIENT,
        scheduledStartAt: new Date("2026-06-01T10:30:00Z"),
        scheduledEndAt: new Date("2026-06-01T11:00:00Z"),
      },
      existingSlots: [
        slot("a", "2026-06-01T10:00:00Z", "2026-06-01T10:30:00Z"),
      ],
    })
    expect(r.ok).toBe(true)
  })

  it("overlap on left edge detected", () => {
    const r = scheduleAppointment({
      request: {
        providerId: PROVIDER,
        patientId: PATIENT,
        scheduledStartAt: new Date("2026-06-01T10:15:00Z"),
        scheduledEndAt: new Date("2026-06-01T10:45:00Z"),
      },
      existingSlots: [
        slot("a", "2026-06-01T10:00:00Z", "2026-06-01T10:30:00Z"),
      ],
    })
    expect(r.ok).toBe(false)
    if (!r.ok && r.reason === "conflicts") {
      expect(r.conflicts).toHaveLength(1)
      expect(r.conflicts[0].conflictingSlotId).toBe("a")
      expect(r.conflicts[0].reason).toBe("overlap")
    } else {
      throw new Error("expected conflict result")
    }
  })

  it("overlap on right edge detected", () => {
    const r = scheduleAppointment({
      request: {
        providerId: PROVIDER,
        patientId: PATIENT,
        scheduledStartAt: new Date("2026-06-01T09:45:00Z"),
        scheduledEndAt: new Date("2026-06-01T10:15:00Z"),
      },
      existingSlots: [
        slot("a", "2026-06-01T10:00:00Z", "2026-06-01T10:30:00Z"),
      ],
    })
    expect(r.ok).toBe(false)
  })

  it("contains slot detected", () => {
    const r = scheduleAppointment({
      request: {
        providerId: PROVIDER,
        patientId: PATIENT,
        scheduledStartAt: new Date("2026-06-01T09:30:00Z"),
        scheduledEndAt: new Date("2026-06-01T11:00:00Z"),
      },
      existingSlots: [
        slot("a", "2026-06-01T10:00:00Z", "2026-06-01T10:30:00Z"),
      ],
    })
    expect(r.ok).toBe(false)
  })

  it("cancelled slot does NOT block", () => {
    const r = scheduleAppointment({
      request: {
        providerId: PROVIDER,
        patientId: PATIENT,
        scheduledStartAt: new Date("2026-06-01T10:00:00Z"),
        scheduledEndAt: new Date("2026-06-01T10:30:00Z"),
      },
      existingSlots: [
        slot(
          "a",
          "2026-06-01T10:00:00Z",
          "2026-06-01T10:30:00Z",
          "cancelled"
        ),
      ],
    })
    expect(r.ok).toBe(true)
  })

  it("no_show slot does NOT block", () => {
    const r = scheduleAppointment({
      request: {
        providerId: PROVIDER,
        patientId: PATIENT,
        scheduledStartAt: new Date("2026-06-01T10:00:00Z"),
        scheduledEndAt: new Date("2026-06-01T10:30:00Z"),
      },
      existingSlots: [
        slot("a", "2026-06-01T10:00:00Z", "2026-06-01T10:30:00Z", "no_show"),
      ],
    })
    expect(r.ok).toBe(true)
  })

  it("completed slot DOES block (history protects no-double-billing)", () => {
    const r = scheduleAppointment({
      request: {
        providerId: PROVIDER,
        patientId: PATIENT,
        scheduledStartAt: new Date("2026-06-01T10:15:00Z"),
        scheduledEndAt: new Date("2026-06-01T10:45:00Z"),
      },
      existingSlots: [
        slot(
          "a",
          "2026-06-01T10:00:00Z",
          "2026-06-01T10:30:00Z",
          "completed"
        ),
      ],
    })
    expect(r.ok).toBe(false)
  })

  it("min gap violation detected (5min gap, 10min required)", () => {
    const r = scheduleAppointment({
      request: {
        providerId: PROVIDER,
        patientId: PATIENT,
        scheduledStartAt: new Date("2026-06-01T10:35:00Z"),
        scheduledEndAt: new Date("2026-06-01T11:00:00Z"),
      },
      existingSlots: [
        slot("a", "2026-06-01T10:00:00Z", "2026-06-01T10:30:00Z"),
      ],
      minGapMinutes: 10,
    })
    expect(r.ok).toBe(false)
    if (!r.ok && r.reason === "conflicts") {
      expect(r.conflicts[0].reason).toBe("gap_too_small")
    } else {
      throw new Error("expected conflict result")
    }
  })

  it("min gap satisfied passes", () => {
    const r = scheduleAppointment({
      request: {
        providerId: PROVIDER,
        patientId: PATIENT,
        scheduledStartAt: new Date("2026-06-01T10:45:00Z"),
        scheduledEndAt: new Date("2026-06-01T11:00:00Z"),
      },
      existingSlots: [
        slot("a", "2026-06-01T10:00:00Z", "2026-06-01T10:30:00Z"),
      ],
      minGapMinutes: 10,
    })
    expect(r.ok).toBe(true)
  })

  it("min gap fires symmetrically (slot AFTER request)", () => {
    const r = scheduleAppointment({
      request: {
        providerId: PROVIDER,
        patientId: PATIENT,
        scheduledStartAt: new Date("2026-06-01T09:30:00Z"),
        scheduledEndAt: new Date("2026-06-01T09:55:00Z"),
      },
      existingSlots: [
        slot("a", "2026-06-01T10:00:00Z", "2026-06-01T10:30:00Z"),
      ],
      minGapMinutes: 10,
    })
    expect(r.ok).toBe(false)
    if (!r.ok && r.reason === "conflicts") {
      expect(r.conflicts[0].reason).toBe("gap_too_small")
    } else {
      throw new Error("expected conflict result")
    }
  })

  it("multiple conflicts collected (no fail-fast)", () => {
    const r = scheduleAppointment({
      request: {
        providerId: PROVIDER,
        patientId: PATIENT,
        scheduledStartAt: new Date("2026-06-01T09:30:00Z"),
        scheduledEndAt: new Date("2026-06-01T11:30:00Z"),
      },
      existingSlots: [
        slot("a", "2026-06-01T10:00:00Z", "2026-06-01T10:30:00Z"),
        slot("b", "2026-06-01T10:45:00Z", "2026-06-01T11:15:00Z"),
      ],
    })
    expect(r.ok).toBe(false)
    if (!r.ok && r.reason === "conflicts") {
      expect(r.conflicts).toHaveLength(2)
      expect(r.conflicts.map((c) => c.conflictingSlotId).sort()).toEqual([
        "a",
        "b",
      ])
    } else {
      throw new Error("expected conflict result")
    }
  })

  it("foreign-provider slot treated as conflict (defends caller error)", () => {
    const r = scheduleAppointment({
      request: {
        providerId: PROVIDER,
        patientId: PATIENT,
        scheduledStartAt: new Date("2026-06-01T10:00:00Z"),
        scheduledEndAt: new Date("2026-06-01T10:30:00Z"),
      },
      existingSlots: [
        slot(
          "a",
          "2026-06-01T10:00:00Z",
          "2026-06-01T10:30:00Z",
          "scheduled",
          "different-provider"
        ),
      ],
    })
    expect(r.ok).toBe(false)
  })

  it("rejects end ≤ start (invalid_input variant)", () => {
    const r = scheduleAppointment({
      request: {
        providerId: PROVIDER,
        patientId: PATIENT,
        scheduledStartAt: new Date("2026-06-01T10:00:00Z"),
        scheduledEndAt: new Date("2026-06-01T10:00:00Z"),
      },
      existingSlots: [],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("invalid_input")
  })

  it("rejects non-finite Date in request (invalid_input variant)", () => {
    const r = scheduleAppointment({
      request: {
        providerId: PROVIDER,
        patientId: PATIENT,
        scheduledStartAt: new Date("invalid"),
        scheduledEndAt: new Date("2026-06-01T10:30:00Z"),
      },
      existingSlots: [],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("invalid_input")
  })

  it("rejects negative minGapMinutes (invalid_input variant)", () => {
    const r = scheduleAppointment({
      request: {
        providerId: PROVIDER,
        patientId: PATIENT,
        scheduledStartAt: new Date("2026-06-01T10:00:00Z"),
        scheduledEndAt: new Date("2026-06-01T10:30:00Z"),
      },
      existingSlots: [],
      minGapMinutes: -1,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("invalid_input")
  })

  it("BLOCKING_STATUSES surfaces 4 entries (scheduled/checked_in/in_progress/completed)", () => {
    expect(__SCHEDULER_INTERNALS.BLOCKING_STATUSES.size).toBe(4)
    expect(__SCHEDULER_INTERNALS.BLOCKING_STATUSES.has("cancelled")).toBe(false)
    expect(__SCHEDULER_INTERNALS.BLOCKING_STATUSES.has("no_show")).toBe(false)
  })
})
