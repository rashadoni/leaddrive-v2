import { describe, expect, it, vi } from "vitest"
import {
  monitoringResetAiCostCarrySince,
  parseMonitoringResetBudgetCarryForward,
  standardPaidProviderChargeTotalUsd,
  standardPaidProviderCollectorRunIdsSince,
} from "@/lib/social/paid-provider-run-scope"

function sqlText(value: unknown): string {
  const query = value as { strings?: readonly string[]; text?: string; sql?: string }
  return query.strings?.join("") ?? query.text ?? query.sql ?? ""
}

function carry(overrides: Record<string, unknown> = {}) {
  return {
    budgetCarryForward: {
      schemaVersion: "social-monitoring-budget-carry-v1",
      capturedAt: "2026-07-28T12:00:00.000Z",
      utcDayStart: "2026-07-28T00:00:00.000Z",
      utcMonthStart: "2026-07-01T00:00:00.000Z",
      provider: {
        dayChargeUsd: 1.2,
        monthChargeUsd: 4.2,
        runsToday: 2,
      },
      paidRunAuthorization: {
        dayReservedUsd: 1.2,
        monthReservedUsd: 4.2,
        runsToday: 2,
      },
      media: {
        dayCostUsd: 0.03,
        monthCostUsd: 0.2,
      },
      ai: {
        dayCostUsd: 0.04,
        monthCostUsd: 0.3,
      },
      ...overrides,
    },
  }
}

describe("paid provider reset budget carry", () => {
  it("requires and exposes the hidden AI current-period carry", () => {
    const parsed = parseMonitoringResetBudgetCarryForward(carry())

    expect(monitoringResetAiCostCarrySince(
      parsed,
      new Date("2026-07-28T00:00:00.000Z"),
    )).toBe(0.04)
    expect(monitoringResetAiCostCarrySince(
      parsed,
      new Date("2026-07-01T00:00:00.000Z"),
    )).toBe(0.3)
    expect(() => parseMonitoringResetBudgetCarryForward(carry({ ai: {} })))
      .toThrow("social_monitoring_reset_budget_carry_invalid:ai.dayCostUsd")
    expect(() => parseMonitoringResetBudgetCarryForward(carry({
      ai: { dayCostUsd: 1, monthCostUsd: 0.5 },
    }))).toThrow("social_monitoring_reset_budget_carry_invalid:ai.monthCostUsd")
  })

  it("adds the hidden current-period carry to live provider exposure", async () => {
    const client = {
      $queryRaw: vi.fn(async () => [{
        reservedChargeUsd: 0.1,
        actualChargeUsd: 0.2,
        resetNewValue: carry(),
        resetCreatedAt: new Date("2026-07-28T12:00:00.000Z"),
      }]),
    }

    await expect(standardPaidProviderChargeTotalUsd(client as never, {
      organizationId: "org-1",
      since: new Date("2026-07-28T00:00:00.000Z"),
      excludePreDispatch: true,
    })).resolves.toBeCloseTo(1.5, 6)

    await expect(standardPaidProviderChargeTotalUsd(client as never, {
      organizationId: "org-1",
      since: new Date("2026-07-01T00:00:00.000Z"),
      excludePreDispatch: true,
    })).resolves.toBeCloseTo(4.5, 6)
  })

  it("keeps the consumed daily run quota after operational rows are cleared", async () => {
    const client = {
      $queryRaw: vi.fn(async () => [
        {
          collectorRunId: "collector-after-reset",
          resetNewValue: null,
          resetCreatedAt: null,
        },
        {
          collectorRunId: null,
          resetNewValue: carry(),
          resetCreatedAt: new Date("2026-07-28T12:00:00.000Z"),
        },
      ]),
    }

    const ids = await standardPaidProviderCollectorRunIdsSince(client as never, {
      organizationId: "org-1",
      since: new Date("2026-07-28T00:00:00.000Z"),
      phase: "PAID_ROUTE_COLLECTION",
    })

    expect(new Set(ids).size).toBe(3)
    expect(ids).toContain("collector-after-reset")
  })

  it("excludes only durably terminal pre-dispatch rows from paid run quota", async () => {
    const client = { $queryRaw: vi.fn(async () => []) }

    await standardPaidProviderCollectorRunIdsSince(client as never, {
      organizationId: "org-1",
      since: new Date("2026-07-28T00:00:00.000Z"),
      phase: "PAID_ROUTE_COLLECTION",
      includeResetCarry: false,
    })

    const query = sqlText(client.$queryRaw.mock.calls[0]?.[0])
    expect(query).toContain("providerRequestDispatched")
    expect(query).toContain("@> '{\"providerRequestDispatched\": false}'::jsonb")
    expect(query).toContain("@> '{\"providerRequestDispatched\": true}'::jsonb")
    expect(query).not.toContain("->>'providerRequestDispatched'")
    expect(query).toContain('COALESCE("actualChargeUsd", 0) <= 0')
    expect(query).toContain("'X_API', 'TIKTOK_BUSINESS_API', 'BRIGHT_DATA_SNAPSHOT'")
    expect(query).toContain('"status" IN (\'SUCCEEDED\', \'FAILED\', \'BLOCKED\', \'PARTIAL\', \'IMPORTED\', \'PURGED\')')
    expect(query).not.toContain('"status" NOT IN (\'QUEUED\', \'RUNNING\')')
  })

  it("fails closed when a versioned carry snapshot is malformed", async () => {
    const client = {
      $queryRaw: vi.fn(async () => [{
        reservedChargeUsd: 0,
        actualChargeUsd: 0,
        resetNewValue: carry({
          provider: {
            dayChargeUsd: -1,
            monthChargeUsd: 4.2,
            runsToday: 2,
          },
        }),
        resetCreatedAt: new Date("2026-07-28T12:00:00.000Z"),
      }]),
    }

    await expect(standardPaidProviderChargeTotalUsd(client as never, {
      organizationId: "org-1",
      since: new Date("2026-07-28T00:00:00.000Z"),
    })).rejects.toThrow(
      "social_monitoring_reset_budget_carry_invalid:provider.dayChargeUsd",
    )
  })
})
