import { describe, expect, it } from "vitest"
import {
  buildWorkforceExceptionRecordedOutcomes,
  type RecordedExceptionReportCase,
  type RecordedExceptionReportCorrectionProof,
} from "@/lib/workforce/exception-case-report-recorded-outcomes"

const BASE = Date.UTC(2026, 8, 1)
const at = (ms: number) => new Date(BASE + ms)
function caseRecord(overrides: Partial<RecordedExceptionReportCase> = {}): RecordedExceptionReportCase {
  return {
    id: "private-case-1", organizationId: "private-org", agentId: "private-agent-1", workdayId: "private-workday-1",
    createdAt: at(0), decisions: [], ...overrides,
  }
}
function proof(overrides: Partial<RecordedExceptionReportCorrectionProof> = {}): RecordedExceptionReportCorrectionProof {
  return {
    organizationId: "private-org", agentId: "private-agent-1", workdayId: "private-workday-1",
    requestId: "private-request-1", source: "REQUEST_APPROVAL",
    request: {
      id: "private-request-1", organizationId: "private-org", agentId: "private-agent-1", type: "TIME_CORRECTION",
      status: "APPROVED", correctionWorkdayId: "private-workday-1", exceptionCaseId: "private-case-1",
    }, ...overrides,
  }
}
function analyze(cases: readonly RecordedExceptionReportCase[], correctionProofs: readonly RecordedExceptionReportCorrectionProof[] = []) {
  return buildWorkforceExceptionRecordedOutcomes({ organizationId: "private-org", cases, correctionProofs })
}
function resolvedCase(elapsed: number, id = "private-case-1") {
  return caseRecord({ id, decisions: [
    { caseRevision: 1, decisionCode: "ACKNOWLEDGE", createdAt: at(0) },
    { caseRevision: 2, decisionCode: "RESOLVE_NO_CHANGE", createdAt: at(elapsed) },
  ] })
}

describe("recorded exception outcomes without outcome-policy inference", () => {
  it("uses null denominators and timing samples for a truly empty cohort", () => {
    const result = analyze([]).recordedOutcomes
    expect(result.linkedCorrection).toMatchObject({ cohortCases: 0, recordedLinkedCorrectionCases: 0, share: null })
    expect(result.firstResolution).toMatchObject({ sampleCount: 0, unresolvedCases: 0, integrityExcludedCases: 0, minMs: null, maxMs: null, meanMs: null })
    expect(result.unavailable).toEqual({
      falsePositiveRate: "UNAVAILABLE_NO_APPROVED_OUTCOME_CLASSIFICATION",
      appealOverturnRate: "UNAVAILABLE_NO_APPROVED_OUTCOME_CLASSIFICATION",
    })
  })

  it("counts a case once across multiple exact links and retains valid links after an invalid first link", () => {
    const second = proof({ requestId: "private-request-2", request: { ...proof().request!, id: "private-request-2" } })
    const result = analyze([caseRecord(), caseRecord({ id: "private-case-unresolved", agentId: "private-agent-2", workdayId: null })], [
      proof({ request: { ...proof().request!, correctionWorkdayId: "wrong-workday" } }), proof(), second,
    ]).recordedOutcomes
    expect(result.linkedCorrection).toMatchObject({ cohortCases: 2, recordedLinkedCorrectionCases: 1, share: 0.5 })
    expect(result.firstResolution).toMatchObject({ sampleCount: 0, unresolvedCases: 2, integrityExcludedCases: 0 })
    expect(JSON.stringify(result)).not.toMatch(/private-|wrong-workday/)
  })

  const invalidProofs: Array<[string, RecordedExceptionReportCorrectionProof]> = [
    ["missing request", proof({ request: null })],
    ["direct source", proof({ source: "DIRECT_MANAGER" })],
    ["unlinked request", proof({ request: { ...proof().request!, exceptionCaseId: null } })],
    ["foreign case", proof({ request: { ...proof().request!, exceptionCaseId: "foreign-case" } })],
    ["foreign correction organization", proof({ organizationId: "foreign-org" })],
    ["foreign request organization", proof({ request: { ...proof().request!, organizationId: "foreign-org" } })],
    ["wrong correction agent", proof({ agentId: "wrong-agent" })],
    ["wrong request agent", proof({ request: { ...proof().request!, agentId: "wrong-agent" } })],
    ["wrong correction workday", proof({ workdayId: "wrong-workday" })],
    ["wrong request workday", proof({ request: { ...proof().request!, correctionWorkdayId: "wrong-workday" } })],
    ["mismatched request id", proof({ requestId: "wrong-request" })],
    ["missing request id", proof({ requestId: null })],
    ["leave request", proof({ request: { ...proof().request!, type: "LEAVE" } })],
    ...["PENDING", "REJECTED", "CANCELLED"].map((status): [string, RecordedExceptionReportCorrectionProof] => [status, proof({ request: { ...proof().request!, status } })]),
  ]
  it.each(invalidProofs)("excludes %s from recorded linked corrections", (_label, invalid) => {
    expect(analyze([caseRecord()], [invalid]).recordedOutcomes.linkedCorrection.recordedLinkedCorrectionCases).toBe(0)
  })
  it("cannot match a workday-free or foreign-organization case", () => {
    for (const item of [caseRecord({ workdayId: null }), caseRecord({ organizationId: "foreign-org" })]) {
      expect(analyze([item], [proof()]).recordedOutcomes.linkedCorrection.recordedLinkedCorrectionCases).toBe(0)
    }
  })

  it("measures only the first resolution even after reopen and a later resolution", () => {
    const item = resolvedCase(1_000)
    item.decisions = [...item.decisions,
      { caseRevision: 3, decisionCode: "REOPEN_FOR_REVIEW", createdAt: at(2_000) },
      { caseRevision: 4, decisionCode: "RESOLVE_WITH_CORRECTION", createdAt: at(9_000) },
    ]
    const result = analyze([item, resolvedCase(2_001, "second"), caseRecord({ id: "unresolved" })]).recordedOutcomes.firstResolution
    expect(result).toMatchObject({ sampleCount: 2, unresolvedCases: 1, integrityExcludedCases: 0, minMs: 1_000, maxMs: 2_001, meanMs: 1_501 })
    expect(analyze([resolvedCase(0)]).recordedOutcomes.firstResolution).toMatchObject({ sampleCount: 1, minMs: 0, maxMs: 0, meanMs: 0 })
    expect(analyze([{ ...item, decisions: item.decisions.slice(0, 3) }]).recordedOutcomes.firstResolution.sampleCount).toBe(1)
  })

  const malformedCases: Array<[string, RecordedExceptionReportCase]> = [
    ["invalid recorded date", caseRecord({ createdAt: new Date(Number.NaN) })],
    ["invalid decision date", caseRecord({ decisions: [{ caseRevision: 1, decisionCode: "ACKNOWLEDGE", createdAt: new Date(Number.NaN) }] })],
    ["before-case decision", caseRecord({ decisions: [{ caseRevision: 1, decisionCode: "ACKNOWLEDGE", createdAt: at(-1) }] })],
    ["decreasing timestamp", caseRecord({ decisions: [
      { caseRevision: 1, decisionCode: "ACKNOWLEDGE", createdAt: at(30) },
      { caseRevision: 2, decisionCode: "RESOLVE_NO_CHANGE", createdAt: at(20) },
    ] })],
    ...[0, 2].map((caseRevision): [string, RecordedExceptionReportCase] => [`initial revision ${caseRevision}`, caseRecord({ decisions: [{ caseRevision, decisionCode: "ACKNOWLEDGE", createdAt: at(0) }] })]),
    ["duplicate revision", caseRecord({ decisions: [
      { caseRevision: 1, decisionCode: "ACKNOWLEDGE", createdAt: at(0) },
      { caseRevision: 1, decisionCode: "ACKNOWLEDGE", createdAt: at(1) },
    ] })],
    ["unknown code", caseRecord({ decisions: [{ caseRevision: 1, decisionCode: "RAW_UNKNOWN", createdAt: at(0) }] })],
    ["illegal terminal transition", caseRecord({ decisions: [{ caseRevision: 1, decisionCode: "RESOLVE_NO_CHANGE", createdAt: at(0) }] })],
    ["invalid event after first resolution", caseRecord({ decisions: [
      ...resolvedCase(1_000).decisions,
      { caseRevision: 3, decisionCode: "ACKNOWLEDGE", createdAt: at(2_000) },
    ] })],
    ["gap after first resolution", caseRecord({ decisions: [
      ...resolvedCase(1_000).decisions,
      { caseRevision: 4, decisionCode: "REOPEN_FOR_REVIEW", createdAt: at(2_000) },
    ] })],
    ["65-row sentinel", caseRecord({ decisions: Array.from({ length: 65 }, (_, index) => ({ caseRevision: index + 1, decisionCode: "ACKNOWLEDGE", createdAt: at(index) })) })],
  ]
  it.each(malformedCases)("excludes timing for %s and retains integrity review", (_label, item) => {
    const result = analyze([item])
    expect(result.integrityCaseIds.has(item.id)).toBe(true)
    expect(result.recordedOutcomes.firstResolution).toMatchObject({ sampleCount: 0, unresolvedCases: 0, integrityExcludedCases: 1, minMs: null, maxMs: null, meanMs: null })
    expect(JSON.stringify(result.recordedOutcomes)).not.toContain("RAW_UNKNOWN")
  })

  it("keeps the duration sum exact beyond Number's safe integer precision", () => {
    const duration = 8_640_000_000_000_000
    const items = Array.from({ length: 5_000 }, (_, index) => caseRecord({
      id: `duration-${index}`, createdAt: new Date(-duration), decisions: [
        { caseRevision: 1, decisionCode: "ACKNOWLEDGE", createdAt: new Date(-duration) },
        { caseRevision: 2, decisionCode: "RESOLVE_NO_CHANGE", createdAt: new Date(0) },
      ],
    }))
    expect(analyze(items).recordedOutcomes.firstResolution).toMatchObject({ sampleCount: 5_000, minMs: duration, maxMs: duration, meanMs: duration })
    const overflow = caseRecord({ createdAt: new Date(-duration), decisions: [
      { caseRevision: 1, decisionCode: "ACKNOWLEDGE", createdAt: new Date(-duration) },
      { caseRevision: 2, decisionCode: "RESOLVE_NO_CHANGE", createdAt: new Date(duration) },
    ] })
    expect(analyze([overflow]).recordedOutcomes.firstResolution.integrityExcludedCases).toBe(1)
  })
})
