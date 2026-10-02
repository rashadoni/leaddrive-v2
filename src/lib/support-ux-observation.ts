import { createHmac } from "node:crypto"

import { DEPLOY_SHA } from "@/generated/build-sha"
import { requireAuthSecret } from "@/lib/auth-secret"
import logger from "@/lib/logger"

export type SupportUxObservationOperation =
  | "CATEGORY_LIST"
  | "CATEGORY_CREATE"
  | "CATEGORY_RENAME"
  | "CATEGORY_DELETE"
export type SupportUxObservationMode = "database" | "browser" | "unverified"
type UnavailableReason =
  | "INVALID_CONTEXT"
  | "ARTIFACT_UNAVAILABLE"
  | "TENANT_KEY_UNAVAILABLE"
  | "CLOCK_UNAVAILABLE"
  | "MODE_INVALID"
  | "RESPONSE_UNAVAILABLE"

export type SupportUxObservationEvent = {
  event: "support_ux_observation"
  schema_version: 1
  observed_at_utc: string
  artifact_sha: string
  tenant_key: string
  operation: SupportUxObservationOperation
  mode: SupportUxObservationMode
  http_status: number | null
  outcome: "success" | "client_rejection" | "server_error" | "thrown"
  duration_ms: number
}

export type SupportUxObservationUnavailableEvent = {
  event: "support_ux_observation_unavailable"
  schema_version: 1
  reason: UnavailableReason
}

export type SupportUxObservationOptions = {
  artifactSha?: () => string
  now?: () => number
  observedAtUtc?: () => string
  secret?: () => string
  sink?: {
    info: (event: SupportUxObservationEvent | SupportUxObservationUnavailableEvent, message: string) => unknown
  }
}

const OPERATIONS = new Set<SupportUxObservationOperation>([
  "CATEGORY_LIST", "CATEGORY_CREATE", "CATEGORY_RENAME", "CATEGORY_DELETE",
])
const MODES = new Set<SupportUxObservationMode>(["database", "browser", "unverified"])
const SHA_RE = /^[0-9a-f]{40}$/
const UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function validOrgId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= 256
}

/** Same domain and key bytes must be used by the protected daily collector. */
export function supportUxObservationTenantKey(orgId: string, secret: string = requireAuthSecret()): string {
  if (!validOrgId(orgId) || typeof secret !== "string" || secret.length === 0) {
    throw new Error("SUPPORT_UX_OBSERVATION_KEY_UNAVAILABLE")
  }
  return createHmac("sha256", secret).update(`support-ux-observation-v1:${orgId}`, "utf8").digest("hex")
}

/**
 * Unsampled server-handler observations, ONLY after successful base auth.
 * These are not proxy/auth, network, browser or end-to-end latency metrics.
 * Missing/invalid context emits a fixed unavailable event, never zero coverage.
 * The compiled deployment SHA is authoritative; environment SHA values are not.
 * Logging is best effort: missing/dropped logs must prevent observation admission.
 */
export async function observeSupportUxOperation(
  context: { orgId: string; operation: SupportUxObservationOperation },
  handler: (setMode: (mode: SupportUxObservationMode) => void) => Promise<Response>,
  options: SupportUxObservationOptions = {},
): Promise<Response> {
  const now = options.now ?? (() => performance.now())
  const sink = options.sink ?? logger
  let reason: UnavailableReason | undefined
  let artifactSha = ""
  let tenantKey = ""
  let startedAt = NaN
  let mode: SupportUxObservationMode = "unverified"
  let invalidMode = false
  let completed = false
  let response: Response | undefined
  let thrown = false
  let operation: SupportUxObservationOperation | undefined

  reason = "INVALID_CONTEXT"
  try {
    const orgId = context?.orgId
    operation = context?.operation
    if (validOrgId(orgId) && OPERATIONS.has(operation)) reason = undefined
    if (!reason) {
      reason = "ARTIFACT_UNAVAILABLE"
      artifactSha = (options.artifactSha ?? (() => DEPLOY_SHA))()
      if (typeof artifactSha === "string" && SHA_RE.test(artifactSha)) {
        reason = "TENANT_KEY_UNAVAILABLE"
        tenantKey = supportUxObservationTenantKey(orgId, (options.secret ?? requireAuthSecret)())
        reason = undefined
      }
    }
  } catch {
    // Only the fixed reason survives; never retain configuration/exception text.
  }
  try {
    startedAt = now()
    if (!Number.isFinite(startedAt) || startedAt < 0) reason ??= "CLOCK_UNAVAILABLE"
  } catch {
    reason ??= "CLOCK_UNAVAILABLE"
  }

  const setMode = (value: SupportUxObservationMode) => {
    if (completed) return
    if (MODES.has(value)) mode = value
    else invalidMode = true
  }
  try {
    response = await handler(setMode)
    return response
  } catch (error) {
    thrown = true
    throw error
  } finally {
    completed = true
    let event: SupportUxObservationEvent | SupportUxObservationUnavailableEvent
    try {
      if (invalidMode) reason ??= "MODE_INVALID"
      let durationMs = 0
      let observedAtUtc = ""
      if (!reason) {
        reason = "CLOCK_UNAVAILABLE"
        const endedAt = now()
        const elapsed = endedAt - startedAt
        observedAtUtc = (options.observedAtUtc ?? (() => new Date().toISOString()))()
        if (Number.isFinite(endedAt) && endedAt >= 0 && Number.isFinite(elapsed)
          && elapsed >= 0 && elapsed <= 600_000
          && typeof observedAtUtc === "string" && UTC_RE.test(observedAtUtc)
          && new Date(observedAtUtc).toISOString() === observedAtUtc) {
          durationMs = Math.round(elapsed)
          reason = undefined
        }
      }
      let status: number | null = null
      let outcome: SupportUxObservationEvent["outcome"] = "thrown"
      if (!reason && !thrown) {
        reason = "RESPONSE_UNAVAILABLE"
        const returnedStatus = response?.status
        if (typeof returnedStatus === "number" && Number.isInteger(returnedStatus)
          && ((returnedStatus >= 200 && returnedStatus < 300) || (returnedStatus >= 400 && returnedStatus < 600))) {
          status = returnedStatus
          outcome = status < 300 ? "success" : status < 500 ? "client_rejection" : "server_error"
          reason = undefined
        }
      }
      event = reason
        ? { event: "support_ux_observation_unavailable", schema_version: 1, reason }
        : {
          event: "support_ux_observation", schema_version: 1, observed_at_utc: observedAtUtc,
          artifact_sha: artifactSha, tenant_key: tenantKey, operation: operation!,
          mode, http_status: status, outcome, duration_ms: durationMs,
        }
    } catch {
      event = {
        event: "support_ux_observation_unavailable", schema_version: 1,
        reason: reason ?? "INVALID_CONTEXT",
      }
    }
    try {
      sink.info(event, "support ux observation")
    } catch {
      // Never change a handler response or replace its original thrown value.
    }
  }
}
