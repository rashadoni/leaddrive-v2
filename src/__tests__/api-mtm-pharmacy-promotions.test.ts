/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto"
import { Prisma } from "@prisma/client"
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const authState = vi.hoisted(() => ({
  principal: "web" as "web" | "mobile",
  userId: "manager-2-user",
  role: "member",
  agentId: null as string | null,
  name: "Manager Two",
}))

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/with-mtm-rls-auth", () => ({
  withMtmRlsAuth: (_module: unknown, _action: unknown, handler: (...args: any[]) => unknown) =>
    (req: NextRequest, context?: unknown) => handler(req, {
      orgId: "org-1",
      userId: authState.userId,
      role: authState.role,
      email: `${authState.userId}@example.com`,
      name: authState.name,
      agentId: authState.agentId,
      principal: authState.principal,
    }, context),
}))
vi.mock("@/lib/mtm/route-permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mtm/route-permissions")>()
  return { ...actual, resolveMtmRouteActor: vi.fn() }
})
vi.mock("@/lib/mtm-settings", () => ({ getMtmSettings: vi.fn() }))
vi.mock("@/lib/mtm/mobile-capabilities", () => ({ requireMobileCapability: vi.fn() }))
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}))

import {
  GET as listExecutions,
  POST as saveDraft,
} from "@/app/api/v1/mtm/pharmacy-promotion-executions/route"
import { GET as exportExecutions } from "@/app/api/v1/mtm/pharmacy-promotion-executions/export/route"
import { GET as getExecutionDetail } from "@/app/api/v1/mtm/pharmacy-promotion-executions/[id]/route"
import { POST as submitExecution } from "@/app/api/v1/mtm/pharmacy-promotion-executions/[id]/submit/route"
import { GET as listEvidence, POST as uploadEvidence } from "@/app/api/v1/mtm/pharmacy-promotion-executions/[id]/evidence/route"
import { POST as previewReview } from "@/app/api/v1/mtm/pharmacy-promotion-executions/[id]/reviews/preview/route"
import { POST as applyReview } from "@/app/api/v1/mtm/pharmacy-promotion-executions/[id]/reviews/route"
import { prisma } from "@/lib/prisma"
import { resolveMtmRouteActor, type MtmRouteActor } from "@/lib/mtm/route-permissions"
import { getMtmSettings } from "@/lib/mtm-settings"
import { requireMobileCapability } from "@/lib/mtm/mobile-capabilities"
import { pharmacyPromotionHash } from "@/lib/mtm/pharmacy-promotion"

const ORG = "org-1"
const EXECUTION = "execution-1"
const TARGET = "target-1"
const AGENT = "agent-1"
const MANAGER_1 = "manager-1"
const MANAGER_2 = "manager-2"

const fieldAgent: MtmRouteActor = { agentId: AGENT, role: "AGENT", scopedAgentIds: [AGENT] }
const managerOne: MtmRouteActor = { agentId: MANAGER_1, role: "MANAGER", scopedAgentIds: [AGENT] }
const managerTwo: MtmRouteActor = { agentId: MANAGER_2, role: "MANAGER", scopedAgentIds: [AGENT] }

const FORMULA = {
  schemaVersion: 1,
  kind: "LINEAR_V1",
  factPointsPerUnit: "1",
  rewardPointsPerUnit: "0.5",
  scale: 4,
  rounding: "HALF_UP",
  sourceFreshnessMinutes: 60,
} as const

const POLICY = {
  schemaVersion: 1,
  levels: ["L1", "L2"],
  l1Roles: ["MANAGER", "SUPERVISOR", "ADMIN"],
  l2Roles: ["MANAGER", "ADMIN"],
  preventSelfApproval: true,
  requireDistinctReviewers: true,
  reasonRequiredFor: ["REJECTED", "RETURNED"],
} as const

const ELIGIBILITY = {
  schemaVersion: 1,
  customerObjectTypes: ["PHARMACY"],
  requireActiveCustomer: true,
  requireCompletedVisit: true,
  minimumEvidenceCount: 1,
} as const

const formulaHash = pharmacyPromotionHash(FORMULA)
const policyHash = pharmacyPromotionHash(POLICY)
const eligibilityHash = pharmacyPromotionHash(ELIGIBILITY)

function formulaRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "formula-1",
    organizationId: ORG,
    status: "ACTIVE",
    version: 1,
    definition: FORMULA,
    definitionHash: formulaHash,
    signedAt: new Date("2026-08-01T07:00:00.000Z"),
    approvalReference: "SWISSMED-FORMULA-APPROVAL",
    ...overrides,
  }
}

function policyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "policy-1",
    organizationId: ORG,
    status: "ACTIVE",
    version: 1,
    definition: POLICY,
    definitionHash: policyHash,
    signedAt: new Date("2026-08-01T07:00:00.000Z"),
    approvalReference: "SWISSMED-POLICY-APPROVAL",
    allowSelfApproval: false,
    requireDistinctReviewers: true,
    requireRejectReason: true,
    requireReturnReason: true,
    ...overrides,
  }
}

function promotionVersionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "promotion-version-1",
    organizationId: ORG,
    promotionId: "promotion-1",
    typeId: "promotion-type-1",
    revision: 1,
    status: "PUBLISHED",
    nameRu: "Аптечная акция",
    nameAz: "Aptek promosiyası",
    nameEn: "Pharmacy promotion",
    startsOn: new Date("2026-08-01T00:00:00.000Z"),
    endsOn: new Date("2026-08-31T00:00:00.000Z"),
    timezone: "Asia/Baku",
    eligibilityDefinition: ELIGIBILITY,
    eligibilityDefinitionHash: eligibilityHash,
    eligibilityApprovedAt: new Date("2026-08-01T07:00:00.000Z"),
    eligibilityApprovalReference: "SWISSMED-ELIGIBILITY-APPROVAL",
    formulaId: "formula-1",
    approvalPolicyId: "policy-1",
    promotion: { id: "promotion-1", code: "SM-2026-01" },
    type: {
      id: "promotion-type-1",
      code: "SELL_OUT",
      nameRu: "Продажа",
      nameAz: "Satış",
      nameEn: "Sell-out",
    },
    ...overrides,
  }
}

function targetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TARGET,
    organizationId: ORG,
    promotionVersionId: "promotion-version-1",
    customerId: "pharmacy-1",
    contactId: null,
    assignedAgentId: AGENT,
    assignedTeamId: "team-1",
    managingManagerId: MANAGER_1,
    status: "CONNECTED",
    eligibilityStatus: "PENDING",
    planQuantity: new Prisma.Decimal("12"),
    unit: "packs",
    customerNameSnapshot: "Central Pharmacy",
    customerCodeSnapshot: "PH-001",
    customerRegistrationSnapshot: "OKPO-001",
    customerAddressSnapshot: "Baku, Central Street 1",
    agentNameSnapshot: "Field Agent",
    teamNameSnapshot: "Baku Team",
    managerNameSnapshot: "Manager One",
    customer: {
      id: "pharmacy-1",
      objectType: "PHARMACY",
      status: "ACTIVE",
      deletedAt: null,
      locality: "Baku",
      territoryCode: "BAKU-CENTRAL",
    },
    contact: null,
    assignedTeam: { id: "team-1", name: "Baku Team", regionId: "region-1" },
    promotionVersion: {
      ...promotionVersionRow(),
      formula: formulaRow(),
      approvalPolicy: policyRow(),
    },
    ...overrides,
  }
}

function executionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: EXECUTION,
    organizationId: ORG,
    targetId: TARGET,
    visitId: "visit-1",
    agentId: AGENT,
    submittedByAgentId: AGENT,
    submittedByUserId: "agent-user",
    clientExecutionId: "client-execution-0001",
    requestHash: "request-hash",
    planQuantitySnapshot: new Prisma.Decimal("12"),
    actualQuantity: new Prisma.Decimal("10"),
    unit: "packs",
    formulaId: "formula-1",
    formulaVersion: 1,
    formulaHash,
    approvalPolicyId: "policy-1",
    approvalPolicyVersion: 1,
    approvalPolicyHash: policyHash,
    calculationInput: { factQuantity: "10" },
    calculationOutput: { status: "CALCULATED" },
    factPointsPreview: new Prisma.Decimal("10"),
    rewardPointsPreview: new Prisma.Decimal("5"),
    differencePointsPreview: new Prisma.Decimal("5"),
    sourceSystem: "FIELD_AGENT_WEB",
    sourceReference: "operation-draft-0001",
    sourceObservedAt: new Date("2026-08-01T08:55:00.000Z"),
    sourceReceivedAt: new Date("2026-08-01T08:56:00.000Z"),
    status: "READY",
    l1State: "READY",
    l2State: "NOT_READY",
    version: 2,
    submittedAt: new Date("2026-08-01T09:00:00.000Z"),
    readyAt: new Date("2026-08-01T09:00:00.000Z"),
    closedAt: null,
    createdAt: new Date("2026-08-01T08:50:00.000Z"),
    updatedAt: new Date("2026-08-01T09:00:00.000Z"),
    agent: { id: AGENT, name: "Field Agent", teamId: "team-1" },
    target: targetRow(),
    visit: {
      id: "visit-1",
      status: "CHECKED_OUT",
      customerId: "pharmacy-1",
      agentId: AGENT,
      checkInAt: new Date("2026-08-01T08:00:00.000Z"),
      checkOutAt: new Date("2026-08-01T08:45:00.000Z"),
      deletedAt: null,
    },
    formula: formulaRow(),
    approvalPolicy: policyRow(),
    reviews: [],
    ledgerEntries: [],
    _count: { evidence: 1 },
    ...overrides,
  }
}

const params = (id = EXECUTION) => ({ params: Promise.resolve({ id }) })

function jsonRequest(path: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined ? {} : {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  })
}

const draftBody = {
  targetId: TARGET,
  clientExecutionId: "client-execution-0001",
  operationId: "operation-draft-0001",
  visitId: "visit-1",
  factQuantity: "10",
  unit: "packs",
}

function draftRequestHash(body = draftBody): string {
  return pharmacyPromotionHash({
    targetId: body.targetId,
    supersedesExecutionId: "supersedesExecutionId" in body ? body.supersedesExecutionId ?? null : null,
    clientExecutionId: body.clientExecutionId,
    operationId: body.operationId,
    expectedVersion: "expectedVersion" in body ? body.expectedVersion ?? 0 : 0,
    visitId: body.visitId ?? null,
    factQuantity: new Prisma.Decimal(body.factQuantity).toString(),
    unit: body.unit,
    clientOccurredAt: "clientOccurredAt" in body ? body.clientOccurredAt ?? null : null,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-08-01T10:00:00.000Z"))
  authState.principal = "web"
  authState.userId = "manager-2-user"
  authState.role = "member"
  authState.agentId = null
  authState.name = "Manager Two"

  vi.mocked(resolveMtmRouteActor).mockResolvedValue(managerTwo)
  vi.mocked(requireMobileCapability).mockReturnValue(null as never)
  vi.mocked(getMtmSettings).mockResolvedValue({
    timezone: "Asia/Baku",
    pharmacyPromotionPostingEnabled: true,
  } as never)

  vi.mocked(prisma.mtmPharmacyPromotionExecution.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmPharmacyPromotionExecution.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmPharmacyPromotionExecution.count).mockResolvedValue(0)
  vi.mocked(prisma.mtmPharmacyPromotionExecution.aggregate).mockResolvedValue({ _max: { updatedAt: null } } as never)
  vi.mocked(prisma.mtmPharmacyPromotionExecution.updateMany).mockResolvedValue({ count: 1 } as never)
  vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({ id: "visit-1" } as never)
  vi.mocked(prisma.mtmPharmacyPromotionEvidence.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmPharmacyPromotionEvidence.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmPharmacyPromotionReview.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmPharmacyPointsLedgerEntry.groupBy).mockResolvedValue([])
  vi.mocked(prisma.mtmPharmacyPointsLedgerEntry.aggregate).mockResolvedValue({ _max: { occurredAt: null } } as never)
  vi.mocked(prisma.mtmVisit.aggregate).mockResolvedValue({ _max: { updatedAt: null } } as never)
  vi.mocked(prisma.mtmPharmacyPromotionEvent.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ user: { preferredLanguage: "en" } } as never)
  vi.mocked(prisma.mtmTeam.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmPharmacyPromotionVersion.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmPharmacyPromotionVersion.findFirst).mockResolvedValue({
    id: "promotion-version-1",
    status: "PUBLISHED",
    formula: { status: "ACTIVE" },
    approvalPolicy: { status: "ACTIVE" },
  } as never)
  vi.mocked(prisma.mtmSetting.findFirst).mockResolvedValue({ value: true } as never)
  vi.mocked(prisma.mtmPharmacyPromotionTarget.updateMany).mockResolvedValue({ count: 1 } as never)
  vi.mocked(prisma.mtmPharmacyPromotionTarget.update).mockResolvedValue({ id: TARGET } as never)
  vi.mocked(prisma.$queryRaw).mockResolvedValue([])
})

describe("SWM-09 registry scope and field draft containment", () => {
  it("reads registry totals and export rows from repeatable-read snapshots", async () => {
    let snapshotOpen = false
    const runSnapshotTransaction = async (...args: unknown[]) => {
      const operation = args[0] as (tx: typeof prisma) => Promise<unknown>
      expect(snapshotOpen).toBe(false)
      snapshotOpen = true
      try {
        return await operation(prisma)
      } finally {
        snapshotOpen = false
      }
    }
    vi.mocked(prisma.$transaction)
      .mockImplementationOnce(runSnapshotTransaction)
      .mockImplementationOnce(runSnapshotTransaction)
    const expectSnapshotOpen = () => expect(snapshotOpen).toBe(true)
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findMany).mockImplementation(async () => {
      expectSnapshotOpen()
      return []
    })
    vi.mocked(prisma.mtmPharmacyPromotionExecution.count).mockImplementation(async () => {
      expectSnapshotOpen()
      return 0
    })
    vi.mocked(prisma.mtmPharmacyPromotionExecution.aggregate).mockImplementation(async () => {
      expectSnapshotOpen()
      return { _max: { updatedAt: null } } as never
    })
    vi.mocked(prisma.mtmPharmacyPointsLedgerEntry.aggregate).mockImplementation(async () => {
      expectSnapshotOpen()
      return { _max: { occurredAt: null } } as never
    })
    vi.mocked(prisma.mtmVisit.aggregate).mockImplementation(async () => {
      expectSnapshotOpen()
      return { _max: { updatedAt: null } } as never
    })
    vi.mocked(prisma.mtmPharmacyPointsLedgerEntry.groupBy).mockImplementation(async () => {
      expectSnapshotOpen()
      return []
    })

    const listResponse = await listExecutions(jsonRequest(
      "/api/v1/mtm/pharmacy-promotion-executions",
    ))
    const listBody = await listResponse.json()

    expect(listResponse.status).toBe(200)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(vi.mocked(prisma.$transaction).mock.calls[0][1]).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 30_000,
    })

    const exportResponse = await exportExecutions(jsonRequest(
      `/api/v1/mtm/pharmacy-promotion-executions/export?locale=en&snapshotId=${listBody.data.snapshotId}`,
    ))

    expect(exportResponse.status).toBe(200)
    expect(exportResponse.headers.get("x-mtm-snapshot-id")).toBe(listBody.data.snapshotId)
    expect(prisma.$transaction).toHaveBeenCalledTimes(2)
    expect(vi.mocked(prisma.$transaction).mock.calls[1][1]).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 30_000,
    })
  })

  it("rejects an export snapshot after an independently mutable visit changes", async () => {
    const executionUpdatedAt = new Date("2026-08-01T09:00:00.000Z")
    const visitBefore = new Date("2026-08-01T09:01:00.000Z")
    const visitAfter = new Date("2026-08-01T09:02:00.000Z")
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findMany).mockResolvedValue([
      executionRow(),
    ] as never)
    vi.mocked(prisma.mtmPharmacyPromotionExecution.count).mockResolvedValue(1)
    vi.mocked(prisma.mtmPharmacyPromotionExecution.aggregate).mockResolvedValue({
      _max: { updatedAt: executionUpdatedAt },
    } as never)
    vi.mocked(prisma.mtmVisit.aggregate)
      .mockResolvedValueOnce({ _max: { updatedAt: visitBefore } } as never)
      .mockResolvedValueOnce({ _max: { updatedAt: visitAfter } } as never)

    const listResponse = await listExecutions(jsonRequest(
      "/api/v1/mtm/pharmacy-promotion-executions",
    ))
    const listBody = await listResponse.json()
    expect(listResponse.status).toBe(200)
    expect(listBody.data.rows).toHaveLength(1)

    const exportResponse = await exportExecutions(jsonRequest(
      `/api/v1/mtm/pharmacy-promotion-executions/export?locale=en&snapshotId=${listBody.data.snapshotId}`,
    ))

    expect(exportResponse.status).toBe(409)
    expect(await exportResponse.json()).toMatchObject({
      code: "MTM_PHARMACY_EXPORT_SNAPSHOT_STALE",
    })
    expect(prisma.mtmPharmacyPromotionExecution.findMany).toHaveBeenCalledTimes(3)
  })

  it("rejects export when mutable locality membership swaps without changing totals or max timestamps", async () => {
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findMany)
      .mockResolvedValueOnce([executionRow()] as never)
      .mockResolvedValueOnce([{ id: "execution-in-central", updatedAt: new Date("2026-08-01T09:00:00.000Z") }] as never)
      .mockResolvedValueOnce([{ id: "execution-newly-in-central", updatedAt: new Date("2026-08-01T09:00:00.000Z") }] as never)
    vi.mocked(prisma.mtmPharmacyPromotionExecution.count).mockResolvedValue(1)
    vi.mocked(prisma.mtmPharmacyPromotionExecution.aggregate).mockResolvedValue({
      _max: { updatedAt: new Date("2026-08-01T09:00:00.000Z") },
    } as never)

    const listResponse = await listExecutions(jsonRequest(
      "/api/v1/mtm/pharmacy-promotion-executions?localityId=Central",
    ))
    const listBody = await listResponse.json()
    expect(listResponse.status).toBe(200)
    expect(vi.mocked(prisma.mtmPharmacyPromotionExecution.findMany).mock.calls[1][0]).toMatchObject({
      orderBy: { id: "asc" },
      select: {
        visit: {
          select: {
            id: true,
            status: true,
            checkInAt: true,
            checkOutAt: true,
            updatedAt: true,
          },
        },
        target: {
          select: {
            customer: { select: { id: true, updatedAt: true } },
            assignedTeam: { select: { id: true, updatedAt: true } },
          },
        },
      },
    })

    const exportResponse = await exportExecutions(jsonRequest(
      `/api/v1/mtm/pharmacy-promotion-executions/export?locale=en&localityId=Central&snapshotId=${listBody.data.snapshotId}`,
    ))

    expect(exportResponse.status).toBe(409)
    expect(await exportResponse.json()).toMatchObject({
      code: "MTM_PHARMACY_EXPORT_SNAPSHOT_STALE",
    })
    expect(prisma.mtmPharmacyPromotionExecution.findMany).toHaveBeenCalledTimes(3)
  })

  it("projects a reasoned eligibility override consistently in registry and detail readiness", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(managerOne)
    const overridden = executionRow({
      sourceObservedAt: new Date("2026-08-01T09:30:00.000Z"),
      sourceReceivedAt: new Date("2026-08-01T09:31:00.000Z"),
      target: targetRow({
        eligibilityStatus: "OVERRIDDEN",
        eligibilityOverrideReason: "Approved governed field exception",
      }),
      evidence: [],
      events: [],
      _count: { evidence: 0 },
    })
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findMany).mockResolvedValue([overridden] as never)
    vi.mocked(prisma.mtmPharmacyPromotionExecution.count).mockResolvedValue(1)

    const listResponse = await listExecutions(jsonRequest(
      "/api/v1/mtm/pharmacy-promotion-executions",
    ))
    const listBody = await listResponse.json()

    expect(listResponse.status).toBe(200)
    expect(listBody.data.rows[0]).toMatchObject({
      eligibility: {
        status: "OVERRIDDEN",
        overridden: true,
        overrideReason: "Approved governed field exception",
      },
      policy: { ready: true, blockers: [] },
    })

    vi.mocked(prisma.mtmPharmacyPromotionExecution.findFirst).mockResolvedValue(overridden as never)
    const detailResponse = await getExecutionDetail(jsonRequest(
      `/api/v1/mtm/pharmacy-promotion-executions/${EXECUTION}`,
    ), params())
    const detailBody = await detailResponse.json()

    expect(detailResponse.status).toBe(200)
    expect(detailBody.data).toMatchObject({
      permissions: { canReview: true },
      eligibility: {
        status: "OVERRIDDEN",
        overridden: true,
        overrideReason: "Approved governed field exception",
      },
      policy: { ready: true, blockers: [] },
    })
  })

  it("returns target-backed facets constrained to the actor's tenant and employee scope", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(managerOne)
    vi.mocked(prisma.mtmAgent.findMany)
      .mockResolvedValueOnce([{ id: AGENT, name: "Field Agent", teamId: "team-1" }] as never)
      .mockResolvedValueOnce([{ id: MANAGER_1, name: "Manager One" }] as never)
    vi.mocked(prisma.mtmTeam.findMany).mockResolvedValue([
      { id: "team-1", name: "Baku Team", regionId: "region-1" },
    ] as never)
    vi.mocked(prisma.mtmPharmacyPromotionVersion.findMany).mockResolvedValue([
      promotionVersionRow(),
    ] as never)
    vi.mocked(prisma.mtmRegion.findMany).mockResolvedValue([
      { id: "region-1", name: "Baku", code: "BAKU" },
    ] as never)
    vi.mocked(prisma.mtmCustomer.findMany)
      .mockResolvedValueOnce([{ locality: "Central" }] as never)
      .mockResolvedValueOnce([{ territoryCode: "BAKU-CENTRAL" }] as never)
    vi.mocked(prisma.mtmContact.findMany).mockResolvedValue([
      { id: "contact-1", displayName: "Pharmacist One" },
    ] as never)

    const response = await listExecutions(jsonRequest(
      "/api/v1/mtm/pharmacy-promotion-executions",
    ))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.filters).toMatchObject({
      agents: [{ id: AGENT, name: "Field Agent", teamId: "team-1" }],
      teams: [{ id: "team-1", name: "Baku Team", regionId: "region-1" }],
      regions: [{ id: "region-1", name: "Baku", code: "BAKU" }],
      localities: [{ id: "Central", name: "Central" }],
      territories: [{ id: "BAKU-CENTRAL", name: "BAKU-CENTRAL" }],
      contacts: [{ id: "contact-1", name: "Pharmacist One" }],
      managers: [{ id: MANAGER_1, name: "Manager One" }],
      userGroups: [{ id: "team-1", name: "Baku Team" }],
    })
    expect(body.data.filters.promotionVersions).toEqual([
      expect.objectContaining({ id: "promotion-version-1" }),
    ])

    const scopedTarget = {
      organizationId: ORG,
      assignedAgentId: { in: [AGENT] },
    }
    expect(prisma.mtmAgent.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({
        organizationId: ORG,
        status: "ACTIVE",
        id: { in: [AGENT] },
      }),
    }))
    expect(prisma.mtmTeam.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: ORG,
        pharmacyPromotionTargets: { some: scopedTarget },
      },
    }))
    expect(prisma.mtmPharmacyPromotionVersion.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: ORG,
        targets: { some: scopedTarget },
      },
    }))
    expect(prisma.mtmRegion.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: ORG,
        teams: { some: { pharmacyPromotionTargets: { some: scopedTarget } } },
      },
    }))
    expect(prisma.mtmCustomer.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({
        organizationId: ORG,
        locality: { not: null },
        pharmacyPromotionTargets: { some: scopedTarget },
      }),
    }))
    expect(prisma.mtmCustomer.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({
        organizationId: ORG,
        territoryCode: { not: null },
        pharmacyPromotionTargets: { some: scopedTarget },
      }),
    }))
    expect(prisma.mtmContact.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: ORG,
        pharmacyPromotionTargets: { some: scopedTarget },
      },
    }))
    expect(prisma.mtmAgent.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: {
        organizationId: ORG,
        managedPharmacyTargets: { some: scopedTarget },
      },
    }))
  })

  it("conjoins an out-of-scope employee filter with current manager scope and returns no foreign row", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(managerOne)

    const response = await listExecutions(jsonRequest(
      "/api/v1/mtm/pharmacy-promotion-executions?employeeId=agent-foreign",
    ))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.rows).toEqual([])
    const where = vi.mocked(prisma.mtmPharmacyPromotionExecution.findMany).mock.calls[0][0].where as any
    expect(where).toMatchObject({ organizationId: ORG })
    expect(where.AND[0]).toEqual({
      agentId: { in: [AGENT] },
      AND: [{ agentId: "agent-foreign" }],
    })
    expect(prisma.mtmAgent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: ORG, id: { in: [AGENT] } }),
    }))
  })

  it("returns privacy-preserving 404 for evidence outside the actor's current employee scope", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(managerOne)
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findFirst).mockResolvedValue(null)

    const response = await listEvidence(
      jsonRequest(`/api/v1/mtm/pharmacy-promotion-executions/${EXECUTION}/evidence`),
      params(),
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "Not found" })
    expect(prisma.mtmPharmacyPromotionExecution.findFirst).toHaveBeenCalledWith({
      where: { id: EXECUTION, organizationId: ORG, agentId: { in: [AGENT] } },
      select: { id: true },
    })
    expect(prisma.mtmPharmacyPromotionEvidence.findMany).not.toHaveBeenCalled()
  })

  it("pins a mobile draft to the authenticated field agent and ignores any manager identity", async () => {
    authState.principal = "mobile"
    authState.userId = "mobile-user"
    authState.role = "AGENT"
    authState.agentId = AGENT
    authState.name = "Field Agent"
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(fieldAgent)

    const expectedHash = draftRequestHash()
    const created = executionRow({
      status: "DRAFT",
      l1State: "NOT_READY",
      l2State: "NOT_READY",
      version: 1,
      submittedByAgentId: null,
      submittedByUserId: null,
      submittedAt: null,
      readyAt: null,
      requestHash: expectedHash,
      sourceSystem: "FIELD_AGENT_MOBILE",
    })
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    vi.mocked(prisma.mtmPharmacyPromotionTarget.findFirst).mockResolvedValue(targetRow() as never)
    vi.mocked(prisma.mtmPharmacyPromotionExecution.create).mockResolvedValue(created as never)

    const response = await saveDraft(jsonRequest(
      "/api/v1/mtm/pharmacy-promotion-executions",
      draftBody,
    ))

    expect(response.status).toBe(201)
    expect(prisma.mtmPharmacyPromotionTarget.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: TARGET,
        organizationId: ORG,
        assignedAgentId: AGENT,
      }),
    }))
    expect(prisma.mtmPharmacyPromotionExecution.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: ORG,
        targetId: TARGET,
        agentId: AGENT,
        clientExecutionId: draftBody.clientExecutionId,
        requestHash: expectedHash,
        sourceSystem: "FIELD_AGENT_MOBILE",
      }),
    }))
    expect(prisma.mtmPharmacyPromotionEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ actorAgentId: AGENT, actorUserId: null }),
    }))
  })

  it("preserves a supplied old fact time, accepts one-minute clock skew, and rejects more than five minutes", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(fieldAgent)
    authState.userId = "agent-user"
    vi.mocked(prisma.mtmPharmacyPromotionTarget.findFirst).mockResolvedValue(targetRow() as never)
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmPharmacyPromotionExecution.create).mockResolvedValue(executionRow({
      status: "DRAFT",
      l1State: "NOT_READY",
      l2State: "NOT_READY",
      submittedByAgentId: null,
      submittedByUserId: null,
      submittedAt: null,
      readyAt: null,
    }) as never)

    const accepted = await saveDraft(jsonRequest(
      "/api/v1/mtm/pharmacy-promotion-executions",
      {
        ...draftBody,
        clientExecutionId: "client-execution-clock-skew-ok",
        operationId: "operation-clock-skew-ok",
        clientOccurredAt: "2026-08-01T10:01:00.000Z",
      },
    ))

    expect(accepted.status).toBe(201)
    expect(prisma.mtmPharmacyPromotionExecution.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        sourceObservedAt: new Date("2026-08-01T10:01:00.000Z"),
        sourceReceivedAt: new Date("2026-08-01T10:00:00.000Z"),
      }),
    }))

    vi.mocked(prisma.mtmPharmacyPromotionExecution.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmPharmacyPromotionExecution.create).mockClear()
    const rejected = await saveDraft(jsonRequest(
      "/api/v1/mtm/pharmacy-promotion-executions",
      {
        ...draftBody,
        clientExecutionId: "client-execution-clock-skew-bad",
        operationId: "operation-clock-skew-bad",
        clientOccurredAt: "2026-08-01T10:06:00.000Z",
      },
    ))

    expect(rejected.status).toBe(400)
    expect(await rejected.json()).toMatchObject({ code: "MTM_PHARMACY_SOURCE_TIME_INVALID" })
    expect(prisma.mtmPharmacyPromotionExecution.create).not.toHaveBeenCalled()

    vi.mocked(prisma.mtmPharmacyPromotionExecution.findFirst).mockResolvedValue(null)
    const oldFact = await saveDraft(jsonRequest(
      "/api/v1/mtm/pharmacy-promotion-executions",
      {
        ...draftBody,
        clientExecutionId: "client-execution-old-fact",
        operationId: "operation-old-fact",
        clientOccurredAt: "2026-07-01T08:00:00.000Z",
      },
    ))
    expect(oldFact.status).toBe(201)
    expect(prisma.mtmPharmacyPromotionExecution.create).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        sourceObservedAt: new Date("2026-07-01T08:00:00.000Z"),
      }),
    }))
  })

  it("returns a deterministic conflict before persistence when signed calculation exceeds DECIMAL(18,4)", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(fieldAgent)
    authState.userId = "agent-user"
    const overflowDefinition = { ...FORMULA, factPointsPerUnit: "2" }
    const overflowFormula = formulaRow({
      definition: overflowDefinition,
      definitionHash: pharmacyPromotionHash(overflowDefinition),
    })
    vi.mocked(prisma.mtmPharmacyPromotionTarget.findFirst).mockResolvedValue(targetRow({
      promotionVersion: {
        ...promotionVersionRow(),
        formula: overflowFormula,
        approvalPolicy: policyRow(),
      },
    }) as never)

    const response = await saveDraft(jsonRequest(
      "/api/v1/mtm/pharmacy-promotion-executions",
      {
        ...draftBody,
        clientExecutionId: "client-execution-overflow-0001",
        operationId: "operation-overflow-0001",
        factQuantity: "99999999999999.9999",
      },
    ))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_PHARMACY_CALCULATION_OUT_OF_RANGE" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPromotionExecution.create).not.toHaveBeenCalled()
  })

  it("denies a mobile manager before target or execution writes", async () => {
    authState.principal = "mobile"
    authState.userId = "mobile-manager"
    authState.role = "MANAGER"
    authState.agentId = MANAGER_1
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: MANAGER_1,
      role: "MANAGER",
      scopedAgentIds: [AGENT],
    })

    const response = await saveDraft(jsonRequest(
      "/api/v1/mtm/pharmacy-promotion-executions",
      draftBody,
    ))

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "MTM_PHARMACY_FIELD_EXECUTE_DENIED" })
    expect(prisma.mtmPharmacyPromotionTarget.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPromotionExecution.create).not.toHaveBeenCalled()
  })

  it("replays the exact draft and rejects the same client ID with changed facts", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(fieldAgent)
    authState.userId = "agent-user"
    const exact = executionRow({ requestHash: draftRequestHash() })
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findFirst).mockResolvedValueOnce(exact as never)

    const replay = await saveDraft(jsonRequest(
      "/api/v1/mtm/pharmacy-promotion-executions",
      draftBody,
    ))
    expect(replay.status).toBe(200)
    expect(await replay.json()).toMatchObject({ success: true, idempotent: true })
    expect(prisma.mtmPharmacyPromotionExecution.create).not.toHaveBeenCalled()

    const changed = { ...draftBody, factQuantity: "11" }
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findFirst).mockResolvedValueOnce(exact as never)
    const conflict = await saveDraft(jsonRequest(
      "/api/v1/mtm/pharmacy-promotion-executions",
      changed,
    ))
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toMatchObject({ code: "MTM_PHARMACY_EXECUTION_IDEMPOTENCY_CONFLICT" })
    expect(prisma.mtmPharmacyPromotionExecution.create).not.toHaveBeenCalled()
  })

  it("rejects a new client execution ID that collides with an existing canonical ID", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(fieldAgent)
    authState.userId = "agent-user"
    const collidingBody = {
      ...draftBody,
      clientExecutionId: "execution-existing-canonical",
      operationId: "operation-reference-collision-0001",
    }
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "execution-existing-canonical" } as never)
    vi.mocked(prisma.mtmPharmacyPromotionTarget.findFirst).mockResolvedValue(targetRow() as never)

    const response = await saveDraft(jsonRequest(
      "/api/v1/mtm/pharmacy-promotion-executions",
      collidingBody,
    ))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_PHARMACY_EXECUTION_REFERENCE_CONFLICT" })
    expect(prisma.mtmPharmacyPromotionExecution.create).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPromotionEvent.create).not.toHaveBeenCalled()
  })

  it("creates one successor for a returned execution and pins the predecessor in every durable envelope", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(fieldAgent)
    authState.userId = "agent-user"
    const predecessorId = "execution-returned-1"
    const correctionBody = {
      ...draftBody,
      supersedesExecutionId: predecessorId,
      clientExecutionId: "client-execution-correction-0001",
      operationId: "operation-correction-0001",
      factQuantity: "11",
    }
    const expectedHash = draftRequestHash(correctionBody)
    const target = targetRow()
    const created = executionRow({
      id: "execution-correction-1",
      clientExecutionId: correctionBody.clientExecutionId,
      requestHash: expectedHash,
      supersedesExecutionId: predecessorId,
      actualQuantity: new Prisma.Decimal(correctionBody.factQuantity),
      status: "DRAFT",
      l1State: "NOT_READY",
      l2State: "NOT_READY",
      version: 1,
      submittedByAgentId: null,
      submittedByUserId: null,
      submittedAt: null,
      readyAt: null,
    })
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: predecessorId } as never)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: predecessorId } as never)
    vi.mocked(prisma.mtmPharmacyPromotionTarget.findFirst)
      .mockResolvedValueOnce(target as never)
      .mockResolvedValueOnce({ id: TARGET } as never)
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({ id: "visit-1" } as never)
    vi.mocked(prisma.mtmPharmacyPromotionVersion.findFirst).mockResolvedValue({
      id: "promotion-version-1",
      status: "PUBLISHED",
      formula: { status: "ACTIVE" },
      approvalPolicy: { status: "ACTIVE" },
    } as never)
    vi.mocked(prisma.mtmPharmacyPromotionExecution.create).mockResolvedValue(created as never)

    const response = await saveDraft(jsonRequest(
      "/api/v1/mtm/pharmacy-promotion-executions",
      correctionBody,
    ))

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      success: true,
      idempotent: false,
      data: { id: "execution-correction-1" },
    })
    const predecessorWhere = {
      id: predecessorId,
      organizationId: ORG,
      targetId: TARGET,
      agentId: AGENT,
      status: { in: ["RETURNED", "REJECTED"] },
      successorExecution: { is: null },
    }
    expect(prisma.mtmPharmacyPromotionExecution.findFirst).toHaveBeenNthCalledWith(2, {
      where: predecessorWhere,
      select: { id: true },
    })
    expect(prisma.mtmPharmacyPromotionExecution.findFirst).toHaveBeenNthCalledWith(5, {
      where: predecessorWhere,
      select: { id: true },
    })
    expect(prisma.mtmPharmacyPromotionExecution.create).toHaveBeenCalledTimes(1)
    expect(prisma.mtmPharmacyPromotionExecution.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: ORG,
        targetId: TARGET,
        agentId: AGENT,
        supersedesExecutionId: predecessorId,
        clientExecutionId: correctionBody.clientExecutionId,
        requestHash: expectedHash,
      }),
    }))
    expect(prisma.mtmPharmacyPromotionEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        executionId: "execution-correction-1",
        requestHash: expectedHash,
        payload: expect.objectContaining({ supersedesExecutionId: predecessorId }),
      }),
    }))
  })

  it("rejects an invalid or out-of-scope correction predecessor before any transaction or write", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(fieldAgent)
    authState.userId = "agent-user"
    const correctionBody = {
      ...draftBody,
      supersedesExecutionId: "execution-foreign-1",
      clientExecutionId: "client-execution-correction-0002",
      operationId: "operation-correction-0002",
    }
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    vi.mocked(prisma.mtmPharmacyPromotionTarget.findFirst).mockResolvedValue(targetRow() as never)
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({ id: "visit-1" } as never)

    const response = await saveDraft(jsonRequest(
      "/api/v1/mtm/pharmacy-promotion-executions",
      correctionBody,
    ))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_PHARMACY_CORRECTION_PREDECESSOR_INVALID" })
    expect(prisma.mtmPharmacyPromotionExecution.findFirst).toHaveBeenNthCalledWith(2, {
      where: {
        id: correctionBody.supersedesExecutionId,
        organizationId: ORG,
        targetId: TARGET,
        agentId: AGENT,
        status: { in: ["RETURNED", "REJECTED"] },
        successorExecution: { is: null },
      },
      select: { id: true },
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPromotionExecution.create).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPromotionTarget.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPromotionEvent.create).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("drains an already-planned target after its signed formula, policy and campaign are retired", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(fieldAgent)
    authState.userId = "agent-user"
    const retiredFormula = formulaRow({ status: "RETIRED" })
    const retiredPolicy = policyRow({ status: "RETIRED" })
    const retiredTarget = targetRow({
      status: "PLANNED",
      promotionVersion: {
        ...promotionVersionRow({ status: "RETIRED" }),
        formula: retiredFormula,
        approvalPolicy: retiredPolicy,
      },
    })
    const retiredDraftBody = {
      ...draftBody,
      clientExecutionId: "client-execution-retired-0001",
      operationId: "operation-retired-0001",
    }
    const expectedHash = draftRequestHash(retiredDraftBody)
    const created = executionRow({
      clientExecutionId: retiredDraftBody.clientExecutionId,
      requestHash: expectedHash,
      status: "DRAFT",
      l1State: "NOT_READY",
      l2State: "NOT_READY",
      version: 1,
      submittedByAgentId: null,
      submittedByUserId: null,
      submittedAt: null,
      readyAt: null,
      target: retiredTarget,
      formula: retiredFormula,
      approvalPolicy: retiredPolicy,
    })
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    vi.mocked(prisma.mtmPharmacyPromotionTarget.findFirst)
      .mockResolvedValueOnce(retiredTarget as never)
      .mockResolvedValueOnce({ id: TARGET } as never)
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({ id: "visit-1" } as never)
    vi.mocked(prisma.mtmPharmacyPromotionVersion.findFirst).mockResolvedValue({
      id: "promotion-version-1",
      status: "RETIRED",
      formula: { status: "RETIRED" },
      approvalPolicy: { status: "RETIRED" },
    } as never)
    vi.mocked(prisma.mtmPharmacyPromotionExecution.create).mockResolvedValue(created as never)

    const response = await saveDraft(jsonRequest(
      "/api/v1/mtm/pharmacy-promotion-executions",
      retiredDraftBody,
    ))

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ success: true, idempotent: false })
    expect(prisma.mtmPharmacyPromotionTarget.findFirst).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({
        id: TARGET,
        organizationId: ORG,
        assignedAgentId: AGENT,
        status: { in: ["PLANNED", "CONNECTED"] },
      }),
    }))
    expect(prisma.mtmPharmacyPromotionVersion.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: "promotion-version-1",
        organizationId: ORG,
        status: { in: ["PUBLISHED", "RETIRED"] },
      },
    }))
    expect(prisma.mtmPharmacyPromotionExecution.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        targetId: TARGET,
        requestHash: expectedHash,
        supersedesExecutionId: null,
        status: "DRAFT",
      }),
    }))
    expect(prisma.mtmPharmacyPromotionTarget.updateMany).toHaveBeenCalledWith({
      where: { id: TARGET, organizationId: ORG, status: "PLANNED" },
      data: { status: "CONNECTED", connectedAt: expect.any(Date) },
    })
  })
})

describe("SWM-09 fail-closed submit and optimistic versioning", () => {
  const submitBody = { operationId: "operation-submit-0001", expectedVersion: 1 }

  beforeEach(() => {
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findMany).mockResolvedValue([{
      id: EXECUTION,
      target: { promotionVersionId: "promotion-version-1" },
    }] as never)
  })

  function draftForSubmit(overrides: Record<string, unknown> = {}) {
    return executionRow({
      status: "DRAFT",
      l1State: "NOT_READY",
      l2State: "NOT_READY",
      version: 1,
      submittedByAgentId: null,
      submittedByUserId: null,
      submittedAt: null,
      readyAt: null,
      sourceObservedAt: new Date("2026-08-01T09:30:00.000Z"),
      sourceReceivedAt: new Date("2026-08-01T09:31:00.000Z"),
      ...overrides,
    })
  }

  it.each([
    ["unsigned formula", true, { formula: formulaRow({ signedAt: null }) }],
    ["posting disabled", false, {}],
  ] as const)("keeps %s from submitting and writes no state, event, ledger or audit", async (_case, postingEnabled, overrides) => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(fieldAgent)
    authState.userId = "agent-user"
    vi.mocked(getMtmSettings).mockResolvedValue({
      timezone: "Asia/Baku",
      pharmacyPromotionPostingEnabled: postingEnabled,
    } as never)
    vi.mocked(prisma.mtmSetting.findFirst).mockResolvedValue({ value: postingEnabled } as never)
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findFirst).mockResolvedValue(
      draftForSubmit(overrides as Record<string, unknown>) as never,
    )

    const response = await submitExecution(jsonRequest(
      `/api/v1/mtm/pharmacy-promotion-executions/${EXECUTION}/submit`,
      submitBody,
    ), params())

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_PHARMACY_CONFIGURATION_NOT_SIGNED" })
    expect(prisma.mtmPharmacyPromotionExecution.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPromotionEvent.create).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPointsLedgerEntry.create).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it.each([
    ["soft-deleted", { deletedAt: new Date("2026-08-01T09:45:00.000Z") }],
    ["missing checkout timestamp", { checkOutAt: null }],
  ] as const)("rejects a %s checked-out visit without any workflow writes", async (_case, visitOverrides) => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(fieldAgent)
    authState.userId = "agent-user"
    const draft = draftForSubmit()
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findFirst).mockResolvedValue({
      ...draft,
      visit: { ...draft.visit, ...visitOverrides },
    } as never)

    const response = await submitExecution(jsonRequest(
      `/api/v1/mtm/pharmacy-promotion-executions/${EXECUTION}/submit`,
      submitBody,
    ), params())

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      code: "MTM_PHARMACY_VISIT_INCOMPLETE",
    })
    expect(prisma.mtmPharmacyPromotionExecution.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        visit: {
          select: expect.objectContaining({ checkOutAt: true, deletedAt: true }),
        },
      }),
    }))
    expect(prisma.mtmPharmacyPromotionExecution.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPromotionTarget.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPromotionEvent.create).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPointsLedgerEntry.create).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("records the committed PENDING to ELIGIBLE transition in event and audit snapshots", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(fieldAgent)
    authState.userId = "agent-user"
    const draft = draftForSubmit()
    const ready = {
      ...draft,
      status: "READY",
      l1State: "READY",
      version: 2,
      submittedAt: new Date("2026-08-01T10:00:00.000Z"),
      readyAt: new Date("2026-08-01T10:00:00.000Z"),
    }
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findFirst)
      .mockResolvedValueOnce(draft as never)
      .mockResolvedValueOnce(ready as never)

    const response = await submitExecution(jsonRequest(
      `/api/v1/mtm/pharmacy-promotion-executions/${EXECUTION}/submit`,
      submitBody,
    ), params())

    expect(response.status).toBe(200)
    expect(prisma.mtmPharmacyPromotionTarget.updateMany).toHaveBeenCalledWith({
      where: { organizationId: ORG, id: TARGET, eligibilityStatus: "PENDING" },
      data: expect.objectContaining({
        eligibilityStatus: "ELIGIBLE",
        eligibilitySnapshot: expect.objectContaining({ status: "ELIGIBLE", reasons: [] }),
      }),
    })
    expect(prisma.mtmPharmacyPromotionEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: "EXECUTION_SUBMITTED",
        payload: expect.objectContaining({
          eligibility: {
            evaluatedStatus: "ELIGIBLE",
            evaluatedReasons: [],
            previousTargetStatus: "PENDING",
            targetStatus: "ELIGIBLE",
            overridden: false,
            overrideReason: null,
          },
        }),
      }),
    })
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        oldData: expect.objectContaining({ eligibilityStatus: "PENDING" }),
        newData: expect.objectContaining({ eligibilityStatus: "ELIGIBLE" }),
      }),
    })
  })

  it("returns a version conflict when the DRAFT CAS loses and appends no submit facts", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(fieldAgent)
    authState.userId = "agent-user"
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findFirst).mockResolvedValue(draftForSubmit() as never)
    vi.mocked(prisma.mtmPharmacyPromotionExecution.updateMany).mockResolvedValue({ count: 0 } as never)

    const response = await submitExecution(jsonRequest(
      `/api/v1/mtm/pharmacy-promotion-executions/${EXECUTION}/submit`,
      submitBody,
    ), params())

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_PHARMACY_EXECUTION_VERSION_CONFLICT" })
    expect(prisma.mtmPharmacyPromotionExecution.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: EXECUTION,
        organizationId: ORG,
        agentId: AGENT,
        status: "DRAFT",
        version: 1,
      }),
    }))
    expect(prisma.mtmPharmacyPromotionEvent.create).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })
})

describe("SWM-09 evidence checksum and durable business replay", () => {
  const content = "proof"
  const checksum = createHash("sha256").update(content).digest("hex")
  const capturedAt = "2026-08-01T08:40:00.000Z"

  function evidenceRequest(checksumSha256 = checksum) {
    const form = new FormData()
    form.append("file", new File([content], "proof.txt", { type: "text/plain" }))
    form.append("clientEvidenceId", "client-evidence-0001")
    form.append("clientDocumentId", "client-document-0001")
    form.append("operationId", "operation-evidence-0001")
    form.append("capturedAt", capturedAt)
    form.append("checksumSha256", checksumSha256)
    form.append("title", "Proof")
    return new NextRequest(
      `http://localhost/api/v1/mtm/pharmacy-promotion-executions/${EXECUTION}/evidence`,
      { method: "POST", body: form },
    )
  }

  function evidenceReplay(overrides: Record<string, unknown> = {}) {
    const requestHash = pharmacyPromotionHash({
      executionId: EXECUTION,
      clientEvidenceId: "client-evidence-0001",
      clientDocumentId: "client-document-0001",
      operationId: "operation-evidence-0001",
      fileName: "proof.txt",
      mimeType: "text/plain",
      sizeBytes: Buffer.byteLength(content),
      contentHash: checksum,
      capturedAt,
      title: "Proof",
    })
    return {
      id: "evidence-1",
      executionId: EXECUTION,
      submittedByAgentId: AGENT,
      clientEvidenceId: "client-evidence-0001",
      requestHash,
      kind: "DOCUMENT",
      contentHash: checksum,
      capturedAt: new Date(capturedAt),
      sourceObservedAt: new Date(capturedAt),
      sourceReceivedAt: new Date("2026-08-01T09:00:00.000Z"),
      metadata: { operationId: "operation-evidence-0001" },
      createdAt: new Date("2026-08-01T09:00:00.000Z"),
      document: {
        id: "document-1",
        clientDocumentId: "client-document-0001",
        title: "Proof",
        fileName: "proof.txt",
        mimeType: "text/plain",
        sizeBytes: Buffer.byteLength(content),
        checksumSha256: checksum,
        deletedAt: null,
      },
      ...overrides,
    }
  }

  it("rejects a checksum mismatch before replay lookup, storage or domain writes", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(fieldAgent)
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findFirst).mockResolvedValue({
      id: EXECUTION, agentId: AGENT, visitId: "visit-1", version: 1,
    } as never)

    const response = await uploadEvidence(evidenceRequest("0".repeat(64)), params())

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_PHARMACY_EVIDENCE_CHECKSUM_MISMATCH" })
    expect(prisma.mtmPharmacyPromotionEvidence.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmDocument.create).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPromotionEvidence.create).not.toHaveBeenCalled()
  })

  it("writes the immutable evidence event with a normalized tenant-scoped evidence subject", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(fieldAgent)
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findFirst).mockResolvedValue({
      id: EXECUTION,
      agentId: AGENT,
      visitId: "visit-1",
      version: 1,
      status: "DRAFT",
    } as never)
    vi.mocked(prisma.mtmDocument.create).mockResolvedValue({ id: "document-1" } as never)
    vi.mocked(prisma.mtmPharmacyPromotionEvidence.create).mockResolvedValue(evidenceReplay() as never)

    const response = await uploadEvidence(evidenceRequest(), params())

    expect(response.status).toBe(201)
    expect(prisma.mtmPharmacyPromotionEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: ORG,
        executionId: EXECUTION,
        evidenceId: "evidence-1",
        eventType: "EVIDENCE_ADDED",
        actorAgentId: AGENT,
        sourceKey: `execution:${EXECUTION}:evidence:client-evidence-0001`,
      }),
    })
  })

  it("replays exact evidence and rejects changed facts for the same client evidence ID", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(fieldAgent)
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findFirst).mockResolvedValue({
      id: EXECUTION, agentId: AGENT, visitId: "visit-1", version: 1,
    } as never)
    const exact = evidenceReplay()
    vi.mocked(prisma.mtmPharmacyPromotionEvidence.findFirst).mockResolvedValueOnce(exact as never)

    const replay = await uploadEvidence(evidenceRequest(), params())
    expect(replay.status).toBe(200)
    expect(await replay.json()).toMatchObject({ success: true, idempotent: true })
    expect(prisma.mtmDocument.create).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPromotionEvidence.create).not.toHaveBeenCalled()

    vi.mocked(prisma.mtmPharmacyPromotionEvidence.findFirst).mockResolvedValueOnce(
      evidenceReplay({ requestHash: "different-request-hash" }) as never,
    )
    const mismatch = await uploadEvidence(evidenceRequest(), params())
    expect(mismatch.status).toBe(409)
    expect(await mismatch.json()).toMatchObject({ code: "MTM_PHARMACY_EVIDENCE_REPLAY_MISMATCH" })
    expect(prisma.mtmDocument.create).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPromotionEvidence.create).not.toHaveBeenCalled()
  })

  it("replays a lost evidence response after the execution was submitted when capturedAt is canonical", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(fieldAgent)
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findFirst).mockImplementation(async (args: any) => {
      if (args?.where?.status === "DRAFT") return null
      return {
        id: EXECUTION,
        agentId: AGENT,
        visitId: "visit-1",
        version: 2,
        status: "READY",
      }
    })
    vi.mocked(prisma.mtmPharmacyPromotionEvidence.findFirst).mockResolvedValue(evidenceReplay() as never)

    const response = await uploadEvidence(evidenceRequest(), params())

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      idempotent: true,
      data: { id: "evidence-1", clientEvidenceId: "client-evidence-0001" },
    })
    expect(prisma.mtmDocument.create).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPromotionEvidence.create).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPromotionEvent.create).not.toHaveBeenCalled()
  })
})

describe("SWM-09 review preview authorization and stage ordering", () => {
  it("returns 404 without disclosing a review execution outside current scope", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(managerOne)
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findFirst).mockResolvedValue(null)

    const response = await previewReview(jsonRequest(
      `/api/v1/mtm/pharmacy-promotion-executions/${EXECUTION}/reviews/preview`,
      { expectedVersion: 2, level: "L1", decision: "APPROVED" },
    ), params())

    expect(response.status).toBe(404)
    expect(prisma.mtmPharmacyPromotionExecution.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: EXECUTION,
        organizationId: ORG,
        agentId: { in: [AGENT] },
      },
    }))
  })

  it("denies self-review before producing a decision preview", async () => {
    const selfManager: MtmRouteActor = { agentId: AGENT, role: "MANAGER", scopedAgentIds: [AGENT] }
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(selfManager)
    authState.userId = "agent-user"
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findFirst).mockResolvedValue(executionRow() as never)

    const response = await previewReview(jsonRequest(
      `/api/v1/mtm/pharmacy-promotion-executions/${EXECUTION}/reviews/preview`,
      { expectedVersion: 2, level: "L1", decision: "APPROVED" },
    ), params())

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "MTM_PHARMACY_SELF_REVIEW_DENIED" })
    expect(prisma.mtmPharmacyPromotionReview.create).not.toHaveBeenCalled()
  })

  it("requires a reviewer distinct from the recorded L1 reviewer", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(managerOne)
    authState.userId = "manager-1-user"
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findFirst).mockResolvedValue(executionRow({
      status: "IN_REVIEW",
      l1State: "APPROVED",
      l2State: "READY",
      version: 3,
      reviews: [{
        level: "L1",
        decision: "APPROVED",
        reviewerAgentId: MANAGER_1,
        reviewerUserId: "manager-1-user",
      }],
    }) as never)

    const response = await previewReview(jsonRequest(
      `/api/v1/mtm/pharmacy-promotion-executions/${EXECUTION}/reviews/preview`,
      { expectedVersion: 3, level: "L2", decision: "APPROVED" },
    ), params())

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "MTM_PHARMACY_DISTINCT_REVIEWER_REQUIRED" })
  })

  it("rejects L2 before L1 has approved the execution", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(managerTwo)
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findFirst).mockResolvedValue(executionRow() as never)

    const response = await previewReview(jsonRequest(
      `/api/v1/mtm/pharmacy-promotion-executions/${EXECUTION}/reviews/preview`,
      { expectedVersion: 2, level: "L2", decision: "APPROVED" },
    ), params())

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_PHARMACY_L2_NOT_READY" })
    expect(prisma.mtmPharmacyPromotionReview.create).not.toHaveBeenCalled()
  })
})

describe("SWM-09 review apply, CAS and atomic ledger posting", () => {
  async function generatePreview(
    execution: ReturnType<typeof executionRow>,
    input: { expectedVersion: number; level: "L1" | "L2"; decision: "APPROVED" | "REJECTED" | "RETURNED"; reason?: string },
  ): Promise<string> {
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findFirst).mockResolvedValueOnce(execution as never)
    const response = await previewReview(jsonRequest(
      `/api/v1/mtm/pharmacy-promotion-executions/${EXECUTION}/reviews/preview`,
      input,
    ), params())
    expect(response.status).toBe(200)
    return (await response.json()).data.previewHash
  }

  function reviewRow(level: "L1" | "L2") {
    return {
      id: `review-${level.toLowerCase()}`,
      executionId: EXECUTION,
      level,
      decision: "APPROVED",
      reason: null,
      reviewerAgentId: level === "L1" ? MANAGER_1 : MANAGER_2,
      reviewerUserId: level === "L1" ? "manager-1-user" : "manager-2-user",
      reviewerNameSnapshot: level === "L1" ? "Manager One" : "Manager Two",
      factPointsPreview: new Prisma.Decimal("10"),
      rewardPointsPreview: new Prisma.Decimal("5"),
      differencePointsPreview: new Prisma.Decimal("5"),
      decidedAt: new Date("2026-08-01T10:00:00.000Z"),
    }
  }

  it("does not replay a prior review after the employee leaves the reviewer's current scope", async () => {
    const replayBody = {
      expectedVersion: 2,
      level: "L1" as const,
      decision: "APPROVED" as const,
      operationId: "operation-review-replay",
      idempotencyKey: "idempotency-review-replay",
      previewHash: "a".repeat(64),
    }
    const requestHash = pharmacyPromotionHash({ executionId: EXECUTION, ...replayBody })
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(managerOne)
    authState.userId = "manager-1-user"
    authState.name = "Manager One"
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findFirst)
      .mockResolvedValueOnce({ id: EXECUTION } as never)
      .mockResolvedValueOnce(null)
    vi.mocked(prisma.mtmPharmacyPromotionReview.findFirst).mockResolvedValue({
      ...reviewRow("L1"),
      idempotencyKey: replayBody.idempotencyKey,
      requestHash,
    } as never)

    const response = await applyReview(jsonRequest(
      `/api/v1/mtm/pharmacy-promotion-executions/${EXECUTION}/reviews`,
      replayBody,
    ), params())

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "Not found" })
    expect(prisma.mtmPharmacyPromotionExecution.findFirst).toHaveBeenNthCalledWith(2, {
      where: {
        id: EXECUTION,
        organizationId: ORG,
        agentId: { in: [AGENT] },
      },
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPromotionExecution.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPointsLedgerEntry.create).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPromotionEvent.create).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("rejects a stale preview before review, state, ledger, event or audit writes", async () => {
    const current = executionRow()
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(managerOne)
    authState.userId = "manager-1-user"
    authState.name = "Manager One"
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findFirst)
      .mockResolvedValueOnce({ id: EXECUTION } as never)
      .mockResolvedValueOnce(current as never)

    const response = await applyReview(jsonRequest(
      `/api/v1/mtm/pharmacy-promotion-executions/${EXECUTION}/reviews`,
      {
        expectedVersion: 2,
        level: "L1",
        decision: "APPROVED",
        operationId: "operation-review-l1",
        idempotencyKey: "idempotency-review-l1",
        previewHash: "0".repeat(64),
      },
    ), params())

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_PHARMACY_REVIEW_PREVIEW_STALE" })
    expect(prisma.mtmPharmacyPromotionReview.create).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPromotionExecution.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPointsLedgerEntry.create).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPromotionEvent.create).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })

  it("applies L1 in one callback transaction without posting any ledger entry", async () => {
    const current = executionRow()
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(managerOne)
    authState.userId = "manager-1-user"
    authState.name = "Manager One"
    const previewHash = await generatePreview(current, {
      expectedVersion: 2,
      level: "L1",
      decision: "APPROVED",
    })
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findFirst).mockReset()
    const refreshed = executionRow({
      status: "IN_REVIEW",
      l1State: "APPROVED",
      l2State: "READY",
      version: 3,
    })
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findFirst)
      .mockResolvedValueOnce({ id: EXECUTION } as never)
      .mockResolvedValueOnce(current as never)
      .mockResolvedValueOnce(refreshed as never)
    vi.mocked(prisma.mtmPharmacyPromotionReview.create).mockResolvedValue(reviewRow("L1") as never)

    const response = await applyReview(jsonRequest(
      `/api/v1/mtm/pharmacy-promotion-executions/${EXECUTION}/reviews`,
      {
        expectedVersion: 2,
        level: "L1",
        decision: "APPROVED",
        operationId: "operation-review-l1",
        idempotencyKey: "idempotency-review-l1",
        previewHash,
      },
    ), params())

    expect(response.status).toBe(200)
    expect(typeof vi.mocked(prisma.$transaction).mock.calls[0][0]).toBe("function")
    expect(vi.mocked(prisma.$transaction).mock.calls[0][1]).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    })
    expect(prisma.mtmPharmacyPromotionReview.create).toHaveBeenCalledTimes(1)
    expect(prisma.mtmPharmacyPromotionExecution.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: EXECUTION,
        organizationId: ORG,
        version: 2,
        status: "READY",
        l1State: "READY",
        l2State: "NOT_READY",
      }),
      data: expect.objectContaining({
        status: "IN_REVIEW",
        l1State: "APPROVED",
        l2State: "READY",
        version: { increment: 1 },
      }),
    }))
    expect(prisma.mtmPharmacyPointsLedgerEntry.create).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPromotionEvent.create).toHaveBeenCalledTimes(1)
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledTimes(1)
    expect(prisma.mtmNotification.create).toHaveBeenCalledTimes(1)
  })

  it("posts exactly two bucket AWARD entries with the L2 state, review, event and audit atomically", async () => {
    const current = executionRow({
      status: "IN_REVIEW",
      l1State: "APPROVED",
      l2State: "READY",
      version: 3,
      reviews: [{
        level: "L1",
        decision: "APPROVED",
        reviewerAgentId: MANAGER_1,
        reviewerUserId: "manager-1-user",
      }],
    })
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(managerTwo)
    const previewHash = await generatePreview(current, {
      expectedVersion: 3,
      level: "L2",
      decision: "APPROVED",
    })
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findFirst).mockReset()
    const refreshed = executionRow({
      status: "APPROVED",
      l1State: "APPROVED",
      l2State: "APPROVED",
      version: 4,
      closedAt: new Date("2026-08-01T10:00:00.000Z"),
    })
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findFirst)
      .mockResolvedValueOnce({ id: EXECUTION } as never)
      .mockResolvedValueOnce(current as never)
      .mockResolvedValueOnce(refreshed as never)
    vi.mocked(prisma.mtmPharmacyPromotionReview.create).mockResolvedValue(reviewRow("L2") as never)

    const response = await applyReview(jsonRequest(
      `/api/v1/mtm/pharmacy-promotion-executions/${EXECUTION}/reviews`,
      {
        expectedVersion: 3,
        level: "L2",
        decision: "APPROVED",
        operationId: "operation-review-l2",
        idempotencyKey: "idempotency-review-l2",
        previewHash,
      },
    ), params())

    expect(response.status).toBe(200)
    expect(typeof vi.mocked(prisma.$transaction).mock.calls[0][0]).toBe("function")
    expect(prisma.mtmPharmacyPromotionReview.create).toHaveBeenCalledTimes(1)
    expect(prisma.mtmPharmacyPromotionExecution.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ version: 3, status: "IN_REVIEW", l1State: "APPROVED", l2State: "READY" }),
      data: expect.objectContaining({
        status: "APPROVED",
        l1State: "APPROVED",
        l2State: "APPROVED",
        version: { increment: 1 },
      }),
    }))
    expect(prisma.mtmPharmacyPointsLedgerEntry.create).toHaveBeenCalledTimes(2)
    const ledgerRows = vi.mocked(prisma.mtmPharmacyPointsLedgerEntry.create).mock.calls
      .map((call: unknown[]) => (call[0] as { data: Record<string, any> }).data)
    expect(ledgerRows.map((row: Record<string, any>) => ({
      organizationId: row.organizationId,
      beneficiaryAgentId: row.beneficiaryAgentId,
      executionId: row.executionId,
      reviewId: row.reviewId,
      entryType: row.entryType,
      bucket: row.bucket,
      delta: row.delta.toString(),
      sourceKey: row.sourceKey,
    }))).toEqual([
      {
        organizationId: ORG,
        beneficiaryAgentId: AGENT,
        executionId: EXECUTION,
        reviewId: "review-l2",
        entryType: "AWARD",
        bucket: "FACT_POINTS",
        delta: "10",
        sourceKey: `execution:${EXECUTION}:award:fact`,
      },
      {
        organizationId: ORG,
        beneficiaryAgentId: AGENT,
        executionId: EXECUTION,
        reviewId: "review-l2",
        entryType: "AWARD",
        bucket: "REWARD_POINTS",
        delta: "5",
        sourceKey: `execution:${EXECUTION}:award:reward`,
      },
    ])
    expect(prisma.mtmPharmacyPromotionEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        targetId: TARGET,
        executionId: EXECUTION,
        formulaId: "formula-1",
        approvalPolicyId: "policy-1",
        reviewId: "review-l2",
        eventType: "REVIEW_L2_APPROVED",
        toState: "APPROVED",
      }),
    }))
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "PHARMACY_PROMOTION_REVIEW_APPROVED" }),
    }))
    expect(prisma.mtmNotification.create).toHaveBeenCalledTimes(1)

    const reviewOrder = vi.mocked(prisma.mtmPharmacyPromotionReview.create).mock.invocationCallOrder[0]
    const stateOrder = vi.mocked(prisma.mtmPharmacyPromotionExecution.updateMany).mock.invocationCallOrder[0]
    const firstLedgerOrder = vi.mocked(prisma.mtmPharmacyPointsLedgerEntry.create).mock.invocationCallOrder[0]
    const eventOrder = vi.mocked(prisma.mtmPharmacyPromotionEvent.create).mock.invocationCallOrder[0]
    const auditOrder = vi.mocked(prisma.mtmAuditLog.create).mock.invocationCallOrder[0]
    expect(reviewOrder).toBeLessThan(stateOrder)
    expect(stateOrder).toBeLessThan(firstLedgerOrder)
    expect(firstLedgerOrder).toBeLessThan(eventOrder)
    expect(eventOrder).toBeLessThan(auditOrder)
  })

  it("returns a version conflict when review CAS loses and reaches no ledger, event or audit append", async () => {
    const current = executionRow()
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(managerOne)
    authState.userId = "manager-1-user"
    authState.name = "Manager One"
    const previewHash = await generatePreview(current, {
      expectedVersion: 2,
      level: "L1",
      decision: "APPROVED",
    })
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findFirst).mockReset()
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findFirst)
      .mockResolvedValueOnce({ id: EXECUTION } as never)
      .mockResolvedValueOnce(current as never)
    vi.mocked(prisma.mtmPharmacyPromotionReview.create).mockResolvedValue(reviewRow("L1") as never)
    vi.mocked(prisma.mtmPharmacyPromotionExecution.updateMany).mockResolvedValue({ count: 0 } as never)

    const response = await applyReview(jsonRequest(
      `/api/v1/mtm/pharmacy-promotion-executions/${EXECUTION}/reviews`,
      {
        expectedVersion: 2,
        level: "L1",
        decision: "APPROVED",
        operationId: "operation-review-l1-cas",
        idempotencyKey: "idempotency-review-l1-cas",
        previewHash,
      },
    ), params())

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_PHARMACY_EXECUTION_VERSION_CONFLICT" })
    expect(prisma.mtmPharmacyPromotionExecution.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: EXECUTION, organizationId: ORG, version: 2 }),
    }))
    expect(prisma.mtmPharmacyPointsLedgerEntry.create).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPromotionEvent.create).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })
})
