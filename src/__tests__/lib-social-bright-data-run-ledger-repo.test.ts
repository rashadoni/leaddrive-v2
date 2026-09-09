import { beforeEach, describe, expect, it, vi } from "vitest"

const tx = vi.hoisted(() => ({
  socialProviderRun: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
}))

const prisma = vi.hoisted(() => ({
  $transaction: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({ prisma }))

import {
  BRIGHT_DATA_PROVIDER_KEY,
  finalizeBrightDataProviderRunLedger,
} from "@/lib/social/bright-data-run-ledger-repo"

const priceSnapshot = {
  id: "bright-data-social-2026-07-13",
  effectiveAt: "2026-07-13T00:00:00.000Z",
  usdPerThousandRecords: 1.5,
  sourceUrl: "https://docs.brightdata.com/datasets/scrapers/scrapers-library/faqs",
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: "org-1",
    providerRunId: "run-1",
    finalStatus: "IMPORTED" as const,
    requestedUnits: 10,
    deliveredRecords: 8,
    acceptedUnique: 4,
    reservedChargeUsd: 0.05,
    providerCost: { amountUsd: 0.012, units: 8, unitName: "records" },
    priceSnapshot,
    now: new Date("2026-07-13T14:00:00.000Z"),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  prisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx))
  tx.socialProviderRun.findUnique.mockResolvedValue({
    providerKey: BRIGHT_DATA_PROVIDER_KEY,
    status: "RUNNING",
    inputSnapshot: { datasetId: "dataset-test", limitPerInput: 1 },
  })
  tx.socialProviderRun.updateMany.mockResolvedValue({ count: 1 })
})

describe("Bright Data provider run ledger repository", () => {
  it("persists authoritative cost, releases reservation and keeps input evidence", async () => {
    const result = await finalizeBrightDataProviderRunLedger(input())

    expect(result).toMatchObject({
      status: "UPDATED",
      ledger: { chargeSource: "PROVIDER_AMOUNT", actualChargeUsd: 0.012 },
    })
    expect(tx.socialProviderRun.updateMany).toHaveBeenCalledWith({
      where: {
        id: "run-1",
        organizationId: "org-1",
        providerKey: BRIGHT_DATA_PROVIDER_KEY,
        purgedAt: null,
        status: { in: ["RUNNING", "SUCCEEDED", "IMPORTING"] },
      },
      data: expect.objectContaining({
        status: "IMPORTED",
        receivedCount: 8,
        acceptedCount: 4,
        actualChargeUsd: 0.012,
        reservedChargeUsd: 0,
        finishedAt: new Date("2026-07-13T14:00:00.000Z"),
        importedAt: new Date("2026-07-13T14:00:00.000Z"),
        inputSnapshot: expect.objectContaining({
          datasetId: "dataset-test",
          limitPerInput: 1,
          costLedger: expect.objectContaining({ schemaVersion: "bright-data-cost-ledger-v1" }),
        }),
      }),
    })
  })

  it("keeps the estimate out of actualChargeUsd but steps the idle reservation down to it", async () => {
    await expect(finalizeBrightDataProviderRunLedger(input({
      providerCost: null,
      priceSnapshot,
      finalStatus: "SUCCEEDED",
    }))).resolves.toMatchObject({
      status: "UPDATED",
      ledger: { chargeSource: "DELIVERED_RECORD_ESTIMATE", actualChargeUsd: null },
    })

    const data = tx.socialProviderRun.updateMany.mock.calls[0][0].data
    // The estimate is never an authoritative actual...
    expect(data.actualChargeUsd).toBeUndefined()
    // ...but the phantom reservation is released down to that estimate here (at the
    // same moment status leaves RUNNING), so the shared daily budget stops carrying
    // the full per-run cap. min(held $0.05, estimate $0.012) = $0.012.
    expect(data.reservedChargeUsd).toBe(0.012)
    expect(data.importedAt).toBeUndefined()
    expect(data.inputSnapshot.costLedger).toMatchObject({ estimatedChargeUsd: 0.012 })
  })

  it("blocks a missing, foreign-provider or malformed run without updating it", async () => {
    tx.socialProviderRun.findUnique.mockResolvedValueOnce(null)
    await expect(finalizeBrightDataProviderRunLedger(input())).resolves.toEqual({
      status: "BLOCKED",
      reason: "bright_data_run_not_found",
    })

    tx.socialProviderRun.findUnique.mockResolvedValueOnce({
      providerKey: "apify",
      status: "RUNNING",
      inputSnapshot: {},
    })
    await expect(finalizeBrightDataProviderRunLedger(input())).resolves.toEqual({
      status: "BLOCKED",
      reason: "bright_data_provider_mismatch",
    })

    tx.socialProviderRun.findUnique.mockResolvedValueOnce({
      providerKey: BRIGHT_DATA_PROVIDER_KEY,
      status: "RUNNING",
      inputSnapshot: [],
    })
    await expect(finalizeBrightDataProviderRunLedger(input())).resolves.toEqual({
      status: "BLOCKED",
      reason: "bright_data_input_snapshot_invalid",
    })
    expect(tx.socialProviderRun.updateMany).not.toHaveBeenCalled()
  })

  it("is idempotent for terminal rows and detects a concurrent state change", async () => {
    tx.socialProviderRun.findUnique.mockResolvedValueOnce({
      providerKey: BRIGHT_DATA_PROVIDER_KEY,
      status: "IMPORTED",
      inputSnapshot: {},
    })
    await expect(finalizeBrightDataProviderRunLedger(input())).resolves.toEqual({
      status: "ALREADY_FINALIZED",
      runStatus: "IMPORTED",
    })
    expect(tx.socialProviderRun.updateMany).not.toHaveBeenCalled()

    tx.socialProviderRun.findUnique.mockResolvedValueOnce({
      providerKey: BRIGHT_DATA_PROVIDER_KEY,
      status: "IMPORTING",
      inputSnapshot: {},
    })
    tx.socialProviderRun.updateMany.mockResolvedValueOnce({ count: 0 })
    await expect(finalizeBrightDataProviderRunLedger(input())).resolves.toEqual({
      status: "STALE",
      reason: "bright_data_run_state_changed",
    })
  })

  it("allows a remotely succeeded run to advance through import reconciliation", async () => {
    tx.socialProviderRun.findUnique.mockResolvedValueOnce({
      providerKey: BRIGHT_DATA_PROVIDER_KEY,
      status: "SUCCEEDED",
      inputSnapshot: {},
    })

    await expect(finalizeBrightDataProviderRunLedger(input({ finalStatus: "IMPORTED" })))
      .resolves.toMatchObject({ status: "UPDATED" })
    expect(tx.socialProviderRun.updateMany).toHaveBeenCalledOnce()
  })
})
