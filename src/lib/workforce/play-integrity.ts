import { createHash, timingSafeEqual } from "node:crypto"

/**
 * Play Integrity is an additional server-verified signal, not an identity or
 * presence verdict. This module binds a Standard API requestHash to an exact
 * Workforce mutation and evaluates only a verdict already decoded by Google's
 * server-side API. It deliberately does not accept a raw token or cache a
 * verdict in application storage.
 */

export type WorkforcePlayIntegrityAction = "START" | "PAUSE" | "RESUME" | "FINISH"

export type WorkforcePlayIntegrityVerdict = {
  /** Only a trusted server decoder may construct this object. */
  decodedBy: "GOOGLE_PLAY_INTEGRITY_SERVER_DECODE"
  requestDetails: {
    requestHash: string | null
  }
  appIntegrity: {
    appRecognitionVerdict: "PLAY_RECOGNIZED" | "UNRECOGNIZED_VERSION" | "UNEVALUATED"
    packageName: string | null
    certificateSha256Digest: readonly string[]
    versionCode: string | null
  }
  deviceIntegrity: {
    deviceRecognitionVerdict: readonly string[]
  }
  accountDetails: {
    appLicensingVerdict: "LICENSED" | "UNLICENSED" | "UNEVALUATED"
  }
}

export type WorkforcePlayIntegrityPolicy = {
  packageName: string
  certificateSha256Digest: readonly string[]
  minimumVersionCode: bigint
  minimumDeviceIntegrity: "MEETS_DEVICE_INTEGRITY" | "MEETS_STRONG_INTEGRITY"
  requireLicensed: boolean
}

export type WorkforcePlayIntegrityAssessment =
  | { status: "ACCEPTED"; code: "WORKFORCE_PLAY_INTEGRITY_ACCEPTED" }
  | {
      status: "REVIEW_REQUIRED"
      code: "WORKFORCE_PLAY_INTEGRITY_DEVICE_UNAVAILABLE"
      recovery: "RETRY_OR_REVIEWED_FALLBACK"
    }
  | {
      status: "REJECTED"
      code:
        | "WORKFORCE_PLAY_INTEGRITY_INPUT_INVALID"
        | "WORKFORCE_PLAY_INTEGRITY_REQUEST_MISMATCH"
        | "WORKFORCE_PLAY_INTEGRITY_APP_UNRECOGNIZED"
        | "WORKFORCE_PLAY_INTEGRITY_APP_IDENTITY_MISMATCH"
        | "WORKFORCE_PLAY_INTEGRITY_APP_VERSION_UNSUPPORTED"
        | "WORKFORCE_PLAY_INTEGRITY_UNLICENSED"
      recovery?: "GET_LICENSED"
    }

const ACTIONS = new Set<WorkforcePlayIntegrityAction>(["START", "PAUSE", "RESUME", "FINISH"])
const ID = /^[A-Za-z0-9_-]{1,100}$/
const SHA256_BASE64URL = /^[A-Za-z0-9_-]{43}$/

function canonicalUtc(value: string): string | null {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? value : null
}

function validPolicy(policy: WorkforcePlayIntegrityPolicy): boolean {
  return /^[A-Za-z][A-Za-z0-9_.]{1,191}$/.test(policy.packageName)
    && policy.certificateSha256Digest.length > 0
    && policy.certificateSha256Digest.every((value) => SHA256_BASE64URL.test(value))
    && policy.minimumVersionCode >= 0n
    && (policy.minimumDeviceIntegrity === "MEETS_DEVICE_INTEGRITY" || policy.minimumDeviceIntegrity === "MEETS_STRONG_INTEGRITY")
}

function exactSet(left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  return leftSet.size === rightSet.size && [...leftSet].every((value) => rightSet.has(value))
}

function constantTimeTextEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8")
  const rightBytes = Buffer.from(right, "utf8")
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

/**
 * Canonically hashes the exact employee mutation without location, QR token,
 * biometric data, signature or employee reason. The resulting base64url
 * SHA-256 digest is suitable for StandardIntegrityTokenRequest.requestHash
 * and stays below Play Integrity's request-hash limit.
 */
export function workforcePlayIntegrityRequestHash(input: {
  organizationId: string
  agentId: string
  enrollmentId: string
  operationId: string
  workdayId: string
  action: WorkforcePlayIntegrityAction
  occurredAt: string
  schemaVersion: number
}): string {
  if (!ID.test(input.organizationId)
    || !ID.test(input.agentId)
    || !ID.test(input.enrollmentId)
    || !ID.test(input.operationId)
    || !ID.test(input.workdayId)
    || !ACTIONS.has(input.action)
    || canonicalUtc(input.occurredAt) == null
    || !Number.isSafeInteger(input.schemaVersion)
    || input.schemaVersion < 1) {
    throw new Error("WORKFORCE_PLAY_INTEGRITY_INPUT_INVALID")
  }
  return createHash("sha256").update(JSON.stringify({
    version: 1,
    organizationId: input.organizationId,
    agentId: input.agentId,
    enrollmentId: input.enrollmentId,
    operationId: input.operationId,
    workdayId: input.workdayId,
    action: input.action,
    occurredAt: input.occurredAt,
    schemaVersion: input.schemaVersion,
  })).digest("base64url")
}

/**
 * Evaluates a Google-server-decoded Standard API verdict against an exact
 * action hash. Missing/weak device integrity routes to review; token/hash/app
 * identity failures are rejected. This function persists nothing, so a valid
 * result cannot be reused as a cached authorization for another operation.
 */
export function assessWorkforcePlayIntegrity(input: {
  expectedRequestHash: string
  policy: WorkforcePlayIntegrityPolicy
  verdict: WorkforcePlayIntegrityVerdict
}): WorkforcePlayIntegrityAssessment {
  if (!SHA256_BASE64URL.test(input.expectedRequestHash) || !validPolicy(input.policy)
    || input.verdict.decodedBy !== "GOOGLE_PLAY_INTEGRITY_SERVER_DECODE") {
    return { status: "REJECTED", code: "WORKFORCE_PLAY_INTEGRITY_INPUT_INVALID" }
  }
  if (input.verdict.requestDetails.requestHash == null
    || !constantTimeTextEqual(input.verdict.requestDetails.requestHash, input.expectedRequestHash)) {
    return { status: "REJECTED", code: "WORKFORCE_PLAY_INTEGRITY_REQUEST_MISMATCH" }
  }
  if (input.verdict.appIntegrity.appRecognitionVerdict !== "PLAY_RECOGNIZED") {
    return {
      status: "REJECTED",
      code: "WORKFORCE_PLAY_INTEGRITY_APP_UNRECOGNIZED",
      recovery: "GET_LICENSED",
    }
  }
  if (input.verdict.appIntegrity.packageName !== input.policy.packageName
    || !exactSet(input.verdict.appIntegrity.certificateSha256Digest, input.policy.certificateSha256Digest)) {
    return { status: "REJECTED", code: "WORKFORCE_PLAY_INTEGRITY_APP_IDENTITY_MISMATCH" }
  }
  let versionCode: bigint
  try {
    versionCode = input.verdict.appIntegrity.versionCode == null ? -1n : BigInt(input.verdict.appIntegrity.versionCode)
  } catch {
    return { status: "REJECTED", code: "WORKFORCE_PLAY_INTEGRITY_APP_VERSION_UNSUPPORTED" }
  }
  if (versionCode < input.policy.minimumVersionCode) {
    return { status: "REJECTED", code: "WORKFORCE_PLAY_INTEGRITY_APP_VERSION_UNSUPPORTED" }
  }
  if (input.policy.requireLicensed && input.verdict.accountDetails.appLicensingVerdict !== "LICENSED") {
    return {
      status: "REJECTED",
      code: "WORKFORCE_PLAY_INTEGRITY_UNLICENSED",
      recovery: "GET_LICENSED",
    }
  }
  if (!input.verdict.deviceIntegrity.deviceRecognitionVerdict.includes(input.policy.minimumDeviceIntegrity)) {
    return {
      status: "REVIEW_REQUIRED",
      code: "WORKFORCE_PLAY_INTEGRITY_DEVICE_UNAVAILABLE",
      recovery: "RETRY_OR_REVIEWED_FALLBACK",
    }
  }
  return { status: "ACCEPTED", code: "WORKFORCE_PLAY_INTEGRITY_ACCEPTED" }
}
