import { generateKeyPairSync, sign } from "node:crypto"
import { describe, expect, it } from "vitest"
import {
  WorkforceAttendancePolicyError,
  workforceAttendancePolicyManifest,
  workforceAttendanceRequirements,
} from "@/lib/workforce/attendance-policy"
import {
  WorkforceAttendanceSecurityError,
  mintWorkforceAttendanceQr,
  validateWorkforceDevicePublicKey,
  verifyWorkforceAttendanceQr,
  verifyWorkforceDeviceSignature,
  workforceAttendanceQrNonceFingerprint,
  workforceDeviceAttendanceChallenge,
  workforceDeviceEnrollmentChallenge,
} from "@/lib/workforce/attendance-security"

const NOW = new Date("2026-08-29T09:00:00.000Z")

describe("Workforce attendance security primitives", () => {
  it("requires an explicit, internally coherent attendance policy", () => {
    expect(workforceAttendancePolicyManifest({ expectedWorkSeconds: 28_800 })).toBeNull()
    const absent = workforceAttendanceRequirements({ expectedWorkSeconds: 28_800 })
    expect(absent.qrRequiredActions.size).toBe(0)
    expect(absent.deviceTrustRequiredActions.size).toBe(0)

    const configured = workforceAttendanceRequirements({
      attendance: {
        enforcementVersion: 1,
        qr: { requiredActions: ["START", "FINISH"] },
        deviceTrust: { requiredActions: ["START", "FINISH"] },
      },
    })
    expect(configured.qrRequiredActions).toEqual(new Set(["START", "FINISH"]))
    expect(configured.biometricRequiredActions).toEqual(new Set())
    expect(workforceAttendancePolicyManifest({
      attendance: {
        enforcementVersion: 1,
        qr: { requiredActions: ["START", "FINISH"] },
        deviceTrust: { requiredActions: ["START", "FINISH"] },
      },
    })).toEqual({
      enforcementVersion: 1,
      qrRequiredActions: ["START", "FINISH"],
      deviceTrustRequiredActions: ["START", "FINISH"],
      biometricRequiredActions: [],
    })

    expect(() => workforceAttendanceRequirements({
      attendance: {
        enforcementVersion: 1,
        deviceTrust: {
          requiredActions: ["FINISH"],
          biometricRequiredActions: ["START"],
        },
      },
    })).toThrow(WorkforceAttendancePolicyError)

    expect(() => workforceAttendanceRequirements({
      attendance: {
        enforcementVersion: 1,
        deviceTrust: {
          requiredActions: ["START"],
          biometricRequiredActions: ["START"],
        },
      },
    })).toThrow(/hardware attestation/)
  })

  it("signs a short-lived tenant-bound QR and rejects tampering, expiry, and another tenant", () => {
    const token = mintWorkforceAttendanceQr({
      organizationId: "org_1",
      stationId: "station_1",
      expiresAt: new Date("2026-08-29T09:01:00.000Z"),
      now: NOW,
    })
    const verified = verifyWorkforceAttendanceQr({ organizationId: "org_1", token, now: NOW })
    expect(verified.stationId).toBe("station_1")
    expect(verified.expiresAt).toEqual(new Date("2026-08-29T09:01:00.000Z"))
    expect(workforceAttendanceQrNonceFingerprint("org_1", verified.nonce))
      .not.toEqual(workforceAttendanceQrNonceFingerprint("org_2", verified.nonce))

    expect(() => verifyWorkforceAttendanceQr({ organizationId: "org_2", token, now: NOW }))
      .toThrow(WorkforceAttendanceSecurityError)
    expect(() => verifyWorkforceAttendanceQr({
      organizationId: "org_1",
      token: `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`,
      now: NOW,
    })).toThrow(WorkforceAttendanceSecurityError)
    expect(() => verifyWorkforceAttendanceQr({
      organizationId: "org_1",
      token,
      now: new Date("2026-08-29T09:01:00.000Z"),
    })).toThrow(expect.objectContaining({ code: "WORKFORCE_ATTENDANCE_QR_EXPIRED" }))
  })

  it("verifies only a P-256 device proof bound to one attendance operation", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
    const publicKeySpkiBase64 = publicKey.export({ format: "der", type: "spki" }).toString("base64")
    const key = validateWorkforceDevicePublicKey(publicKeySpkiBase64)
    expect(key.algorithm).toBe("ECDSA_P256_SHA256")
    expect(key.fingerprint).toMatch(/^[a-f0-9]{64}$/)

    const challenge = workforceDeviceAttendanceChallenge({
      organizationId: "org_1",
      agentId: "agent_1",
      enrollmentId: "enrollment_1",
      clientEventId: "operation_1",
      action: "START",
      workdayId: "workday_1",
      occurredAt: NOW,
    })
    const signatureBase64 = sign("sha256", Buffer.from(challenge, "utf8"), {
      key: privateKey,
      dsaEncoding: "der",
    }).toString("base64")
    expect(verifyWorkforceDeviceSignature({ publicKeySpkiBase64, challenge, signatureBase64 })).toBe(true)
    expect(verifyWorkforceDeviceSignature({
      publicKeySpkiBase64,
      challenge: `${challenge}\naction=FINISH`,
      signatureBase64,
    })).toBe(false)
    expect(workforceDeviceEnrollmentChallenge({
      organizationId: "org_1",
      agentId: "agent_1",
      enrollmentId: "enrollment_1",
      challenge: "AbCdEfGhIjKlMnOpQrStUvWxYz012345",
    })).toContain("workforce-device-enrollment:v1")
  })
})
