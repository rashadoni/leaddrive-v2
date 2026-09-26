import { createHash, timingSafeEqual, X509Certificate } from "node:crypto"

/**
 * Server-side, fail-closed shell around Android Key Attestation verification.
 *
 * Certificate-chain verification runs here, on the server. Parsing Android's
 * private attestation extension is intentionally injected: before any route
 * can accept a hardware assertion it must use a separately reviewed ASN.1
 * implementation that finds the first trusted extension in the chain. This
 * module never treats an unparsed certificate, a stale revocation answer or a
 * self-reported device property as an attestation.
 */

const MAX_CERTIFICATE_CHAIN_LENGTH = 10
const MAX_CERTIFICATE_BASE64_LENGTH = 32_768

export type WorkforceAndroidAttestationClaims = {
  /** Index of the first trusted 1.3.6.1.4.1.11129.2.1.17 extension. */
  attestationCertificateIndex: number
  challengeBase64: string
  attestationSecurityLevel: "SOFTWARE" | "TRUSTED_ENVIRONMENT" | "STRONGBOX"
  keySecurityLevel: "SOFTWARE" | "TRUSTED_ENVIRONMENT" | "STRONGBOX"
  verifiedBootState: "VERIFIED" | "SELF_SIGNED" | "UNVERIFIED" | "FAILED"
  deviceLocked: boolean
  applicationPackageNames: readonly string[]
  applicationSigningCertificateSha256: readonly string[]
  keyPurposes: readonly string[]
  keyAlgorithm: "EC_P256" | "OTHER"
  keyDigests: readonly string[]
  perUseStrongBiometric: boolean
  uniqueIdEmpty: boolean
  containsDeviceIdentifiers: boolean
}

/** A vetted ASN.1 implementation must parse the chain, not a client payload. */
export type WorkforceAndroidAttestationInspector = {
  inspect(chainDer: readonly Buffer[]): WorkforceAndroidAttestationClaims
}

export type WorkforceAndroidAttestationRevocation = {
  /** Must come from the current Google hardware-attestation status list. */
  source: "GOOGLE_ATTESTATION_STATUS_LIST"
  checkedAt: Date
  /**
   * Google publishes non-normal attestation certificates keyed by certificate
   * serial number, not fingerprint. This is the authoritative live-feed
   * representation. It must be refreshed under the response Cache-Control
   * policy before a caller can pass it to the verifier.
   */
  revokedCertificateSerialNumbers: readonly string[]
  /**
   * Optional internal deny-list for an already investigated certificate. It is
   * additive only; it never substitutes for the official serial-number list.
   */
  revokedCertificateSha256: readonly string[]
}

export class WorkforceAndroidAttestationRevocationError extends Error {
  constructor(readonly code: "WORKFORCE_ANDROID_ATTESTATION_STATUS_LIST_INVALID") {
    super(code)
  }
}

export type WorkforceAndroidAttestationPolicy = {
  /** SHA-256 fingerprints of currently trusted Google attestation roots. */
  trustedRootCertificateSha256: readonly string[]
  /** The one-time bytes used when the Android key was generated. */
  expectedChallengeBase64: string
  /** Final package/signing identity is runtime configuration, never guessed. */
  application: {
    packageNames: readonly string[]
    signingCertificateSha256: readonly string[]
  }
  /** A revoked or stale status list must reject, rather than become a cache. */
  maxRevocationAgeSeconds: number
}

export type WorkforceAndroidAttestationResult =
  | {
      status: "ACCEPTED"
      securityLevel: "TRUSTED_ENVIRONMENT" | "STRONGBOX"
      rootCertificateSha256: string
    }
  | {
      status: "REJECTED"
      code:
        | "WORKFORCE_ANDROID_ATTESTATION_INPUT_INVALID"
        | "WORKFORCE_ANDROID_ATTESTATION_CHAIN_INVALID"
        | "WORKFORCE_ANDROID_ATTESTATION_ROOT_UNTRUSTED"
        | "WORKFORCE_ANDROID_ATTESTATION_REVOKED_OR_STALE"
        | "WORKFORCE_ANDROID_ATTESTATION_EXTENSION_UNAVAILABLE"
        | "WORKFORCE_ANDROID_ATTESTATION_CLAIMS_INVALID"
    }

function strictBase64(value: string, maxLength = MAX_CERTIFICATE_BASE64_LENGTH): Buffer | null {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length > maxLength || value.length % 4 !== 0) {
    return null
  }
  try {
    const decoded = Buffer.from(value, "base64")
    return decoded.length > 0 ? decoded : null
  } catch {
    return null
  }
}

function fingerprint(certificateDer: Buffer): string {
  return createHash("sha256").update(certificateDer).digest("hex")
}

function validFingerprint(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value)
}

/**
 * The official Google status list uses lower-case hexadecimal certificate
 * serial numbers. X509Certificate may present a serial with colons and a
 * DER-positive leading zero, so normalize both representations before a
 * comparison. A zero serial is invalid for this status-list contract.
 */
function canonicalCertificateSerialNumber(value: unknown): string | null {
  if (typeof value !== "string") return null
  const normalized = value.replaceAll(":", "").toLowerCase()
  if (!/^[0-9a-f]+$/.test(normalized)) return null
  const withoutDerPadding = normalized.replace(/^0+/, "")
  return withoutDerPadding.length > 0 ? withoutDerPadding : null
}

type GoogleAttestationStatusListEntry = {
  status: "REVOKED" | "SUSPENDED"
  expires?: string
  reason?: string
  comment?: string
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function validOptionalIsoDate(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value))
}

function validOptionalShortString(value: unknown, maxLength: number): boolean {
  return value === undefined || (typeof value === "string" && value.length <= maxLength)
}

/**
 * Parses the official Google Hardware Attestation status-list shape without
 * fetching it. Network/cache ownership stays outside this pure conversion so
 * a route cannot accidentally make an attestation decision from an unchecked
 * response. Both REVOKED and SUSPENDED entries fail closed.
 */
export function parseWorkforceGoogleAttestationStatusList(input: { checkedAt: Date; payload: unknown }): WorkforceAndroidAttestationRevocation {
  const statusList = record(input.payload)
  const entries = statusList && record(statusList.entries)
  if (!entries || Object.keys(statusList!).some((key) => key !== "entries")
    || !(input.checkedAt instanceof Date) || Number.isNaN(input.checkedAt.getTime())) {
    throw new WorkforceAndroidAttestationRevocationError("WORKFORCE_ANDROID_ATTESTATION_STATUS_LIST_INVALID")
  }

  const revokedCertificateSerialNumbers = Object.entries(entries).map(([serialNumber, rawEntry]) => {
    const canonicalSerial = canonicalCertificateSerialNumber(serialNumber)
    const entry = record(rawEntry) as GoogleAttestationStatusListEntry | null
    if (!canonicalSerial || !entry || (entry.status !== "REVOKED" && entry.status !== "SUSPENDED")
      || !validOptionalIsoDate(entry.expires)
      || !validOptionalShortString(entry.reason, 64)
      || !validOptionalShortString(entry.comment, 140)
      || Object.keys(entry).some((key) => !["status", "expires", "reason", "comment"].includes(key))) {
      throw new WorkforceAndroidAttestationRevocationError("WORKFORCE_ANDROID_ATTESTATION_STATUS_LIST_INVALID")
    }
    return canonicalSerial
  })
  if (new Set(revokedCertificateSerialNumbers).size !== revokedCertificateSerialNumbers.length) {
    throw new WorkforceAndroidAttestationRevocationError("WORKFORCE_ANDROID_ATTESTATION_STATUS_LIST_INVALID")
  }
  return {
    source: "GOOGLE_ATTESTATION_STATUS_LIST",
    checkedAt: input.checkedAt,
    revokedCertificateSerialNumbers,
    revokedCertificateSha256: [],
  }
}

function equalBytes(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right)
}

function equalStringSets(actual: readonly string[], expected: readonly string[]): boolean {
  const actualSet = new Set(actual)
  const expectedSet = new Set(expected)
  return actualSet.size === expectedSet.size
    && [...actualSet].every((value) => expectedSet.has(value))
}

function currentCertificateChain(input: {
  certificateChainDerBase64: readonly string[]
  now: Date
}): { chain: X509Certificate[]; der: Buffer[]; fingerprints: string[] } | null {
  if (!Array.isArray(input.certificateChainDerBase64)
    || input.certificateChainDerBase64.length < 1
    || input.certificateChainDerBase64.length > MAX_CERTIFICATE_CHAIN_LENGTH
    || Number.isNaN(input.now.getTime())) return null

  const der: Buffer[] = []
  const chain: X509Certificate[] = []
  try {
    for (const encoded of input.certificateChainDerBase64) {
      const certificateDer = strictBase64(encoded)
      if (!certificateDer) return null
      const certificate = new X509Certificate(certificateDer)
      const validFrom = Date.parse(certificate.validFrom)
      const validTo = Date.parse(certificate.validTo)
      if (!Number.isFinite(validFrom) || !Number.isFinite(validTo)
        || input.now.getTime() < validFrom || input.now.getTime() > validTo) return null
      der.push(certificateDer)
      chain.push(certificate)
    }
  } catch {
    return null
  }

  const fingerprints = der.map(fingerprint)
  if (new Set(fingerprints).size !== fingerprints.length) return null
  for (let index = 0; index < chain.length - 1; index += 1) {
    const child = chain[index]!
    const issuer = chain[index + 1]!
    if (!child.checkIssued(issuer) || !child.verify(issuer.publicKey)) return null
  }
  const root = chain[chain.length - 1]!
  if (!root.checkIssued(root) || !root.verify(root.publicKey)) return null
  return { chain, der, fingerprints }
}

function validPolicy(input: WorkforceAndroidAttestationPolicy): boolean {
  const expectedChallenge = strictBase64(input.expectedChallengeBase64, 512)
  return expectedChallenge != null
    && expectedChallenge.length >= 16
    && Number.isSafeInteger(input.maxRevocationAgeSeconds)
    && input.maxRevocationAgeSeconds >= 0
    && input.maxRevocationAgeSeconds <= 86_400
    && input.trustedRootCertificateSha256.length > 0
    && input.trustedRootCertificateSha256.every(validFingerprint)
    && input.application.packageNames.length > 0
    && input.application.packageNames.every((value) => /^[A-Za-z][A-Za-z0-9_.]{1,191}$/.test(value))
    && input.application.signingCertificateSha256.length > 0
    && input.application.signingCertificateSha256.every(validFingerprint)
}

function validRevocation(input: WorkforceAndroidAttestationRevocation): boolean {
  return input.source === "GOOGLE_ATTESTATION_STATUS_LIST"
    && input.checkedAt instanceof Date
    && !Number.isNaN(input.checkedAt.getTime())
    && Array.isArray(input.revokedCertificateSerialNumbers)
    && input.revokedCertificateSerialNumbers.every((value) => canonicalCertificateSerialNumber(value) === value)
    && new Set(input.revokedCertificateSerialNumbers).size === input.revokedCertificateSerialNumbers.length
    && Array.isArray(input.revokedCertificateSha256)
    && input.revokedCertificateSha256.every(validFingerprint)
}

function hardwareSecurityLevel(value: unknown): value is "TRUSTED_ENVIRONMENT" | "STRONGBOX" {
  return value === "TRUSTED_ENVIRONMENT" || value === "STRONGBOX"
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
}

function validClaims(
  claims: unknown,
  policy: WorkforceAndroidAttestationPolicy,
  chainLength: number,
): claims is WorkforceAndroidAttestationClaims {
  const value = record(claims)
  if (!value
    || !hardwareSecurityLevel(value.attestationSecurityLevel)
    || !hardwareSecurityLevel(value.keySecurityLevel)
    || !stringArray(value.applicationPackageNames)
    || !stringArray(value.applicationSigningCertificateSha256)
    || !stringArray(value.keyPurposes)
    || !stringArray(value.keyDigests)) return false

  const expectedChallenge = strictBase64(policy.expectedChallengeBase64, 512)
  const attestedChallenge = strictBase64(value.challengeBase64 as string, 512)
  return expectedChallenge != null
    && attestedChallenge != null
    && equalBytes(expectedChallenge, attestedChallenge)
    && Number.isInteger(value.attestationCertificateIndex)
    && (value.attestationCertificateIndex as number) >= 0
    && (value.attestationCertificateIndex as number) < chainLength
    && value.verifiedBootState === "VERIFIED"
    && value.deviceLocked === true
    && equalStringSets(value.applicationPackageNames, policy.application.packageNames)
    && equalStringSets(
      value.applicationSigningCertificateSha256.map((fingerprint) => fingerprint.toLowerCase()),
      policy.application.signingCertificateSha256.map((fingerprint) => fingerprint.toLowerCase()),
    )
    && value.keyPurposes.includes("SIGN")
    && value.keyAlgorithm === "EC_P256"
    && value.keyDigests.includes("SHA256")
    && value.perUseStrongBiometric === true
    && value.uniqueIdEmpty === true
    && value.containsDeviceIdentifiers === false
}

/**
 * Verifies all server-observable prerequisites for high-assurance Android key
 * attestation. `ACCEPTED` is still an attested-device assertion, not evidence
 * that the named employee was physically present; action-time proof policy and
 * employee notice remain independent checks.
 */
export function verifyWorkforceAndroidKeyAttestation(input: {
  certificateChainDerBase64: readonly string[]
  enrolledPublicKeySpkiBase64: string
  policy: WorkforceAndroidAttestationPolicy
  revocation: WorkforceAndroidAttestationRevocation
  inspector: WorkforceAndroidAttestationInspector
  now?: Date
}): WorkforceAndroidAttestationResult {
  const now = input.now ?? new Date()
  if (!validPolicy(input.policy) || !validRevocation(input.revocation)) {
    return { status: "REJECTED", code: "WORKFORCE_ANDROID_ATTESTATION_INPUT_INVALID" }
  }

  const parsed = currentCertificateChain({ certificateChainDerBase64: input.certificateChainDerBase64, now })
  const enrolledPublicKey = strictBase64(input.enrolledPublicKeySpkiBase64, 16_384)
  if (!parsed || !enrolledPublicKey) {
    return { status: "REJECTED", code: "WORKFORCE_ANDROID_ATTESTATION_CHAIN_INVALID" }
  }
  const leafPublicKey = parsed.chain[0]!.publicKey.export({ format: "der", type: "spki" })
  if (!equalBytes(leafPublicKey, enrolledPublicKey)) {
    return { status: "REJECTED", code: "WORKFORCE_ANDROID_ATTESTATION_CHAIN_INVALID" }
  }

  const rootCertificateSha256 = parsed.fingerprints[parsed.fingerprints.length - 1]!
  if (!input.policy.trustedRootCertificateSha256.map((value) => value.toLowerCase()).includes(rootCertificateSha256)) {
    return { status: "REJECTED", code: "WORKFORCE_ANDROID_ATTESTATION_ROOT_UNTRUSTED" }
  }
  const revocationAgeMs = now.getTime() - input.revocation.checkedAt.getTime()
  const revokedFingerprints = new Set(input.revocation.revokedCertificateSha256.map((value) => value.toLowerCase()))
  const revokedSerialNumbers = new Set(input.revocation.revokedCertificateSerialNumbers)
  const chainHasRevokedSerial = parsed.chain.some((certificate) => {
    const serialNumber = canonicalCertificateSerialNumber(certificate.serialNumber)
    return serialNumber == null || revokedSerialNumbers.has(serialNumber)
  })
  if (revocationAgeMs < 0 || revocationAgeMs > input.policy.maxRevocationAgeSeconds * 1000
    || parsed.fingerprints.some((value) => revokedFingerprints.has(value))
    || chainHasRevokedSerial) {
    return { status: "REJECTED", code: "WORKFORCE_ANDROID_ATTESTATION_REVOKED_OR_STALE" }
  }

  let claims: unknown
  try {
    claims = input.inspector.inspect(parsed.der)
  } catch {
    return { status: "REJECTED", code: "WORKFORCE_ANDROID_ATTESTATION_EXTENSION_UNAVAILABLE" }
  }
  if (
    !validClaims(claims, input.policy, parsed.chain.length)
  ) {
    return { status: "REJECTED", code: "WORKFORCE_ANDROID_ATTESTATION_CLAIMS_INVALID" }
  }
  // Repeat the positive allowlist at the accepted-result boundary. Unknown ASN.1
  // enum values must never become hardware-backed merely because they are not
  // the known SOFTWARE value.
  if (!hardwareSecurityLevel(claims.attestationSecurityLevel)) {
    return { status: "REJECTED", code: "WORKFORCE_ANDROID_ATTESTATION_CLAIMS_INVALID" }
  }
  return {
    status: "ACCEPTED",
    securityLevel: claims.attestationSecurityLevel,
    rootCertificateSha256,
  }
}
