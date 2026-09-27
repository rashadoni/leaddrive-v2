/**
 * Minimal receipt retained only after a server-side Android Key Attestation
 * verifier has accepted a chain. The chain, its challenge bytes, biometric
 * output and device identifiers are intentionally not durable application
 * data. Keeping this validation separate from enrollment proof-of-possession
 * prevents an arbitrary P-256 key from becoming a "trusted device" merely
 * because it can sign its own enrollment challenge.
 */
export type WorkforceAttendanceAttestationReceipt = {
  attestationVerifiedAt: Date | null
  attestationSecurityLevel: string | null
  attestationRootCertificateSha256: string | null
}

const ROOT_FINGERPRINT = /^[a-f0-9]{64}$/i

/**
 * Attestation receipts are written exclusively by a future reviewed verifier.
 * Until that writer exists, this returns false and all device-trust promotion
 * and use paths stay closed. A receipt dated in the future is invalid even if
 * a malformed database state otherwise has the expected shape.
 */
export function hasVerifiedWorkforceAttendanceAttestation(
  receipt: WorkforceAttendanceAttestationReceipt,
  now: Date = new Date(),
): boolean {
  return receipt.attestationVerifiedAt instanceof Date
    && Number.isFinite(receipt.attestationVerifiedAt.getTime())
    && receipt.attestationVerifiedAt.getTime() <= now.getTime()
    && (receipt.attestationSecurityLevel === "TRUSTED_ENVIRONMENT"
      || receipt.attestationSecurityLevel === "STRONGBOX")
    && typeof receipt.attestationRootCertificateSha256 === "string"
    && ROOT_FINGERPRINT.test(receipt.attestationRootCertificateSha256)
}
