import { generateKeyPairSync, sign } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

import { prisma } from "@/lib/prisma"
import {
  mintWorkforceAttendanceQr,
  workforceDeviceAttendanceChallenge,
} from "@/lib/workforce/attendance-security"
import {
  prepareWorkforceAttendanceVerification,
  recordWorkforceAttendanceVerification,
} from "@/lib/workforce/attendance-trust"
import { hasVerifiedWorkforceAttendanceAttestation } from "@/lib/workforce/attendance-attestation-receipt"

type AttendanceEvent = Parameters<typeof prepareWorkforceAttendanceVerification>[1]["event"]

const ORGANIZATION_ID = "org_1"
const AGENT_ID = "agent_1"
const NOW = new Date("2026-08-29T09:00:00.000Z")
const WORKDAY = {
  workDate: new Date("2026-08-29T00:00:00.000Z"),
  startedAt: new Date("2026-08-29T08:00:00.000Z"),
}
const EVENT: AttendanceEvent = {
  action: "START" as const,
  workdayId: "workday_1",
  clientEventId: "event_1",
  occurredAt: NOW,
  schemaVersion: 5,
  latitude: null,
  longitude: null,
  accuracy: null,
}

function policy(definition: Record<string, unknown>) {
  return {
    id: "policy_1",
    teamId: null,
    version: 3,
    status: "ACTIVE",
    name: "Attendance policy",
    effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
    effectiveTo: null,
    activatedAt: new Date("2026-08-01T00:00:00.000Z"),
    retiredAt: null,
    definition,
    definitionHash: "a".repeat(64),
  }
}

function prepare(
  input: Parameters<typeof prepareWorkforceAttendanceVerification>[1]["evidence"] = undefined,
  event: AttendanceEvent = EVENT,
) {
  return prepareWorkforceAttendanceVerification(prisma as never, {
    organizationId: ORGANIZATION_ID,
    agentId: AGENT_ID,
    workday: WORKDAY,
    event,
    evidence: input,
    capabilities: { qrEnabled: true, deviceTrustEnabled: true },
    principal: "mobile",
    now: NOW,
  })
}

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: AGENT_ID, teamId: null } as never)
})

describe("Workforce attendance trust preparation", () => {
  it("accepts only a complete non-future minimal Android attestation receipt", () => {
    expect(hasVerifiedWorkforceAttendanceAttestation({
      attestationVerifiedAt: new Date("2026-08-29T08:59:00.000Z"),
      attestationSecurityLevel: "STRONGBOX",
      attestationRootCertificateSha256: "a".repeat(64),
    }, NOW)).toBe(true)
    expect(hasVerifiedWorkforceAttendanceAttestation({
      attestationVerifiedAt: new Date("2026-08-29T09:00:01.000Z"),
      attestationSecurityLevel: "STRONGBOX",
      attestationRootCertificateSha256: "a".repeat(64),
    }, NOW)).toBe(false)
    expect(hasVerifiedWorkforceAttendanceAttestation({
      attestationVerifiedAt: NOW,
      attestationSecurityLevel: "SOFTWARE",
      attestationRootCertificateSha256: "not-a-root",
    }, NOW)).toBe(false)
  })

  it("keeps a policy without attendance requirements on the legacy workday path", async () => {
    vi.mocked(prisma.workforcePolicy.findMany).mockResolvedValue([
      policy({ expectedWorkSeconds: 28_800 }),
    ] as never)

    await expect(prepare()).resolves.toBeNull()
    expect(prisma.workforceAttendanceQrStation.findFirst).not.toHaveBeenCalled()
    expect(prisma.workforceAttendanceVerification.create).not.toHaveBeenCalled()
  })

  it("validates a tenant-bound QR before appending its nonce fingerprint to the canonical event", async () => {
    vi.mocked(prisma.workforcePolicy.findMany).mockResolvedValue([
      policy({ attendance: { enforcementVersion: 1, qr: { requiredActions: ["START"] } } }),
    ] as never)
    vi.mocked(prisma.workforceAttendanceQrStation.findFirst).mockResolvedValue({ id: "station_1" } as never)
    const token = mintWorkforceAttendanceQr({
      organizationId: ORGANIZATION_ID,
      stationId: "station_1",
      siteId: "site_1",
      geofenceRevisionId: "geofence_1",
      action: "START",
      expiresAt: new Date("2026-08-29T09:01:00.000Z"),
      now: NOW,
    })

    const prepared = await prepare({ qrToken: token })
    expect(prepared).toMatchObject({
      policyId: "policy_1",
      policyVersion: 3,
      facts: [{ method: "QR", stationId: "station_1", nonceFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) }],
    })

    await recordWorkforceAttendanceVerification(prisma as never, prepared!, "event_server_1")
    expect(prisma.workforceAttendanceVerification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: ORGANIZATION_ID,
        agentId: AGENT_ID,
        workdayEventId: "event_server_1",
        method: "QR",
        stationId: "station_1",
      }),
    })
    expect(prisma.workforceAttendanceQrStation.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        siteId: "site_1",
        geofenceRevisionId: "geofence_1",
      }),
    }))
  })

  it("rejects a current QR when the submitted work-time action is historical", async () => {
    vi.mocked(prisma.workforcePolicy.findMany).mockResolvedValue([
      policy({ attendance: { enforcementVersion: 1, qr: { requiredActions: ["START"] } } }),
    ] as never)
    const token = mintWorkforceAttendanceQr({
      organizationId: ORGANIZATION_ID,
      stationId: "station_1",
      siteId: "site_1",
      geofenceRevisionId: "geofence_1",
      action: "START",
      expiresAt: new Date("2026-08-29T09:01:00.000Z"),
      now: NOW,
    })

    await expect(prepare({ qrToken: token }, {
      ...EVENT,
      occurredAt: new Date("2026-08-01T09:00:00.000Z"),
    })).rejects.toMatchObject({ code: "WORKFORCE_ATTENDANCE_QR_EVENT_TIME_INVALID" })
    expect(prisma.workforceAttendanceQrStation.findFirst).not.toHaveBeenCalled()
  })

  it("rejects a valid current QR if it was minted for another attendance action", async () => {
    vi.mocked(prisma.workforcePolicy.findMany).mockResolvedValue([
      policy({ attendance: { enforcementVersion: 1, qr: { requiredActions: ["START"] } } }),
    ] as never)
    const token = mintWorkforceAttendanceQr({
      organizationId: ORGANIZATION_ID,
      stationId: "station_1",
      siteId: "site_1",
      geofenceRevisionId: "geofence_1",
      action: "FINISH",
      expiresAt: new Date("2026-08-29T09:01:00.000Z"),
      now: NOW,
    })

    await expect(prepare({ qrToken: token })).rejects.toMatchObject({
      code: "WORKFORCE_ATTENDANCE_QR_CONTEXT_INVALID",
    })
    expect(prisma.workforceAttendanceQrStation.findFirst).not.toHaveBeenCalled()
  })

  it("requires a valid active employee device key and binds its signature to the exact event", async () => {
    vi.mocked(prisma.workforcePolicy.findMany).mockResolvedValue([
      policy({ attendance: { enforcementVersion: 1, deviceTrust: { requiredActions: ["START"] } } }),
    ] as never)
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
    const publicKeySpki = publicKey.export({ format: "der", type: "spki" }).toString("base64")
    vi.mocked(prisma.workforceAttendanceDeviceEnrollment.findFirst).mockResolvedValue({
      id: "enrollment_1",
      publicKeySpki,
      attestationVerifiedAt: new Date("2026-08-29T08:59:00.000Z"),
      attestationSecurityLevel: "TRUSTED_ENVIRONMENT",
      attestationRootCertificateSha256: "b".repeat(64),
    } as never)
    const challenge = workforceDeviceAttendanceChallenge({
      organizationId: ORGANIZATION_ID,
      agentId: AGENT_ID,
      enrollmentId: "enrollment_1",
      ...EVENT,
    })
    const signature = sign("sha256", Buffer.from(challenge, "utf8"), {
      key: privateKey,
      dsaEncoding: "der",
    }).toString("base64")

    const prepared = await prepare({ device: { enrollmentId: "enrollment_1", signature } })
    expect(prepared?.facts).toEqual([
      expect.objectContaining({
        method: "DEVICE_KEY",
        deviceEnrollmentId: "enrollment_1",
        proofFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ])
  })

  it("records only a tenant-bound Play Integrity fingerprint after Google decodes an exact trusted-device action", async () => {
    vi.stubEnv("WORKFORCE_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON", JSON.stringify({ type: "service_account", project_id: "test-project" }))
    vi.stubEnv("WORKFORCE_PLAY_INTEGRITY_PACKAGE_NAME", "com.leaddrive.workforce")
    vi.stubEnv("WORKFORCE_PLAY_INTEGRITY_CERTIFICATE_SHA256_DIGESTS", "a".repeat(43))
    vi.stubEnv("WORKFORCE_PLAY_INTEGRITY_MIN_VERSION_CODE", "12")
    vi.stubEnv("WORKFORCE_PLAY_INTEGRITY_MIN_DEVICE_INTEGRITY", "MEETS_DEVICE_INTEGRITY")
    vi.mocked(prisma.workforcePolicy.findMany).mockResolvedValue([
      policy({
        attendance: {
          enforcementVersion: 1,
          deviceTrust: { requiredActions: ["START"] },
          playIntegrity: { requiredActions: ["START"] },
        },
      }),
    ] as never)
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
    const publicKeySpki = publicKey.export({ format: "der", type: "spki" }).toString("base64")
    vi.mocked(prisma.workforceAttendanceDeviceEnrollment.findFirst).mockResolvedValue({
      id: "enrollment_1",
      publicKeySpki,
      attestationVerifiedAt: new Date("2026-08-29T08:59:00.000Z"),
      attestationSecurityLevel: "TRUSTED_ENVIRONMENT",
      attestationRootCertificateSha256: "b".repeat(64),
    } as never)
    const challenge = workforceDeviceAttendanceChallenge({
      organizationId: ORGANIZATION_ID,
      agentId: AGENT_ID,
      enrollmentId: "enrollment_1",
      ...EVENT,
    })
    const signature = sign("sha256", Buffer.from(challenge, "utf8"), {
      key: privateKey,
      dsaEncoding: "der",
    }).toString("base64")
    const expectedRequestHash = (await import("@/lib/workforce/play-integrity")).workforcePlayIntegrityRequestHash({
      organizationId: ORGANIZATION_ID,
      agentId: AGENT_ID,
      enrollmentId: "enrollment_1",
      operationId: EVENT.clientEventId,
      workdayId: EVENT.workdayId,
      action: EVENT.action,
      occurredAt: EVENT.occurredAt.toISOString(),
      schemaVersion: EVENT.schemaVersion,
    })

    const prepared = await prepareWorkforceAttendanceVerification(prisma as never, {
      organizationId: ORGANIZATION_ID,
      agentId: AGENT_ID,
      workday: WORKDAY,
      event: EVENT,
      evidence: {
        device: { enrollmentId: "enrollment_1", signature },
        playIntegrityToken: "opaque-standard-api-token",
      },
      capabilities: { qrEnabled: true, deviceTrustEnabled: true },
      principal: "mobile",
      now: NOW,
      playIntegrityDecode: async () => ({
        requestDetails: {
          requestHash: expectedRequestHash,
          requestPackageName: "com.leaddrive.workforce",
          timestampMillis: String(NOW.getTime()),
        },
        appIntegrity: {
          appRecognitionVerdict: "PLAY_RECOGNIZED",
          packageName: "com.leaddrive.workforce",
          certificateSha256Digest: ["a".repeat(43)],
          versionCode: "12",
        },
        deviceIntegrity: { deviceRecognitionVerdict: ["MEETS_DEVICE_INTEGRITY"] },
        accountDetails: { appLicensingVerdict: "LICENSED" },
      }),
    })

    expect(prepared?.facts).toEqual([
      expect.objectContaining({ method: "DEVICE_KEY", deviceEnrollmentId: "enrollment_1" }),
      expect.objectContaining({
        method: "PLAY_INTEGRITY",
        deviceEnrollmentId: "enrollment_1",
        proofFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ])
    expect(JSON.stringify(prepared)).not.toContain("opaque-standard-api-token")
  })

  it("does not let an active device enrolled to another employee prove this employee's attendance", async () => {
    vi.mocked(prisma.workforcePolicy.findMany).mockResolvedValue([
      policy({ attendance: { enforcementVersion: 1, deviceTrust: { requiredActions: ["START"] } } }),
    ] as never)
    // The provided id is deliberately plausible: tenant scope alone is not
    // enough. The lookup must also bind the active enrollment to the exact
    // authenticated Workforce employee before it ever reads a public key.
    vi.mocked(prisma.workforceAttendanceDeviceEnrollment.findFirst).mockResolvedValue(null as never)

    await expect(prepare({
      device: { enrollmentId: "active-device-for-someone-else", signature: "a".repeat(96) },
    })).rejects.toMatchObject({ code: "WORKFORCE_ATTENDANCE_DEVICE_UNAVAILABLE" })
    expect(prisma.workforceAttendanceDeviceEnrollment.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: ORGANIZATION_ID,
        agentId: AGENT_ID,
        status: "ACTIVE",
        keyVerifiedAt: { not: null },
      }),
    }))
    expect(prisma.workforceAttendanceVerification.create).not.toHaveBeenCalled()
  })

  it("does not treat proof of possession as Android hardware/app attestation", async () => {
    vi.mocked(prisma.workforcePolicy.findMany).mockResolvedValue([
      policy({ attendance: { enforcementVersion: 1, deviceTrust: { requiredActions: ["START"] } } }),
    ] as never)
    const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
    vi.mocked(prisma.workforceAttendanceDeviceEnrollment.findFirst).mockResolvedValue({
      id: "enrollment_unattested",
      publicKeySpki: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
      attestationVerifiedAt: null,
      attestationSecurityLevel: null,
      attestationRootCertificateSha256: null,
    } as never)

    await expect(prepare({
      device: { enrollmentId: "enrollment_unattested", signature: "a".repeat(96) },
    })).rejects.toMatchObject({ code: "WORKFORCE_ATTENDANCE_DEVICE_ATTESTATION_REQUIRED" })
    expect(prisma.workforceAttendanceVerification.create).not.toHaveBeenCalled()
  })

  it("fails closed for a missing proof, disabled capability, and unverified biometric policy", async () => {
    vi.mocked(prisma.workforcePolicy.findMany).mockResolvedValue([
      policy({ attendance: { enforcementVersion: 1, qr: { requiredActions: ["START"] } } }),
    ] as never)
    await expect(prepare()).rejects.toMatchObject({ code: "WORKFORCE_ATTENDANCE_QR_REQUIRED" })

    await expect(prepareWorkforceAttendanceVerification(prisma as never, {
      organizationId: ORGANIZATION_ID,
      agentId: AGENT_ID,
      workday: WORKDAY,
      event: EVENT,
      capabilities: { qrEnabled: false, deviceTrustEnabled: true },
      principal: "mobile",
      now: NOW,
    })).rejects.toMatchObject({ code: "WORKFORCE_ATTENDANCE_CAPABILITY_DISABLED" })

    vi.mocked(prisma.workforcePolicy.findMany).mockResolvedValue([
      policy({
        attendance: {
          enforcementVersion: 1,
          deviceTrust: {
            requiredActions: ["START"],
            biometricRequiredActions: ["START"],
          },
        },
      }),
    ] as never)
    await expect(prepareWorkforceAttendanceVerification(prisma as never, {
      organizationId: ORGANIZATION_ID,
      agentId: AGENT_ID,
      workday: WORKDAY,
      event: EVENT,
      capabilities: { qrEnabled: true, deviceTrustEnabled: true },
      principal: "web",
      now: NOW,
    })).rejects.toMatchObject({ code: "WORKFORCE_ATTENDANCE_POLICY_INVALID" })
  })

  it("requires a fresh, quality-eligible action-time location only when the policy publishes it", async () => {
    vi.mocked(prisma.workforcePolicy.findMany).mockResolvedValue([
      policy({ attendance: { enforcementVersion: 1, location: { requiredActions: ["START"] } } }),
    ] as never)

    await expect(prepare()).rejects.toMatchObject({ code: "WORKFORCE_ATTENDANCE_LOCATION_REQUIRED" })

    await expect(prepare({
      location: {
        capturedAt: NOW,
        provider: "GPS",
        isMock: false,
      },
    }, {
      ...EVENT,
      latitude: 40.4093,
      longitude: 49.8671,
      accuracy: 12,
    })).resolves.toMatchObject({
      facts: [],
      locationEvidence: {
        provider: "GPS",
        quality: { status: "ELIGIBLE_FOR_GEOFENCE" },
      },
    })

    await expect(prepare({
      location: {
        capturedAt: NOW,
        provider: "NETWORK",
        isMock: false,
      },
    }, {
      ...EVENT,
      latitude: 40.4093,
      longitude: 49.8671,
      accuracy: 12,
    })).rejects.toMatchObject({ code: "WORKFORCE_ATTENDANCE_LOCATION_REVIEW_REQUIRED" })
  })
})
