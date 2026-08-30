import { createHash } from "node:crypto"
import { validateWorkforceExceptionDraftDecisionAppend } from "@/lib/workforce/exception-policy-draft"

/**
 * Canonical, raw-proof-free inputs for the additive C6 exception-case ledger.
 * This module constructs immutable drafts only. It intentionally has no
 * Prisma import, no endpoint, no notification and no policy that could turn a
 * decision code into a payroll, disciplinary or automatic attendance result.
 */

export type WorkforceExceptionCaseLinks = {
  workdayId?: string | null
  workdayEventId?: string | null
  evidenceId?: string | null
  segmentId?: string | null
}

export type WorkforceExceptionCaseDraft = {
  organizationId: string
  agentId: string
  kind: string
  detectorVersion: string
  deduplicationKey: string
  links: Required<WorkforceExceptionCaseLinks>
}

export type WorkforceExceptionDecisionDraft = {
  organizationId: string
  caseId: string
  operationId: string
  decisionCode: string
  reason: string
  actorUserId: string
}

export class WorkforceExceptionCaseLedgerError extends Error {
  constructor(readonly code:
    | "WORKFORCE_EXCEPTION_CASE_INPUT_INVALID"
    | "WORKFORCE_EXCEPTION_DECISION_INPUT_INVALID"
    | "WORKFORCE_EXCEPTION_DECISION_LIFECYCLE_INVALID") {
    super(code)
  }
}

const CODE = /^[A-Z][A-Z0-9_]{0,63}$/
const DETECTOR_VERSION = /^[a-z][a-z0-9._-]{0,63}$/

function opaqueId(value: string | null | undefined, code: WorkforceExceptionCaseLedgerError["code"]): string | null {
  if (value == null) return null
  if (typeof value !== "string" || !value.trim() || value.length > 191 || /[\u0000-\u001f]/.test(value)) {
    throw new WorkforceExceptionCaseLedgerError(code)
  }
  return value
}

function opaqueRequiredId(value: string, code: WorkforceExceptionCaseLedgerError["code"]): string {
  const parsed = opaqueId(value, code)
  if (parsed == null) throw new WorkforceExceptionCaseLedgerError(code)
  return parsed
}

function policyCode(value: string, code: WorkforceExceptionCaseLedgerError["code"]): string {
  if (typeof value !== "string" || !CODE.test(value)) {
    throw new WorkforceExceptionCaseLedgerError(code)
  }
  return value
}

function normalizeLinks(input: WorkforceExceptionCaseLinks): Required<WorkforceExceptionCaseLinks> {
  const links = {
    workdayId: opaqueId(input.workdayId, "WORKFORCE_EXCEPTION_CASE_INPUT_INVALID"),
    workdayEventId: opaqueId(input.workdayEventId, "WORKFORCE_EXCEPTION_CASE_INPUT_INVALID"),
    evidenceId: opaqueId(input.evidenceId, "WORKFORCE_EXCEPTION_CASE_INPUT_INVALID"),
    segmentId: opaqueId(input.segmentId, "WORKFORCE_EXCEPTION_CASE_INPUT_INVALID"),
  }
  // An evidence row is deliberately supplementary: the durable database
  // contract requires a workday, event or segment that can be scoped to the
  // employee without decrypting the evidence envelope.
  if (links.workdayId == null && links.workdayEventId == null && links.segmentId == null) {
    throw new WorkforceExceptionCaseLedgerError("WORKFORCE_EXCEPTION_CASE_INPUT_INVALID")
  }
  return links
}

/**
 * A detector gets exactly one stable tenant-scoped key for the same linked
 * subject and detector version. The key excludes timestamps, reason text,
 * coordinates, QR, device proof and employee content so a retry cannot fork a
 * second case by changing a non-subject payload.
 */
export function workforceExceptionCaseDeduplicationKey(input: {
  organizationId: string
  agentId: string
  kind: string
  detectorVersion: string
  links: WorkforceExceptionCaseLinks
}): string {
  const organizationId = opaqueRequiredId(input.organizationId, "WORKFORCE_EXCEPTION_CASE_INPUT_INVALID")
  const agentId = opaqueRequiredId(input.agentId, "WORKFORCE_EXCEPTION_CASE_INPUT_INVALID")
  const kind = policyCode(input.kind, "WORKFORCE_EXCEPTION_CASE_INPUT_INVALID")
  if (typeof input.detectorVersion !== "string" || !DETECTOR_VERSION.test(input.detectorVersion)) {
    throw new WorkforceExceptionCaseLedgerError("WORKFORCE_EXCEPTION_CASE_INPUT_INVALID")
  }
  const links = normalizeLinks(input.links)
  return createHash("sha256").update(JSON.stringify({
    version: 1,
    organizationId,
    agentId,
    kind,
    detectorVersion: input.detectorVersion,
    links,
  })).digest("hex")
}

export function createWorkforceExceptionCaseDraft(input: {
  organizationId: string
  agentId: string
  kind: string
  detectorVersion: string
  links: WorkforceExceptionCaseLinks
}): WorkforceExceptionCaseDraft {
  const organizationId = opaqueRequiredId(input.organizationId, "WORKFORCE_EXCEPTION_CASE_INPUT_INVALID")
  const agentId = opaqueRequiredId(input.agentId, "WORKFORCE_EXCEPTION_CASE_INPUT_INVALID")
  const kind = policyCode(input.kind, "WORKFORCE_EXCEPTION_CASE_INPUT_INVALID")
  if (typeof input.detectorVersion !== "string" || !DETECTOR_VERSION.test(input.detectorVersion)) {
    throw new WorkforceExceptionCaseLedgerError("WORKFORCE_EXCEPTION_CASE_INPUT_INVALID")
  }
  const links = normalizeLinks(input.links)
  return {
    organizationId,
    agentId,
    kind,
    detectorVersion: input.detectorVersion,
    deduplicationKey: workforceExceptionCaseDeduplicationKey({
      organizationId,
      agentId,
      kind,
      detectorVersion: input.detectorVersion,
      links,
    }),
    links,
  }
}

/**
 * Produces an immutable accountable decision envelope. A later lifecycle
 * service must first authorize the actor, resolve the case and apply the
 * tenant-approved decision vocabulary before it persists this draft.
 */
export function createWorkforceExceptionDecisionDraft(input: {
  organizationId: string
  caseId: string
  operationId: string
  decisionCode: string
  reason: string
  actorUserId: string
}): WorkforceExceptionDecisionDraft {
  const reason = typeof input.reason === "string" ? input.reason.trim() : ""
  if (!reason || reason.length > 1000) {
    throw new WorkforceExceptionCaseLedgerError("WORKFORCE_EXCEPTION_DECISION_INPUT_INVALID")
  }
  return {
    organizationId: opaqueRequiredId(input.organizationId, "WORKFORCE_EXCEPTION_DECISION_INPUT_INVALID"),
    caseId: opaqueRequiredId(input.caseId, "WORKFORCE_EXCEPTION_DECISION_INPUT_INVALID"),
    operationId: opaqueRequiredId(input.operationId, "WORKFORCE_EXCEPTION_DECISION_INPUT_INVALID"),
    decisionCode: policyCode(input.decisionCode, "WORKFORCE_EXCEPTION_DECISION_INPUT_INVALID"),
    reason,
    actorUserId: opaqueRequiredId(input.actorUserId, "WORKFORCE_EXCEPTION_DECISION_INPUT_INVALID"),
  }
}

/**
 * Constructs a decision only after its suggested v1 lifecycle transition is
 * valid. It remains an immutable draft: the caller supplies a complete
 * tenant-scoped decision sequence, and no query, authorization or write is
 * performed here.
 */
export function createDraftPolicyWorkforceExceptionDecisionDraft(input: {
  organizationId: string
  caseId: string
  operationId: string
  decisionCode: string
  reason: string
  actorUserId: string
  priorDecisionCodes: readonly string[]
}): WorkforceExceptionDecisionDraft {
  const lifecycle = validateWorkforceExceptionDraftDecisionAppend({
    priorDecisionCodes: input.priorDecisionCodes,
    nextDecisionCode: input.decisionCode,
  })
  if (!lifecycle.valid) {
    throw new WorkforceExceptionCaseLedgerError("WORKFORCE_EXCEPTION_DECISION_LIFECYCLE_INVALID")
  }
  return createWorkforceExceptionDecisionDraft(input)
}
