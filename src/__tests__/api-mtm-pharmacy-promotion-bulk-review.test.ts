/* eslint-disable @typescript-eslint/no-explicit-any */
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
    (req: NextRequest) => handler(req, {
      orgId: "org-1",
      userId: authState.userId,
      role: authState.role,
      email: `${authState.userId}@example.com`,
      name: authState.name,
      agentId: authState.agentId,
      principal: authState.principal,
    }),
}))
vi.mock("@/lib/mtm/route-permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mtm/route-permissions")>()
  return { ...actual, resolveMtmRouteActor: vi.fn() }
})
vi.mock("@/lib/mtm/mobile-capabilities", () => ({ requireMobileCapability: vi.fn() }))

import { POST as applyBulkReview } from "@/app/api/v1/mtm/pharmacy-promotion-executions/bulk/reviews/route"
import { prisma } from "@/lib/prisma"
import { preparePharmacyPromotionBulkReview } from "@/lib/mtm/pharmacy-promotion-bulk-review"
import { pharmacyPromotionHash } from "@/lib/mtm/pharmacy-promotion"
import { requireMobileCapability } from "@/lib/mtm/mobile-capabilities"
import { resolveMtmRouteActor, type MtmRouteActor } from "@/lib/mtm/route-permissions"

const ORG = "org-1"
const manager: MtmRouteActor = {
  agentId: "manager-2",
  role: "MANAGER",
  scopedAgentIds: ["agent-a", "agent-b"],
}

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

const formulaHash = pharmacyPromotionHash(FORMULA)
const policyHash = pharmacyPromotionHash(POLICY)

function executionRow(input: {
  id: string
  agentId: string
  level?: "L1" | "L2"
  quantity?: string
}) {
  const level = input.level ?? "L1"
  const quantity = new Prisma.Decimal(input.quantity ?? "2")
  const fact = quantity.mul(1).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP)
  const reward = quantity.mul("0.5").toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP)
  return {
    id: input.id,
    organizationId: ORG,
    targetId: `target-${input.id}`,
    agentId: input.agentId,
    submittedByAgentId: input.agentId,
    submittedByUserId: `user-${input.agentId}`,
    actualQuantity: quantity,
    formulaId: "formula-1",
    formulaVersion: 1,
    formulaHash,
    approvalPolicyId: "policy-1",
    approvalPolicyVersion: 1,
    approvalPolicyHash: policyHash,
    calculationInput: { factQuantity: quantity.toString() },
    calculationOutput: { status: "CALCULATED" },
    factPointsPreview: fact,
    rewardPointsPreview: reward,
    differencePointsPreview: fact.minus(reward),
    sourceObservedAt: new Date("2026-08-01T09:55:00.000Z"),
    sourceReceivedAt: new Date("2026-08-01T09:56:00.000Z"),
    readyAt: new Date("2026-08-01T10:00:00.000Z"),
    status: level === "L1" ? "READY" : "IN_REVIEW",
    l1State: level === "L1" ? "READY" : "APPROVED",
    l2State: level === "L1" ? "NOT_READY" : "READY",
    version: level === "L1" ? 2 : 3,
    formula: {
      id: "formula-1",
      status: "ACTIVE",
      version: 1,
      definition: FORMULA,
      definitionHash: formulaHash,
      approvalReference: "SWISSMED-FORMULA-APPROVAL",
      signedAt: new Date("2026-08-01T07:00:00.000Z"),
    },
    approvalPolicy: {
      id: "policy-1",
      status: "ACTIVE",
      version: 1,
      definition: POLICY,
      definitionHash: policyHash,
      approvalReference: "SWISSMED-POLICY-APPROVAL",
      signedAt: new Date("2026-08-01T07:00:00.000Z"),
      allowSelfApproval: false,
      requireDistinctReviewers: true,
      requireRejectReason: true,
      requireReturnReason: true,
    },
    target: {
      id: `target-${input.id}`,
      customerId: `customer-${input.id}`,
      contactId: null,
    },
    reviews: level === "L2" ? [{
      level: "L1",
      decision: "APPROVED",
      reviewerAgentId: "manager-1",
      reviewerUserId: "manager-1-user",
    }] : [],
  }
}

function request(body: unknown) {
  return new NextRequest("http://localhost/api/v1/mtm/pharmacy-promotion-executions/bulk/reviews", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function applyBody(
  executions: ReturnType<typeof executionRow>[],
  level: "L1" | "L2",
  overrides: Record<string, unknown> = {},
) {
  const prepared = preparePharmacyPromotionBulkReview({
    executions,
    actor: manager,
    reviewerUserId: authState.userId,
    level,
    decision: "APPROVED",
    postingEnabled: true,
  })
  return {
    // Deliberately reverse both lists: the endpoint must canonicalize its lock,
    // hash, review, and CAS order rather than trusting request order.
    executionIds: [...prepared.preview.executionIds].reverse(),
    versions: [...prepared.versions].reverse(),
    level,
    decision: "APPROVED" as const,
    operationId: `operation-bulk-${level.toLowerCase()}-0001`,
    idempotencyKey: `idempotency-bulk-${level.toLowerCase()}-0001`,
    previewHash: prepared.previewHash,
    selectionHash: prepared.selectionHash,
    ...overrides,
  }
}

function normalizedRequestHash(body: ReturnType<typeof applyBody>) {
  const executionIds = [...body.executionIds].sort()
  const versions = [...body.versions].sort((left, right) => left.executionId.localeCompare(right.executionId))
  return pharmacyPromotionHash({
    schemaVersion: 1,
    operationId: body.operationId,
    idempotencyKey: body.idempotencyKey,
    selectionScope: "EXPLICIT_IDS",
    executionIds,
    selectionHash: body.selectionHash,
    versions,
    level: body.level,
    decision: body.decision,
    reason: null,
    previewHash: body.previewHash,
  })
}

function exposeExecutions(executions: ReturnType<typeof executionRow>[]) {
  vi.mocked(prisma.mtmPharmacyPromotionExecution.findMany).mockImplementation(async (args: any) => (
    args?.include
      ? [...executions].sort((left, right) => left.id.localeCompare(right.id))
      : executions.map(({ id }) => ({ id })).sort((left, right) => left.id.localeCompare(right.id))
  ) as never)
}

let createdOperation: any

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-08-01T10:05:00.000Z"))
  authState.principal = "web"
  authState.userId = "manager-2-user"
  authState.role = "member"
  authState.agentId = null
  authState.name = "Manager Two"
  createdOperation = null

  vi.mocked(resolveMtmRouteActor).mockResolvedValue(manager)
  vi.mocked(requireMobileCapability).mockReturnValue(null as never)
  vi.mocked(prisma.mtmSetting.findFirst).mockResolvedValue({ value: true } as never)
  vi.mocked(prisma.mtmPharmacyPromotionOperation.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmPharmacyPromotionExecution.updateMany).mockResolvedValue({ count: 1 } as never)
  vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([
    { id: "agent-a", user: { preferredLanguage: "en" } },
    { id: "agent-b", user: { preferredLanguage: "az" } },
  ] as never)
  vi.mocked(prisma.mtmPharmacyPromotionReview.create).mockImplementation(async (args: any) => ({
    ...args.data,
    id: `review-${args.data.executionId}`,
    decidedAt: new Date(),
  }) as never)
  vi.mocked(prisma.mtmPharmacyPromotionOperation.create).mockImplementation(async (args: any) => {
    createdOperation = { ...args.data, failedCount: 0, succeededCount: 0, completedAt: null, resultPayload: null }
    return createdOperation
  })
  vi.mocked(prisma.mtmPharmacyPromotionOperation.update).mockImplementation(async (args: any) => ({
    ...createdOperation,
    ...args.data,
    version: 2,
  }) as never)
})

describe("SWM-09 explicit-ID bulk review apply", () => {
  it("rejects more than 100 explicit IDs before scope lookup or a transaction", async () => {
    const executionIds = Array.from({ length: 101 }, (_, index) => `execution-${index}`)
    const response = await applyBulkReview(request({
      executionIds,
      versions: executionIds.map((executionId) => ({ executionId, expectedVersion: 2 })),
      level: "L1",
      decision: "APPROVED",
      operationId: "operation-over-limit",
      idempotencyKey: "idempotency-over-limit",
      previewHash: "a".repeat(64),
      selectionHash: pharmacyPromotionHash([...executionIds].sort()),
    }))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "MTM_PHARMACY_BULK_REVIEW_INVALID" })
    expect(prisma.mtmPharmacyPromotionExecution.findMany).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("rejects an invalid one-to-one version set before reading any execution", async () => {
    const executionIds = ["execution-a"]
    const response = await applyBulkReview(request({
      executionIds,
      versions: [
        { executionId: "execution-a", expectedVersion: 2 },
        { executionId: "execution-foreign", expectedVersion: 2 },
      ],
      level: "L1",
      decision: "APPROVED",
      operationId: "operation-version-mismatch",
      idempotencyKey: "idempotency-version-mismatch",
      previewHash: "a".repeat(64),
      selectionHash: pharmacyPromotionHash(executionIds),
    }))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      code: "MTM_PHARMACY_BULK_REVIEW_INVALID",
      error: "Every selected execution needs one expected version",
    })
    expect(prisma.mtmPharmacyPromotionExecution.findMany).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("returns one privacy-preserving 404 when any selected employee is outside current manager scope", async () => {
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findMany).mockResolvedValue([
      { id: "execution-a" },
    ] as never)
    const executions = [
      executionRow({ id: "execution-a", agentId: "agent-a" }),
      // The request may contain an opaque ID that resolves to another agent or
      // tenant in storage. Body hashes do not disclose that storage identity.
      executionRow({ id: "execution-foreign", agentId: "agent-b" }),
    ]
    const body = applyBody(executions, "L1")

    const response = await applyBulkReview(request(body))

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "Not found" })
    expect(prisma.mtmPharmacyPromotionExecution.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["execution-a", "execution-foreign"] },
        organizationId: ORG,
        agentId: { in: ["agent-a", "agent-b"] },
      },
      select: { id: true },
      orderBy: { id: "asc" },
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("applies every L1 CAS under deterministic locks and writes no ledger row", async () => {
    const executions = [
      executionRow({ id: "execution-b", agentId: "agent-b" }),
      executionRow({ id: "execution-a", agentId: "agent-a" }),
    ]
    const body = applyBody(executions, "L1")
    exposeExecutions(executions)

    const response = await applyBulkReview(request(body))
    const payload = await response.json()

    expect(response.status).toBe(201)
    expect(payload).toMatchObject({ success: true, idempotent: false, data: { operation: { status: "COMPLETED" } } })
    expect(vi.mocked(prisma.$transaction).mock.calls[0][1]).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5_000,
      timeout: 30_000,
    })
    expect(vi.mocked(prisma.$queryRaw).mock.calls.map((call: unknown[]) => call[1])).toEqual([
      `mtm-pharmacy-bulk-review:${ORG}:${body.operationId}`,
      `mtm-pharmacy-review:${ORG}:execution-a`,
      `mtm-pharmacy-review:${ORG}:execution-b`,
    ])
    expect(prisma.mtmPharmacyPromotionOperation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        id: body.operationId,
        organizationId: ORG,
        kind: "BULK_REVIEW",
        status: "PENDING",
        selectionScope: "EXPLICIT_IDS",
        explicitIds: ["execution-a", "execution-b"],
        selectionHash: body.selectionHash,
        idempotencyKey: body.idempotencyKey,
        selectedCount: 2,
        actorAgentId: manager.agentId,
        actorUserId: authState.userId,
      }),
    }))
    expect(prisma.mtmPharmacyPromotionReview.create).toHaveBeenCalledTimes(2)
    expect(vi.mocked(prisma.mtmPharmacyPromotionExecution.updateMany).mock.calls.map((call: unknown[]) => (
      (call[0] as any).where.id
    ))).toEqual(["execution-a", "execution-b"])
    expect(prisma.mtmPharmacyPointsLedgerEntry.create).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPromotionEvent.create).toHaveBeenCalledTimes(3)
    const eventSubjects = vi.mocked(prisma.mtmPharmacyPromotionEvent.create).mock.calls
      .map((call: unknown[]) => (call[0] as { data: Record<string, unknown> }).data)
    expect(eventSubjects.slice(0, 2).map((event: Record<string, unknown>) => ({
      targetId: event.targetId,
      executionId: event.executionId,
      formulaId: event.formulaId,
      approvalPolicyId: event.approvalPolicyId,
      reviewId: event.reviewId,
      operationId: event.operationId,
    }))).toEqual([
      {
        targetId: "target-execution-a",
        executionId: "execution-a",
        formulaId: "formula-1",
        approvalPolicyId: "policy-1",
        reviewId: "review-execution-a",
        operationId: body.operationId,
      },
      {
        targetId: "target-execution-b",
        executionId: "execution-b",
        formulaId: "formula-1",
        approvalPolicyId: "policy-1",
        reviewId: "review-execution-b",
        operationId: body.operationId,
      },
    ])
    expect(eventSubjects[2]).toMatchObject({
      eventType: "BULK_REVIEW_COMPLETED",
      operationId: body.operationId,
    })
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledTimes(2)
    expect(prisma.mtmNotification.create).toHaveBeenCalledTimes(2)
    expect(prisma.mtmPharmacyPromotionOperation.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "COMPLETED",
        succeededCount: 2,
        failedCount: 0,
      }),
    }))
  })

  it("posts exactly two zero-safe AWARD buckets per L2 approval", async () => {
    const executions = [
      executionRow({ id: "execution-b", agentId: "agent-b", level: "L2", quantity: "0" }),
      executionRow({ id: "execution-a", agentId: "agent-a", level: "L2", quantity: "0" }),
    ]
    const body = applyBody(executions, "L2")
    exposeExecutions(executions)

    const response = await applyBulkReview(request(body))

    expect(response.status).toBe(201)
    expect(vi.mocked(prisma.$queryRaw).mock.calls.map((call: unknown[]) => call[1])).toEqual([
      `mtm-pharmacy-bulk-review:${ORG}:${body.operationId}`,
      `mtm-pharmacy-review:${ORG}:execution-a`,
      `mtm-pharmacy-review:${ORG}:execution-b`,
      `mtm-pharmacy-ledger:${ORG}:agent-a`,
      `mtm-pharmacy-ledger:${ORG}:agent-b`,
    ])
    expect(prisma.mtmPharmacyPointsLedgerEntry.create).toHaveBeenCalledTimes(4)
    const rows = vi.mocked(prisma.mtmPharmacyPointsLedgerEntry.create).mock.calls.map((call: unknown[]) => {
      const data = (call[0] as any).data
      return {
        executionId: data.executionId,
        entryType: data.entryType,
        bucket: data.bucket,
        delta: data.delta.toString(),
        reviewId: data.reviewId,
      }
    })
    expect(rows).toEqual([
      { executionId: "execution-a", entryType: "AWARD", bucket: "FACT_POINTS", delta: "0", reviewId: "review-execution-a" },
      { executionId: "execution-a", entryType: "AWARD", bucket: "REWARD_POINTS", delta: "0", reviewId: "review-execution-a" },
      { executionId: "execution-b", entryType: "AWARD", bucket: "FACT_POINTS", delta: "0", reviewId: "review-execution-b" },
      { executionId: "execution-b", entryType: "AWARD", bucket: "REWARD_POINTS", delta: "0", reviewId: "review-execution-b" },
    ])
    expect(prisma.mtmPharmacyPromotionExecution.updateMany).toHaveBeenCalledTimes(2)
    for (const call of vi.mocked(prisma.mtmPharmacyPromotionExecution.updateMany).mock.calls) {
      expect((call[0] as any).data).toMatchObject({
        status: "APPROVED",
        l1State: "APPROVED",
        l2State: "APPROVED",
        version: { increment: 1 },
      })
    }
    expect(prisma.mtmPharmacyPromotionEvent.create).toHaveBeenCalledTimes(3)
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledTimes(2)
    expect(prisma.mtmNotification.create).toHaveBeenCalledTimes(2)
  })

  it("rejects a stale aggregate preview before creating the operation or any review", async () => {
    const executions = [executionRow({ id: "execution-a", agentId: "agent-a" })]
    const body = applyBody(executions, "L1", { previewHash: "0".repeat(64) })
    exposeExecutions(executions)

    const response = await applyBulkReview(request(body))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_PHARMACY_BULK_REVIEW_PREVIEW_STALE" })
    expect(prisma.mtmPharmacyPromotionOperation.create).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPromotionReview.create).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPromotionExecution.updateMany).not.toHaveBeenCalled()
  })

  it("rolls the serializable batch back when any execution CAS loses", async () => {
    const executions = [
      executionRow({ id: "execution-a", agentId: "agent-a" }),
      executionRow({ id: "execution-b", agentId: "agent-b" }),
    ]
    const body = applyBody(executions, "L1")
    exposeExecutions(executions)
    vi.mocked(prisma.mtmPharmacyPromotionExecution.updateMany)
      .mockResolvedValueOnce({ count: 1 } as never)
      .mockResolvedValueOnce({ count: 0 } as never)

    const response = await applyBulkReview(request(body))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_PHARMACY_EXECUTION_VERSION_CONFLICT" })
    expect(typeof vi.mocked(prisma.$transaction).mock.calls[0][0]).toBe("function")
    expect(prisma.mtmPharmacyPromotionReview.create).toHaveBeenCalledTimes(2)
    expect(prisma.mtmPharmacyPromotionExecution.updateMany).toHaveBeenCalledTimes(2)
    expect(prisma.mtmPharmacyPointsLedgerEntry.create).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPromotionEvent.create).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
    expect(prisma.mtmNotification.create).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPromotionOperation.update).not.toHaveBeenCalled()
  })

  it("rechecks current scope inside a replay transaction and returns 404 after reassignment", async () => {
    const executions = [executionRow({ id: "execution-a", agentId: "agent-a" })]
    const body = applyBody(executions, "L1")
    vi.mocked(prisma.mtmPharmacyPromotionExecution.findMany)
      .mockResolvedValueOnce([{ id: "execution-a" }] as never)
      .mockResolvedValueOnce([])
    vi.mocked(prisma.mtmPharmacyPromotionOperation.findFirst).mockResolvedValue({
      id: body.operationId,
      organizationId: ORG,
      kind: "BULK_REVIEW",
      status: "COMPLETED",
      selectionScope: "EXPLICIT_IDS",
      explicitIds: ["execution-a"],
      selectionHash: body.selectionHash,
      idempotencyKey: body.idempotencyKey,
      requestHash: normalizedRequestHash(body),
      actorAgentId: manager.agentId,
      actorUserId: authState.userId,
      resultPayload: { schemaVersion: 1, results: [] },
    } as never)

    const response = await applyBulkReview(request(body))

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "Not found" })
    expect(resolveMtmRouteActor).toHaveBeenCalledTimes(2)
    expect(prisma.mtmPharmacyPromotionOperation.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPromotionReview.create).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPromotionOperation.update).not.toHaveBeenCalled()
  })

  it("returns an exact completed operation idempotently without repeating domain writes", async () => {
    const executions = [executionRow({ id: "execution-a", agentId: "agent-a" })]
    const body = applyBody(executions, "L1")
    exposeExecutions(executions)
    const replay = {
      id: body.operationId,
      organizationId: ORG,
      kind: "BULK_REVIEW",
      status: "COMPLETED",
      selectionScope: "EXPLICIT_IDS",
      explicitIds: ["execution-a"],
      selectionHash: body.selectionHash,
      idempotencyKey: body.idempotencyKey,
      requestHash: normalizedRequestHash(body),
      actorAgentId: manager.agentId,
      actorUserId: authState.userId,
      selectedCount: 1,
      succeededCount: 1,
      failedCount: 0,
      completedAt: new Date("2026-08-01T10:01:00.000Z"),
      resultPayload: { schemaVersion: 1, results: [{ executionId: "execution-a" }] },
    }
    vi.mocked(prisma.mtmPharmacyPromotionOperation.findFirst).mockResolvedValue(replay as never)

    const response = await applyBulkReview(request(body))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      idempotent: true,
      data: { operation: { id: body.operationId, status: "COMPLETED", result: replay.resultPayload } },
    })
    expect(prisma.mtmSetting.findFirst).toHaveBeenCalledTimes(1)
    expect(prisma.mtmPharmacyPromotionOperation.create).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPromotionReview.create).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPromotionExecution.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPointsLedgerEntry.create).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPromotionEvent.create).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
    expect(prisma.mtmNotification.create).not.toHaveBeenCalled()
    expect(prisma.mtmPharmacyPromotionOperation.update).not.toHaveBeenCalled()
  })
})
