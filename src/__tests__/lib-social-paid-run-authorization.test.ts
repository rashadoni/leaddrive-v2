import { beforeEach, describe, expect, it, vi } from "vitest"

const tx = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  $queryRaw: vi.fn(),
  organization: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  auditLog: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  socialProviderRun: {
    findMany: vi.fn(),
  },
}))

const mockPrisma = vi.hoisted(() => ({
  $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  organization: { findUnique: vi.fn() },
}))

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))

import {
  authorizeTenantManualPaidRun,
  finalizeTenantManualPaidRunAuthorization,
  getTenantPaidRunReport,
  parseTenantPaidRunPolicy,
  tenantProviderAccountFundedRunPolicy,
  updateTenantPaidRunPolicy,
} from "@/lib/social/paid-run-authorization"

const enabledSettings = {
  unrelated: { keep: true },
  socialMonitoringPaidRuns: {
    policyVersion: 3,
    manualRunsEnabled: true,
    emergencyStopped: false,
    maxPerRunUsd: 1,
    dailyBudgetUsd: 4,
    monthlyBudgetUsd: 20,
    authorizedAt: "2026-07-18T12:00:00.000Z",
    authorizedBy: "admin-1",
    updatedAt: "2026-07-18T12:00:00.000Z",
    updatedBy: "admin-1",
  },
}

function resetCarry(overrides: Record<string, unknown> = {}) {
  return {
    budgetCarryForward: {
      schemaVersion: "social-monitoring-budget-carry-v1",
      capturedAt: "2026-07-18T12:01:00.000Z",
      utcDayStart: "2026-07-18T00:00:00.000Z",
      utcMonthStart: "2026-07-01T00:00:00.000Z",
      provider: {
        dayChargeUsd: 1,
        monthChargeUsd: 3,
        runsToday: 1,
      },
      paidRunAuthorization: {
        dayReservedUsd: 3.75,
        monthReservedUsd: 8,
        runsToday: 1,
      },
      media: {
        dayCostUsd: 0.02,
        monthCostUsd: 0.1,
      },
      ai: {
        dayCostUsd: 0.03,
        monthCostUsd: 0.15,
      },
      ...overrides,
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("SOCIAL_MONITORING_ENFORCE_USD_BUDGETS", "1")
  tx.organization.findUnique.mockResolvedValue({ settings: enabledSettings })
  tx.organization.update.mockResolvedValue({ id: "org-1" })
  tx.auditLog.findMany.mockResolvedValue([])
  tx.auditLog.findFirst.mockResolvedValue(null)
  tx.auditLog.create.mockResolvedValue({ id: "audit-1" })
  tx.$queryRaw.mockResolvedValue([])
  tx.socialProviderRun.findMany.mockResolvedValue([])
})

describe("tenant paid-run authorization", () => {
  it("parses absent policy as fail-closed", () => {
    expect(parseTenantPaidRunPolicy({})).toEqual(expect.objectContaining({
      policyVersion: 1,
      manualRunsEnabled: false,
      clientFundedManualRunsEnabled: false,
      emergencyStopped: true,
      maxPerRunUsd: 0,
      dailyBudgetUsd: 0,
      monthlyBudgetUsd: 0,
    }))
  })

  it("forces a stored enabled policy closed when its limits exceed hard ceilings", () => {
    expect(parseTenantPaidRunPolicy({
      socialMonitoringPaidRuns: {
        ...enabledSettings.socialMonitoringPaidRuns,
        maxPerRunUsd: 101,
        dailyBudgetUsd: 101,
      },
    })).toMatchObject({ manualRunsEnabled: false, emergencyStopped: true })
  })

  it("locks clean-slate dispatch before the generic paid-run policy lock", async () => {
    await expect(updateTenantPaidRunPolicy("org-1", "admin-1", {
      manualRunsEnabled: false,
      emergencyStopped: true,
    })).resolves.toMatchObject({
      manualRunsEnabled: false,
      emergencyStopped: true,
    })

    expect(tx.$executeRaw).toHaveBeenCalledTimes(2)
    expect(tx.$executeRaw.mock.calls.map(call => call[1])).toEqual([
      "social-monitoring-clean-slate:org-1",
      "social-paid-runs:org-1",
    ])
    expect(mockPrisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      {
        maxWait: 30_000,
        timeout: 90_000,
      },
    )
  })

  it("requires an explicit confirmation when an admin enables paid manual runs", async () => {
    tx.organization.findUnique.mockResolvedValue({ settings: {} })
    await expect(updateTenantPaidRunPolicy("org-1", "admin-1", {
      manualRunsEnabled: true,
      emergencyStopped: false,
      maxPerRunUsd: 1,
      dailyBudgetUsd: 4,
      monthlyBudgetUsd: 20,
    })).rejects.toThrow("paid_manual_run_authorization_confirmation_required")
    expect(tx.organization.update).not.toHaveBeenCalled()
    expect(tx.auditLog.create).not.toHaveBeenCalled()
  })

  it("persists a versioned tenant policy and its actor audit without dropping unrelated settings", async () => {
    tx.organization.findUnique.mockResolvedValue({ settings: { unrelated: { keep: true } } })
    const updated = await updateTenantPaidRunPolicy("org-1", "admin-1", {
      manualRunsEnabled: true,
      emergencyStopped: false,
      maxPerRunUsd: 1,
      dailyBudgetUsd: 4,
      monthlyBudgetUsd: 20,
      authorizationConfirmed: true,
    }, new Date("2026-07-18T13:00:00.000Z"))

    expect(updated).toMatchObject({ policyVersion: 2, manualRunsEnabled: true, authorizedBy: "admin-1" })
    expect(tx.organization.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "org-1" },
      data: { settings: expect.objectContaining({ unrelated: { keep: true }, socialMonitoringPaidRuns: expect.objectContaining({ dailyBudgetUsd: 4 }) }) },
    }))
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ organizationId: "org-1", userId: "admin-1", action: "update", entityType: "social_paid_run_policy" }),
    }))
  })

  it("requires renewed confirmation before raising an enabled tenant budget", async () => {
    await expect(updateTenantPaidRunPolicy("org-1", "admin-1", {
      dailyBudgetUsd: 5,
    })).rejects.toThrow("paid_manual_run_authorization_confirmation_required")
    expect(tx.organization.update).not.toHaveBeenCalled()
    expect(tx.auditLog.create).not.toHaveBeenCalled()
  })

  it("requires renewed confirmation before clearing an active emergency stop", async () => {
    tx.organization.findUnique.mockResolvedValue({
      settings: {
        socialMonitoringPaidRuns: {
          ...enabledSettings.socialMonitoringPaidRuns,
          emergencyStopped: true,
        },
      },
    })
    await expect(updateTenantPaidRunPolicy("org-1", "admin-1", {
      emergencyStopped: false,
    })).rejects.toThrow("paid_manual_run_authorization_confirmation_required")
    expect(tx.organization.update).not.toHaveBeenCalled()
    expect(tx.auditLog.create).not.toHaveBeenCalled()
  })

  it("atomically clears the clean-slate collection fence on a confirmed resume", async () => {
    tx.organization.findUnique.mockResolvedValue({
      settings: {
        unrelated: { keep: true },
        socialMonitoringPaidRuns: {
          ...enabledSettings.socialMonitoringPaidRuns,
          emergencyStopped: true,
        },
        socialMonitoringCleanSlate: {
          collectionBlocked: true,
          requestedAt: "2026-07-28T10:00:00.000Z",
          reason: "operator_clean_slate_reset",
        },
      },
    })
    const resumedAt = new Date("2026-07-28T12:00:00.000Z")

    await expect(updateTenantPaidRunPolicy("org-1", "admin-2", {
      emergencyStopped: false,
      authorizationConfirmed: true,
    }, resumedAt)).resolves.toMatchObject({
      emergencyStopped: false,
      authorizedBy: "admin-2",
    })

    expect(tx.organization.update).toHaveBeenCalledWith({
      where: { id: "org-1" },
      data: {
        settings: expect.objectContaining({
          unrelated: { keep: true },
          socialMonitoringPaidRuns: expect.objectContaining({ emergencyStopped: false }),
          socialMonitoringCleanSlate: expect.objectContaining({
            collectionBlocked: false,
            resumedAt: resumedAt.toISOString(),
            resumedBy: "admin-2",
            reason: "operator_clean_slate_reset",
          }),
        }),
      },
    })
  })

  it("blocks a one-shot cap when tenant authorization is absent", async () => {
    tx.organization.findUnique.mockResolvedValue({ settings: {} })
    await expect(authorizeTenantManualPaidRun({
      organizationId: "org-1",
      sourceId: "source-1",
      requestedByUserId: "user-1",
      maxTotalChargeUsd: 0.5,
    })).resolves.toEqual({ status: "BLOCKED", reason: "paid_manual_runs_not_authorized" })
    expect(tx.auditLog.create).not.toHaveBeenCalled()
  })

  it("authorizes an audited client-funded run without consulting tenant numeric or run-count usage", async () => {
    tx.organization.findUnique.mockResolvedValue({
      settings: {
        socialMonitoringPaidRuns: {
          policyVersion: 9,
          manualRunsEnabled: false,
          clientFundedManualRunsEnabled: true,
          emergencyStopped: false,
          maxPerRunUsd: 0.01,
          dailyBudgetUsd: 0.01,
          monthlyBudgetUsd: 0.01,
          dailyRunQuota: 1,
        },
      },
    })
    tx.auditLog.findMany.mockResolvedValue([
      {
        action: "authorize",
        entityId: "tenant-budget-exhausted",
        newValue: { maxTotalChargeUsd: 10_000 },
        createdAt: new Date("2026-07-23T01:00:00.000Z"),
      },
    ])
    tx.socialProviderRun.findMany.mockResolvedValue([{ collectorRunId: "tenant-quota-exhausted" }])

    await expect(authorizeTenantManualPaidRun({
      organizationId: "org-1",
      sourceId: "source-client-funded",
      requestedByUserId: "admin-1",
      maxTotalChargeUsd: 100,
      clientFundedManual: true,
      now: new Date("2026-07-23T12:00:00.000Z"),
    })).resolves.toMatchObject({
      status: "AUTHORIZED",
      maxTotalChargeUsd: 100,
      policyVersion: 0,
    })

    expect(tx.auditLog.findMany).not.toHaveBeenCalled()
    expect(tx.$queryRaw).not.toHaveBeenCalled()
    expect(tx.socialProviderRun.findMany).not.toHaveBeenCalled()
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-1",
        userId: "admin-1",
        action: "authorize",
        entityType: "social_paid_run_authorization",
        entityName: "source-client-funded",
        newValue: expect.objectContaining({
          maxTotalChargeUsd: 100,
          clientFundedManual: true,
          automaticCollectionEnabled: false,
          providerRequestFuseUsd: 100,
        }),
      }),
    }))
  })

  it("keeps the tenant emergency stop authoritative for client-funded manual runs", async () => {
    tx.organization.findUnique.mockResolvedValue({
      settings: {
        socialMonitoringPaidRuns: {
          manualRunsEnabled: false,
          clientFundedManualRunsEnabled: true,
          emergencyStopped: true,
        },
      },
    })

    await expect(authorizeTenantManualPaidRun({
      organizationId: "org-1",
      sourceId: "source-client-funded",
      requestedByUserId: "admin-1",
      maxTotalChargeUsd: 100,
      clientFundedManual: true,
    })).resolves.toEqual({
      status: "BLOCKED",
      reason: "paid_manual_run_emergency_stopped",
    })
    expect(tx.auditLog.findMany).not.toHaveBeenCalled()
    expect(tx.socialProviderRun.findMany).not.toHaveBeenCalled()
    expect(tx.auditLog.create).not.toHaveBeenCalled()
  })

  it("requires an operator-only tenant opt-in for provider-billed manual runs", async () => {
    tx.organization.findUnique.mockResolvedValue({
      settings: {
        socialMonitoringPaidRuns: {
          manualRunsEnabled: false,
          clientFundedManualRunsEnabled: false,
          emergencyStopped: false,
        },
      },
    })

    await expect(authorizeTenantManualPaidRun({
      organizationId: "org-1",
      sourceId: "source-client-funded",
      requestedByUserId: "admin-1",
      maxTotalChargeUsd: 100,
      clientFundedManual: true,
    })).resolves.toEqual({
      status: "BLOCKED",
      reason: "paid_client_funded_manual_not_authorized",
    })
    expect(tx.auditLog.create).not.toHaveBeenCalled()
  })

  it("keeps global paid-budget enforcement authoritative for client-funded manual runs", async () => {
    vi.stubEnv("SOCIAL_MONITORING_ENFORCE_USD_BUDGETS", "0")

    await expect(authorizeTenantManualPaidRun({
      organizationId: "org-1",
      sourceId: "source-client-funded",
      requestedByUserId: "admin-1",
      maxTotalChargeUsd: 100,
      clientFundedManual: true,
    })).resolves.toEqual({
      status: "BLOCKED",
      reason: "paid_route_budget_enforcement_disabled",
    })
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    expect(tx.auditLog.create).not.toHaveBeenCalled()
  })

  it("blocks a manual run when prior authorizations exhausted the shared daily ceiling", async () => {
    tx.auditLog.findMany.mockResolvedValue([
      { action: "authorize", entityId: "auth-a", newValue: { maxTotalChargeUsd: 2 }, createdAt: new Date("2026-07-18T01:00:00.000Z") },
      { action: "authorize", entityId: "auth-b", newValue: { maxTotalChargeUsd: 1.75 }, createdAt: new Date("2026-07-18T02:00:00.000Z") },
    ])
    await expect(authorizeTenantManualPaidRun({
      organizationId: "org-1",
      sourceId: "source-c",
      requestedByUserId: "user-1",
      maxTotalChargeUsd: 0.75,
      now: new Date("2026-07-18T12:00:00.000Z"),
    })).resolves.toEqual({ status: "BLOCKED", reason: "paid_route_daily_budget_exhausted" })
    expect(tx.auditLog.create).not.toHaveBeenCalled()
  })

  it("reconciles a dispatched terminal authorization from a legacy collection phase", async () => {
    tx.auditLog.findMany.mockResolvedValue([
      { action: "authorize", entityId: "auth-a", newValue: { maxTotalChargeUsd: 4 }, createdAt: new Date("2026-07-18T01:00:00.000Z") },
      { action: "complete", entityId: "auth-a", newValue: { collectorRunId: "collector-a", providerRequestDispatched: true }, createdAt: new Date("2026-07-18T01:05:00.000Z") },
    ])
    tx.socialProviderRun.findMany.mockImplementation(async (args: { where?: { collectorRunId?: unknown } }) => (
      args.where?.collectorRunId
        ? [{ collectorRunId: "collector-a", phase: "DISCOVER_CANDIDATE_POSTS", status: "IMPORTED", reservedChargeUsd: 0, actualChargeUsd: 0.35 }]
        : []
    ))

    await expect(authorizeTenantManualPaidRun({
      organizationId: "org-1",
      sourceId: "source-b",
      requestedByUserId: "user-1",
      maxTotalChargeUsd: 1,
      now: new Date("2026-07-18T12:00:00.000Z"),
    })).resolves.toMatchObject({ status: "AUTHORIZED", maxTotalChargeUsd: 1 })
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "authorize",
        newValue: expect.objectContaining({ dayReservedBeforeUsd: 0.35, monthReservedBeforeUsd: 0.35 }),
      }),
    }))
    const exposureLookup = tx.socialProviderRun.findMany.mock.calls.find(([args]) => args.where?.collectorRunId)
    expect(exposureLookup?.[0].where).not.toHaveProperty("phase")
    expect(exposureLookup?.[0].where).toMatchObject({ purgedAt: null })
  })

  it("keeps the full cap for active, missing, and unknown provider states", async () => {
    tx.auditLog.findMany.mockResolvedValue([
      { action: "authorize", entityId: "auth-active", newValue: { maxTotalChargeUsd: 1 }, createdAt: new Date("2026-07-18T01:00:00.000Z") },
      { action: "complete", entityId: "auth-active", newValue: { collectorRunId: "collector-active", providerRequestDispatched: true }, createdAt: new Date("2026-07-18T01:05:00.000Z") },
      { action: "authorize", entityId: "auth-missing", newValue: { maxTotalChargeUsd: 1 }, createdAt: new Date("2026-07-18T02:00:00.000Z") },
      { action: "complete", entityId: "auth-missing", newValue: { collectorRunId: "collector-missing", providerRequestDispatched: true }, createdAt: new Date("2026-07-18T02:05:00.000Z") },
      { action: "authorize", entityId: "auth-unknown", newValue: { maxTotalChargeUsd: 1 }, createdAt: new Date("2026-07-18T03:00:00.000Z") },
      { action: "complete", entityId: "auth-unknown", newValue: { collectorRunId: "collector-unknown", providerRequestDispatched: true }, createdAt: new Date("2026-07-18T03:05:00.000Z") },
    ])
    tx.socialProviderRun.findMany.mockImplementation(async (args: { where?: { collectorRunId?: unknown } }) => (
      args.where?.collectorRunId
        ? [
            { collectorRunId: "collector-active", status: "RUNNING", reservedChargeUsd: 1, actualChargeUsd: null },
            { collectorRunId: "collector-unknown", status: "AWAITING_SETTLEMENT", reservedChargeUsd: 0, actualChargeUsd: 0 },
          ]
        : []
    ))

    await expect(authorizeTenantManualPaidRun({
      organizationId: "org-1",
      sourceId: "source-d",
      requestedByUserId: "user-1",
      maxTotalChargeUsd: 1.5,
      now: new Date("2026-07-18T12:00:00.000Z"),
    })).resolves.toEqual({ status: "BLOCKED", reason: "paid_manual_run_cap_exceeds_tenant_limit" })

    const report = await getTenantPaidRunReport("org-1", new Date("2026-07-18T12:00:00.000Z"))
    expect(report.usage).toMatchObject({ dayReservedUsd: 3, monthReservedUsd: 3 })
  })

  it("bounds legacy authorization caps before retaining unresolved exposure", async () => {
    tx.auditLog.findMany.mockResolvedValue([
      { action: "authorize", entityId: "auth-legacy", newValue: { maxTotalChargeUsd: 50 }, createdAt: new Date("2026-07-18T01:00:00.000Z") },
    ])

    const report = await getTenantPaidRunReport("org-1", new Date("2026-07-18T12:00:00.000Z"))
    expect(report.usage).toMatchObject({ dayReservedUsd: 4, monthReservedUsd: 4 })
  })

  it("clamps a tenant-authorized manual request to the immutable $4 run ceiling", async () => {
    tx.organization.findUnique.mockResolvedValue({
      settings: {
        socialMonitoringPaidRuns: {
          ...enabledSettings.socialMonitoringPaidRuns,
          maxPerRunUsd: 10,
          dailyBudgetUsd: 10,
          monthlyBudgetUsd: 100,
        },
      },
    })
    await expect(authorizeTenantManualPaidRun({
      organizationId: "org-1",
      sourceId: "source-1",
      requestedByUserId: "user-1",
      maxTotalChargeUsd: 10,
      now: new Date("2026-07-18T12:00:00.000Z"),
    })).resolves.toMatchObject({ status: "AUTHORIZED", maxTotalChargeUsd: 4 })
  })

  it("still blocks a one-shot cap above the tenant per-run limit", async () => {
    await expect(authorizeTenantManualPaidRun({
      organizationId: "org-1",
      sourceId: "source-c",
      requestedByUserId: "user-1",
      maxTotalChargeUsd: 2,
      now: new Date("2026-07-18T12:00:00.000Z"),
    })).resolves.toEqual({ status: "BLOCKED", reason: "paid_manual_run_cap_exceeds_tenant_limit" })
    expect(tx.auditLog.create).not.toHaveBeenCalled()
  })

  it("reserves and audits an allowed one-shot cap with actor and policy snapshot", async () => {
    const result = await authorizeTenantManualPaidRun({
      organizationId: "org-1",
      sourceId: "source-1",
      requestedByUserId: "user-1",
      maxTotalChargeUsd: 0.5,
      now: new Date("2026-07-18T12:00:00.000Z"),
    })
    expect(result).toMatchObject({ status: "AUTHORIZED", maxTotalChargeUsd: 0.5, policyVersion: 3 })
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-1",
        userId: "user-1",
        action: "authorize",
        entityType: "social_paid_run_authorization",
        entityName: "source-1",
        newValue: expect.objectContaining({ maxTotalChargeUsd: 0.5, tenantDailyBudgetUsd: 4 }),
      }),
    }))
  })

  it("releases the full reservation when no provider request was dispatched", async () => {
    await finalizeTenantManualPaidRunAuthorization({
      organizationId: "org-1",
      authorizationId: "authorization-1",
      requestedByUserId: "user-1",
      collectorRunId: "collector-1",
      outcome: "partial",
      providerRequestDispatched: false,
      maxTotalChargeUsd: 0.5,
      now: new Date("2026-07-18T12:05:00.000Z"),
    })
    expect(tx.auditLog.create).toHaveBeenCalledTimes(2)
    expect(tx.auditLog.create).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "release", newValue: expect.objectContaining({ releasedChargeUsd: 0.5 }) }),
    }))
  })

  it("reports tenant usage and recent authorization status with tenant-scoped filters", async () => {
    tx.auditLog.findMany
      .mockResolvedValueOnce([
        { action: "authorize", entityId: "authorization-1", newValue: { maxTotalChargeUsd: 0.5 }, createdAt: new Date("2026-07-18T12:00:00.000Z") },
      ])
      .mockResolvedValueOnce([
        { userId: "user-1", action: "complete", entityId: "authorization-1", entityName: null, newValue: { collectorRunId: "collector-1", outcome: "success", providerRequestDispatched: true }, createdAt: new Date("2026-07-18T12:05:00.000Z") },
        { userId: "user-1", action: "authorize", entityId: "authorization-1", entityName: "source-1", newValue: { sourceId: "source-1", maxTotalChargeUsd: 0.5, policyVersion: 3 }, createdAt: new Date("2026-07-18T12:00:00.000Z") },
      ])
    const report = await getTenantPaidRunReport("org-1", new Date("2026-07-18T13:00:00.000Z"))
    expect(report.usage).toMatchObject({ dayReservedUsd: 0.5, monthReservedUsd: 0.5 })
    expect(report.recentAuthorizations[0]).toMatchObject({ authorizationId: "authorization-1", status: "DISPATCHED", collectorRunId: "collector-1" })
    expect(tx.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-1" }) }))
  })

  it("starts usage and recent authorization history at the latest reset boundary", async () => {
    const resetAt = new Date("2026-07-18T12:01:00.000Z")
    tx.auditLog.findFirst.mockResolvedValue({
      newValue: { resetAt: resetAt.toISOString() },
      createdAt: new Date("2026-07-18T12:00:00.000Z"),
    })
    tx.auditLog.findMany
      .mockResolvedValueOnce([
        {
          action: "authorize",
          entityId: "authorization-before-reset",
          newValue: { maxTotalChargeUsd: 3 },
          createdAt: new Date("2026-07-18T10:00:00.000Z"),
        },
        {
          action: "authorize",
          entityId: "authorization-after-reset",
          newValue: { maxTotalChargeUsd: 0.5 },
          createdAt: new Date("2026-07-18T12:05:00.000Z"),
        },
      ])
      .mockResolvedValueOnce([
        {
          userId: "user-old",
          action: "authorize",
          entityId: "authorization-before-reset",
          entityName: "source-old",
          newValue: { sourceId: "source-old", maxTotalChargeUsd: 3, policyVersion: 2 },
          createdAt: new Date("2026-07-18T10:00:00.000Z"),
        },
        {
          userId: "user-new",
          action: "authorize",
          entityId: "authorization-after-reset",
          entityName: "source-new",
          newValue: { sourceId: "source-new", maxTotalChargeUsd: 0.5, policyVersion: 3 },
          createdAt: new Date("2026-07-18T12:05:00.000Z"),
        },
      ])

    const report = await getTenantPaidRunReport("org-1", new Date("2026-07-18T13:00:00.000Z"))

    expect(report.usage).toMatchObject({ dayReservedUsd: 0.5, monthReservedUsd: 0.5 })
    expect(report.recentAuthorizations).toEqual([
      expect.objectContaining({ authorizationId: "authorization-after-reset" }),
    ])
    expect(tx.auditLog.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        entityType: "social_paid_run_authorization",
        action: "reset_boundary",
        userId: null,
        entityName: "Social Monitoring clean slate",
        entityId: { startsWith: "clean-slate:" },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { newValue: true, createdAt: true },
    })
    expect(tx.auditLog.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ createdAt: { gte: resetAt } }),
    }))
    expect(tx.auditLog.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ createdAt: { gte: resetAt } }),
    }))
  })

  it("carries hidden same-period spend and run quota across the reset boundary", async () => {
    tx.organization.findUnique.mockResolvedValue({
      settings: {
        socialMonitoringPaidRuns: {
          ...enabledSettings.socialMonitoringPaidRuns,
          dailyRunQuota: 3,
        },
      },
    })
    tx.auditLog.findFirst.mockResolvedValue({
      newValue: {
        resetAt: "2026-07-18T12:01:00.000Z",
        ...resetCarry(),
      },
      createdAt: new Date("2026-07-18T12:01:00.000Z"),
    })
    tx.auditLog.findMany.mockResolvedValue([])
    tx.$queryRaw.mockResolvedValue([])

    const report = await getTenantPaidRunReport(
      "org-1",
      new Date("2026-07-18T13:00:00.000Z"),
    )

    expect(report.usage).toMatchObject({
      dayReservedUsd: 3.75,
      monthReservedUsd: 8,
      runsToday: 1,
      runsRemainingToday: 2,
    })
  })
})

describe("tenant run-count quota", () => {
  it("keeps a quota-only policy enabled without any USD budget", () => {
    const policy = parseTenantPaidRunPolicy({
      socialMonitoringPaidRuns: {
        policyVersion: 2,
        manualRunsEnabled: true,
        emergencyStopped: false,
        maxPerRunUsd: 0,
        dailyBudgetUsd: 0,
        monthlyBudgetUsd: 0,
        dailyRunQuota: 3,
        authorizedAt: "2026-07-19T12:00:00.000Z",
        authorizedBy: "admin-1",
      },
    })
    expect(policy).toMatchObject({ manualRunsEnabled: true, emergencyStopped: false, dailyRunQuota: 3 })
  })

  it("forces a quota-only policy closed when the quota exceeds the hard ceiling", () => {
    expect(parseTenantPaidRunPolicy({
      socialMonitoringPaidRuns: {
        manualRunsEnabled: true,
        emergencyStopped: false,
        dailyRunQuota: 101,
        authorizedAt: "2026-07-19T12:00:00.000Z",
        authorizedBy: "admin-1",
      },
    })).toMatchObject({ manualRunsEnabled: false, emergencyStopped: true })
  })

  it("lets an admin enable paid runs by run-count quota alone", async () => {
    tx.organization.findUnique.mockResolvedValue({ settings: {} })
    const updated = await updateTenantPaidRunPolicy("org-1", "admin-1", {
      manualRunsEnabled: true,
      emergencyStopped: false,
      dailyRunQuota: 3,
      authorizationConfirmed: true,
    }, new Date("2026-07-19T13:00:00.000Z"))
    expect(updated).toMatchObject({ manualRunsEnabled: true, dailyRunQuota: 3, maxPerRunUsd: 0, authorizedBy: "admin-1" })
  })

  it("rejects a quota above the hard ceiling", async () => {
    tx.organization.findUnique.mockResolvedValue({ settings: {} })
    await expect(updateTenantPaidRunPolicy("org-1", "admin-1", {
      manualRunsEnabled: true,
      emergencyStopped: false,
      dailyRunQuota: 101,
      authorizationConfirmed: true,
    })).rejects.toThrow("paid_run_daily_quota_too_high")
  })

  it("still rejects enabling with neither a USD budget nor a quota", async () => {
    tx.organization.findUnique.mockResolvedValue({ settings: {} })
    await expect(updateTenantPaidRunPolicy("org-1", "admin-1", {
      manualRunsEnabled: true,
      emergencyStopped: false,
      authorizationConfirmed: true,
    })).rejects.toThrow("paid_manual_run_limits_required")
  })

  it("reports run-count usage and remaining quota for the day", async () => {
    tx.organization.findUnique.mockResolvedValue({
      settings: {
        socialMonitoringPaidRuns: {
          policyVersion: 2,
          manualRunsEnabled: true,
          emergencyStopped: false,
          dailyRunQuota: 3,
          authorizedAt: "2026-07-19T12:00:00.000Z",
          authorizedBy: "admin-1",
        },
      },
    })
    tx.$queryRaw.mockResolvedValueOnce([
      { collectorRunId: "run-a" },
      { collectorRunId: "run-b" },
    ])
    const report = await getTenantPaidRunReport("org-1", new Date("2026-07-19T13:00:00.000Z"))
    expect(report.usage).toMatchObject({ runsToday: 2, runsRemainingToday: 1 })
    expect(report.policy).toMatchObject({ dailyRunQuota: 3 })
    expect(tx.$queryRaw).toHaveBeenCalledOnce()
    const quotaQuery = tx.$queryRaw.mock.calls[0]?.[0] as { text?: string; sql?: string }
    expect(quotaQuery.text ?? quotaQuery.sql ?? "").toContain("SELECT DISTINCT \"collectorRunId\"")
    expect(quotaQuery.text ?? quotaQuery.sql ?? "").toContain('"purgedAt" IS NULL')
  })

  it("atomically counts an authorization that has not created its provider row yet", async () => {
    tx.organization.findUnique.mockResolvedValue({
      settings: {
        socialMonitoringPaidRuns: {
          ...enabledSettings.socialMonitoringPaidRuns,
          dailyRunQuota: 1,
        },
      },
    })
    tx.auditLog.findMany.mockResolvedValue([{
      action: "authorize",
      entityId: "authorization-in-flight",
      newValue: { maxTotalChargeUsd: 0.5 },
      createdAt: new Date("2026-07-19T12:30:00.000Z"),
    }])

    await expect(authorizeTenantManualPaidRun({
      organizationId: "org-1",
      sourceId: "source-2",
      requestedByUserId: "user-1",
      maxTotalChargeUsd: 0.5,
      now: new Date("2026-07-19T13:00:00.000Z"),
    })).resolves.toEqual({
      status: "BLOCKED",
      reason: "paid_run_daily_quota_exhausted",
    })
    expect(tx.auditLog.create).not.toHaveBeenCalled()
  })
})

// Режим снимает суточный и месячный долларовые потолки автосбора, поэтому
// включаться он обязан ТОЛЬКО когда есть чем ограничить ночь.
describe("tenantProviderAccountFundedRunPolicy", () => {
  const policy = (overrides: Record<string, unknown>) => ({
    settings: {
      socialMonitoringPaidRuns: {
        policyVersion: 3,
        clientFundedManualRunsEnabled: true,
        emergencyStopped: false,
        dailyRunQuota: 5,
        ...overrides,
      },
    },
  })

  beforeEach(() => {
    mockPrisma.organization.findUnique.mockReset()
  })

  it("включается только при заданной суточной квоте", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue(policy({}))
    await expect(tenantProviderAccountFundedRunPolicy("org-1"))
      .resolves.toEqual({ enabled: true, dailyRunQuota: 5 })
  })

  it("fail-closed без квоты: иначе у автосбора не остаётся ни одного потолка", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue(policy({ dailyRunQuota: 0 }))
    await expect(tenantProviderAccountFundedRunPolicy("org-1"))
      .resolves.toEqual({ enabled: false, dailyRunQuota: 0 })
  })

  it("выключен при аварийной остановке и без разрешения платить со своего счёта", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue(policy({ emergencyStopped: true }))
    await expect(tenantProviderAccountFundedRunPolicy("org-1"))
      .resolves.toMatchObject({ enabled: false })

    mockPrisma.organization.findUnique.mockResolvedValue(policy({ clientFundedManualRunsEnabled: false }))
    await expect(tenantProviderAccountFundedRunPolicy("org-1"))
      .resolves.toMatchObject({ enabled: false })
  })

  it("выключен у тенанта без настроек вовсе", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({ settings: {} })
    await expect(tenantProviderAccountFundedRunPolicy("org-1"))
      .resolves.toEqual({ enabled: false, dailyRunQuota: 0 })
  })
})
