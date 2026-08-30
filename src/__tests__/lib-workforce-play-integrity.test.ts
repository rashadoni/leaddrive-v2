import { describe, expect, it } from "vitest"
import {
  assessWorkforcePlayIntegrity,
  workforcePlayIntegrityRequestHash,
  type WorkforcePlayIntegrityVerdict,
} from "@/lib/workforce/play-integrity"

const hash = workforcePlayIntegrityRequestHash({
  organizationId: "org-1",
  agentId: "agent-1",
  enrollmentId: "device-1",
  operationId: "operation-1",
  workdayId: "workday-1",
  action: "START",
  occurredAt: "2026-08-30T15:00:00.000Z",
  schemaVersion: 3,
})

const verdict: WorkforcePlayIntegrityVerdict = {
  decodedBy: "GOOGLE_PLAY_INTEGRITY_SERVER_DECODE",
  requestDetails: { requestHash: hash },
  appIntegrity: {
    appRecognitionVerdict: "PLAY_RECOGNIZED",
    packageName: "com.leaddrive.workforce",
    certificateSha256Digest: ["a".repeat(43)],
    versionCode: "12",
  },
  deviceIntegrity: { deviceRecognitionVerdict: ["MEETS_DEVICE_INTEGRITY"] },
  accountDetails: { appLicensingVerdict: "LICENSED" },
}

const policy = {
  packageName: "com.leaddrive.workforce",
  certificateSha256Digest: ["a".repeat(43)],
  minimumVersionCode: 12n,
  minimumDeviceIntegrity: "MEETS_DEVICE_INTEGRITY" as const,
  requireLicensed: true,
}

describe("Workforce Play Integrity exact-action binding", () => {
  it("creates a stable hash for exactly one action without sensitive proof material", () => {
    expect(hash).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(workforcePlayIntegrityRequestHash({
      organizationId: "org-1", agentId: "agent-1", enrollmentId: "device-1", operationId: "operation-1",
      workdayId: "workday-1", action: "START", occurredAt: "2026-08-30T15:00:00.000Z", schemaVersion: 3,
    })).toBe(hash)
    expect(workforcePlayIntegrityRequestHash({
      organizationId: "org-1", agentId: "agent-1", enrollmentId: "device-1", operationId: "operation-1",
      workdayId: "workday-1", action: "FINISH", occurredAt: "2026-08-30T15:00:00.000Z", schemaVersion: 3,
    })).not.toBe(hash)
  })

  it("accepts only a server-decoded exact hash, Play-recognized identity, version, license and device tier", () => {
    expect(assessWorkforcePlayIntegrity({ expectedRequestHash: hash, policy, verdict }))
      .toEqual({ status: "ACCEPTED", code: "WORKFORCE_PLAY_INTEGRITY_ACCEPTED" })
  })

  it("rejects replay/tamper, package, version and license mismatches", () => {
    expect(assessWorkforcePlayIntegrity({
      expectedRequestHash: workforcePlayIntegrityRequestHash({
        organizationId: "org-1", agentId: "agent-1", enrollmentId: "device-1", operationId: "operation-2",
        workdayId: "workday-1", action: "START", occurredAt: "2026-08-30T15:00:00.000Z", schemaVersion: 3,
      }), policy, verdict,
    })).toMatchObject({ code: "WORKFORCE_PLAY_INTEGRITY_REQUEST_MISMATCH" })
    expect(assessWorkforcePlayIntegrity({
      expectedRequestHash: hash, policy, verdict: { ...verdict, appIntegrity: { ...verdict.appIntegrity, packageName: "other.app" } },
    })).toMatchObject({ code: "WORKFORCE_PLAY_INTEGRITY_APP_IDENTITY_MISMATCH" })
    expect(assessWorkforcePlayIntegrity({
      expectedRequestHash: hash, policy, verdict: { ...verdict, appIntegrity: { ...verdict.appIntegrity, versionCode: "11" } },
    })).toMatchObject({ code: "WORKFORCE_PLAY_INTEGRITY_APP_VERSION_UNSUPPORTED" })
    expect(assessWorkforcePlayIntegrity({
      expectedRequestHash: hash, policy, verdict: { ...verdict, accountDetails: { appLicensingVerdict: "UNLICENSED" } },
    })).toMatchObject({ code: "WORKFORCE_PLAY_INTEGRITY_UNLICENSED", recovery: "GET_LICENSED" })
  })

  it("routes missing device integrity to reviewed fallback instead of a silent pass", () => {
    expect(assessWorkforcePlayIntegrity({
      expectedRequestHash: hash,
      policy,
      verdict: { ...verdict, deviceIntegrity: { deviceRecognitionVerdict: [] } },
    })).toEqual({
      status: "REVIEW_REQUIRED",
      code: "WORKFORCE_PLAY_INTEGRITY_DEVICE_UNAVAILABLE",
      recovery: "RETRY_OR_REVIEWED_FALLBACK",
    })
  })
})
