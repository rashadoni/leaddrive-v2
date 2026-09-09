import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { verifyBrightDataWebhookAuthorization } from "@/lib/social/bright-data-webhook-auth"

export const BRIGHT_DATA_WEBHOOK_MAX_BYTES = 16 * 1024

export type BrightDataWebhookResult =
  | { status: "UPDATED"; runStatus: "RUNNING" | "SUCCEEDED" | "FAILED" }
  | { status: "ALREADY_APPLIED"; runStatus: string }
  | { status: "UNAUTHORIZED" }
  | { status: "INVALID_PAYLOAD"; reason: string }
  | { status: "STALE"; reason: string }

interface BrightDataWebhookPayload {
  snapshotId: string
  providerStatus: "starting" | "running" | "ready" | "failed"
  runStatus: "RUNNING" | "SUCCEEDED" | "FAILED"
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function validSnapshotId(value: string): boolean {
  return /^(?:s|sd|snap)_[a-z0-9]+$/i.test(value)
}

export function parseBrightDataWebhookPayload(value: unknown): BrightDataWebhookPayload {
  const body = record(value)
  const snapshotId = typeof body.snapshot_id === "string" ? body.snapshot_id.trim() : ""
  const providerStatus = typeof body.status === "string" ? body.status.trim().toLowerCase() : ""
  if (!validSnapshotId(snapshotId)) throw new Error("bright_data_webhook_snapshot_invalid")
  if (!["starting", "running", "ready", "failed"].includes(providerStatus)) {
    throw new Error("bright_data_webhook_status_invalid")
  }
  return {
    snapshotId,
    providerStatus: providerStatus as BrightDataWebhookPayload["providerStatus"],
    runStatus: providerStatus === "ready" ? "SUCCEEDED" : providerStatus === "failed" ? "FAILED" : "RUNNING",
  }
}

export function validateBrightDataWebhookTransport(headers: Headers): { valid: true } | { valid: false; status: 400 | 413; reason: string } {
  const encoding = headers.get("content-encoding")?.trim().toLowerCase()
  if (encoding && encoding !== "identity") {
    return { valid: false, status: 400, reason: "bright_data_webhook_compression_not_allowed" }
  }
  const lengthHeader = headers.get("content-length")
  if (lengthHeader) {
    const length = Number(lengthHeader)
    if (!Number.isInteger(length) || length < 0) {
      return { valid: false, status: 400, reason: "bright_data_webhook_content_length_invalid" }
    }
    if (length > BRIGHT_DATA_WEBHOOK_MAX_BYTES) {
      return { valid: false, status: 413, reason: "bright_data_webhook_payload_too_large" }
    }
  }
  return { valid: true }
}

export function decodeBrightDataWebhookBody(bytes: Uint8Array): unknown {
  if (bytes.byteLength > BRIGHT_DATA_WEBHOOK_MAX_BYTES) {
    throw new Error("bright_data_webhook_payload_too_large")
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  } catch (error) {
    if (error instanceof Error && error.message === "bright_data_webhook_payload_too_large") throw error
    throw new Error("bright_data_webhook_json_invalid")
  }
}

export async function applyBrightDataWebhook(input: {
  runId: string
  authorizationHeader: string | null
  payload: unknown
}): Promise<BrightDataWebhookResult> {
  const runId = input.runId.trim()
  if (!runId) return { status: "INVALID_PAYLOAD", reason: "bright_data_webhook_run_id_missing" }
  return runWithRlsBypass(async () => {
    const run = await prisma.socialProviderRun.findUnique({
      where: { id: runId },
      select: {
        id: true,
        organizationId: true,
        providerKey: true,
        idempotencyKey: true,
        webhookSecretHash: true,
        externalRunId: true,
        status: true,
        purgedAt: true,
      },
    })
    if (!run || run.providerKey !== "bright-data" || !verifyBrightDataWebhookAuthorization({
      organizationId: run.organizationId,
      idempotencyKey: run.idempotencyKey,
      webhookSecretHash: run.webhookSecretHash,
    }, input.authorizationHeader)) {
      return { status: "UNAUTHORIZED" as const }
    }

    let payload: BrightDataWebhookPayload
    try {
      payload = parseBrightDataWebhookPayload(input.payload)
    } catch (error) {
      return {
        status: "INVALID_PAYLOAD" as const,
        reason: error instanceof Error ? error.message : "bright_data_webhook_payload_invalid",
      }
    }
    if (!run.externalRunId || run.externalRunId !== payload.snapshotId) {
      return { status: "STALE" as const, reason: "bright_data_webhook_snapshot_mismatch" }
    }
    if (run.purgedAt || run.status === "PURGED") {
      return { status: "STALE" as const, reason: "bright_data_webhook_run_terminal" }
    }
    if (run.status === payload.runStatus) {
      return { status: "ALREADY_APPLIED" as const, runStatus: run.status }
    }
    if (!["RUNNING", "SUCCEEDED"].includes(run.status)) {
      return { status: "STALE" as const, reason: "bright_data_webhook_run_terminal" }
    }
    if (run.status === "SUCCEEDED" && payload.runStatus !== "SUCCEEDED") {
      return { status: "STALE" as const, reason: "bright_data_webhook_state_regression" }
    }

    const updated = await prisma.socialProviderRun.updateMany({
      where: {
        id: run.id,
        organizationId: run.organizationId,
        providerKey: "bright-data",
        purgedAt: null,
        externalRunId: payload.snapshotId,
        status: run.status,
      },
      data: {
        status: payload.runStatus,
        ...(payload.runStatus === "RUNNING" ? {} : { finishedAt: new Date() }),
        ...(payload.runStatus === "FAILED" ? { lastError: "bright_data_snapshot_failed" } : {}),
      },
    })
    if (updated.count !== 1) {
      return { status: "STALE" as const, reason: "bright_data_webhook_run_state_changed" }
    }
    return { status: "UPDATED" as const, runStatus: payload.runStatus }
  })
}
