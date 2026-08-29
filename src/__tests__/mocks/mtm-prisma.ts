import { vi } from "vitest"

/**
 * Shared mock factory for `prisma.mtm*` models — addresses the cross-session
 * mock drift architect flagged after the second mtmPhoto.count miss
 * (commits `acd9c207` and `68402804`). Test files used to inline a partial
 * mock per file; when a parallel session added a new prisma method to a
 * production route, the inline mocks went stale and CI broke for the next
 * session who pushed.
 *
 * Pattern: this file is the SINGLE place to declare the surface area of the
 * MTM prisma mock. New methods land here once; every test that imports
 * `makeMtmPrismaMock()` picks them up automatically.
 *
 * Usage — ALWAYS via async vi.mock factory so the import crosses the hoist
 * barrier (top-level `import { makeMtmPrismaMock }` won't work — vi.mock is
 * hoisted ABOVE imports):
 *
 *   vi.mock("@/lib/prisma", async () => {
 *     const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
 *     return { prisma: makeMtmPrismaMock() }
 *   })
 *
 * Canonical adopter to copy from: src/__tests__/api-mtm-visits.test.ts
 * (intentionally minimal — no $transaction override, no per-test reset
 * gymnastics, just `beforeEach(vi.clearAllMocks)`).
 *
 * Returning a factory (not a singleton) keeps each test file isolated —
 * `vi.clearAllMocks()` resets call history per file but preserves the
 * default impls (count→0, groupBy→[], aggregate→standard shape).
 *
 * Memory note for future Claude sessions:
 *   ~/.claude/projects/.../memory/feedback_use_mtm_prisma_factory.md
 */

/**
 * Each model method is a callable mock. We type it as a function returning
 * `Promise<unknown>` (callers cast the return when needed via
 * `.mockResolvedValue(...)`) plus the vitest Mock interface for assertions
 * like `expect(fn).toHaveBeenCalledWith(...)`.
 */
type ModelMethod = ((...args: unknown[]) => Promise<unknown>) & ReturnType<typeof vi.fn>

interface ModelMock {
  findFirst: ModelMethod
  findUnique: ModelMethod
  findMany: ModelMethod
  create: ModelMethod
  createMany: ModelMethod
  update: ModelMethod
  updateMany: ModelMethod
  upsert: ModelMethod
  delete: ModelMethod
  deleteMany: ModelMethod
  count: ModelMethod
  // Aggregation methods — every Prisma model exposes these; analytics
  // routes (api-mtm-agents, api-mtm-analytics) use them heavily.
  groupBy: ModelMethod
  aggregate: ModelMethod
}

/**
 * Build the full CRUD surface for one model. Each method is a fresh
 * `vi.fn()` — callers override with `.mockResolvedValue(...)` per test.
 *
 * `count` defaults to resolving 0 because several production routes use
 * `.count()` in fire-and-forget branches (e.g. POST /photos burst
 * detection added in M3-5b) — without a default, the unmocked promise
 * rejects and the route 500s, which is exactly the regression that
 * triggered this factory.
 *
 * `findMany` defaults to [] for the same reason: getMtmSettings() runs
 * `mtmSetting.findMany` inside visits/photos routes (honest-settings
 * enforcement) and iterates the result — an unmocked `undefined` would
 * crash every route that merely LOADS org settings on its way to the
 * behavior under test. Tests that care about rows still override.
 */
function makeModel(): ModelMock {
  return {
    findFirst: vi.fn() as ModelMethod,
    findUnique: vi.fn() as ModelMethod,
    findMany: vi.fn().mockResolvedValue([]) as ModelMethod,
    create: vi.fn() as ModelMethod,
    createMany: vi.fn() as ModelMethod,
    update: vi.fn() as ModelMethod,
    updateMany: vi.fn() as ModelMethod,
    upsert: vi.fn() as ModelMethod,
    delete: vi.fn() as ModelMethod,
    deleteMany: vi.fn() as ModelMethod,
    count: vi.fn().mockResolvedValue(0) as ModelMethod,
    groupBy: vi.fn().mockResolvedValue([]) as ModelMethod,
    aggregate: vi.fn().mockResolvedValue({ _count: 0, _sum: {}, _avg: {}, _min: {}, _max: {} }) as ModelMethod,
  }
}

/**
 * MTM route tests historically exercise an entitled tenant. Route & Field
 * capability guards preserve that legacy `mtm` entitlement, but their
 * organization lookup happens before the route-specific Prisma calls each
 * test configures. Keep that invariant local to the shared MTM factory and
 * only for the exact capability-access projection; other organization lookups
 * continue to default to undefined unless a test explicitly supplies a row.
 */
function makeMtmOrganizationModel(): ModelMock {
  const organization = makeModel()

  organization.findUnique.mockImplementation(async (...args: unknown[]) => {
    const [query] = args
    const select = (query as { select?: Record<string, unknown> } | undefined)?.select
    const capabilityAccessKeys = ["plan", "addons", "features", "modules", "settings"]
    if (
      select
      && Object.keys(select).length === capabilityAccessKeys.length
      && capabilityAccessKeys.every((key) => select[key] === true)
    ) {
      return {
        plan: "enterprise",
        addons: [],
        features: ["mtm"],
        modules: { mtm: true },
        settings: {},
      }
    }
    return undefined
  })

  return organization
}

/**
 * The full prisma client surface a typical MTM test needs. Models must
 * stay in sync with `prisma/schema.prisma`.
 * The self-test below pins the surface so dropping a model breaks CI.
 *
 * Add NEW models here when `prisma migrate` adds them — never inline a
 * model-specific mock in a test file. Architect M1-5b.6 follow-up
 * proposed auto-extracting this list via `grep ^model Mtm
 * prisma/schema.prisma`; tracked as a future enhancement.
 */
export interface MtmPrismaMock {
  mtmAgent: ModelMock
  mtmAgentLocation: ModelMock
  mtmAgentWorkday: ModelMock
  mtmAgentWorkdayEvent: ModelMock
  mtmCustomer: ModelMock
  mtmContact: ModelMock
  mtmContactWorkplace: ModelMock
  mtmCustomerAgentAssignment: ModelMock
  mtmContactAgentAssignment: ModelMock
  mtmContactTransferOperation: ModelMock
  mtmContactAssignmentOperation: ModelMock
  mtmOrganizationAssignmentOperation: ModelMock
  mtmFieldPotential: ModelMock
  mtmFieldPotentialEvidence: ModelMock
  mtmCoveragePolicy: ModelMock
  mtmKpiPolicy: ModelMock
  mtmCoverageSnapshot: ModelMock
  mtmCoverageSnapshotRow: ModelMock
  mtmDoctorScoringFormula: ModelMock
  mtmDoctorAssessment: ModelMock
  mtmContactDictionary: ModelMock
  mtmContactDictionaryAssignment: ModelMock
  mtmOrganizationAttributePackage: ModelMock
  mtmOrganizationAttributeFact: ModelMock
  mtmCustomerDepartment: ModelMock
  mtmCustomerCoordinateVerification: ModelMock
  mtmCommitment: ModelMock
  mtmCommitmentFulfillment: ModelMock
  mtmMessageThread: ModelMock
  mtmMessageParticipant: ModelMock
  mtmMessage: ModelMock
  mtmMessageReceipt: ModelMock
  mtmDocument: ModelMock
  mtmDocumentAssignment: ModelMock
  mtmHrmRequest: ModelMock
  mtmRoute: ModelMock
  mtmRoutePoint: ModelMock
  mtmRouteAssignment: ModelMock
  mtmRouteChangeRequest: ModelMock
  mtmTask: ModelMock
  mtmTaskEvent: ModelMock
  mtmVisit: ModelMock
  mtmVisitParticipant: ModelMock
  mtmVisitPolicy: ModelMock
  mtmVisitPolicyAction: ModelMock
  mtmVisitRequirementSnapshot: ModelMock
  mtmVisitRequirement: ModelMock
  mtmVisitActionResult: ModelMock
  mtmPhoto: ModelMock
  mtmAlert: ModelMock
  mtmAgentLatestLocation: ModelMock
  mtmSetting: ModelMock
  mtmNotification: ModelMock
  mtmRouteNotificationOutbox: ModelMock
  mtmSyncOperation: ModelMock
  mtmMobileRouteCommandReceipt: ModelMock
  mtmMobileSyncStreamRevision: ModelMock
  mtmMobileSyncScopeRevision: ModelMock
  mtmMobileSyncDevice: ModelMock
  mtmMobileSyncStream: ModelMock
  mtmMobileSyncAgentScope: ModelMock
  mtmMobileSyncChange: ModelMock
  mtmMobileSyncSnapshot: ModelMock
  mtmMobileSyncSnapshotLease: ModelMock
  mtmMobileSyncSnapshotItem: ModelMock
  mtmMobileSyncCohort: ModelMock
  mtmMobileSyncRetentionCursor: ModelMock
  mtmMediaObject: ModelMock
  mtmAuditLog: ModelMock
  workforcePolicy: ModelMock
  workforceShiftTemplate: ModelMock
  workforceShiftAssignment: ModelMock
  workforceSite: ModelMock
  workforcePolicySnapshot: ModelMock
  workforceShiftSnapshot: ModelMock
  workforceAttendanceException: ModelMock
  workforceAttendanceReviewCase: ModelMock
  workforceAttendanceQrStation: ModelMock
  workforceAttendanceDeviceEnrollment: ModelMock
  workforceAttendanceDeviceEnrollmentChallenge: ModelMock
  workforceAttendanceVerification: ModelMock
  workforceMobileWriteFence: ModelMock
  workforceTimeCorrection: ModelMock
  workforceTimesheetApproval: ModelMock
  // Region/team hierarchy (M4-5)
  mtmRegion: ModelMock
  mtmTeam: ModelMock
  // Onboarding (M5+)
  mtmOnboarding: ModelMock
  mtmCustomerCreateRequest: ModelMock
  mtmContactChangeRequest: ModelMock
  mtmImportJob: ModelMock
  mtmImportRowError: ModelMock
  mtmExternalSalesDocument: ModelMock
  mtmExternalSalesLine: ModelMock
  mtmSalesPlanLine: ModelMock
  mtmWorkCalendarDay: ModelMock
  mtmPharmacyPromotionType: ModelMock
  mtmPharmacyPromotion: ModelMock
  mtmPharmacyPromotionVersion: ModelMock
  mtmPharmacyPointsFormula: ModelMock
  mtmPharmacyApprovalPolicy: ModelMock
  mtmPharmacyPromotionTarget: ModelMock
  mtmPharmacyPromotionExecution: ModelMock
  mtmPharmacyPromotionEvidence: ModelMock
  mtmPharmacyPromotionReview: ModelMock
  mtmPharmacyPromotionEvent: ModelMock
  mtmPharmacyPointsLedgerEntry: ModelMock
  mtmPharmacyReward: ModelMock
  mtmPharmacyRewardClaim: ModelMock
  mtmPharmacyPromotionOperation: ModelMock
  // Non-mtm models commonly mocked alongside MTM tests
  user: ModelMock
  organization: ModelMock
  savedView: ModelMock
  /**
   * Transaction helper. Production code uses BOTH forms:
   *   prisma.$transaction(async (tx) => { ... })   ← callback form
   *   prisma.$transaction([ promise, promise, ... ])  ← array form
   *
   * Callback form: `tx` is the SAME outer mock instance (NOT a fresh
   * one). Architect M1-5b.6 review caught the tx-isolation bug: tests
   * that set `prisma.mtmVisit.update.mockResolvedValue(...)` must
   * see that override inside `tx.mtmVisit.update(...)` — otherwise
   * test author expectations silently invert.
   * Transaction options are accepted as the second argument and retained in
   * Vitest call metadata, so consistency tests can pin isolation/timeout.
   *
   * Array form: returns `Promise.all(arr)` — matches real Prisma
   * semantics where the array is awaited in order.
   *
   * Typed as `ModelMethod` (callable + vitest Mock) so tests can ALSO
   * use `vi.mocked(prisma.$transaction).mockResolvedValue([...])` to
   * fully override the impl per-test — important for tests that don't
   * want the default callback/array dispatch (e.g. inspect test pins
   * the array passed in, not its execution).
   */
  $transaction: ModelMethod
  /**
   * Raw SQL escape hatches. Durable background processing claims
   * rows with an atomic `UPDATE ... WHERE ... RETURNING` (`FOR UPDATE SKIP
   * LOCKED` semantics) that Prisma's typed API can't express, so the cron
   * processor reaches for `$queryRaw`/`$executeRaw`. Defaults: `$queryRaw`
   * → `[]` (no rows claimed), `$executeRaw` → `0` (no rows affected). Tests
   * override per-case with `.mockResolvedValue(...)`.
   */
  $queryRaw: ModelMethod
  $executeRaw: ModelMethod
  $queryRawUnsafe: ModelMethod
  $executeRawUnsafe: ModelMethod
}

export function makeMtmPrismaMock(): MtmPrismaMock {
  const workforceTimeCorrection = makeModel()
  workforceTimeCorrection.create.mockResolvedValue({ id: "workforce-time-correction-1" })
  const mock: MtmPrismaMock = {
    mtmAgent: makeModel(),
    mtmAgentLocation: makeModel(),
    mtmAgentWorkday: makeModel(),
    mtmAgentWorkdayEvent: makeModel(),
    mtmCustomer: makeModel(),
    mtmContact: makeModel(),
    mtmContactWorkplace: makeModel(),
    mtmCustomerAgentAssignment: makeModel(),
    mtmContactAgentAssignment: makeModel(),
    mtmContactTransferOperation: makeModel(),
    mtmContactAssignmentOperation: makeModel(),
    mtmOrganizationAssignmentOperation: makeModel(),
    mtmFieldPotential: makeModel(),
    mtmFieldPotentialEvidence: makeModel(),
    mtmCoveragePolicy: makeModel(),
    mtmKpiPolicy: makeModel(),
    mtmCoverageSnapshot: makeModel(),
    mtmCoverageSnapshotRow: makeModel(),
    mtmDoctorScoringFormula: makeModel(),
    mtmDoctorAssessment: makeModel(),
    mtmContactDictionary: makeModel(),
    mtmContactDictionaryAssignment: makeModel(),
    mtmOrganizationAttributePackage: makeModel(),
    mtmOrganizationAttributeFact: makeModel(),
    mtmCustomerDepartment: makeModel(),
    mtmCustomerCoordinateVerification: makeModel(),
    mtmCommitment: makeModel(),
    mtmCommitmentFulfillment: makeModel(),
    mtmMessageThread: makeModel(),
    mtmMessageParticipant: makeModel(),
    mtmMessage: makeModel(),
    mtmMessageReceipt: makeModel(),
    mtmDocument: makeModel(),
    mtmDocumentAssignment: makeModel(),
    mtmHrmRequest: makeModel(),
    mtmRoute: makeModel(),
    mtmRoutePoint: makeModel(),
    mtmRouteAssignment: makeModel(),
    mtmRouteChangeRequest: makeModel(),
    mtmTask: makeModel(),
    mtmTaskEvent: makeModel(),
    mtmVisit: makeModel(),
    mtmVisitParticipant: makeModel(),
    mtmVisitPolicy: makeModel(),
    mtmVisitPolicyAction: makeModel(),
    mtmVisitRequirementSnapshot: makeModel(),
    mtmVisitRequirement: makeModel(),
    mtmVisitActionResult: makeModel(),
    mtmPhoto: makeModel(),
    mtmAlert: makeModel(),
    mtmAgentLatestLocation: makeModel(),
    mtmSetting: makeModel(),
    mtmNotification: makeModel(),
    mtmRouteNotificationOutbox: makeModel(),
    mtmSyncOperation: makeModel(),
    mtmMobileRouteCommandReceipt: makeModel(),
    mtmMobileSyncStreamRevision: makeModel(),
    mtmMobileSyncScopeRevision: makeModel(),
    mtmMobileSyncDevice: makeModel(),
    mtmMobileSyncStream: makeModel(),
    mtmMobileSyncAgentScope: makeModel(),
    mtmMobileSyncChange: makeModel(),
    mtmMobileSyncSnapshot: makeModel(),
    mtmMobileSyncSnapshotLease: makeModel(),
    mtmMobileSyncSnapshotItem: makeModel(),
    mtmMobileSyncCohort: makeModel(),
    mtmMobileSyncRetentionCursor: makeModel(),
    mtmMediaObject: makeModel(),
    mtmAuditLog: makeModel(),
    workforcePolicy: makeModel(),
    workforceShiftTemplate: makeModel(),
    workforceShiftAssignment: makeModel(),
    workforceSite: makeModel(),
    workforcePolicySnapshot: makeModel(),
    workforceShiftSnapshot: makeModel(),
    workforceAttendanceException: makeModel(),
    workforceAttendanceReviewCase: makeModel(),
    workforceAttendanceQrStation: makeModel(),
    workforceAttendanceDeviceEnrollment: makeModel(),
    workforceAttendanceDeviceEnrollmentChallenge: makeModel(),
    workforceAttendanceVerification: makeModel(),
    workforceMobileWriteFence: makeModel(),
    workforceTimeCorrection,
    workforceTimesheetApproval: makeModel(),
    mtmRegion: makeModel(),
    mtmTeam: makeModel(),
    mtmOnboarding: makeModel(),
    mtmCustomerCreateRequest: makeModel(),
    mtmContactChangeRequest: makeModel(),
    mtmImportJob: makeModel(),
    mtmImportRowError: makeModel(),
    mtmExternalSalesDocument: makeModel(),
    mtmExternalSalesLine: makeModel(),
    mtmSalesPlanLine: makeModel(),
    mtmWorkCalendarDay: makeModel(),
    mtmPharmacyPromotionType: makeModel(),
    mtmPharmacyPromotion: makeModel(),
    mtmPharmacyPromotionVersion: makeModel(),
    mtmPharmacyPointsFormula: makeModel(),
    mtmPharmacyApprovalPolicy: makeModel(),
    mtmPharmacyPromotionTarget: makeModel(),
    mtmPharmacyPromotionExecution: makeModel(),
    mtmPharmacyPromotionEvidence: makeModel(),
    mtmPharmacyPromotionReview: makeModel(),
    mtmPharmacyPromotionEvent: makeModel(),
    mtmPharmacyPointsLedgerEntry: makeModel(),
    mtmPharmacyReward: makeModel(),
    mtmPharmacyRewardClaim: makeModel(),
    mtmPharmacyPromotionOperation: makeModel(),
    user: makeModel(),
    organization: makeMtmOrganizationModel(),
    savedView: makeModel(),
    // Placeholder — overwritten below so the closure captures the
    // actual outer `mock` (callback form must hand back the SAME
    // instance). Tests can also `vi.mocked($transaction)
    // .mockResolvedValue(...)` to override the default impl entirely.
    $transaction: vi.fn() as ModelMethod,
    // Raw SQL escape hatches (Variant C backstop atomic claim). Safe
    // defaults so an unmocked call resolves instead of rejecting.
    $queryRaw: vi.fn().mockResolvedValue([]) as ModelMethod,
    $executeRaw: vi.fn().mockResolvedValue(0) as ModelMethod,
    $queryRawUnsafe: vi.fn().mockResolvedValue([]) as ModelMethod,
    $executeRawUnsafe: vi.fn().mockResolvedValue(0) as ModelMethod,
  }
  mock.$transaction = vi.fn(async (
    arg: Array<Promise<unknown> | unknown> | ((tx: MtmPrismaMock) => Promise<unknown> | unknown),
    _options?: { isolationLevel?: unknown; maxWait?: number; timeout?: number },
  ): Promise<unknown> => {
    if (Array.isArray(arg)) {
      return Promise.all(arg)
    }
    return arg(mock)
  }) as ModelMethod
  // Sync writers run inside existing route/visit transactions. New model mocks
  // need a realistic revision row by default so unrelated endpoint tests do
  // not crash merely because they exercise a journaled mutation.
  mock.mtmMobileSyncStreamRevision.upsert.mockResolvedValue({ revision: 1n })
  mock.mtmMobileSyncScopeRevision.upsert.mockResolvedValue({ revision: 1n })
  return mock
}
