import { beforeEach, describe, expect, it, vi } from "vitest"

const prisma = vi.hoisted(() => ({
  socialProviderRun: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
}))

vi.mock("@/lib/prisma", () => ({ prisma }))
vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: (callback: () => unknown) => callback(),
}))

import {
  BRIGHT_DATA_WEBHOOK_MAX_BYTES,
  applyBrightDataWebhook,
  decodeBrightDataWebhookBody,
  parseBrightDataWebhookPayload,
  validateBrightDataWebhookTransport,
} from "@/lib/social/bright-data-webhook"
import {
  brightDataWebhookAuthorizationValue,
  generateBrightDataWebhookSecret,
  hashBrightDataWebhookSecret,
} from "@/lib/social/bright-data-webhook-auth"

const secret = generateBrightDataWebhookSecret()
const baseRun = {
  id: "run-1",
  organizationId: "org-1",
  providerKey: "bright-data",
  idempotencyKey: "bright-data:run-1",
  webhookSecretHash: hashBrightDataWebhookSecret({ organizationId: "org-1", idempotencyKey: "bright-data:run-1" }, secret),
  externalRunId: "s_snapshot1",
  status: "RUNNING",
}

beforeEach(() => {
  vi.clearAllMocks()
  prisma.socialProviderRun.findUnique.mockResolvedValue(baseRun)
  prisma.socialProviderRun.updateMany.mockResolvedValue({ count: 1 })
})

describe("Bright Data webhook delivery contract", () => {
  it("rejects compressed or oversized transport before JSON parsing", () => {
    expect(validateBrightDataWebhookTransport(new Headers({ "content-encoding": "gzip" }))).toEqual({
      valid: false,
      status: 400,
      reason: "bright_data_webhook_compression_not_allowed",
    })
    expect(validateBrightDataWebhookTransport(new Headers({ "content-length": String(BRIGHT_DATA_WEBHOOK_MAX_BYTES + 1) }))).toEqual({
      valid: false,
      status: 413,
      reason: "bright_data_webhook_payload_too_large",
    })
    expect(() => decodeBrightDataWebhookBody(new Uint8Array(BRIGHT_DATA_WEBHOOK_MAX_BYTES + 1)))
      .toThrow("payload_too_large")
  })

  it("accepts only bounded UTF-8 JSON with a valid snapshot/status", () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ snapshot_id: "s_snapshot1", status: "ready" }))
    expect(parseBrightDataWebhookPayload(decodeBrightDataWebhookBody(bytes))).toEqual({
      snapshotId: "s_snapshot1",
      providerStatus: "ready",
      runStatus: "SUCCEEDED",
    })
    expect(() => parseBrightDataWebhookPayload({ snapshot_id: "../../etc/passwd", status: "ready" }))
      .toThrow("snapshot_invalid")
    expect(() => parseBrightDataWebhookPayload({ snapshot_id: "s_snapshot1", status: "unknown" }))
      .toThrow("status_invalid")
  })

  it("authenticates, binds the snapshot to the run and applies ready exactly once", async () => {
    const authorizationHeader = brightDataWebhookAuthorizationValue(secret)
    const payload = { snapshot_id: "s_snapshot1", status: "ready" }

    await expect(applyBrightDataWebhook({ runId: "run-1", authorizationHeader, payload }))
      .resolves.toEqual({ status: "UPDATED", runStatus: "SUCCEEDED" })
    expect(prisma.socialProviderRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "run-1", organizationId: "org-1", externalRunId: "s_snapshot1", status: "RUNNING" }),
      data: expect.objectContaining({ status: "SUCCEEDED", finishedAt: expect.any(Date) }),
    }))

    prisma.socialProviderRun.findUnique.mockResolvedValue({ ...baseRun, status: "SUCCEEDED" })
    await expect(applyBrightDataWebhook({ runId: "run-1", authorizationHeader, payload }))
      .resolves.toEqual({ status: "ALREADY_APPLIED", runStatus: "SUCCEEDED" })
    expect(prisma.socialProviderRun.updateMany).toHaveBeenCalledTimes(1)
  })

  it("rejects unsigned, cross-snapshot and state-regression deliveries", async () => {
    await expect(applyBrightDataWebhook({
      runId: "run-1",
      authorizationHeader: null,
      payload: { snapshot_id: "s_snapshot1", status: "ready" },
    })).resolves.toEqual({ status: "UNAUTHORIZED" })

    const authorizationHeader = brightDataWebhookAuthorizationValue(secret)
    await expect(applyBrightDataWebhook({
      runId: "run-1",
      authorizationHeader,
      payload: { snapshot_id: "s_other", status: "ready" },
    })).resolves.toEqual({ status: "STALE", reason: "bright_data_webhook_snapshot_mismatch" })

    prisma.socialProviderRun.findUnique.mockResolvedValue({ ...baseRun, status: "SUCCEEDED" })
    await expect(applyBrightDataWebhook({
      runId: "run-1",
      authorizationHeader,
      payload: { snapshot_id: "s_snapshot1", status: "running" },
    })).resolves.toEqual({ status: "STALE", reason: "bright_data_webhook_state_regression" })
  })
})
