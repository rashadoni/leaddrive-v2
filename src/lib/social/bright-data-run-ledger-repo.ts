import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import {
  brightDataLedgerToProviderRunCostFields,
  buildBrightDataCostLedger,
  type BrightDataCostLedgerEntry,
  type BrightDataCostLedgerInput,
} from "@/lib/social/bright-data-cost-ledger"

export const BRIGHT_DATA_PROVIDER_KEY = "bright-data"

// SUCCEEDED means the remote collection finished; import/cost reconciliation
// may still advance it to IMPORTED or PARTIAL.
const MUTABLE_RUN_STATUSES = ["RUNNING", "SUCCEEDED", "IMPORTING"] as const

export interface FinalizeBrightDataProviderRunInput extends BrightDataCostLedgerInput {
  organizationId: string
  providerRunId: string
  finalStatus: "SUCCEEDED" | "PARTIAL" | "IMPORTED"
  // Schema-drift warnings from normalization (already redacted aggregates).
  // Persisted on the run's inputSnapshot so a PARTIAL run's root cause stays
  // inspectable after the collector falls back to a manual route.
  driftWarnings?: string[]
  now?: Date
}

export type FinalizeBrightDataProviderRunResult =
  | { status: "UPDATED"; ledger: BrightDataCostLedgerEntry }
  | { status: "BLOCKED"; reason: "bright_data_run_not_found" | "bright_data_provider_mismatch" | "bright_data_input_snapshot_invalid" }
  | { status: "ALREADY_FINALIZED"; runStatus: string }
  | { status: "STALE"; reason: "bright_data_run_state_changed" }

function inputSnapshotRecord(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, Prisma.JsonValue>
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

/**
 * Finalizes cost/count fields only for a Bright Data run that is still mutable.
 * It does not dispatch a provider request. Estimated charges are stored in the
 * run snapshot for audit but never copied into actualChargeUsd.
 */
export async function finalizeBrightDataProviderRunLedger(
  input: FinalizeBrightDataProviderRunInput,
): Promise<FinalizeBrightDataProviderRunResult> {
  const organizationId = input.organizationId.trim()
  const providerRunId = input.providerRunId.trim()
  if (!organizationId) throw new Error("organizationId is required")
  if (!providerRunId) throw new Error("providerRunId is required")
  const ledger = buildBrightDataCostLedger(input)
  const costFields = brightDataLedgerToProviderRunCostFields(ledger)
  const now = input.now ?? new Date()

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const run = await tx.socialProviderRun.findUnique({
      where: {
        organizationId_id: {
          organizationId,
          id: providerRunId,
        },
      },
      select: {
        providerKey: true,
        status: true,
        inputSnapshot: true,
        purgedAt: true,
      },
    })
    if (!run) return { status: "BLOCKED", reason: "bright_data_run_not_found" }
    if (run.providerKey !== BRIGHT_DATA_PROVIDER_KEY) {
      return { status: "BLOCKED", reason: "bright_data_provider_mismatch" }
    }
    if (run.purgedAt) return { status: "ALREADY_FINALIZED", runStatus: "PURGED" }
    if (!MUTABLE_RUN_STATUSES.includes(run.status as typeof MUTABLE_RUN_STATUSES[number])) {
      return { status: "ALREADY_FINALIZED", runStatus: run.status }
    }
    const existingSnapshot = inputSnapshotRecord(run.inputSnapshot)
    if (!existingSnapshot) {
      return { status: "BLOCKED", reason: "bright_data_input_snapshot_invalid" }
    }

    const update = await tx.socialProviderRun.updateMany({
      where: {
        id: providerRunId,
        organizationId,
        providerKey: BRIGHT_DATA_PROVIDER_KEY,
        purgedAt: null,
        status: { in: [...MUTABLE_RUN_STATUSES] },
      },
      data: {
        status: input.finalStatus,
        receivedCount: costFields.receivedCount,
        acceptedCount: costFields.acceptedCount,
        inputSnapshot: jsonValue({
          ...existingSnapshot,
          costLedger: ledger,
          ...(input.driftWarnings && input.driftWarnings.length > 0
            ? { driftWarnings: input.driftWarnings.slice(0, 8).map(warning => String(warning).slice(0, 300)) }
            : {}),
        }),
        finishedAt: now,
        ...(input.finalStatus === "IMPORTED" ? { importedAt: now } : {}),
        ...(costFields.actualChargeUsd === undefined
          ? {}
          : {
              actualChargeUsd: costFields.actualChargeUsd,
              reservedChargeUsd: 0,
            }),
        // Estimate-only completion (no authoritative actual yet): step the idle
        // reservation down to the record-based estimate here, at the SAME moment
        // status moves off RUNNING — otherwise the collector's post-dispatch
        // step-down (finishPaidRouteBudgetReservation, guarded status:"RUNNING")
        // finds no RUNNING row and the full per-run cap stays reserved all day.
        ...(costFields.reservedChargeUsd === undefined
          ? {}
          : { reservedChargeUsd: costFields.reservedChargeUsd }),
      },
    })
    if (update.count !== 1) return { status: "STALE", reason: "bright_data_run_state_changed" }
    return { status: "UPDATED", ledger }
  })
}
