import { evaluateWorkforceExceptionDraftLifecycle } from "@/lib/workforce/exception-policy-draft"

export type RecordedExceptionReportCase = {
  id: string
  organizationId: string
  agentId: string
  workdayId: string | null
  createdAt: Date
  decisions: ReadonlyArray<{ caseRevision: number; decisionCode: string; createdAt: Date }>
}

export type RecordedExceptionReportCorrectionProof = {
  organizationId: string
  agentId: string
  workdayId: string
  requestId: string | null
  source: string
  request: {
    id: string
    organizationId: string
    agentId: string
    type: string
    status: string
    correctionWorkdayId: string | null
    exceptionCaseId: string | null
  } | null
}

export type WorkforceExceptionRecordedOutcomes = {
  cohortBasis: "CASE_RECORDED_AT"
  outcomeBasis: "RECORDED_LEDGERS_IN_CURRENT_READ_SNAPSHOT"
  linkedCorrection: {
    cohortCases: number
    recordedLinkedCorrectionCases: number
    share: number | null
    interpretation: "RECORDED_APPROVED_REQUEST_CORRECTION_LINK_NOT_CURRENT_WORKDAY_FACTS"
  }
  firstResolution: {
    basis: "ELAPSED_WALL_CLOCK_FROM_CASE_TO_FIRST_RECORDED_RESOLUTION"
    sampleCount: number
    unresolvedCases: number
    integrityExcludedCases: number
    minMs: number | null
    maxMs: number | null
    meanMs: number | null
    meanRounding: "NEAREST_MILLISECOND"
  }
  unavailable: {
    falsePositiveRate: "UNAVAILABLE_NO_APPROVED_OUTCOME_CLASSIFICATION"
    appealOverturnRate: "UNAVAILABLE_NO_APPROVED_OUTCOME_CLASSIFICATION"
  }
}

function timestamp(value: Date): number | null {
  const ms = value instanceof Date ? value.getTime() : Number.NaN
  return Number.isSafeInteger(ms) ? ms : null
}

/** Validate the entire bounded stream, including decisions after a reopen. */
function firstResolution(item: RecordedExceptionReportCase):
  | { valid: false }
  | { valid: true; elapsedMs: number | null } {
  const recordedAt = timestamp(item.createdAt)
  if (recordedAt === null || item.decisions.length > 64) return { valid: false }
  let previousAt = recordedAt
  let elapsedMs: number | null = null
  for (const [index, decision] of item.decisions.entries()) {
    const decidedAt = timestamp(decision.createdAt)
    if (decision.caseRevision !== index + 1 || decidedAt === null || decidedAt < previousAt) {
      return { valid: false }
    }
    previousAt = decidedAt
    if (elapsedMs === null && (decision.decisionCode === "RESOLVE_NO_CHANGE"
      || decision.decisionCode === "RESOLVE_WITH_CORRECTION")) {
      elapsedMs = decidedAt - recordedAt
      if (!Number.isSafeInteger(elapsedMs) || elapsedMs < 0) return { valid: false }
    }
  }
  if (!evaluateWorkforceExceptionDraftLifecycle(item.decisions).valid) return { valid: false }
  return { valid: true, elapsedMs }
}

/**
 * Internal identifiers validate exact immutable links and deduplicate cases.
 * Only aggregate values leave this function; no outcome classification or
 * current workday application is inferred from a recorded correction ledger.
 */
export function buildWorkforceExceptionRecordedOutcomes(input: {
  organizationId: string
  cases: readonly RecordedExceptionReportCase[]
  correctionProofs: readonly RecordedExceptionReportCorrectionProof[]
}): { recordedOutcomes: WorkforceExceptionRecordedOutcomes; integrityCaseIds: ReadonlySet<string> } {
  const cohort = new Map(input.cases.map((item) => [item.id, item]))
  const linkedCases = new Set<string>()
  for (const proof of input.correctionProofs) {
    const request = proof.request
    if (!request || request.exceptionCaseId === null) continue
    const item = cohort.get(request.exceptionCaseId)
    if (!item || item.organizationId !== input.organizationId
      || proof.organizationId !== input.organizationId || request.organizationId !== input.organizationId
      || proof.source !== "REQUEST_APPROVAL" || request.type !== "TIME_CORRECTION" || request.status !== "APPROVED"
      || proof.requestId !== request.id || item.workdayId === null
      || proof.workdayId !== item.workdayId || request.correctionWorkdayId !== item.workdayId
      || proof.agentId !== item.agentId || request.agentId !== item.agentId) continue
    linkedCases.add(item.id)
  }

  const integrityCaseIds = new Set<string>()
  const durations: number[] = []
  let unresolvedCases = 0
  let totalMs = BigInt(0)
  for (const item of input.cases) {
    const result = firstResolution(item)
    if (!result.valid) {
      integrityCaseIds.add(item.id)
    } else if (result.elapsedMs === null) {
      unresolvedCases += 1
    } else {
      durations.push(result.elapsedMs)
      totalMs += BigInt(result.elapsedMs)
    }
  }
  const sampleCount = durations.length
  const samples = BigInt(sampleCount)
  return {
    integrityCaseIds,
    recordedOutcomes: {
      cohortBasis: "CASE_RECORDED_AT",
      outcomeBasis: "RECORDED_LEDGERS_IN_CURRENT_READ_SNAPSHOT",
      linkedCorrection: {
        cohortCases: input.cases.length,
        recordedLinkedCorrectionCases: linkedCases.size,
        share: input.cases.length === 0 ? null : linkedCases.size / input.cases.length,
        interpretation: "RECORDED_APPROVED_REQUEST_CORRECTION_LINK_NOT_CURRENT_WORKDAY_FACTS",
      },
      firstResolution: {
        basis: "ELAPSED_WALL_CLOCK_FROM_CASE_TO_FIRST_RECORDED_RESOLUTION",
        sampleCount,
        unresolvedCases,
        integrityExcludedCases: integrityCaseIds.size,
        minMs: sampleCount === 0 ? null : Math.min(...durations),
        maxMs: sampleCount === 0 ? null : Math.max(...durations),
        // BigInt keeps up to 5,000 safe integer durations exact before rounding.
        meanMs: sampleCount === 0 ? null : Number((totalMs + samples / BigInt(2)) / samples),
        meanRounding: "NEAREST_MILLISECOND",
      },
      unavailable: {
        falsePositiveRate: "UNAVAILABLE_NO_APPROVED_OUTCOME_CLASSIFICATION",
        appealOverturnRate: "UNAVAILABLE_NO_APPROVED_OUTCOME_CLASSIFICATION",
      },
    },
  }
}
