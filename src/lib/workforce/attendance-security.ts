import {
  createHash,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify,
  type KeyObject,
} from "node:crypto"
import { hmacToken } from "@/lib/secure-token"
import {
  WorkforceAttendanceActionSchema,
  type WorkforceAttendanceAction,
} from "@/lib/workforce/attendance-policy"

const QR_VERSION = "wa1"
const QR_MAX_LIFETIME_SECONDS = 5 * 60
const QR_CLOCK_SKEW_SECONDS = 60
const DEVICE_KEY_ALGORITHM = "ECDSA_P256_SHA256" as const
const DEVICE_KEY_CURVE = "prime256v1"

export type WorkforceDeviceKeyAlgorithm = typeof DEVICE_KEY_ALGORITHM

export type WorkforceAttendanceQrPayload = {
  stationId: string
  nonce: string
  issuedAt: Date
  expiresAt: Date
}

export class WorkforceAttendanceSecurityError extends Error {
  constructor(
    readonly code:
      | "WORKFORCE_ATTENDANCE_QR_INVALID"
      | "WORKFORCE_ATTENDANCE_QR_EXPIRED"
      | "WORKFORCE_ATTENDANCE_DEVICE_KEY_INVALID",
    message: string = code,
  ) {
    super(message)
  }
}

function requireIdentifier(value: string, name: string): string {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(value)) {
    throw new WorkforceAttendanceSecurityError(
      "WORKFORCE_ATTENDANCE_QR_INVALID",
      `${name} is invalid`,
    )
  }
  return value
}

function b64url(buffer: Buffer): string {
  return buffer.toString("base64url")
}

function decodeB64url(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 2048) return null
  try {
    return Buffer.from(value, "base64url")
  } catch {
    return null
  }
}

function qrSignature(payloadSegment: string, organizationId: string): string {
  return hmacToken(payloadSegment, `workforce-attendance-qr:v1:${organizationId}`)
}

function qrPayloadJson(input: {
  stationId: string
  nonce: string
  issuedAtSeconds: number
  expiresAtSeconds: number
}): string {
  // Fixed field order is part of the signed wire contract.  Do not sign an
  // arbitrary JSON object whose serialisation could differ across runtimes.
  return JSON.stringify({
    v: 1,
    s: input.stationId,
    n: input.nonce,
    i: input.issuedAtSeconds,
    e: input.expiresAtSeconds,
  })
}

/** Creates a short-lived, server-signed QR payload for one attendance station. */
export function mintWorkforceAttendanceQr(input: {
  organizationId: string
  stationId: string
  expiresAt: Date
  now?: Date
}): string {
  requireIdentifier(input.organizationId, "organizationId")
  requireIdentifier(input.stationId, "stationId")
  const now = input.now ?? new Date()
  const issuedAtSeconds = Math.floor(now.getTime() / 1000)
  const expiresAtSeconds = Math.floor(input.expiresAt.getTime() / 1000)
  if (
    !Number.isSafeInteger(expiresAtSeconds)
    || expiresAtSeconds <= issuedAtSeconds
    || expiresAtSeconds > issuedAtSeconds + QR_MAX_LIFETIME_SECONDS
  ) {
    throw new WorkforceAttendanceSecurityError(
      "WORKFORCE_ATTENDANCE_QR_INVALID",
      "QR expiry must be a future instant within five minutes",
    )
  }
  const nonce = b64url(randomBytes(24))
  const payload = b64url(Buffer.from(qrPayloadJson({
    stationId: input.stationId,
    nonce,
    issuedAtSeconds,
    expiresAtSeconds,
  }), "utf8"))
  return `${QR_VERSION}.${payload}.${qrSignature(payload, input.organizationId)}`
}

function parseQrPayload(payloadSegment: string): {
  stationId: string
  nonce: string
  issuedAtSeconds: number
  expiresAtSeconds: number
} {
  const decoded = decodeB64url(payloadSegment)
  if (!decoded) {
    throw new WorkforceAttendanceSecurityError("WORKFORCE_ATTENDANCE_QR_INVALID")
  }
  let value: unknown
  try {
    value = JSON.parse(decoded.toString("utf8"))
  } catch {
    throw new WorkforceAttendanceSecurityError("WORKFORCE_ATTENDANCE_QR_INVALID")
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkforceAttendanceSecurityError("WORKFORCE_ATTENDANCE_QR_INVALID")
  }
  const payload = value as Record<string, unknown>
  if (
    payload.v !== 1
    || typeof payload.s !== "string"
    || typeof payload.n !== "string"
    || !/^[A-Za-z0-9_-]{16,128}$/.test(payload.n)
    || !Number.isSafeInteger(payload.i)
    || !Number.isSafeInteger(payload.e)
  ) {
    throw new WorkforceAttendanceSecurityError("WORKFORCE_ATTENDANCE_QR_INVALID")
  }
  requireIdentifier(payload.s, "stationId")
  return {
    stationId: payload.s,
    nonce: payload.n,
    issuedAtSeconds: payload.i as number,
    expiresAtSeconds: payload.e as number,
  }
}

/**
 * Authenticates the signed QR before its station is looked up in the tenant
 * database.  The caller stores only `workforceAttendanceQrNonceFingerprint()`;
 * the scan's raw nonce and token never become attendance/audit data.
 */
export function verifyWorkforceAttendanceQr(input: {
  organizationId: string
  token: string
  now?: Date
}): WorkforceAttendanceQrPayload {
  requireIdentifier(input.organizationId, "organizationId")
  const parts = input.token.split(".")
  if (parts.length !== 3 || parts[0] !== QR_VERSION || !/^[a-f0-9]{64}$/i.test(parts[2] ?? "")) {
    throw new WorkforceAttendanceSecurityError("WORKFORCE_ATTENDANCE_QR_INVALID")
  }
  const [_, payloadSegment, suppliedSignature] = parts
  const expectedSignature = Buffer.from(qrSignature(payloadSegment!, input.organizationId), "hex")
  const actualSignature = Buffer.from(suppliedSignature!, "hex")
  if (
    expectedSignature.length !== actualSignature.length
    || !timingSafeEqual(expectedSignature, actualSignature)
  ) {
    throw new WorkforceAttendanceSecurityError("WORKFORCE_ATTENDANCE_QR_INVALID")
  }

  const payload = parseQrPayload(payloadSegment!)
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000)
  if (
    payload.expiresAtSeconds <= nowSeconds
    || payload.issuedAtSeconds > nowSeconds + QR_CLOCK_SKEW_SECONDS
    || payload.expiresAtSeconds <= payload.issuedAtSeconds
    || payload.expiresAtSeconds > payload.issuedAtSeconds + QR_MAX_LIFETIME_SECONDS
  ) {
    throw new WorkforceAttendanceSecurityError("WORKFORCE_ATTENDANCE_QR_EXPIRED")
  }

  return {
    stationId: payload.stationId,
    nonce: payload.nonce,
    issuedAt: new Date(payload.issuedAtSeconds * 1000),
    expiresAt: new Date(payload.expiresAtSeconds * 1000),
  }
}

/** A tenant-bound, non-reversible key for the single-use QR nonce ledger. */
export function workforceAttendanceQrNonceFingerprint(organizationId: string, nonce: string): string {
  requireIdentifier(organizationId, "organizationId")
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) {
    throw new WorkforceAttendanceSecurityError("WORKFORCE_ATTENDANCE_QR_INVALID")
  }
  return hmacToken(nonce, `workforce-attendance-qr-nonce:v1:${organizationId}`)
}

function requireDeviceIdentifier(value: string, name: string): string {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(value)) {
    throw new WorkforceAttendanceSecurityError(
      "WORKFORCE_ATTENDANCE_DEVICE_KEY_INVALID",
      `${name} is invalid`,
    )
  }
  return value
}

function requireDeviceTimestamp(value: Date): string {
  if (Number.isNaN(value.getTime())) {
    throw new WorkforceAttendanceSecurityError("WORKFORCE_ATTENDANCE_DEVICE_KEY_INVALID", "occurredAt is invalid")
  }
  return value.toISOString()
}

/**
 * Canonical byte-for-byte challenge signed during enrollment.  The challenge
 * itself is one-time and stored hashed by the route/service layer.
 */
export function workforceDeviceEnrollmentChallenge(input: {
  organizationId: string
  agentId: string
  enrollmentId: string
  challenge: string
}): string {
  const challenge = input.challenge
  if (!/^[A-Za-z0-9_-]{24,256}$/.test(challenge)) {
    throw new WorkforceAttendanceSecurityError("WORKFORCE_ATTENDANCE_DEVICE_KEY_INVALID", "challenge is invalid")
  }
  return [
    "workforce-device-enrollment:v1",
    `organizationId=${requireDeviceIdentifier(input.organizationId, "organizationId")}`,
    `agentId=${requireDeviceIdentifier(input.agentId, "agentId")}`,
    `enrollmentId=${requireDeviceIdentifier(input.enrollmentId, "enrollmentId")}`,
    `challenge=${challenge}`,
  ].join("\n")
}

/** Stores only this tenant-bound fingerprint, never the raw enrollment challenge. */
export function workforceDeviceEnrollmentChallengeFingerprint(
  organizationId: string,
  challenge: string,
): string {
  requireDeviceIdentifier(organizationId, "organizationId")
  if (!/^[A-Za-z0-9_-]{24,256}$/.test(challenge)) {
    throw new WorkforceAttendanceSecurityError("WORKFORCE_ATTENDANCE_DEVICE_KEY_INVALID", "challenge is invalid")
  }
  return hmacToken(challenge, `workforce-attendance-device-challenge:v1:${organizationId}`)
}

/**
 * Canonical proof for one exact work-time mutation.  A signature cannot be
 * reused for another tenant, employee, event id, action, workday, or time.
 */
export function workforceDeviceAttendanceChallenge(input: {
  organizationId: string
  agentId: string
  enrollmentId: string
  clientEventId: string
  action: WorkforceAttendanceAction
  workdayId: string
  occurredAt: Date
}): string {
  if (!WorkforceAttendanceActionSchema.safeParse(input.action).success) {
    throw new WorkforceAttendanceSecurityError("WORKFORCE_ATTENDANCE_DEVICE_KEY_INVALID", "action is invalid")
  }
  return [
    "workforce-device-attendance:v1",
    `organizationId=${requireDeviceIdentifier(input.organizationId, "organizationId")}`,
    `agentId=${requireDeviceIdentifier(input.agentId, "agentId")}`,
    `enrollmentId=${requireDeviceIdentifier(input.enrollmentId, "enrollmentId")}`,
    `clientEventId=${requireDeviceIdentifier(input.clientEventId, "clientEventId")}`,
    `action=${input.action}`,
    `workdayId=${requireDeviceIdentifier(input.workdayId, "workdayId")}`,
    `occurredAt=${requireDeviceTimestamp(input.occurredAt)}`,
  ].join("\n")
}

function strictBase64(value: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length > 8192 || value.length % 4 !== 0) return null
  try {
    const decoded = Buffer.from(value, "base64")
    return decoded.length > 0 ? decoded : null
  } catch {
    return null
  }
}

function parsedDevicePublicKey(publicKeySpkiBase64: string): KeyObject | null {
  const der = strictBase64(publicKeySpkiBase64)
  if (!der) return null
  try {
    const key = createPublicKey({ key: der, format: "der", type: "spki" })
    const curve = key.asymmetricKeyDetails?.namedCurve
    return key.asymmetricKeyType === "ec" && curve === DEVICE_KEY_CURVE ? key : null
  } catch {
    return null
  }
}

/** Validates the only device-key algorithm accepted by the first H5 release. */
export function validateWorkforceDevicePublicKey(publicKeySpkiBase64: string): {
  algorithm: WorkforceDeviceKeyAlgorithm
  fingerprint: string
} {
  const key = parsedDevicePublicKey(publicKeySpkiBase64)
  if (!key) {
    throw new WorkforceAttendanceSecurityError("WORKFORCE_ATTENDANCE_DEVICE_KEY_INVALID")
  }
  const der = key.export({ format: "der", type: "spki" })
  return {
    algorithm: DEVICE_KEY_ALGORITHM,
    fingerprint: createHash("sha256").update(der).digest("hex"),
  }
}

/** Verifies a DER-encoded P-256/SHA-256 signature from the enrolled device key. */
export function verifyWorkforceDeviceSignature(input: {
  publicKeySpkiBase64: string
  challenge: string
  signatureBase64: string
}): boolean {
  const key = parsedDevicePublicKey(input.publicKeySpkiBase64)
  const signature = strictBase64(input.signatureBase64)
  if (!key || !signature || !input.challenge) return false
  try {
    return verify("sha256", Buffer.from(input.challenge, "utf8"), {
      key,
      dsaEncoding: "der",
    }, signature)
  } catch {
    return false
  }
}
