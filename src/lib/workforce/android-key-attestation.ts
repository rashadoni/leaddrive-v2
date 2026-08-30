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
  revokedCertificateSha256: readonly string[]
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

function validClaims(input: {
  claims: WorkforceAndroidAttestationClaims
  policy: WorkforceAndroidAttestationPolicy
  chainLength: number
}): boolean {
  const expectedChallenge = strictBase64(input.policy.expectedChallengeBase64, 512)
  const attestedChallenge = strictBase64(input.claims.challengeBase64, 512)
  const hardwareBacked = input.claims.attestationSecurityLevel !== "SOFTWARE"
    && input.claims.keySecurityLevel !== "SOFTWARE"
  return expectedChallenge != null
    && attestedChallenge != null
    && equalBytes(expectedChallenge, attestedChallenge)
    && Number.isInteger(input.claims.attestationCertificateIndex)
    && input.claims.attestationCertificateIndex >= 0
    && input.claims.attestationCertificateIndex < input.chainLength
    && hardwareBacked
    && input.claims.verifiedBootState === "VERIFIED"
    && input.claims.deviceLocked
    && equalStringSets(input.claims.applicationPackageNames, input.policy.application.packageNames)
    && equalStringSets(
      input.claims.applicationSigningCertificateSha256.map((value) => value.toLowerCase()),
      input.policy.application.signingCertificateSha256.map((value) => value.toLowerCase()),
    )
    && input.claims.keyPurposes.includes("SIGN")
    && input.claims.keyAlgorithm === "EC_P256"
    && input.claims.keyDigests.includes("SHA256")
    && input.claims.perUseStrongBiometric
    && input.claims.uniqueIdEmpty
    && !input.claims.containsDeviceIdentifiers
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
  if (!validPolicy(input.policy) || input.revocation.source !== "GOOGLE_ATTESTATION_STATUS_LIST"
    || Number.isNaN(input.revocation.checkedAt.getTime())) {
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
  const revoked = new Set(input.revocation.revokedCertificateSha256.map((value) => value.toLowerCase()))
  if (revocationAgeMs < 0 || revocationAgeMs > input.policy.maxRevocationAgeSeconds * 1000
    || parsed.fingerprints.some((value) => revoked.has(value))) {
    return { status: "REJECTED", code: "WORKFORCE_ANDROID_ATTESTATION_REVOKED_OR_STALE" }
  }

  let claims: WorkforceAndroidAttestationClaims
  try {
    claims = input.inspector.inspect(parsed.der)
  } catch {
    return { status: "REJECTED", code: "WORKFORCE_ANDROID_ATTESTATION_EXTENSION_UNAVAILABLE" }
  }
  if (!validClaims({ claims, policy: input.policy, chainLength: parsed.chain.length })) {
    return { status: "REJECTED", code: "WORKFORCE_ANDROID_ATTESTATION_CLAIMS_INVALID" }
  }
  return {
    status: "ACCEPTED",
    securityLevel: claims.attestationSecurityLevel,
    rootCertificateSha256,
  }
}
