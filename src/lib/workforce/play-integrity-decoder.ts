import { google } from "googleapis"
import {
  assessWorkforcePlayIntegrity,
  type WorkforcePlayIntegrityAssessment,
  type WorkforcePlayIntegrityPolicy,
  type WorkforcePlayIntegrityVerdict,
} from "@/lib/workforce/play-integrity"

const PLAY_INTEGRITY_SCOPE = "https://www.googleapis.com/auth/playintegrity"
const TOKEN_MAX_LENGTH = 20_000
const SHA256_BASE64URL = /^[A-Za-z0-9_-]{43}$/
const DECIMAL = /^(0|[1-9][0-9]{0,18})$/
const PACKAGE_NAME = /^[A-Za-z][A-Za-z0-9_.]{1,191}$/

type PlayIntegrityEnvironment = Record<string, string | undefined>

type GoogleDecodedPayload = {
  requestDetails?: {
    requestHash?: unknown
    requestPackageName?: unknown
    timestampMillis?: unknown
  } | null
  appIntegrity?: {
    appRecognitionVerdict?: unknown
    packageName?: unknown
    certificateSha256Digest?: unknown
    versionCode?: unknown
  } | null
  deviceIntegrity?: {
    deviceRecognitionVerdict?: unknown
  } | null
  accountDetails?: {
    appLicensingVerdict?: unknown
  } | null
} | null | undefined

export class WorkforcePlayIntegrityDecoderError extends Error {
  constructor(
    readonly code:
      | "WORKFORCE_PLAY_INTEGRITY_NOT_CONFIGURED"
      | "WORKFORCE_PLAY_INTEGRITY_DECODE_UNAVAILABLE"
      | "WORKFORCE_PLAY_INTEGRITY_DECODE_INVALID",
  ) {
    super(code)
  }
}

export type WorkforcePlayIntegrityDecodedToken = (input: {
  packageName: string
  token: string
  credentials: Record<string, unknown>
}) => Promise<GoogleDecodedPayload>

function optionalText(value: unknown, pattern: RegExp): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === "string" && pattern.test(value)) return value
  throw new WorkforcePlayIntegrityDecoderError("WORKFORCE_PLAY_INTEGRITY_DECODE_INVALID")
}

function optionalStringArray(value: unknown): string[] {
  if (value === null || value === undefined) return []
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value as string[]
  }
  throw new WorkforcePlayIntegrityDecoderError("WORKFORCE_PLAY_INTEGRITY_DECODE_INVALID")
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? value as T
    : null
}

function configuredPolicy(env: PlayIntegrityEnvironment): { policy: WorkforcePlayIntegrityPolicy; credentials: Record<string, unknown> } | null {
  const rawCredentials = env.WORKFORCE_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON?.trim()
  const packageName = env.WORKFORCE_PLAY_INTEGRITY_PACKAGE_NAME?.trim()
  const digests = env.WORKFORCE_PLAY_INTEGRITY_CERTIFICATE_SHA256_DIGESTS
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean)
  const minimumVersion = env.WORKFORCE_PLAY_INTEGRITY_MIN_VERSION_CODE?.trim()
  const minimumDeviceIntegrity = env.WORKFORCE_PLAY_INTEGRITY_MIN_DEVICE_INTEGRITY?.trim()
  const maxAge = env.WORKFORCE_PLAY_INTEGRITY_MAX_VERDICT_AGE_SECONDS?.trim() ?? "120"
  const requireLicensed = env.WORKFORCE_PLAY_INTEGRITY_REQUIRE_LICENSED?.trim() ?? "true"
  if (!rawCredentials || !packageName || !digests || digests.length === 0 || !minimumVersion || !minimumDeviceIntegrity) return null
  if (!PACKAGE_NAME.test(packageName)
    || !digests.every((digest) => SHA256_BASE64URL.test(digest))
    || new Set(digests).size !== digests.length
    || !DECIMAL.test(minimumVersion)
    || !["MEETS_DEVICE_INTEGRITY", "MEETS_STRONG_INTEGRITY"].includes(minimumDeviceIntegrity)
    || !/^(0|[1-9][0-9]{0,2})$/.test(maxAge)
    || !["true", "false"].includes(requireLicensed)) return null
  let credentials: unknown
  try {
    credentials = JSON.parse(rawCredentials)
  } catch {
    return null
  }
  if (credentials == null || typeof credentials !== "object" || Array.isArray(credentials)) return null
  const maxVerdictAgeSeconds = Number(maxAge)
  if (!Number.isSafeInteger(maxVerdictAgeSeconds) || maxVerdictAgeSeconds > 300) return null
  try {
    return {
      credentials: credentials as Record<string, unknown>,
      policy: {
        packageName,
        certificateSha256Digest: digests,
        minimumVersionCode: BigInt(minimumVersion),
        minimumDeviceIntegrity: minimumDeviceIntegrity as WorkforcePlayIntegrityPolicy["minimumDeviceIntegrity"],
        requireLicensed: requireLicensed === "true",
        maxVerdictAgeSeconds,
      },
    }
  } catch {
    return null
  }
}

function decodedVerdict(payload: GoogleDecodedPayload): WorkforcePlayIntegrityVerdict {
  const requestDetails = payload?.requestDetails
  const appIntegrity = payload?.appIntegrity
  const deviceIntegrity = payload?.deviceIntegrity
  const accountDetails = payload?.accountDetails
  // Google intentionally omits some fields for an unevaluated or unrecognized
  // token. Preserve those omissions as null/empty so the evaluator can make a
  // precise fail-closed decision (rather than treating a valid Google response
  // as a decoder failure). A present malformed value is still rejected here.
  const requestHash = optionalText(requestDetails?.requestHash, SHA256_BASE64URL)
  const requestPackageName = optionalText(requestDetails?.requestPackageName, PACKAGE_NAME)
  const timestampMillis = optionalText(requestDetails?.timestampMillis, DECIMAL)
  const appRecognitionVerdict = enumValue(appIntegrity?.appRecognitionVerdict, ["PLAY_RECOGNIZED", "UNRECOGNIZED_VERSION", "UNEVALUATED"] as const)
  const appPackageName = optionalText(appIntegrity?.packageName, PACKAGE_NAME)
  const certificateSha256Digest = optionalStringArray(appIntegrity?.certificateSha256Digest)
  const versionCode = optionalText(appIntegrity?.versionCode, DECIMAL)
  const deviceRecognitionVerdict = optionalStringArray(deviceIntegrity?.deviceRecognitionVerdict)
  const appLicensingVerdict = enumValue(accountDetails?.appLicensingVerdict, ["LICENSED", "UNLICENSED", "UNEVALUATED"] as const)
  if (appRecognitionVerdict == null || appLicensingVerdict == null) {
    throw new WorkforcePlayIntegrityDecoderError("WORKFORCE_PLAY_INTEGRITY_DECODE_INVALID")
  }
  return {
    decodedBy: "GOOGLE_PLAY_INTEGRITY_SERVER_DECODE",
    requestDetails: { requestHash, requestPackageName, timestampMillis },
    appIntegrity: { appRecognitionVerdict, packageName: appPackageName, certificateSha256Digest, versionCode },
    deviceIntegrity: { deviceRecognitionVerdict },
    accountDetails: { appLicensingVerdict },
  }
}

async function decodeWithGoogle(input: {
  packageName: string
  token: string
  credentials: Record<string, unknown>
}): Promise<GoogleDecodedPayload> {
  const auth = new google.auth.GoogleAuth({ credentials: input.credentials, scopes: [PLAY_INTEGRITY_SCOPE] })
  const api = google.playintegrity({ version: "v1", auth })
  const response = await api.v1.decodeIntegrityToken({
    packageName: input.packageName,
    requestBody: { integrityToken: input.token },
  })
  return response.data.tokenPayloadExternal as GoogleDecodedPayload
}

/**
 * Decode a Standard API token only on the server and immediately reduce it to
 * a fixed integrity assessment. No raw token, decoded payload or service
 * credential is returned to a route, durable store, logger or caller.
 */
export async function assessConfiguredWorkforcePlayIntegrity(input: {
  token: string
  expectedRequestHash: string
  now?: Date
  env?: PlayIntegrityEnvironment
  decode?: WorkforcePlayIntegrityDecodedToken
}): Promise<WorkforcePlayIntegrityAssessment> {
  if (typeof input.token !== "string" || !input.token.trim() || input.token.length > TOKEN_MAX_LENGTH || !SHA256_BASE64URL.test(input.expectedRequestHash)) {
    throw new WorkforcePlayIntegrityDecoderError("WORKFORCE_PLAY_INTEGRITY_DECODE_INVALID")
  }
  const configuration = configuredPolicy(input.env ?? process.env)
  if (!configuration) throw new WorkforcePlayIntegrityDecoderError("WORKFORCE_PLAY_INTEGRITY_NOT_CONFIGURED")
  let payload: GoogleDecodedPayload
  try {
    payload = await (input.decode ?? decodeWithGoogle)({
      packageName: configuration.policy.packageName,
      token: input.token.trim(),
      credentials: configuration.credentials,
    })
  } catch (error) {
    if (error instanceof WorkforcePlayIntegrityDecoderError) throw error
    throw new WorkforcePlayIntegrityDecoderError("WORKFORCE_PLAY_INTEGRITY_DECODE_UNAVAILABLE")
  }
  return assessWorkforcePlayIntegrity({
    expectedRequestHash: input.expectedRequestHash,
    policy: configuration.policy,
    verdict: decodedVerdict(payload),
    now: input.now,
  })
}
