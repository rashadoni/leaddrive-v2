import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  jobFindFirst: vi.fn(),
  jobFindMany: vi.fn(),
  jobCreate: vi.fn(),
  jobUpdateMany: vi.fn(),
  itemFindFirst: vi.fn(),
  itemFindMany: vi.fn(),
  itemUpdateMany: vi.fn(),
  userFindFirst: vi.fn(),
  organizationFindUnique: vi.fn(),
  collectorRunFindMany: vi.fn(),
  providerRunFindMany: vi.fn(),
  monitoringSourceFindMany: vi.fn(),
  logAudit: vi.fn(),
  listProfiles: vi.fn(),
  brandProtectionOnly: vi.fn(),
  sourceIdentityRole: vi.fn(),
  sourcePresentationKind: vi.fn(),
  runSourceForActor: vi.fn(),
  runProfileSource: vi.fn(),
  hasPendingProvider: vi.fn(),
  pendingProviderRunIds: vi.fn(),
  summarizeProviderRuns: vi.fn(),
  mergeCollectorAndProvider: vi.fn(),
  importApifyProviderRun: vi.fn(),
  reconcileBrightDataProviderRuns: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialMonitoringRunJob: {
      findFirst: mocks.jobFindFirst,
      findMany: mocks.jobFindMany,
      create: mocks.jobCreate,
      updateMany: mocks.jobUpdateMany,
    },
    socialMonitoringRunJobItem: {
      findFirst: mocks.itemFindFirst,
      findMany: mocks.itemFindMany,
      updateMany: mocks.itemUpdateMany,
    },
    socialProviderRun: { findMany: mocks.providerRunFindMany },
    collectorRun: { findMany: mocks.collectorRunFindMany },
    monitoringSource: { findMany: mocks.monitoringSourceFindMany },
    user: { findFirst: mocks.userFindFirst },
    organization: { findUnique: mocks.organizationFindUnique },
  },
  logAudit: mocks.logAudit,
}))

vi.mock("@/lib/social/monitoring-profiles", () => ({
  listMonitoringProfiles: mocks.listProfiles,
}))

vi.mock("@/lib/social/brand-protection", () => ({
  isSocialBrandProtectionOnly: mocks.brandProtectionOnly,
}))

vi.mock("@/lib/social/monitoring-source-identity", () => ({
  monitoringSourceIdentityRole: mocks.sourceIdentityRole,
}))

vi.mock("@/lib/social/monitoring-source-presentation", () => ({
  monitoringSourcePresentationKind: mocks.sourcePresentationKind,
}))

vi.mock("@/lib/social/monitoring-source-run", () => ({
  runMonitoringSourceForActor: mocks.runSourceForActor,
}))

vi.mock("@/lib/social/monitoring-import-fence", () => ({
  withSocialMonitoringTenantCollectionFence: vi.fn(async (
    _organizationId: string,
    action: () => Promise<unknown>,
  ) => ({ allowed: true, value: await action() })),
}))

vi.mock("@/lib/social/monitoring-profile-source-run", () => ({
  runMonitoringProfileSourceForSubject: mocks.runProfileSource,
}))

vi.mock("@/lib/social/monitoring-profile-runner", () => ({
  monitoringCollectorResultHasPendingProvider: mocks.hasPendingProvider,
  monitoringCollectorPendingProviderRunIds: mocks.pendingProviderRunIds,
  summarizeMonitoringProviderRuns: mocks.summarizeProviderRuns,
  mergeMonitoringCollectorAndProviderResult: mocks.mergeCollectorAndProvider,
}))

vi.mock("@/lib/social/apify-async-adapter", () => ({
  importApifyProviderRun: mocks.importApifyProviderRun,
}))

vi.mock("@/lib/social/bright-data-reconcile", () => ({
  reconcileBrightDataProviderRuns: mocks.reconcileBrightDataProviderRuns,
}))

import {
  createSocialMonitoringRunJob,
  processSocialMonitoringRunJobs,
} from "@/lib/social/monitoring-run-job"

type ItemRow = ReturnType<typeof itemRow>

function itemRow(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-08-01T12:00:00.000Z")
  return {
    id: "item-1",
    organizationId: "org-1",
    jobId: "job-1",
    position: 1,
    subjectId: "subject-1",
    scenarioId: "scenario-1",
    profileName: "Brand one",
    sourceId: "source-1",
    sourceLabel: "instagram · brand-one",
    sourcePlatform: "instagram",
    status: "QUEUED",
    paid: false,
    providerAccountFundedOnly: false,
    sharedAcrossMonitorings: false,
    maxTotalChargeUsd: null,
    onlyCapability: null,
    includeComments: false,
    fullArchiveRun: true,
    attemptCount: 0,
    nextAttemptAt: null,
    providerDeadlineAt: null,
    terminalObservedAt: null,
    leaseToken: null,
    leaseExpiresAt: null,
    collectorRunId: null,
    providerRunIds: [] as string[],
    collectorResult: null,
    foundCount: 0,
    newCount: 0,
    duplicateCount: 0,
    acceptedCount: 0,
    reviewCount: 0,
    rejectedCount: 0,
    ignoredCount: 0,
    error: null,
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function jobRow(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-08-01T12:00:00.000Z")
  return {
    id: "job-1",
    organizationId: "org-1",
    kind: "PROFILE_FULL",
    sourceScope: null,
    status: "QUEUED",
    idempotencyKey: "bulk:1",
    requestedBy: "admin-1",
    fullArchiveConfirmed: true,
    paidConfirmed: true,
    sharedConfirmed: true,
    totalItems: 2,
    paidItems: 2,
    sharedItems: 2,
    failureCount: 0,
    nextAttemptAt: null,
    leaseToken: null,
    leaseExpiresAt: null,
    cancelRequestedAt: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
    items: [] as ItemRow[],
    ...overrides,
  }
}

function resetMocks() {
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.logAudit.mockResolvedValue(undefined)
  mocks.brandProtectionOnly.mockResolvedValue(false)
  mocks.sourceIdentityRole.mockReturnValue("external")
  mocks.sourcePresentationKind.mockReturnValue("direct")
  mocks.hasPendingProvider.mockReturnValue(false)
  mocks.pendingProviderRunIds.mockReturnValue([])
  mocks.summarizeProviderRuns.mockReturnValue({
    status: "pending",
    foundCount: 0,
    newCount: 0,
    duplicateCount: 0,
  })
  mocks.mergeCollectorAndProvider.mockImplementation((_collector, provider) => provider)
  mocks.providerRunFindMany.mockResolvedValue([])
  mocks.userFindFirst.mockResolvedValue({ role: "admin" })
  mocks.organizationFindUnique.mockResolvedValue({
    isActive: true,
    plan: "professional",
    addons: [],
    features: ["social"],
    modules: { social: true },
  })
  mocks.collectorRunFindMany.mockResolvedValue([])
  mocks.importApifyProviderRun.mockResolvedValue({ status: "IMPORTED" })
  mocks.reconcileBrightDataProviderRuns.mockResolvedValue([])
}

beforeEach(() => {
  vi.useRealTimers()
  resetMocks()
})

describe("createSocialMonitoringRunJob", () => {
  it("persists a stable profile/source plan without deduplicating a shared physical source across profiles", async () => {
    mocks.listProfiles.mockResolvedValue([
      {
        id: "profile-1",
        subjectId: "subject-1",
        scenarioId: "scenario-1",
        name: "Brand one",
        status: "active",
        commentsEnabled: true,
        sources: [{
          id: "shared-source",
          platform: "instagram",
          sourceType: "page",
          label: "instagram · shared",
          isActive: true,
          paid: true,
          providerAccountFundedOnly: false,
          sharedAcrossMonitorings: true,
        }],
      },
      {
        id: "profile-2",
        subjectId: "subject-2",
        scenarioId: "scenario-2",
        name: "Brand two",
        status: "active",
        commentsEnabled: false,
        sources: [{
          id: "shared-source",
          platform: "instagram",
          sourceType: "page",
          label: "instagram · shared",
          isActive: true,
          paid: true,
          providerAccountFundedOnly: false,
          sharedAcrossMonitorings: true,
        }],
      },
    ])
    const persisted = jobRow({
      items: [
        itemRow({ id: "item-1", sourceId: "shared-source", subjectId: "subject-1", scenarioId: "scenario-1" }),
        itemRow({ id: "item-2", position: 2, sourceId: "shared-source", subjectId: "subject-2", scenarioId: "scenario-2" }),
      ],
    })
    mocks.jobFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(persisted)
    mocks.jobCreate.mockResolvedValue({ id: "job-1" })

    const result = await createSocialMonitoringRunJob({
      organizationId: "org-1",
      requestedBy: "admin-1",
      requestedByRole: "admin",
      kind: "PROFILE_FULL",
      idempotencyKey: "bulk:1",
      fullArchiveConfirmed: true,
      paidConfirmed: true,
      sharedConfirmed: true,
    })

    expect(result).toMatchObject({ id: "job-1", totalItems: 2 })
    const create = mocks.jobCreate.mock.calls[0]?.[0]
    expect(create.data).toMatchObject({
      organizationId: "org-1",
      kind: "PROFILE_FULL",
      sourceScope: null,
      totalItems: 2,
      paidItems: 2,
      sharedItems: 2,
    })
    expect(create.data.items.create).toEqual([
      expect.objectContaining({
        position: 1,
        sourceId: "shared-source",
        subjectId: "subject-1",
        scenarioId: "scenario-1",
        includeComments: true,
      }),
      expect.objectContaining({
        position: 2,
        sourceId: "shared-source",
        subjectId: "subject-2",
        scenarioId: "scenario-2",
        includeComments: false,
      }),
    ])
    for (const item of create.data.items.create) {
      expect(item).not.toHaveProperty("organizationId")
    }
    expect(mocks.logAudit).toHaveBeenCalledWith(
      "org-1",
      "create",
      "social_monitoring_run_job",
      "job-1",
      "PROFILE_FULL",
      { userId: "admin-1" },
    )
  })

  it("returns the existing tenant job for the same idempotency key without rebuilding or dispatching", async () => {
    const persisted = jobRow({ id: "job-existing", totalItems: 1, items: [itemRow()] })
    mocks.jobFindFirst
      .mockResolvedValueOnce({
        id: "job-existing",
        kind: "PROFILE_FULL",
        sourceScope: null,
      })
      .mockResolvedValueOnce(persisted)

    const result = await createSocialMonitoringRunJob({
      organizationId: "org-1",
      requestedBy: "admin-1",
      requestedByRole: "admin",
      kind: "PROFILE_FULL",
      idempotencyKey: "same-request",
      fullArchiveConfirmed: true,
      paidConfirmed: true,
      sharedConfirmed: true,
    })

    expect(result).toMatchObject({ id: "job-existing" })
    expect(mocks.listProfiles).not.toHaveBeenCalled()
    expect(mocks.jobCreate).not.toHaveBeenCalled()
    expect(mocks.logAudit).not.toHaveBeenCalled()
  })

  it("fails closed before storage when a non-admin requests a profile-wide run", async () => {
    await expect(createSocialMonitoringRunJob({
      organizationId: "org-1",
      requestedBy: "member-1",
      requestedByRole: "member",
      kind: "PROFILE_FULL",
      idempotencyKey: "member-request",
      fullArchiveConfirmed: true,
    })).rejects.toMatchObject({
      code: "admin_required",
      status: 403,
    })

    expect(mocks.jobFindFirst).not.toHaveBeenCalled()
    expect(mocks.listProfiles).not.toHaveBeenCalled()
  })
})

describe("processSocialMonitoringRunJobs", () => {
  it("fails closed before dispatch when the tenant is deactivated or loses Social Monitoring", async () => {
    const candidate = jobRow({ status: "QUEUED", totalItems: 1 })
    mocks.jobFindMany.mockResolvedValue([{
      id: candidate.id,
      organizationId: candidate.organizationId,
      kind: candidate.kind,
      sourceScope: candidate.sourceScope,
      requestedBy: candidate.requestedBy,
      failureCount: candidate.failureCount,
    }])
    mocks.jobUpdateMany.mockResolvedValue({ count: 1 })
    mocks.organizationFindUnique.mockResolvedValueOnce({
      isActive: false,
      plan: "professional",
      addons: [],
      features: ["social"],
      modules: { social: true },
    })

    const result = await processSocialMonitoringRunJobs({ limit: 1 })

    expect(result).toMatchObject({ claimed: 1 })
    expect(mocks.jobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "FAILED",
        error: "social_monitoring_run_job_actor_not_authorized",
      }),
    }))
    expect(mocks.runProfileSource).not.toHaveBeenCalled()
    expect(mocks.runSourceForActor).not.toHaveBeenCalled()
  })

  it("rechecks actor authorization inside the tenant fence before every dispatch", async () => {
    const stateJob = jobRow({ status: "QUEUED", totalItems: 1 })
    const stateItem = itemRow()
    mocks.jobFindMany.mockResolvedValue([{
      id: stateJob.id,
      organizationId: stateJob.organizationId,
      kind: stateJob.kind,
      sourceScope: stateJob.sourceScope,
      requestedBy: stateJob.requestedBy,
      failureCount: stateJob.failureCount,
    }])
    mocks.jobUpdateMany.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      applyData(stateJob, data)
      return { count: 1 }
    })
    mocks.jobFindFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      if (
        where.id === stateJob.id
        && where.organizationId === stateJob.organizationId
        && statusMatches(stateJob.status, where.status)
        && (!where.leaseToken || where.leaseToken === stateJob.leaseToken)
      ) return { id: stateJob.id }
      return null
    })
    mocks.itemFindFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      if (where.id && where.id !== stateItem.id) return null
      return statusMatches(stateItem.status, where.status) ? stateItem : null
    })
    mocks.itemUpdateMany.mockImplementation(async ({ where, data }: {
      where: Record<string, unknown>
      data: Record<string, unknown>
    }) => {
      if (where.id && where.id !== stateItem.id) return { count: 0 }
      if (!statusMatches(stateItem.status, where.status)) return { count: 0 }
      applyData(stateItem, data)
      return { count: 1 }
    })
    mocks.organizationFindUnique
      .mockResolvedValueOnce({
        isActive: true,
        plan: "professional",
        addons: [],
        features: ["social"],
        modules: { social: true },
      })
      .mockResolvedValueOnce({
        isActive: false,
        plan: "professional",
        addons: [],
        features: ["social"],
        modules: { social: true },
      })

    const result = await processSocialMonitoringRunJobs({ limit: 1 })

    expect(result).toMatchObject({
      claimed: 1,
      processed: 1,
      results: [{ id: "job-1", status: "FAILED", processed: 1 }],
    })
    expect(stateJob).toMatchObject({
      status: "FAILED",
      error: "social_monitoring_run_job_actor_not_authorized",
      leaseToken: null,
    })
    expect(stateItem).toMatchObject({
      status: "QUEUED",
      leaseToken: null,
      providerDeadlineAt: null,
    })
    expect(mocks.runProfileSource).not.toHaveBeenCalled()
    expect(mocks.runSourceForActor).not.toHaveBeenCalled()
  })

  it("rechecks backoff in the claim CAS and rotates least recently serviced due jobs first", async () => {
    const candidate = jobRow({ status: "WAITING_PROVIDER" })
    mocks.jobFindMany.mockResolvedValue([{
      id: candidate.id,
      organizationId: candidate.organizationId,
      kind: candidate.kind,
      sourceScope: candidate.sourceScope,
      requestedBy: candidate.requestedBy,
      failureCount: candidate.failureCount,
    }])
    mocks.jobUpdateMany.mockResolvedValue({ count: 0 })

    const result = await processSocialMonitoringRunJobs({ limit: 1 })

    expect(result).toMatchObject({ selected: 1, claimed: 0 })
    expect(mocks.jobFindMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [
        { updatedAt: "asc" },
        { createdAt: "asc" },
      ],
    }))
    expect(mocks.jobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: expect.any(Date) } }] },
        ]),
      }),
    }))
  })

  it("does not claim another job after the invocation wall-clock deadline", async () => {
    vi.useFakeTimers()
    const now = new Date("2026-08-01T12:00:00.000Z")
    vi.setSystemTime(now)
    const candidate = jobRow()
    mocks.jobFindMany.mockResolvedValue([{
      id: candidate.id,
      organizationId: candidate.organizationId,
      kind: candidate.kind,
      sourceScope: candidate.sourceScope,
      requestedBy: candidate.requestedBy,
      failureCount: candidate.failureCount,
    }])

    const result = await processSocialMonitoringRunJobs({
      limit: 1,
      deadlineAt: new Date(now.getTime() - 1),
    })

    expect(result).toEqual({
      selected: 1,
      claimed: 0,
      processed: 0,
      results: [],
    })
    expect(mocks.jobUpdateMany).not.toHaveBeenCalled()
  })

  it("counts provider inspections against the global budget across jobs", async () => {
    vi.useFakeTimers()
    const now = new Date("2026-08-01T12:00:00.000Z")
    vi.setSystemTime(now)
    const jobs = Array.from({ length: 4 }, (_, index) => jobRow({
      id: `job-${index + 1}`,
      organizationId: `org-${index + 1}`,
      status: "WAITING_PROVIDER",
      totalItems: 1,
    }))
    const items = jobs.map((job, index) => itemRow({
      id: `item-${index + 1}`,
      organizationId: job.organizationId,
      jobId: job.id,
      status: "WAITING_PROVIDER",
      providerRunIds: [`provider-${index + 1}`],
      providerDeadlineAt: new Date("2026-08-01T12:20:00.000Z"),
      nextAttemptAt: now,
    }))
    mocks.jobFindMany.mockResolvedValue(jobs.map(job => ({
      id: job.id,
      organizationId: job.organizationId,
      kind: job.kind,
      sourceScope: job.sourceScope,
      requestedBy: job.requestedBy,
      failureCount: job.failureCount,
    })))
    mocks.jobUpdateMany.mockImplementation(async ({ where, data }: {
      where: Record<string, unknown>
      data: Record<string, unknown>
    }) => {
      const job = jobs.find(candidate => candidate.id === where.id)
      if (!job || !statusMatches(job.status, where.status)) return { count: 0 }
      applyData(job, data)
      return { count: 1 }
    })
    mocks.jobFindFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      const job = jobs.find(candidate => candidate.id === where.id)
      if (
        job
        && job.organizationId === where.organizationId
        && statusMatches(job.status, where.status)
        && (!where.leaseToken || where.leaseToken === job.leaseToken)
      ) return { id: job.id }
      return null
    })
    mocks.itemFindFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      return items.find(item => (
        item.jobId === where.jobId
        && (!where.id || item.id === where.id)
        && statusMatches(item.status, where.status)
      )) ?? null
    })
    mocks.itemUpdateMany.mockImplementation(async ({ where, data }: {
      where: Record<string, unknown>
      data: Record<string, unknown>
    }) => {
      const matching = items.filter(item => (
        (!where.id || item.id === where.id)
        && (!where.jobId || item.jobId === where.jobId)
        && statusMatches(item.status, where.status)
      ))
      for (const item of matching) applyData(item, data)
      return { count: matching.length }
    })
    mocks.providerRunFindMany.mockResolvedValue([{
      id: "provider-pending",
      parentRunId: null,
      providerKey: "APIFY",
      phase: "PAID_ROUTE_COLLECTION",
      status: "QUEUED",
      receivedCount: 0,
      acceptedCount: 0,
      reviewCount: 0,
      rejectedCount: 0,
      duplicateCount: 0,
      lastError: null,
      timeoutSeconds: 60,
      startedAt: now,
      createdAt: now,
    }])

    const result = await processSocialMonitoringRunJobs({
      limit: 4,
      maxItemsPerJob: 3,
      maxItemsTotal: 3,
      now,
    })

    expect(result).toMatchObject({ selected: 4, claimed: 3, processed: 3 })
    expect(result.results.map(item => item.id)).toEqual(["job-1", "job-2", "job-3"])
    // Each inspection reads once before and once after provider reconciliation.
    expect(mocks.providerRunFindMany).toHaveBeenCalledTimes(6)
    expect(mocks.jobUpdateMany.mock.calls.some(([input]) => input.where.id === "job-4")).toBe(false)
  })

  it("never time-correlates an unknown paid dispatch to another same-source run", async () => {
    vi.useFakeTimers()
    const now = new Date("2026-08-01T12:00:00.000Z")
    vi.setSystemTime(now)

    const stateJob = jobRow({ status: "QUEUED", totalItems: 1, paidItems: 1 })
    const stateItem = itemRow({ paid: true, maxTotalChargeUsd: 1 })
    const candidate = {
      id: stateJob.id,
      organizationId: stateJob.organizationId,
      kind: stateJob.kind,
      sourceScope: stateJob.sourceScope,
      requestedBy: stateJob.requestedBy,
      failureCount: stateJob.failureCount,
    }
    mocks.jobFindMany.mockResolvedValue([candidate])
    mocks.jobUpdateMany.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      applyData(stateJob, data)
      return { count: 1 }
    })
    mocks.jobFindFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      if (
        where.id === stateJob.id
        && where.organizationId === stateJob.organizationId
        && statusMatches(stateJob.status, where.status)
        && (!where.leaseToken || where.leaseToken === stateJob.leaseToken)
      ) return { id: stateJob.id }
      return null
    })
    mocks.itemFindFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      if (where.id && where.id !== stateItem.id) return null
      return statusMatches(stateItem.status, where.status) ? stateItem : null
    })
    mocks.itemUpdateMany.mockImplementation(async ({ where, data }: {
      where: Record<string, unknown>
      data: Record<string, unknown>
    }) => {
      if (where.id && where.id !== stateItem.id) return { count: 0 }
      if (!statusMatches(stateItem.status, where.status)) return { count: 0 }
      applyData(stateItem, data)
      return { count: 1 }
    })
    mocks.runProfileSource.mockRejectedValue(new Error("provider connection reset"))
    mocks.collectorRunFindMany.mockResolvedValue([{ id: "foreign-collector" }])

    const first = await processSocialMonitoringRunJobs({ limit: 1, now })

    expect(first).toMatchObject({
      claimed: 1,
      results: [{ id: "job-1", status: "waiting", processed: 1 }],
    })
    expect(stateItem).toMatchObject({
      status: "WAITING_PROVIDER",
      collectorRunId: null,
      providerRunIds: [],
      error: "dispatch_outcome_unknown:provider connection reset",
    })
    expect(mocks.collectorRunFindMany).not.toHaveBeenCalled()
    expect(mocks.providerRunFindMany).not.toHaveBeenCalled()

    vi.setSystemTime(new Date("2026-08-01T12:01:00.000Z"))
    const second = await processSocialMonitoringRunJobs({ limit: 1 })

    expect(second).toMatchObject({
      claimed: 1,
      results: [{ id: "job-1", status: "waiting" }],
    })
    expect(mocks.providerRunFindMany).not.toHaveBeenCalled()
  })

  it("honors the global item budget, then continues after a stuck provider item on the next tick", async () => {
    vi.useFakeTimers()
    const now = new Date("2026-08-01T12:30:00.000Z")
    vi.setSystemTime(now)

    const stateJob = jobRow({
      status: "WAITING_PROVIDER",
      requestedBy: "admin-1",
      leaseToken: null,
      leaseExpiresAt: null,
    })
    const stateItems = [
      itemRow({
        id: "item-stuck",
        position: 1,
        status: "WAITING_PROVIDER",
        providerDeadlineAt: new Date("2026-08-01T12:29:00.000Z"),
        startedAt: new Date("2026-08-01T12:00:00.000Z"),
      }),
      itemRow({
        id: "item-next",
        position: 2,
        subjectId: "subject-2",
        scenarioId: "scenario-2",
        profileName: "Brand two",
        sourceId: "source-2",
        sourceLabel: "facebook · brand-two",
        sourcePlatform: "facebook",
        status: "QUEUED",
      }),
    ]

    mocks.jobFindMany.mockResolvedValue([{
      id: stateJob.id,
      organizationId: stateJob.organizationId,
      kind: stateJob.kind,
      sourceScope: stateJob.sourceScope,
      requestedBy: stateJob.requestedBy,
      failureCount: stateJob.failureCount,
    }])
    mocks.jobUpdateMany.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      applyData(stateJob, data)
      return { count: 1 }
    })
    mocks.jobFindFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      if (
        where.id === stateJob.id
        && where.organizationId === stateJob.organizationId
        && where.status === stateJob.status
        && (!where.leaseToken || where.leaseToken === stateJob.leaseToken)
      ) return { id: stateJob.id }
      return null
    })
    mocks.itemFindFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      const excluded = record(where.id).notIn
      return stateItems
        .filter(item => !Array.isArray(excluded) || !excluded.includes(item.id))
        .filter(item => statusMatches(item.status, where.status))
        .sort((left, right) => left.position - right.position)[0] ?? null
    })
    mocks.itemFindMany.mockImplementation(async () => (
      stateItems.map(item => ({ status: item.status }))
    ))
    mocks.itemUpdateMany.mockImplementation(async ({ where, data }: {
      where: Record<string, unknown>
      data: Record<string, unknown>
    }) => {
      const item = stateItems.find(candidate => candidate.id === where.id)
      if (!item) return { count: 0 }
      applyData(item, data)
      return { count: 1 }
    })
    mocks.providerRunFindMany.mockResolvedValue([])
    mocks.runProfileSource.mockResolvedValue({
      ok: true,
      data: {
        runId: "collector-2",
        sourceId: "source-2",
        status: "success",
        foundCount: 4,
        newCount: 3,
        duplicateCount: 1,
        ignoredCount: 0,
      },
    })

    const first = await processSocialMonitoringRunJobs({
      limit: 1,
      maxItemsPerJob: 3,
      maxItemsTotal: 1,
      now,
    })

    expect(first).toEqual({
      selected: 1,
      claimed: 1,
      processed: 1,
      results: [{ id: "job-1", status: "QUEUED", processed: 1 }],
    })
    expect(stateItems.map(item => item.status)).toEqual(["TIMED_OUT", "QUEUED"])
    expect(mocks.runProfileSource).not.toHaveBeenCalled()

    const second = await processSocialMonitoringRunJobs({
      limit: 1,
      maxItemsPerJob: 3,
      maxItemsTotal: 1,
      now,
    })

    expect(second).toEqual({
      selected: 1,
      claimed: 1,
      processed: 1,
      results: [{ id: "job-1", status: "COMPLETED_WITH_ISSUES", processed: 1 }],
    })
    expect(stateItems.map(item => item.status)).toEqual(["TIMED_OUT", "SUCCEEDED"])
    expect(stateJob.status).toBe("COMPLETED_WITH_ISSUES")
    expect(mocks.runProfileSource).toHaveBeenCalledTimes(1)
    expect(mocks.runProfileSource).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      requestedByUserId: "admin-1",
      subjectId: "subject-2",
      run: expect.objectContaining({
        scenarioId: "scenario-2",
        sourceId: "source-2",
      }),
    }))
  })
})

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function statusMatches(current: string, expected: unknown): boolean {
  if (typeof expected === "string") return current === expected
  const values = record(expected).in
  return Array.isArray(values) ? values.includes(current) : true
}

function applyData(target: object, data: Record<string, unknown>) {
  const row = target as Record<string, unknown>
  for (const [key, value] of Object.entries(data)) {
    const increment = record(value).increment
    if (typeof increment === "number") {
      row[key] = Number(row[key] ?? 0) + increment
    } else {
      row[key] = value
    }
  }
}
