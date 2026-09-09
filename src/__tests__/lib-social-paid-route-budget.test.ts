import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const tx = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  $queryRaw: vi.fn(),
  organization: {
    findUnique: vi.fn(),
  },
  socialProviderRun: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    aggregate: vi.fn(),
    create: vi.fn(),
  },
}))

const prisma = vi.hoisted(() => ({
  $transaction: vi.fn(),
  $executeRaw: vi.fn(),
  organization: { findUnique: vi.fn() },
  socialProviderRun: { updateMany: vi.fn(), findFirst: vi.fn() },
}))

vi.mock("@/lib/prisma", () => ({ prisma }))

import {
  beginPaidRouteBudgetDispatch,
  finishPaidRouteBudgetReservation,
  requiresPaidRouteBudget,
  reservePaidRouteBudget,
  usesProviderAccountBudget,
} from "@/lib/social/paid-route-budget"

function input(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: "org-1",
    sourceId: "source-1",
    routePlanId: "route-1",
    collectorRunId: "collector-1",
    adapterKey: "X_API",
    budget: {
      usdLimitsConfigured: true,
      maxTotalChargeUsd: 0.25,
      dailyBudgetUsd: 2,
      monthlyBudgetUsd: 20,
    },
    maxItems: 100,
    timeoutSeconds: 900,
    now: new Date("2026-07-12T12:00:00.000Z"),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("SOCIAL_MONITORING_ENFORCE_USD_BUDGETS", "1")
  prisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx))
  prisma.organization.findUnique.mockResolvedValue({ settings: {} })
  tx.organization.findUnique.mockResolvedValue({
    settings: {
      socialMonitoringPaidRuns: {
        emergencyStopped: false,
      },
    },
  })
  tx.$executeRaw.mockResolvedValue(0)
  tx.$queryRaw.mockImplementation(async (query: { text?: string; sql?: string }) => {
    const statement = query.text ?? query.sql ?? ""
    return statement.includes("SELECT DISTINCT")
      ? []
      : [{ reservedChargeUsd: 0, actualChargeUsd: 0 }]
  })
  tx.socialProviderRun.findUnique.mockResolvedValue(null)
  tx.socialProviderRun.findMany.mockResolvedValue([])
  tx.socialProviderRun.aggregate.mockResolvedValue({
    _sum: { reservedChargeUsd: 0, actualChargeUsd: 0 },
  })
  tx.socialProviderRun.create.mockResolvedValue({ id: "provider-run-1" })
  prisma.$executeRaw.mockResolvedValue(1)
  prisma.socialProviderRun.findFirst.mockResolvedValue({
    adapterKey: "X_API",
    reservedChargeUsd: 0.25,
    inputSnapshot: { providerRequestDispatched: true },
  })
  prisma.socialProviderRun.updateMany.mockResolvedValue({ count: 1 })
})

function quotaSettings(dailyRunQuota: number) {
  return {
    settings: {
      socialMonitoringPaidRuns: {
        policyVersion: 2,
        manualRunsEnabled: true,
        emergencyStopped: false,
        dailyRunQuota,
        authorizedAt: "2026-07-19T00:00:00.000Z",
        authorizedBy: "admin-1",
      },
    },
  }
}

function clientFundedSettings(overrides: Record<string, unknown> = {}) {
  return {
    settings: {
      socialMonitoringPaidRuns: {
        policyVersion: 1,
        manualRunsEnabled: false,
        clientFundedManualRunsEnabled: true,
        emergencyStopped: false,
        dailyRunQuota: 1,
        ...overrides,
      },
    },
  }
}

function resetCarry(overrides: Record<string, unknown> = {}) {
  return {
    budgetCarryForward: {
      schemaVersion: "social-monitoring-budget-carry-v1",
      capturedAt: "2026-07-12T10:00:00.000Z",
      utcDayStart: "2026-07-12T00:00:00.000Z",
      utcMonthStart: "2026-07-01T00:00:00.000Z",
      provider: {
        dayChargeUsd: 0,
        monthChargeUsd: 0,
        runsToday: 0,
      },
      paidRunAuthorization: {
        dayReservedUsd: 0,
        monthReservedUsd: 0,
        runsToday: 0,
      },
      media: {
        dayCostUsd: 0,
        monthCostUsd: 0,
      },
      ai: {
        dayCostUsd: 0,
        monthCostUsd: 0,
      },
      ...overrides,
    },
  }
}

afterEach(() => vi.unstubAllEnvs())

describe("paid route budget guard", () => {
  it("fails closed when paid-budget enforcement is disabled", async () => {
    vi.unstubAllEnvs()
    await expect(reservePaidRouteBudget(input())).resolves.toEqual({
      status: "BLOCKED",
      reason: "paid_route_budget_enforcement_disabled",
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("reserves and audits an explicit manual cap even when recurring owner limits are absent", async () => {
    await expect(reservePaidRouteBudget(input({
      budget: { usdLimitsConfigured: false },
      manualMaxTotalChargeUsd: 0.1,
    }))).resolves.toEqual({
      status: "RESERVED",
      providerRunId: "provider-run-1",
      reservedChargeUsd: 0.1,
    })

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2)
    expect(tx.socialProviderRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        schemaVersion: "paid-route-manual-capped-v3",
        reservedChargeUsd: 0.1,
        maxTotalChargeUsd: 0.1,
        dailyBudgetUsd: 4,
        monthlyBudgetUsd: 120,
        inputSnapshot: expect.objectContaining({
          manualRun: true,
          operatorAuthorizedMaxTotalChargeUsd: 0.1,
        }),
      }),
      select: { id: true },
    })
  })

  it("bypasses tenant period aggregates and run-count quota for a client-funded manual reservation", async () => {
    prisma.organization.findUnique.mockResolvedValue(clientFundedSettings())
    await expect(reservePaidRouteBudget(input({
      budget: {
        usdLimitsConfigured: true,
        maxTotalChargeUsd: 0.25,
        dailyBudgetUsd: 0.25,
        monthlyBudgetUsd: 0.25,
      },
      manualMaxTotalChargeUsd: 100,
      clientFundedManual: true,
    }))).resolves.toEqual({
      status: "RESERVED",
      providerRunId: "provider-run-1",
      reservedChargeUsd: 100,
    })

    expect(prisma.organization.findUnique).toHaveBeenCalledOnce()
    expect(tx.$queryRaw).not.toHaveBeenCalled()
    expect(tx.socialProviderRun.findUnique).toHaveBeenCalledOnce()
    expect(tx.socialProviderRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        schemaVersion: "paid-route-client-funded-manual-v1",
        reservedChargeUsd: 100,
        maxTotalChargeUsd: 100,
        dailyBudgetUsd: null,
        monthlyBudgetUsd: null,
        inputSnapshot: expect.objectContaining({
          manualRun: true,
          clientFundedManual: true,
          operatorAuthorizedMaxTotalChargeUsd: 100,
          hardMaxPerRunUsd: 100,
          hardDailyBudgetUsd: null,
          hardMonthlyBudgetUsd: null,
        }),
      }),
      select: { id: true },
    })
  })

  it("keeps the tenant emergency stop authoritative for client-funded reservations", async () => {
    prisma.organization.findUnique.mockResolvedValue(clientFundedSettings({
      emergencyStopped: true,
    }))

    await expect(reservePaidRouteBudget(input({
      manualMaxTotalChargeUsd: 100,
      clientFundedManual: true,
    }))).resolves.toEqual({
      status: "BLOCKED",
      reason: "paid_run_emergency_stopped",
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(tx.socialProviderRun.create).not.toHaveBeenCalled()
  })

  it("fails closed unless the operator explicitly enabled provider-billed manual runs for the tenant", async () => {
    prisma.organization.findUnique.mockResolvedValue(clientFundedSettings({
      clientFundedManualRunsEnabled: false,
    }))

    await expect(reservePaidRouteBudget(input({
      manualMaxTotalChargeUsd: 100,
      clientFundedManual: true,
    }))).resolves.toEqual({
      status: "BLOCKED",
      reason: "paid_client_funded_manual_not_authorized",
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(tx.$queryRaw).not.toHaveBeenCalled()
    expect(tx.socialProviderRun.create).not.toHaveBeenCalled()
  })

  it("keeps route idempotency ahead of all client-funded provider dispatch", async () => {
    prisma.organization.findUnique.mockResolvedValue(clientFundedSettings())
    tx.socialProviderRun.findUnique.mockResolvedValue({ id: "provider-run-existing" })

    await expect(reservePaidRouteBudget(input({
      manualMaxTotalChargeUsd: 100,
      clientFundedManual: true,
    }))).resolves.toEqual({
      status: "BLOCKED",
      reason: "paid_route_already_attempted",
    })
    expect(tx.$queryRaw).not.toHaveBeenCalled()
    expect(tx.socialProviderRun.create).not.toHaveBeenCalled()
  })

  it("rejects a zero manual cap before opening a transaction", async () => {
    await expect(reservePaidRouteBudget(input({ manualMaxTotalChargeUsd: 0 }))).resolves.toEqual({
      status: "BLOCKED",
      reason: "paid_manual_run_cap_invalid",
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("keeps manual paid runs fail-closed when USD enforcement is disabled", async () => {
    vi.unstubAllEnvs()
    await expect(reservePaidRouteBudget(input({ manualMaxTotalChargeUsd: 0.1 }))).resolves.toEqual({
      status: "BLOCKED",
      reason: "paid_route_budget_enforcement_disabled",
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
  it("guards monetary providers but not quota-only YouTube or Apify", () => {
    expect(requiresPaidRouteBudget("X_API")).toBe(true)
    expect(requiresPaidRouteBudget("YOUTUBE_DATA_API")).toBe(false)
    expect(requiresPaidRouteBudget("TIKTOK_BUSINESS_API")).toBe(true)
    expect(requiresPaidRouteBudget("BRIGHT_DATA_SNAPSHOT")).toBe(true)
    expect(requiresPaidRouteBudget("APIFY_ASYNC")).toBe(false)
    expect(usesProviderAccountBudget("BRIGHT_DATA_SNAPSHOT")).toBe(true)
    expect(usesProviderAccountBudget("X_API")).toBe(false)
  })

  it("fails closed before a transaction when owner pricing is incomplete", async () => {
    await expect(reservePaidRouteBudget(input({
      budget: { maxTotalChargeUsd: 0.25, dailyBudgetUsd: 2 },
    }))).resolves.toEqual({ status: "BLOCKED", reason: "paid_route_budget_unconfigured" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("atomically reserves configured exposure and records owner-supplied limits", async () => {
    await expect(reservePaidRouteBudget(input())).resolves.toEqual({
      status: "RESERVED",
      providerRunId: "provider-run-1",
      reservedChargeUsd: 0.25,
    })

    expect(tx.$executeRaw).toHaveBeenCalledTimes(2)
    const reaperTemplate = tx.$executeRaw.mock.calls[1]?.[0] as unknown
    const reaperSql = Array.isArray(reaperTemplate)
      ? reaperTemplate.join("")
      : (reaperTemplate as { strings?: readonly string[] })?.strings?.join("") ?? ""
    expect(reaperSql).toContain("paid_route_dispatch_handoff_expired")
    expect(reaperSql).toContain("@> '{\"providerRequestDispatched\": false}'::jsonb")
    expect(reaperSql).toContain('"status" = \'QUEUED\'')
    expect(reaperSql).toContain('"externalRunId" IS NULL')
    expect(reaperSql).toContain('COALESCE("actualChargeUsd", 0) <= 0')
    expect(tx.organization.findUnique).toHaveBeenCalledWith({
      where: { id: "org-1" },
      select: { settings: true },
    })
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2)
    for (const [query] of tx.$queryRaw.mock.calls) {
      const sql = query.text ?? query.sql ?? ""
      expect(sql).toContain('"purgedAt" IS NULL')
    }
    expect(tx.socialProviderRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        providerKey: "X_API",
        adapterKey: "X_API",
        collectorRunId: "collector-1",
        reservedChargeUsd: 0.25,
        maxTotalChargeUsd: 0.25,
        dailyBudgetUsd: 2,
        monthlyBudgetUsd: 20,
        status: "QUEUED",
        startedAt: null,
        inputSnapshot: expect.objectContaining({ providerRequestDispatched: false }),
      }),
      select: { id: true },
    })
  })

  it("claims a synchronous paid reservation immediately before provider I/O", async () => {
    await expect(beginPaidRouteBudgetDispatch("org-1", "provider-run-1")).resolves.toBe(true)

    expect(prisma.$executeRaw).toHaveBeenCalledOnce()
    const query = prisma.$executeRaw.mock.calls[0]?.[0] as unknown
    const sql = Array.isArray(query)
      ? query.join("")
      : (query as { strings?: readonly string[] })?.strings?.join("") ?? ""
    expect(sql).toContain('"status" = \'RUNNING\'')
    expect(sql).toContain('"status" = \'QUEUED\'')
    expect(sql).toContain("providerRequestDispatched")
    expect(sql).toContain("@> '{\"providerRequestDispatched\": false}'::jsonb")
    expect(sql).not.toContain("->>'providerRequestDispatched'")
    expect(sql).toContain('"externalRunId" IS NULL')
    expect(sql).toContain('COALESCE("actualChargeUsd", 0) <= 0')
    expect(sql).toContain('"adapterKey" IN (')
  })

  it("does not claim a reservation whose state changed before dispatch", async () => {
    prisma.$executeRaw.mockResolvedValueOnce(0)
    await expect(beginPaidRouteBudgetDispatch("org-1", "provider-run-1")).resolves.toBe(false)
  })

  it("re-reads the emergency stop after the spend lock and blocks a pre-reset waiter", async () => {
    prisma.organization.findUnique.mockResolvedValue({
      settings: {
        socialMonitoringPaidRuns: {
          emergencyStopped: false,
        },
      },
    })
    tx.organization.findUnique.mockResolvedValue({
      settings: {
        socialMonitoringPaidRuns: {
          emergencyStopped: true,
        },
      },
    })

    await expect(reservePaidRouteBudget(input())).resolves.toEqual({
      status: "BLOCKED",
      reason: "paid_run_emergency_stopped",
    })

    expect(tx.$executeRaw).toHaveBeenCalledOnce()
    expect(tx.organization.findUnique).toHaveBeenCalledOnce()
    expect(tx.socialProviderRun.findUnique).not.toHaveBeenCalled()
    expect(tx.socialProviderRun.create).not.toHaveBeenCalled()
  })

  it("records Bright Data without applying local USD or run-count budgets", async () => {
    prisma.organization.findUnique.mockResolvedValue(clientFundedSettings())
    vi.stubEnv("SOCIAL_MONITORING_ENFORCE_USD_BUDGETS", "0")
    await expect(reservePaidRouteBudget(input({
      adapterKey: "BRIGHT_DATA_SNAPSHOT",
      providerKey: "bright-data",
      budget: { usdLimitsConfigured: false },
    }))).resolves.toMatchObject({ status: "RESERVED", providerRunId: "provider-run-1" })

    expect(tx.$queryRaw).not.toHaveBeenCalled()
    expect(tx.socialProviderRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        providerKey: "bright-data",
        adapterKey: "BRIGHT_DATA_SNAPSHOT",
        schemaVersion: "paid-route-provider-account-v1",
        status: "QUEUED",
        startedAt: null,
        reservedChargeUsd: 0,
        maxTotalChargeUsd: 0,
        dailyBudgetUsd: null,
        monthlyBudgetUsd: null,
        inputSnapshot: expect.objectContaining({
          providerAccountBudget: true,
          providerRequestDispatched: false,
          hardMaxPerRunUsd: null,
          hardDailyBudgetUsd: null,
          hardMonthlyBudgetUsd: null,
        }),
      }),
      select: { id: true },
    })
  })

  it("allows an explicitly authorized Bright Data profile run without a local per-click cap", async () => {
    prisma.organization.findUnique.mockResolvedValue(clientFundedSettings())
    vi.stubEnv("SOCIAL_MONITORING_ENFORCE_USD_BUDGETS", "0")

    await expect(reservePaidRouteBudget(input({
      adapterKey: "BRIGHT_DATA_SNAPSHOT",
      providerKey: "bright-data",
      budget: { usdLimitsConfigured: false },
      manualMaxTotalChargeUsd: undefined,
      clientFundedManual: true,
      targetScenarioId: "scenario-a",
      targetSubjectId: "subject-a",
    }))).resolves.toEqual({
      status: "RESERVED",
      providerRunId: "provider-run-1",
      reservedChargeUsd: 0,
    })

    expect(tx.$queryRaw).not.toHaveBeenCalled()
    expect(tx.socialProviderRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        schemaVersion: "paid-route-provider-account-v1",
        maxTotalChargeUsd: 0,
        dailyBudgetUsd: null,
        monthlyBudgetUsd: null,
        inputSnapshot: expect.objectContaining({
          manualRun: true,
          clientFundedManual: true,
          providerAccountBudget: true,
          targetScenarioId: "scenario-a",
          targetSubjectId: "subject-a",
        }),
      }),
      select: { id: true },
    })
  })

  it("blocks when the next reservation would exceed the daily limit", async () => {
    tx.$queryRaw
      .mockResolvedValueOnce([{ reservedChargeUsd: 1.8, actualChargeUsd: 0 }])
      .mockResolvedValueOnce([{ reservedChargeUsd: 1.8, actualChargeUsd: 0 }])

    await expect(reservePaidRouteBudget(input())).resolves.toEqual({
      status: "BLOCKED",
      reason: "paid_route_daily_budget_exhausted",
    })
    expect(tx.socialProviderRun.create).not.toHaveBeenCalled()
  })

  it("keeps hidden pre-reset provider spend in the daily budget gate", async () => {
    const carry = resetCarry({
      provider: {
        dayChargeUsd: 1.8,
        monthChargeUsd: 1.8,
        runsToday: 1,
      },
    })
    tx.$queryRaw.mockResolvedValue([{
      reservedChargeUsd: 0,
      actualChargeUsd: 0,
      resetNewValue: carry,
      resetCreatedAt: new Date("2026-07-12T10:00:00.000Z"),
    }])

    await expect(reservePaidRouteBudget(input())).resolves.toEqual({
      status: "BLOCKED",
      reason: "paid_route_daily_budget_exhausted",
    })
    expect(tx.socialProviderRun.create).not.toHaveBeenCalled()
  })

  it("blocks a manual capped run when shared daily exposure is exhausted", async () => {
    tx.$queryRaw
      .mockResolvedValueOnce([{ reservedChargeUsd: 3.95, actualChargeUsd: 0 }])
      .mockResolvedValueOnce([{ reservedChargeUsd: 3.95, actualChargeUsd: 0 }])
    await expect(reservePaidRouteBudget(input({ manualMaxTotalChargeUsd: 0.1 }))).resolves.toEqual({
      status: "BLOCKED",
      reason: "paid_route_daily_budget_exhausted",
    })
    expect(tx.socialProviderRun.create).not.toHaveBeenCalled()
  })

  it("clamps an oversized automatic route to the immutable $4 run ceiling", async () => {
    await expect(reservePaidRouteBudget(input({
      budget: { usdLimitsConfigured: true, maxTotalChargeUsd: 100, dailyBudgetUsd: 10_000, monthlyBudgetUsd: 100_000 },
    }))).resolves.toMatchObject({ status: "RESERVED", reservedChargeUsd: 4 })
    expect(tx.socialProviderRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ maxTotalChargeUsd: 4, dailyBudgetUsd: 4, monthlyBudgetUsd: 120 }),
      select: { id: true },
    })
  })

  it("blocks on the monthly cap independently of the daily cap", async () => {
    tx.$queryRaw
      .mockResolvedValueOnce([{ reservedChargeUsd: 0, actualChargeUsd: 0 }])
      .mockResolvedValueOnce([{ reservedChargeUsd: 19.8, actualChargeUsd: 0 }])

    await expect(reservePaidRouteBudget(input())).resolves.toEqual({
      status: "BLOCKED",
      reason: "paid_route_monthly_budget_exhausted",
    })
  })

  it("does not dispatch the same collector route twice", async () => {
    tx.socialProviderRun.findUnique.mockResolvedValue({ id: "provider-run-existing" })
    await expect(reservePaidRouteBudget(input())).resolves.toEqual({
      status: "BLOCKED",
      reason: "paid_route_already_attempted",
    })
    expect(tx.$queryRaw).not.toHaveBeenCalled()
  })

  it("finalizes counts without pretending an estimated reservation is an actual charge", async () => {
    await finishPaidRouteBudgetReservation("org-1", "provider-run-1", {
      status: "success",
      foundCount: 10,
      newCount: 4,
      duplicateCount: 3,
      ignoredCount: 3,
    })
    expect(prisma.socialProviderRun.updateMany).toHaveBeenCalledWith({
      where: { id: "provider-run-1", organizationId: "org-1", status: { in: ["QUEUED", "RUNNING"] } },
      data: expect.objectContaining({
        status: "SUCCEEDED",
        receivedCount: 10,
        acceptedCount: 4,
        duplicateCount: 3,
        rejectedCount: 3,
        finishedAt: expect.any(Date),
        inputSnapshot: expect.objectContaining({ providerRequestDispatched: true }),
      }),
    })
    const data = prisma.socialProviderRun.updateMany.mock.calls[0][0].data
    expect(data.actualChargeUsd).toBeUndefined()
    expect(data.reservedChargeUsd).toBeUndefined()
  })

  it("fails a partially persisted run when the paid dispatch outcome is unknown", async () => {
    await finishPaidRouteBudgetReservation("org-1", "provider-run-1", {
      status: "partial",
      foundCount: 3,
      newCount: 2,
      duplicateCount: 1,
      ignoredCount: 0,
      error: "x_api_timeout",
      rawStats: { providerRequestDispatched: true, dispatchUnknown: true },
    })

    expect(prisma.socialProviderRun.updateMany).toHaveBeenCalledWith({
      where: { id: "provider-run-1", organizationId: "org-1", status: { in: ["QUEUED", "RUNNING"] } },
      data: expect.objectContaining({
        status: "FAILED",
        receivedCount: 3,
        acceptedCount: 2,
        duplicateCount: 1,
        lastError: "x_api_timeout",
        inputSnapshot: expect.objectContaining({ providerRequestDispatched: true }),
      }),
    })
    const data = prisma.socialProviderRun.updateMany.mock.calls[0][0].data
    expect(data.actualChargeUsd).toBeUndefined()
    expect(data.reservedChargeUsd).toBeUndefined()
  })

  it("keeps the durable dispatch marker fail-closed when an unknown result claims no request", async () => {
    await finishPaidRouteBudgetReservation("org-1", "provider-run-1", {
      status: "failed",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: "x_api_transport_unknown",
      rawStats: { providerRequestDispatched: false, dispatchUnknown: true },
    })

    const data = prisma.socialProviderRun.updateMany.mock.calls[0][0].data
    expect(data.inputSnapshot).toEqual(expect.objectContaining({ providerRequestDispatched: true }))
    expect(data.reservedChargeUsd).toBeUndefined()
    expect(data.actualChargeUsd).toBeUndefined()
  })

  it("fails closed if a synchronous paid ledger changes before fenced settlement", async () => {
    prisma.socialProviderRun.updateMany.mockResolvedValueOnce({ count: 0 })

    await expect(finishPaidRouteBudgetReservation("org-1", "provider-run-1", {
      status: "success",
      foundCount: 1,
      newCount: 1,
      duplicateCount: 0,
      ignoredCount: 0,
      rawStats: { providerRequestDispatched: true },
    })).rejects.toThrow("paid_route_budget_settlement_state_changed")
  })

  it("keeps an async Bright Data reservation running for reconciliation", async () => {
    await finishPaidRouteBudgetReservation("org-1", "provider-run-1", {
      status: "partial",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: "bright_data_snapshot_pending",
      rawStats: { providerRequestDispatched: true, asyncPending: true },
    })

    expect(prisma.socialProviderRun.findFirst).not.toHaveBeenCalled()
    expect(prisma.socialProviderRun.updateMany).not.toHaveBeenCalled()
  })

  it("releases a reservation when no provider request was dispatched", async () => {
    await finishPaidRouteBudgetReservation("org-1", "provider-run-1", {
      status: "success",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      rawStats: { providerRequestDispatched: false, noOp: true },
    })

    expect(prisma.socialProviderRun.updateMany).toHaveBeenCalledWith({
      where: {
        id: "provider-run-1",
        organizationId: "org-1",
        status: { in: ["QUEUED", "RUNNING"] },
        externalRunId: null,
        OR: [
          { actualChargeUsd: null },
          { actualChargeUsd: { lte: 0 } },
        ],
      },
      data: expect.objectContaining({
        status: "SUCCEEDED",
        actualChargeUsd: 0,
        reservedChargeUsd: 0,
        inputSnapshot: expect.objectContaining({ providerRequestDispatched: false }),
      }),
    })
  })

  it("marks an emergency-stopped pre-dispatch reservation blocked with zero exposure", async () => {
    await finishPaidRouteBudgetReservation("org-1", "provider-run-1", {
      status: "skipped",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: "paid_run_emergency_stopped_before_dispatch",
      rawStats: { providerRequestDispatched: false, failClosed: true },
    })

    expect(prisma.socialProviderRun.updateMany).toHaveBeenCalledWith({
      where: {
        id: "provider-run-1",
        organizationId: "org-1",
        status: { in: ["QUEUED", "RUNNING"] },
        externalRunId: null,
        OR: [
          { actualChargeUsd: null },
          { actualChargeUsd: { lte: 0 } },
        ],
      },
      data: expect.objectContaining({
        status: "BLOCKED",
        actualChargeUsd: 0,
        reservedChargeUsd: 0,
        lastError: "paid_run_emergency_stopped_before_dispatch",
        inputSnapshot: expect.objectContaining({ providerRequestDispatched: false }),
      }),
    })
  })

  it("steps a finished Bright Data reservation down to its record-based estimate", async () => {
    vi.stubEnv("BRIGHT_DATA_PRICE_SNAPSHOT_ID", "price-1")
    vi.stubEnv("BRIGHT_DATA_PRICE_EFFECTIVE_AT", "2026-07-01T00:00:00.000Z")
    vi.stubEnv("BRIGHT_DATA_USD_PER_1000_RECORDS", "2")
    vi.stubEnv("BRIGHT_DATA_PRICE_SOURCE_URL", "https://brightdata.com/pricing")
    prisma.socialProviderRun.findFirst.mockResolvedValue({
      adapterKey: "BRIGHT_DATA_SNAPSHOT",
      reservedChargeUsd: 0.5,
      inputSnapshot: { providerAccountBudget: true },
    })

    await finishPaidRouteBudgetReservation("org-1", "provider-run-1", {
      status: "partial",
      foundCount: 100,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
    })

    // 100 records × $2/1000 = $0.20, released from the $0.50 held cap.
    const data = prisma.socialProviderRun.updateMany.mock.calls[0][0].data
    expect(data.reservedChargeUsd).toBeCloseTo(0.2, 6)
    expect(data.actualChargeUsd).toBeUndefined()
  })

  it("keeps the full Bright Data reservation when dispatch outcome is unknown", async () => {
    vi.stubEnv("BRIGHT_DATA_PRICE_SNAPSHOT_ID", "price-1")
    vi.stubEnv("BRIGHT_DATA_PRICE_EFFECTIVE_AT", "2026-07-01T00:00:00.000Z")
    vi.stubEnv("BRIGHT_DATA_USD_PER_1000_RECORDS", "2")
    vi.stubEnv("BRIGHT_DATA_PRICE_SOURCE_URL", "https://brightdata.com/pricing")
    prisma.socialProviderRun.findFirst.mockResolvedValue({
      adapterKey: "BRIGHT_DATA_SNAPSHOT",
      reservedChargeUsd: 0.5,
      inputSnapshot: { providerAccountBudget: true },
    })

    await finishPaidRouteBudgetReservation("org-1", "provider-run-1", {
      status: "partial",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      error: "bright_data_timeout",
      rawStats: { providerRequestDispatched: true, dispatchUnknown: true },
    })

    expect(prisma.socialProviderRun.findFirst).toHaveBeenCalledOnce()
    const data = prisma.socialProviderRun.updateMany.mock.calls[0][0].data
    expect(data.status).toBe("RUNNING")
    expect(data.finishedAt).toBeNull()
    expect(data.actualChargeUsd).toBeUndefined()
    expect(data.reservedChargeUsd).toBeUndefined()
  })

  it("never raises a Bright Data reservation above what was held", async () => {
    vi.stubEnv("BRIGHT_DATA_PRICE_SNAPSHOT_ID", "price-1")
    vi.stubEnv("BRIGHT_DATA_PRICE_EFFECTIVE_AT", "2026-07-01T00:00:00.000Z")
    vi.stubEnv("BRIGHT_DATA_USD_PER_1000_RECORDS", "2")
    vi.stubEnv("BRIGHT_DATA_PRICE_SOURCE_URL", "https://brightdata.com/pricing")
    prisma.socialProviderRun.findFirst.mockResolvedValue({
      adapterKey: "BRIGHT_DATA_SNAPSHOT",
      reservedChargeUsd: 0.05,
      inputSnapshot: { providerAccountBudget: true },
    })

    await finishPaidRouteBudgetReservation("org-1", "provider-run-1", {
      status: "partial",
      foundCount: 1000, // estimate $2.00, but only $0.05 was reserved
      newCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
    })

    const data = prisma.socialProviderRun.updateMany.mock.calls[0][0].data
    expect(data.reservedChargeUsd).toBeCloseTo(0.05, 6)
  })

  it("reserves a provider-account Bright Data run without consuming a local quota", async () => {
    prisma.organization.findUnique.mockResolvedValue(quotaSettings(3))
    await expect(reservePaidRouteBudget(input({
      adapterKey: "BRIGHT_DATA_SNAPSHOT",
      providerKey: "bright-data",
      budget: { usdLimitsConfigured: false },
    }))).resolves.toEqual({ status: "RESERVED", providerRunId: "provider-run-1", reservedChargeUsd: 0 })

    expect(tx.$queryRaw).not.toHaveBeenCalled()
    expect(tx.socialProviderRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ reservedChargeUsd: 0, maxTotalChargeUsd: 0, dailyBudgetUsd: null, monthlyBudgetUsd: null }),
      select: { id: true },
    })
  })

  it("does not truncate Bright Data when the local daily run-count quota is exhausted", async () => {
    prisma.organization.findUnique.mockResolvedValue(quotaSettings(3))
    tx.$queryRaw.mockResolvedValueOnce([
      { collectorRunId: "run-a" },
      { collectorRunId: "run-b" },
      { collectorRunId: "run-c" },
    ])
    await expect(reservePaidRouteBudget(input({
      adapterKey: "BRIGHT_DATA_SNAPSHOT",
      providerKey: "bright-data",
      budget: { usdLimitsConfigured: false },
    }))).resolves.toEqual({ status: "RESERVED", providerRunId: "provider-run-1", reservedChargeUsd: 0 })
    expect(tx.$queryRaw).not.toHaveBeenCalled()
    expect(tx.socialProviderRun.create).toHaveBeenCalledOnce()
  })

  it("does not count the current in-progress scan against its own quota", async () => {
    prisma.organization.findUnique.mockResolvedValue(quotaSettings(1))
    tx.$queryRaw.mockResolvedValueOnce([{ collectorRunId: "collector-1" }])
    await expect(reservePaidRouteBudget(input({
      adapterKey: "BRIGHT_DATA_SNAPSHOT",
      providerKey: "bright-data",
      budget: { usdLimitsConfigured: false },
    }))).resolves.toMatchObject({ status: "RESERVED", providerRunId: "provider-run-1" })
  })

  it("keeps hidden pre-reset scans in the daily run-count quota", async () => {
    prisma.organization.findUnique.mockResolvedValue(quotaSettings(1))
    const carry = resetCarry({
      provider: {
        dayChargeUsd: 0,
        monthChargeUsd: 0,
        runsToday: 1,
      },
    })
    tx.$queryRaw.mockImplementation(async (query: { text?: string; sql?: string }) => {
      const statement = query.text ?? query.sql ?? ""
      if (statement.includes("SELECT DISTINCT")) {
        return [{
          collectorRunId: null,
          resetNewValue: carry,
          resetCreatedAt: new Date("2026-07-12T10:00:00.000Z"),
        }]
      }
      return [{
        reservedChargeUsd: 0,
        actualChargeUsd: 0,
        resetNewValue: carry,
        resetCreatedAt: new Date("2026-07-12T10:00:00.000Z"),
      }]
    })

    await expect(reservePaidRouteBudget(input())).resolves.toEqual({
      status: "BLOCKED",
      reason: "paid_run_daily_quota_exhausted",
    })
    expect(tx.socialProviderRun.create).not.toHaveBeenCalled()
  })

  it("blocks quota-governed runs when the tenant emergency stop is active", async () => {
    prisma.organization.findUnique.mockResolvedValue({
      settings: {
        socialMonitoringPaidRuns: {
          manualRunsEnabled: true,
          emergencyStopped: true,
          dailyRunQuota: 3,
          authorizedAt: "2026-07-19T00:00:00.000Z",
          authorizedBy: "admin-1",
        },
      },
    })
    await expect(reservePaidRouteBudget(input({
      adapterKey: "BRIGHT_DATA_SNAPSHOT",
      providerKey: "bright-data",
      budget: { usdLimitsConfigured: false },
    }))).resolves.toEqual({ status: "BLOCKED", reason: "paid_run_emergency_stopped" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})
