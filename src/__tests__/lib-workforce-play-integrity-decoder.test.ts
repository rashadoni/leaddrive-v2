import { describe, expect, it } from "vitest"
import {
  assessConfiguredWorkforcePlayIntegrity,
  WorkforcePlayIntegrityDecoderError,
} from "@/lib/workforce/play-integrity-decoder"
import { workforcePlayIntegrityRequestHash } from "@/lib/workforce/play-integrity"

const NOW = new Date("2026-08-30T15:00:30.000Z")
const TOKEN = "server-decoded-standard-api-token"
const REQUEST_HASH = workforcePlayIntegrityRequestHash({
  organizationId: "org-1",
  agentId: "agent-1",
  enrollmentId: "device-1",
  operationId: "operation-1",
  workdayId: "workday-1",
  action: "START",
  occurredAt: "2026-08-30T15:00:00.000Z",
  schemaVersion: 5,
})

const env = {
  WORKFORCE_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON: JSON.stringify({
    type: "service_account",
    project_id: "test-project",
  }),
  WORKFORCE_PLAY_INTEGRITY_PACKAGE_NAME: "com.leaddrive.workforce",
  WORKFORCE_PLAY_INTEGRITY_CERTIFICATE_SHA256_DIGESTS: "a".repeat(43),
  WORKFORCE_PLAY_INTEGRITY_MIN_VERSION_CODE: "12",
  WORKFORCE_PLAY_INTEGRITY_MIN_DEVICE_INTEGRITY: "MEETS_DEVICE_INTEGRITY",
}

const acceptedPayload = {
  requestDetails: {
    requestHash: REQUEST_HASH,
    requestPackageName: "com.leaddrive.workforce",
    timestampMillis: "1788102030000",
  },
  appIntegrity: {
    appRecognitionVerdict: "PLAY_RECOGNIZED",
    packageName: "com.leaddrive.workforce",
    certificateSha256Digest: ["a".repeat(43)],
    versionCode: "12",
  },
  deviceIntegrity: { deviceRecognitionVerdict: ["MEETS_DEVICE_INTEGRITY"] },
  accountDetails: { appLicensingVerdict: "LICENSED" },
}

describe("configured Workforce Play Integrity server decoder", () => {
  it("uses a server decoder and reduces the decoded token to an accepted fixed assessment", async () => {
    const decode = async ({ packageName, token }: { packageName: string; token: string }) => {
      expect(packageName).toBe("com.leaddrive.workforce")
      expect(token).toBe(TOKEN)
      return acceptedPayload
    }

    await expect(assessConfiguredWorkforcePlayIntegrity({
      token: TOKEN,
      expectedRequestHash: REQUEST_HASH,
      env,
      decode,
      now: NOW,
    })).resolves.toEqual({ status: "ACCEPTED", code: "WORKFORCE_PLAY_INTEGRITY_ACCEPTED" })
  })

  it("fails closed without a complete enabled decoder configuration", async () => {
    await expect(assessConfiguredWorkforcePlayIntegrity({
      token: TOKEN,
      expectedRequestHash: REQUEST_HASH,
      env: {},
      decode: async () => acceptedPayload,
      now: NOW,
    })).rejects.toMatchObject({ code: "WORKFORCE_PLAY_INTEGRITY_NOT_CONFIGURED" })
  })

  it("keeps a valid but unevaluated Google response in the evaluator's fail-closed path", async () => {
    await expect(assessConfiguredWorkforcePlayIntegrity({
      token: TOKEN,
      expectedRequestHash: REQUEST_HASH,
      env,
      decode: async () => ({
        requestDetails: { requestHash: null, requestPackageName: null, timestampMillis: null },
        appIntegrity: {
          appRecognitionVerdict: "UNEVALUATED",
          packageName: null,
          certificateSha256Digest: null,
          versionCode: null,
        },
        deviceIntegrity: { deviceRecognitionVerdict: null },
        accountDetails: { appLicensingVerdict: "UNEVALUATED" },
      }),
      now: NOW,
    })).resolves.toMatchObject({ status: "REJECTED", code: "WORKFORCE_PLAY_INTEGRITY_REQUEST_MISMATCH" })
  })

  it("does not expose a raw token when the external decoder is unavailable", async () => {
    const failure = new Error(`provider failure for ${TOKEN}`)
    await expect(assessConfiguredWorkforcePlayIntegrity({
      token: TOKEN,
      expectedRequestHash: REQUEST_HASH,
      env,
      decode: async () => { throw failure },
      now: NOW,
    })).rejects.toBeInstanceOf(WorkforcePlayIntegrityDecoderError)
    await expect(assessConfiguredWorkforcePlayIntegrity({
      token: TOKEN,
      expectedRequestHash: REQUEST_HASH,
      env,
      decode: async () => { throw failure },
      now: NOW,
    })).rejects.toMatchObject({
      code: "WORKFORCE_PLAY_INTEGRITY_DECODE_UNAVAILABLE",
      message: "WORKFORCE_PLAY_INTEGRITY_DECODE_UNAVAILABLE",
    })
  })
})
