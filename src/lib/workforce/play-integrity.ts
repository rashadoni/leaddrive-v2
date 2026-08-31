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
    requestPackageName: string | null
    timestampMillis: string | null
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
  /** The decoded Standard API token must be this fresh at server evaluation. */
  maxVerdictAgeSeconds: number
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
        | "WORKFORCE_PLAY_INTEGRITY_VERDICT_STALE"
      recovery?: "GET_LICENSED" | "RETRY"
    }

const ACTIONS = new Set<WorkforcePlayIntegrityAction>(["START", "PAUSE", "RESUME", "FINISH"])
const ID = /^[A-Za-z0-9_-]{1,100}$/
const SHA256_BASE64URL = /^[A-Za-z0-9_-]{43}$/
const NON_NEGATIVE_DECIMAL = /^(0|[1-9][0-9]{0,18})$/

function canonicalUtc(value: string): string | null {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? value : null
}

function validPolicy(policy: WorkforcePlayIntegrityPolicy): boolean {
  return /^[A-Za-z][A-Za-z0-9_.]{1,191}$/.test(policy.packageName)
    && policy.certificateSha256Digest.length > 0
    && policy.certificateSha256Digest.every((value) => SHA256_BASE64URL.test(value))
    && new Set(policy.certificateSha256Digest).size === policy.certificateSha256Digest.length
    && policy.minimumVersionCode >= 0n
    && (policy.minimumDeviceIntegrity === "MEETS_DEVICE_INTEGRITY" || policy.minimumDeviceIntegrity === "MEETS_STRONG_INTEGRITY")
    && Number.isSafeInteger(policy.maxVerdictAgeSeconds)
    && policy.maxVerdictAgeSeconds >= 0
    && policy.maxVerdictAgeSeconds <= 300
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function validVersionCode(value: unknown): value is string {
  return typeof value === "string" && NON_NEGATIVE_DECIMAL.test(value)
}

function nullOrMatches(value: unknown, expression: RegExp): boolean {
  return value === null || (typeof value === "string" && expression.test(value))
}

/**
 * A future decoder crosses an external-service boundary, so reject malformed
 * values at runtime rather than relying only on the TypeScript type. Device
 * labels are deliberately not an enum: Google can add labels, while the
 * policy still requires one known minimum label before it accepts a verdict.
 */
function validDecodedVerdict(value: unknown): value is WorkforcePlayIntegrityVerdict {
  if (!isRecord(value)
    || value.decodedBy !== "GOOGLE_PLAY_INTEGRITY_SERVER_DECODE"
    || !isRecord(value.requestDetails)
    || !isRecord(value.appIntegrity)
    || !isRecord(value.deviceIntegrity)
    || !isRecord(value.accountDetails)) return false

  const requestDetails = value.requestDetails
  const appIntegrity = value.appIntegrity
  const deviceIntegrity = value.deviceIntegrity
  const accountDetails = value.accountDetails
  const certificateSha256Digest = appIntegrity.certificateSha256Digest
  const deviceRecognitionVerdict = deviceIntegrity.deviceRecognitionVerdict
  return nullOrMatches(requestDetails.requestHash, SHA256_BASE64URL)
    && nullOrMatches(requestDetails.requestPackageName, /^[A-Za-z][A-Za-z0-9_.]{1,191}$/)
    && (requestDetails.timestampMillis === null || validVersionCode(requestDetails.timestampMillis))
    && (appIntegrity.appRecognitionVerdict === "PLAY_RECOGNIZED"
      || appIntegrity.appRecognitionVerdict === "UNRECOGNIZED_VERSION"
      || appIntegrity.appRecognitionVerdict === "UNEVALUATED")
    && nullOrMatches(appIntegrity.packageName, /^[A-Za-z][A-Za-z0-9_.]{1,191}$/)
    && Array.isArray(certificateSha256Digest)
    && certificateSha256Digest.every((digest) => typeof digest === "string" && SHA256_BASE64URL.test(digest))
    && new Set(certificateSha256Digest).size === certificateSha256Digest.length
    && (appIntegrity.versionCode === null || validVersionCode(appIntegrity.versionCode))
    && Array.isArray(deviceRecognitionVerdict)
    && deviceRecognitionVerdict.every((label) => typeof label === "string" && /^[A-Z][A-Z0-9_]{1,127}$/.test(label))
    && new Set(deviceRecognitionVerdict).size === deviceRecognitionVerdict.length
    && (accountDetails.appLicensingVerdict === "LICENSED"
      || accountDetails.appLicensingVerdict === "UNLICENSED"
      || accountDetails.appLicensingVerdict === "UNEVALUATED")
}

function verdictTimestampMillis(value: string): bigint | null {
  if (!validVersionCode(value)) return null
  try {
    return BigInt(value)
  } catch {
    return null
  }
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
  now?: Date
}): WorkforcePlayIntegrityAssessment {
  const now = input.now ?? new Date()
  if (!SHA256_BASE64URL.test(input.expectedRequestHash) || !validPolicy(input.policy)
    || !validDecodedVerdict(input.verdict) || Number.isNaN(now.getTime())) {
    return { status: "REJECTED", code: "WORKFORCE_PLAY_INTEGRITY_INPUT_INVALID" }
  }
  if (input.verdict.requestDetails.requestHash == null
    || input.verdict.requestDetails.requestPackageName !== input.policy.packageName
    || !constantTimeTextEqual(input.verdict.requestDetails.requestHash, input.expectedRequestHash)) {
    return { status: "REJECTED", code: "WORKFORCE_PLAY_INTEGRITY_REQUEST_MISMATCH" }
  }
  const timestampMillis = input.verdict.requestDetails.timestampMillis == null
    ? null
    : verdictTimestampMillis(input.verdict.requestDetails.timestampMillis)
  const maximumAgeMillis = BigInt(input.policy.maxVerdictAgeSeconds) * 1_000n
  const nowMillis = BigInt(now.getTime())
  if (timestampMillis == null || timestampMillis > nowMillis || nowMillis - timestampMillis > maximumAgeMillis) {
    return {
      status: "REJECTED",
      code: "WORKFORCE_PLAY_INTEGRITY_VERDICT_STALE",
      recovery: "RETRY",
    }
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
