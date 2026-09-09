import { createHash } from "node:crypto"
import { z } from "zod"

const NonNegativeSeconds = z.number().int().min(0).refine(
  Number.isSafeInteger,
  "Duration must be a safe integer",
)

/**
 * Only the five fields already persisted in WorkforcePolicySnapshot are
 * interpreted here. Unknown definition keys remain part of the signed JSON
 * and are intentionally not treated as a new policy or schedule contract.
 */
export const WorkforcePolicyCalculationDefinitionSchema = z.object({
  expectedWorkSeconds: NonNegativeSeconds,
  lateGraceSeconds: NonNegativeSeconds,
  undertimeToleranceSeconds: NonNegativeSeconds,
  overtimeThresholdSeconds: NonNegativeSeconds,
  longPauseThresholdSeconds: NonNegativeSeconds.nullable(),
}).passthrough()

export type WorkforcePolicySnapshotValues = {
  expectedWorkSeconds: number
  lateGraceSeconds: number
  undertimeToleranceSeconds: number
  overtimeThresholdSeconds: number
  longPauseThresholdSeconds: number | null
}

export class WorkforcePolicyDefinitionError extends Error {
  constructor(
    readonly code:
      | "WORKFORCE_POLICY_DEFINITION_INVALID"
      | "WORKFORCE_POLICY_DEFINITION_HASH_MISMATCH",
    message: string = code,
  ) {
    super(message)
  }
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map(canonicalValue)
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalValue(nested)]),
  )
}

export function canonicalWorkforcePolicyJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value))
}

export function workforcePolicyDefinitionHash(value: unknown): string {
  return createHash("sha256").update(canonicalWorkforcePolicyJson(value)).digest("hex")
}

/**
 * Validates the calculation inputs and the full immutable policy hash before
 * snapshotting. It does not define shift JSON, geofence, QR, device or
 * retention semantics; those remain opaque definition fields until approved.
 */
export function workforcePolicySnapshotValues(input: {
  definition: unknown
  definitionHash: string
}): WorkforcePolicySnapshotValues {
  const parsed = WorkforcePolicyCalculationDefinitionSchema.safeParse(input.definition)
  if (!parsed.success) {
    throw new WorkforcePolicyDefinitionError(
      "WORKFORCE_POLICY_DEFINITION_INVALID",
      "Workforce policy is missing valid calculation inputs",
    )
  }
  if (
    !/^[a-f0-9]{64}$/i.test(input.definitionHash)
    || workforcePolicyDefinitionHash(parsed.data) !== input.definitionHash.toLowerCase()
  ) {
    throw new WorkforcePolicyDefinitionError(
      "WORKFORCE_POLICY_DEFINITION_HASH_MISMATCH",
      "Workforce policy definition does not match its immutable hash",
    )
  }
  return {
    expectedWorkSeconds: parsed.data.expectedWorkSeconds,
    lateGraceSeconds: parsed.data.lateGraceSeconds,
    undertimeToleranceSeconds: parsed.data.undertimeToleranceSeconds,
    overtimeThresholdSeconds: parsed.data.overtimeThresholdSeconds,
    longPauseThresholdSeconds: parsed.data.longPauseThresholdSeconds,
  }
}
