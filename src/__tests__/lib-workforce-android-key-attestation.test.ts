import { X509Certificate } from "node:crypto"
import { rootCertificates } from "node:tls"
import { describe, expect, it } from "vitest"
import {
  parseWorkforceGoogleAttestationStatusList,
  verifyWorkforceAndroidKeyAttestation,
  WorkforceAndroidAttestationRevocationError,
  type WorkforceAndroidAttestationClaims,
} from "@/lib/workforce/android-key-attestation"

const NOW = new Date("2026-08-30T15:20:00.000Z")
const certificatePem = rootCertificates.find((pem) => {
  const certificate = new X509Certificate(pem)
  return NOW >= new Date(certificate.validFrom) && NOW <= new Date(certificate.validTo)
})!
const certificate = new X509Certificate(certificatePem)
const certificateDerBase64 = certificate.raw.toString("base64")
const rootFingerprint = certificate.fingerprint256.replaceAll(":", "").toLowerCase()
const certificateSerialNumber = certificate.serialNumber.replaceAll(":", "").toLowerCase().replace(/^0+/, "")
const publicKeySpkiBase64 = certificate.publicKey.export({ format: "der", type: "spki" }).toString("base64")
const challengeBase64 = Buffer.from("a".repeat(32), "utf8").toString("base64")

const claims: WorkforceAndroidAttestationClaims = {
  attestationCertificateIndex: 0,
  challengeBase64,
  attestationSecurityLevel: "TRUSTED_ENVIRONMENT",
  keySecurityLevel: "TRUSTED_ENVIRONMENT",
  verifiedBootState: "VERIFIED",
  deviceLocked: true,
  applicationPackageNames: ["com.leaddrive.workforce"],
  applicationSigningCertificateSha256: ["a".repeat(64)],
  keyPurposes: ["SIGN"],
  keyAlgorithm: "EC_P256",
  keyDigests: ["SHA256"],
  perUseStrongBiometric: true,
  uniqueIdEmpty: true,
  containsDeviceIdentifiers: false,
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    certificateChainDerBase64: [certificateDerBase64],
    enrolledPublicKeySpkiBase64: publicKeySpkiBase64,
    policy: {
      trustedRootCertificateSha256: [rootFingerprint],
      expectedChallengeBase64: challengeBase64,
      application: {
        packageNames: ["com.leaddrive.workforce"],
        signingCertificateSha256: ["a".repeat(64)],
      },
      maxRevocationAgeSeconds: 300,
    },
    revocation: {
      source: "GOOGLE_ATTESTATION_STATUS_LIST" as const,
      checkedAt: new Date("2026-08-30T15:19:00.000Z"),
      revokedCertificateSerialNumbers: [],
      revokedCertificateSha256: [],
    },
    inspector: { inspect: () => claims },
    now: NOW,
    ...overrides,
  }
}

describe("Workforce Android key-attestation gate", () => {
  it("accepts only a server-validated chain, current revocation feed and exact claims", () => {
    expect(verifyWorkforceAndroidKeyAttestation(input())).toEqual({
      status: "ACCEPTED",
      securityLevel: "TRUSTED_ENVIRONMENT",
      rootCertificateSha256: rootFingerprint,
    })
  })

  it("rejects root mismatch, stale/revoked chain and enrolled-key mismatch", () => {
    expect(verifyWorkforceAndroidKeyAttestation(input({
      policy: { ...input().policy, trustedRootCertificateSha256: ["b".repeat(64)] },
    }))).toMatchObject({ code: "WORKFORCE_ANDROID_ATTESTATION_ROOT_UNTRUSTED" })
    expect(verifyWorkforceAndroidKeyAttestation(input({
      revocation: { ...input().revocation, revokedCertificateSha256: [rootFingerprint] },
    }))).toMatchObject({ code: "WORKFORCE_ANDROID_ATTESTATION_REVOKED_OR_STALE" })
    expect(
      verifyWorkforceAndroidKeyAttestation(
        input({
          revocation: {
            ...input().revocation,
            revokedCertificateSerialNumbers: [certificateSerialNumber],
          },
        }),
      ),
    ).toMatchObject({ code: "WORKFORCE_ANDROID_ATTESTATION_REVOKED_OR_STALE" })
    expect(verifyWorkforceAndroidKeyAttestation(input({
      enrolledPublicKeySpkiBase64: Buffer.from("not-the-leaf-key").toString("base64"),
    }))).toMatchObject({ code: "WORKFORCE_ANDROID_ATTESTATION_CHAIN_INVALID" })
  })

  it("fails closed when extension parsing or exact hardware/app/boot claims are unavailable", () => {
    expect(verifyWorkforceAndroidKeyAttestation(input({
      inspector: { inspect: () => { throw new Error("parser unavailable") } },
    }))).toMatchObject({ code: "WORKFORCE_ANDROID_ATTESTATION_EXTENSION_UNAVAILABLE" })
    expect(verifyWorkforceAndroidKeyAttestation(input({
      inspector: { inspect: () => ({ ...claims, deviceLocked: false }) },
    }))).toMatchObject({ code: "WORKFORCE_ANDROID_ATTESTATION_CLAIMS_INVALID" })
    expect(verifyWorkforceAndroidKeyAttestation(input({
      certificateChainDerBase64: ["not-base64"],
    }))).toMatchObject({ code: "WORKFORCE_ANDROID_ATTESTATION_CHAIN_INVALID" })
  })

  it("accepts only the official status-list shape and preserves serial-number revocations", () => {
    expect(
      parseWorkforceGoogleAttestationStatusList({
        checkedAt: new Date("2026-08-30T15:19:00.000Z"),
        payload: {
          entries: {
            "00ABCD": {
              status: "REVOKED",
              reason: "KEY_COMPROMISE",
              comment: "example",
            },
            "2c8cdddfd5e03bfc": { status: "SUSPENDED", expires: "2026-09-01" },
          },
        },
      }),
    ).toMatchObject({
      source: "GOOGLE_ATTESTATION_STATUS_LIST",
      revokedCertificateSerialNumbers: ["abcd", "2c8cdddfd5e03bfc"],
      revokedCertificateSha256: [],
    })
    expect(() =>
      parseWorkforceGoogleAttestationStatusList({
        checkedAt: new Date("2026-08-30T15:19:00.000Z"),
        payload: { entries: { abcd: { status: "NORMAL" } } },
      }),
    ).toThrow(WorkforceAndroidAttestationRevocationError)
  })
})
