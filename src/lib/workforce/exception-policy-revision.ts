import {
  WORKFORCE_EXCEPTION_DRAFT_POLICY_VERSION,
  WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_V1,
  type WorkforceExceptionDraftPolicy,
} from "@/lib/workforce/exception-policy-draft"
import {
  canonicalWorkforcePolicyJson,
  workforcePolicyDefinitionHash,
} from "@/lib/workforce/policy-definition"

/**
 * SHA-256 of the exact owner-approved recommended-v1 draft. This literal is a
 * review boundary: changing the draft requires a new version and hash rather
 * than silently reinterpreting already recorded provenance.
 */
export const WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_HASH_V1 =
  "5651ee6048857f0c62219176dc1e17d411d0769a835be994a1d0cebbf4291c5a" as const

/**
 * A deliberately small bound for a complete tenant acknowledgement stream.
 * Reaching it requires an explicit follow-up design rather than turning an
 * unbounded authority ledger into an application request dependency.
 */
export const MAX_WORKFORCE_EXCEPTION_POLICY_REVISIONS = 64
export const WORKFORCE_EXCEPTION_POLICY_TENANT_RECORD_REASON_CODE =
  "TENANT_RECORDED_DRAFT" as const

export type WorkforceExceptionPolicyRevisionDraft = {
  organizationId: string
  operationId: string
  policyVersion: typeof WORKFORCE_EXCEPTION_DRAFT_POLICY_VERSION
  definition: WorkforceExceptionDraftPolicy
  definitionHash: typeof WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_HASH_V1
  recordedByUserId: string
  recordReasonCode: typeof WORKFORCE_EXCEPTION_POLICY_TENANT_RECORD_REASON_CODE
}

export class WorkforceExceptionPolicyRevisionInputError extends Error {
  constructor(readonly code: "WORKFORCE_EXCEPTION_POLICY_REVISION_INPUT_INVALID") {
    super(code)
  }
}

export type WorkforceExceptionPolicyRevisionRecord = {
  id: string
  organizationId: string
  revision: number
  operationId: string
  policyVersion: string
  definition: unknown
  definitionHash: string
  recordedByUserId: string
  recordReasonCode: string
  createdAt: Date
}

export type WorkforceExceptionPolicyDraftRevisionResolution =
  | {
      status: "UNAVAILABLE"
      code: "WORKFORCE_EXCEPTION_POLICY_REVISION_MISSING"
    }
  | {
      status: "INVALID"
      code:
        | "WORKFORCE_EXCEPTION_POLICY_REVISION_SOURCE_DRIFT"
        | "WORKFORCE_EXCEPTION_POLICY_REVISION_STREAM_INVALID"
        | "WORKFORCE_EXCEPTION_POLICY_REVISION_UNSUPPORTED"
    }
  | {
      status: "VALID_DRAFT"
      revisionId: string
      organizationId: string
      revision: number
      policyVersion: typeof WORKFORCE_EXCEPTION_DRAFT_POLICY_VERSION
      definitionHash: typeof WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_HASH_V1
      definition: WorkforceExceptionDraftPolicy
    }

const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/u
const REASON_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u
const canonicalRecommendedDefinition = canonicalWorkforcePolicyJson(
  WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_V1,
)
const computedRecommendedDefinitionHash = workforcePolicyDefinitionHash(
  WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_V1,
)

function opaqueIdentifier(value: unknown): string {
  if (
    typeof value !== "string"
    || !value.trim()
    || value.length > 191
    || /[\u0000-\u001f]/u.test(value)
  ) {
    throw new WorkforceExceptionPolicyRevisionInputError(
      "WORKFORCE_EXCEPTION_POLICY_REVISION_INPUT_INVALID",
    )
  }
  return value
}

/**
 * Produces the only policy payload this dormant writer is allowed to record.
 * The caller cannot supply a definition, hash, version or free-form reason.
 * Persisting this draft remains an acknowledgement, never tenant activation.
 */
export function createWorkforceExceptionPolicyRevisionDraft(input: {
  organizationId: unknown
  operationId: unknown
  recordedByUserId: unknown
}): WorkforceExceptionPolicyRevisionDraft {
  if (
    typeof input.operationId !== "string"
    || !OPERATION_ID_PATTERN.test(input.operationId)
  ) {
    throw new WorkforceExceptionPolicyRevisionInputError(
      "WORKFORCE_EXCEPTION_POLICY_REVISION_INPUT_INVALID",
    )
  }
  return {
    organizationId: opaqueIdentifier(input.organizationId),
    operationId: input.operationId,
    policyVersion: WORKFORCE_EXCEPTION_DRAFT_POLICY_VERSION,
    definition: WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_V1,
    definitionHash: WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_HASH_V1,
    recordedByUserId: opaqueIdentifier(input.recordedByUserId),
    recordReasonCode: WORKFORCE_EXCEPTION_POLICY_TENANT_RECORD_REASON_CODE,
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function matchesRecommendedDefinition(value: unknown): boolean {
  try {
    return canonicalWorkforcePolicyJson(value) === canonicalRecommendedDefinition
  } catch {
    return false
  }
}

/**
 * Validates the complete caller-supplied revision stream and returns only the
 * latest exact owner-approved draft. It deliberately does not activate a
 * tenant, authorize a decision, read storage or select an effective window.
 * Empty, gapped, reordered, mixed-tenant or unsupported history fails closed.
 */
export function resolveWorkforceExceptionPolicyDraftRevision(
  records: readonly WorkforceExceptionPolicyRevisionRecord[],
): WorkforceExceptionPolicyDraftRevisionResolution {
  if (
    computedRecommendedDefinitionHash
    !== WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_HASH_V1
  ) {
    return {
      status: "INVALID",
      code: "WORKFORCE_EXCEPTION_POLICY_REVISION_SOURCE_DRIFT",
    }
  }
  if (records.length === 0) {
    return {
      status: "UNAVAILABLE",
      code: "WORKFORCE_EXCEPTION_POLICY_REVISION_MISSING",
    }
  }

  const organizationId = records[0]?.organizationId
  if (!isNonEmptyString(organizationId)) {
    return {
      status: "INVALID",
      code: "WORKFORCE_EXCEPTION_POLICY_REVISION_STREAM_INVALID",
    }
  }
  const ids = new Set<string>()
  const operationIds = new Set<string>()

  for (const [index, record] of records.entries()) {
    if (
      record === null
      || typeof record !== "object"
      || record.organizationId !== organizationId
      || !isNonEmptyString(record.id)
      || ids.has(record.id)
      || !Number.isSafeInteger(record.revision)
      || record.revision !== index + 1
      || typeof record.operationId !== "string"
      || !OPERATION_ID_PATTERN.test(record.operationId)
      || operationIds.has(record.operationId)
      || !isNonEmptyString(record.recordedByUserId)
      || typeof record.recordReasonCode !== "string"
      || !REASON_CODE_PATTERN.test(record.recordReasonCode)
      || !(record.createdAt instanceof Date)
      || !Number.isFinite(record.createdAt.getTime())
    ) {
      return {
        status: "INVALID",
        code: "WORKFORCE_EXCEPTION_POLICY_REVISION_STREAM_INVALID",
      }
    }
    ids.add(record.id)
    operationIds.add(record.operationId)

    if (
      record.policyVersion !== WORKFORCE_EXCEPTION_DRAFT_POLICY_VERSION
      || record.definitionHash !== WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_HASH_V1
      || !matchesRecommendedDefinition(record.definition)
    ) {
      return {
        status: "INVALID",
        code: "WORKFORCE_EXCEPTION_POLICY_REVISION_UNSUPPORTED",
      }
    }
  }

  const latest = records[records.length - 1]!
  return {
    status: "VALID_DRAFT",
    revisionId: latest.id,
    organizationId: latest.organizationId,
    revision: latest.revision,
    policyVersion: WORKFORCE_EXCEPTION_DRAFT_POLICY_VERSION,
    definitionHash: WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_HASH_V1,
    definition: WORKFORCE_RECOMMENDED_EXCEPTION_DRAFT_POLICY_V1,
  }
}
