import { createHash } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const tx = {
    discoveryAutoReviewRun: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    discoveryAutoReviewDecision: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      createMany: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    discoveryAutoReviewEvent: {
      createMany: vi.fn(),
    },
    ingestEnvelope: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    rejectedObservationFingerprint: {
      upsert: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    organization: {
      findUnique: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $executeRawUnsafe: vi.fn(),
  }

  return {
    tx,
    transaction: vi.fn(),
    loadPlan: vi.fn(),
    hmacToken: vi.fn(),
    logError: vi.fn(),
    replayIngestEnvelope: vi.fn(),
  }
})

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ...mocks.tx,
    $transaction: mocks.transaction,
  },
}))

vi.mock("@/lib/secure-token", () => ({
  hmacToken: mocks.hmacToken,
}))

vi.mock("@/lib/logger", () => ({
  logError: mocks.logError,
}))

vi.mock("@/lib/social/discovery-auto-review-report", () => ({
  loadDiscoveryAutoReviewPlan: mocks.loadPlan,
}))

vi.mock("@/lib/social/ingest-envelope-replay", () => ({
  replayIngestEnvelope: mocks.replayIngestEnvelope,
}))

import {
  applyDiscoveryAutoReviewPlan,
  DiscoveryAutoReviewApplyError,
  finalizeDueDiscoveryAutoReviewRuns,
  rollbackDiscoveryAutoReviewRun,
  type ApplyDiscoveryAutoReviewInput,
} from "@/lib/social/discovery-auto-review-apply"

const now = new Date("2026-07-23T12:00:00.000Z")
const rollbackUntil = new Date("2026-07-24T12:00:00.000Z")
const candidateUpdatedAt = new Date("2026-07-23T11:00:00.000Z")
const candidatePurgeAt = new Date("2026-07-30T12:00:00.000Z")

const applyInput: ApplyDiscoveryAutoReviewInput = {
  organizationId: "org-1",
  subjectId: "subject-1",
  requestedBy: "user-1",
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
  mode: "REJECT_ONLY",
  resolverVersion: "discovery_auto_review_v1",
  planFingerprint: "a".repeat(64),
  expectedLinks: 1,
  expectedRows: 1,
}

const safeResolveInput: ApplyDiscoveryAutoReviewInput = {
  ...applyInput,
  idempotencyKey: "33333333-3333-4333-8333-333333333333",
  mode: "SAFE_RESOLVE",
  planFingerprint: "c".repeat(64),
  expectedLinks: 2,
  expectedRows: 2,
}

function hashApplyRequest(input: ApplyDiscoveryAutoReviewInput): string {
  return createHash("sha256").update(JSON.stringify({
    organizationId: input.organizationId,
    subjectId: input.subjectId,
    requestedBy: input.requestedBy,
    idempotencyKey: input.idempotencyKey,
    mode: input.mode,
    resolverVersion: input.resolverVersion,
    planFingerprint: input.planFingerprint,
    expectedLinks: input.expectedLinks,
    expectedRows: input.expectedRows,
  })).digest("hex")
}

function runRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    mode: "REJECT_ONLY",
    state: "APPLIED",
    requestFingerprint: hashApplyRequest(applyInput),
    appliedGroupCount: 1,
    appliedRowCount: 1,
    rollbackUntil,
    createdAt: now,
    rolledBackAt: null,
    finalizedAt: null,
    ...overrides,
  }
}

function eligiblePlan(overrides: Record<string, unknown> = {}) {
  return {
    report: {
      totalRows: 1,
      apply: {
        mode: "REJECT_ONLY",
        planFingerprint: applyInput.planFingerprint,
        eligibleLinks: 1,
        eligibleRows: 1,
        rollbackUntil: rollbackUntil.toISOString(),
      },
    },
    groups: [
      {
        key: "https://news.example/story",
        applyEligibility: "ELIGIBLE",
        rollbackUntil: rollbackUntil.toISOString(),
        decision: {
          action: "REJECT",
          reason: "discovery_auto_review_outside_provider_window",
          evidence: {
            policyVersion: "discovery_auto_review_v1",
            reviewReason: "discovery_outside_lookback_window",
            urlClassification: "EXTERNAL",
            urlHost: "news.example",
            matchedOfficialHost: null,
            resolvedPublishedAt: "2026-07-01T00:00:00.000Z",
            publishedAtSource: "provider",
            freshness: "STALE",
            titleIdentityTerms: ["baku electronics"],
            urlIdentityTerms: ["baku-electronics"],
          },
        },
        rows: [
          {
            candidate: {
              id: "envelope-1",
              contentHmac: "content-hmac-1",
              updatedAt: candidateUpdatedAt.toISOString(),
              purgeAt: candidatePurgeAt.toISOString(),
            },
            decision: {
              action: "REJECT",
              reason: "discovery_auto_review_outside_provider_window",
              evidence: {
                policyVersion: "discovery_auto_review_v1",
                reviewReason: "discovery_outside_lookback_window",
                urlClassification: "EXTERNAL",
                urlHost: "news.example",
                matchedOfficialHost: null,
                resolvedPublishedAt: "2026-07-01T00:00:00.000Z",
                publishedAtSource: "provider",
                freshness: "STALE",
                titleIdentityTerms: ["baku electronics"],
                urlIdentityTerms: ["baku-electronics"],
              },
            },
          },
        ],
      },
    ],
    ...overrides,
  }
}

function safeResolvePlan() {
  const safeRollbackUntil = rollbackUntil.toISOString()
  const rejectDecision = {
    action: "REJECT",
    reason: "discovery_auto_review_outside_provider_window",
    evidence: {
      policyVersion: "discovery_auto_review_v1",
      reviewReason: "discovery_outside_lookback_window",
      urlClassification: "EXTERNAL",
      urlHost: "news.example",
      matchedOfficialHost: null,
      resolvedPublishedAt: "2026-07-01T00:00:00.000Z",
      publishedAtSource: "provider",
      freshness: "STALE",
      titleIdentityTerms: ["baku electronics"],
      urlIdentityTerms: ["baku-electronics"],
    },
  }
  const releaseDecision = {
    action: "RELEASE_TO_NORMAL_PIPELINE",
    reason: "discovery_auto_review_fresh_independent_identity",
    evidence: {
      policyVersion: "discovery_auto_review_v1",
      reviewReason: "discovery_snippet_only_match",
      urlClassification: "EXTERNAL",
      urlHost: "publisher.example",
      matchedOfficialHost: null,
      resolvedPublishedAt: "2026-07-23T10:30:00.000Z",
      publishedAtSource: "provider",
      freshness: "IN_WINDOW",
      titleIdentityTerms: ["baku electronics"],
      urlIdentityTerms: ["baku-electronics"],
    },
  }

  return {
    report: {
      totalRows: 2,
      apply: {
        mode: "REJECT_ONLY",
        planFingerprint: safeResolveInput.planFingerprint,
        eligibleLinks: 1,
        eligibleRows: 1,
        rollbackUntil: safeRollbackUntil,
      },
      safeApply: {
        mode: "SAFE_RESOLVE",
        planFingerprint: safeResolveInput.planFingerprint,
        eligibleLinks: 2,
        eligibleRows: 2,
        rejectLinks: 1,
        rejectRows: 1,
        releaseLinks: 1,
        releaseRows: 1,
        rollbackUntil: safeRollbackUntil,
      },
    },
    groups: [
      {
        key: "https://news.example/stale-story",
        applyEligibility: "ELIGIBLE",
        rollbackUntil: safeRollbackUntil,
        safeApplyEligibility: "ELIGIBLE",
        safeRollbackUntil,
        storedSubjectAcceptance: [],
        decision: rejectDecision,
        rows: [{
          candidate: {
            id: "envelope-reject",
            contentHmac: "content-hmac-reject",
            updatedAt: candidateUpdatedAt.toISOString(),
            purgeAt: candidatePurgeAt.toISOString(),
          },
          decision: rejectDecision,
        }],
      },
      {
        key: "https://publisher.example/fresh-story",
        applyEligibility: "NOT_REJECT",
        rollbackUntil: safeRollbackUntil,
        safeApplyEligibility: "ELIGIBLE",
        safeRollbackUntil,
        storedSubjectAcceptance: [{
          subjectId: "subject-1",
          status: "ACCEPTED",
          confidence: 0.99,
        }],
        decision: releaseDecision,
        rows: [{
          candidate: {
            id: "envelope-release",
            contentHmac: "content-hmac-release",
            updatedAt: candidateUpdatedAt.toISOString(),
            purgeAt: candidatePurgeAt.toISOString(),
          },
          decision: releaseDecision,
        }],
      },
    ],
  }
}

function sqlParts(args: unknown[]): { text: string; values: unknown[] } {
  const value = args[0]
  if (Array.isArray(value)) {
    return {
      text: value.join("?"),
      values: args.slice(1),
    }
  }
  if (!value || typeof value !== "object") return { text: "", values: [] }
  const candidate = value as { strings?: readonly string[]; values?: readonly unknown[] }
  return {
    text: candidate.strings?.join("?") ?? "",
    values: [...(candidate.values ?? [])],
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(now)
  vi.resetAllMocks()

  mocks.transaction.mockImplementation(async (
    operation: (tx: typeof mocks.tx) => Promise<unknown>,
  ) => operation(mocks.tx))
  mocks.loadPlan.mockResolvedValue(eligiblePlan())
  mocks.hmacToken.mockReturnValue("group-key-hmac")

  mocks.tx.discoveryAutoReviewRun.findFirst.mockResolvedValue(null)
  mocks.tx.discoveryAutoReviewRun.findMany.mockResolvedValue([])
  mocks.tx.discoveryAutoReviewRun.create.mockResolvedValue(runRecord())
  mocks.tx.discoveryAutoReviewRun.update.mockResolvedValue(runRecord())
  mocks.tx.discoveryAutoReviewRun.updateMany.mockResolvedValue({ count: 1 })
  mocks.tx.discoveryAutoReviewDecision.findMany.mockResolvedValue([])
  mocks.tx.discoveryAutoReviewDecision.findFirst.mockResolvedValue(null)
  mocks.tx.discoveryAutoReviewDecision.createMany.mockResolvedValue({ count: 1 })
  mocks.tx.discoveryAutoReviewDecision.updateMany.mockResolvedValue({ count: 1 })
  mocks.tx.discoveryAutoReviewDecision.update.mockResolvedValue({})
  mocks.tx.discoveryAutoReviewEvent.createMany.mockResolvedValue({ count: 1 })
  mocks.tx.ingestEnvelope.findMany.mockResolvedValue([{
    id: "envelope-1",
    contentHmac: "content-hmac-1",
    updatedAt: candidateUpdatedAt,
    relevanceStatus: "REVIEW",
    relevanceReason: "discovery_outside_lookback_window",
    relevanceConfidence: 0.4,
    decidedAt: now,
    purgeAt: candidatePurgeAt,
  }])
  mocks.tx.ingestEnvelope.findFirst.mockResolvedValue(null)
  mocks.tx.ingestEnvelope.updateMany.mockResolvedValue({ count: 1 })
  mocks.tx.rejectedObservationFingerprint.upsert.mockResolvedValue({})
  mocks.tx.auditLog.create.mockResolvedValue({})
  mocks.tx.organization.findUnique.mockResolvedValue({ settings: {} })
  mocks.tx.$queryRaw.mockResolvedValue([{
    id: "envelope-1",
    contentHmac: "content-hmac-1",
    updatedAt: candidateUpdatedAt,
    relevanceStatus: "REVIEW",
    relevanceReason: "discovery_outside_lookback_window",
    relevanceConfidence: 0.4,
    decidedAt: now,
    purgeAt: candidatePurgeAt,
  }])
  mocks.tx.$executeRaw.mockResolvedValue(1)
  mocks.tx.$executeRawUnsafe.mockResolvedValue(1)
  mocks.replayIngestEnvelope.mockResolvedValue({
    status: "REPLAYED",
    envelopeId: "envelope-release",
    mentionId: "mention-release",
    created: true,
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe("applyDiscoveryAutoReviewPlan", () => {
  it("returns an identical retry without entering a write transaction", async () => {
    mocks.tx.discoveryAutoReviewRun.findFirst.mockResolvedValueOnce(runRecord())

    const result = await applyDiscoveryAutoReviewPlan(applyInput)

    expect(result).toMatchObject({
      idempotent: true,
      run: {
        id: "run-1",
        state: "APPLIED",
        appliedGroupCount: 1,
        appliedRowCount: 1,
        rollbackAvailable: true,
      },
    })
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.tx.discoveryAutoReviewDecision.createMany).not.toHaveBeenCalled()
  })

  it("rejects reuse of an idempotency key for a different request", async () => {
    mocks.tx.discoveryAutoReviewRun.findFirst.mockResolvedValueOnce(
      runRecord({ requestFingerprint: "different-request" }),
    )

    await expect(applyDiscoveryAutoReviewPlan(applyInput)).rejects.toMatchObject({
      name: "DiscoveryAutoReviewApplyError",
      code: "review_apply_idempotency_conflict",
      status: 409,
    })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("does not create an applied review run while clean-slate collection is blocked", async () => {
    mocks.tx.organization.findUnique.mockResolvedValueOnce({
      settings: {
        socialMonitoringCleanSlate: { collectionBlocked: true },
      },
    })

    await expect(applyDiscoveryAutoReviewPlan(applyInput)).rejects.toMatchObject({
      name: "DiscoveryAutoReviewApplyError",
      code: "social_monitoring_collection_blocked",
      status: 409,
    })

    expect(mocks.tx.$executeRawUnsafe).toHaveBeenCalledWith(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      "social-monitoring-clean-slate:org-1",
    )
    expect(mocks.tx.discoveryAutoReviewRun.create).not.toHaveBeenCalled()
    expect(mocks.tx.discoveryAutoReviewDecision.createMany).not.toHaveBeenCalled()
  })

  it("fails closed when the preview fingerprint or counts are stale", async () => {
    mocks.loadPlan.mockResolvedValueOnce(eligiblePlan({
      report: {
        totalRows: 1,
        apply: {
          mode: "REJECT_ONLY",
          planFingerprint: "b".repeat(64),
          eligibleLinks: 1,
          eligibleRows: 1,
          rollbackUntil: rollbackUntil.toISOString(),
        },
      },
    }))

    await expect(applyDiscoveryAutoReviewPlan(applyInput)).rejects.toMatchObject({
      code: "review_apply_preview_stale",
      status: 409,
    })
    expect(mocks.tx.discoveryAutoReviewRun.create).not.toHaveBeenCalled()
    expect(mocks.tx.discoveryAutoReviewDecision.createMany).not.toHaveBeenCalled()
  })

  it("suppresses eligible rejects without mutating source envelopes", async () => {
    const result = await applyDiscoveryAutoReviewPlan(applyInput)

    expect(result).toMatchObject({
      idempotent: false,
      run: {
        id: "run-1",
        state: "APPLIED",
        rollbackAvailable: true,
      },
    })
    expect(mocks.tx.$queryRaw).toHaveBeenCalledTimes(1)
    const lockedQuery = sqlParts(mocks.tx.$queryRaw.mock.calls[0])
    expect(lockedQuery.text).toContain("FROM ingest_envelopes envelope")
    expect(lockedQuery.text).toContain("FOR UPDATE")
    expect(lockedQuery.text).toContain('"reviewMutationUntil"')
    expect(lockedQuery.values).toContain("org-1")
    expect(JSON.stringify(lockedQuery.values)).toContain("envelope-1")
    expect(mocks.tx.ingestEnvelope.updateMany).not.toHaveBeenCalled()
    expect(mocks.tx.$executeRaw).not.toHaveBeenCalled()
    expect(mocks.tx.discoveryAutoReviewDecision.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          organizationId: "org-1",
          envelopeId: "envelope-1",
          action: "REJECT",
          state: "SUPPRESSED",
          groupKeyHmac: "group-key-hmac",
          beforeContentHmac: "content-hmac-1",
          rollbackUntil,
        }),
      ],
    })
    const decisionData = mocks.tx.discoveryAutoReviewDecision.createMany.mock.calls[0][0]
      .data[0]
    expect(JSON.stringify(decisionData.evidence)).not.toContain("https://")
    expect(decisionData.evidence).not.toHaveProperty("url")
    expect(decisionData.evidence).not.toHaveProperty("text")
  })

  it("checks live snapshots before creating the suppression ledger", async () => {
    mocks.tx.$queryRaw.mockResolvedValueOnce([{
      id: "envelope-1",
      contentHmac: "changed-content",
      updatedAt: candidateUpdatedAt,
      relevanceStatus: "REVIEW",
      relevanceReason: null,
      relevanceConfidence: null,
      decidedAt: null,
      purgeAt: candidatePurgeAt,
    }])

    await expect(applyDiscoveryAutoReviewPlan(applyInput)).rejects.toMatchObject({
      code: "review_apply_preview_stale",
      status: 409,
    })
    expect(mocks.tx.discoveryAutoReviewRun.create).not.toHaveBeenCalled()
  })

  it("stores a mixed SAFE_RESOLVE ledger and records reject/release counts", async () => {
    mocks.loadPlan.mockResolvedValueOnce(safeResolvePlan())
    mocks.hmacToken.mockImplementation((key: string) => `hmac:${key}`)
    mocks.tx.$queryRaw.mockResolvedValueOnce([
      {
        id: "envelope-reject",
        contentHmac: "content-hmac-reject",
        updatedAt: candidateUpdatedAt,
        relevanceStatus: "REVIEW",
        relevanceReason: "discovery_outside_lookback_window",
        relevanceConfidence: 0.4,
        decidedAt: now,
        purgeAt: candidatePurgeAt,
      },
      {
        id: "envelope-release",
        contentHmac: "content-hmac-release",
        updatedAt: candidateUpdatedAt,
        relevanceStatus: "REVIEW",
        relevanceReason: "discovery_snippet_only_match",
        relevanceConfidence: 0.93,
        decidedAt: now,
        purgeAt: candidatePurgeAt,
      },
    ])
    mocks.tx.discoveryAutoReviewRun.create.mockResolvedValueOnce(runRecord({
      mode: "SAFE_RESOLVE",
      requestFingerprint: hashApplyRequest(safeResolveInput),
      appliedGroupCount: 2,
      appliedRowCount: 2,
    }))
    mocks.tx.discoveryAutoReviewDecision.createMany.mockResolvedValueOnce({
      count: 2,
    })

    await expect(applyDiscoveryAutoReviewPlan(safeResolveInput)).resolves.toMatchObject({
      idempotent: false,
      run: {
        mode: "SAFE_RESOLVE",
        appliedGroupCount: 2,
        appliedRowCount: 2,
        rollbackAvailable: true,
      },
    })

    const ledger = mocks.tx.discoveryAutoReviewDecision.createMany.mock.calls[0][0].data
    expect(ledger).toEqual([
      expect.objectContaining({
        envelopeId: "envelope-reject",
        action: "REJECT",
        state: "SUPPRESSED",
        groupKeyHmac: "hmac:https://news.example/stale-story",
        rollbackUntil,
      }),
      expect.objectContaining({
        envelopeId: "envelope-release",
        action: "RELEASE_TO_NORMAL_PIPELINE",
        state: "SUPPRESSED",
        groupKeyHmac: "hmac:https://publisher.example/fresh-story",
        rollbackUntil,
      }),
    ])
    expect(mocks.tx.ingestEnvelope.updateMany).not.toHaveBeenCalled()
    expect(mocks.replayIngestEnvelope).not.toHaveBeenCalled()

    const events = mocks.tx.discoveryAutoReviewEvent.createMany.mock.calls[0][0].data
    expect(events).toEqual([
      expect.objectContaining({
        eventType: "DECISION_SUPPRESSED",
        payload: expect.objectContaining({
          groupCount: 2,
          rowCount: 2,
          rejectGroupCount: 1,
          rejectRowCount: 1,
          releaseGroupCount: 1,
          releaseRowCount: 1,
        }),
      }),
      expect.objectContaining({
        eventType: "RUN_APPLIED",
        payload: expect.objectContaining({
          mode: "SAFE_RESOLVE",
          groupCount: 2,
          rowCount: 2,
          rejectGroupCount: 1,
          rejectRowCount: 1,
          releaseGroupCount: 1,
          releaseRowCount: 1,
        }),
      }),
    ])
  })
})

describe("rollbackDiscoveryAutoReviewRun", () => {
  const rollbackInput = {
    organizationId: "org-1",
    subjectId: "subject-1",
    runId: "run-1",
    requestedBy: "user-1",
    idempotencyKey: "22222222-2222-4222-8222-222222222222",
  }

  it("returns a previously rolled-back run idempotently", async () => {
    mocks.tx.discoveryAutoReviewRun.findFirst.mockResolvedValueOnce(runRecord({
      state: "ROLLED_BACK",
      rolledBackAt: new Date("2026-07-23T12:05:00.000Z"),
    }))

    const result = await rollbackDiscoveryAutoReviewRun(rollbackInput)

    expect(result).toMatchObject({
      idempotent: true,
      run: {
        id: "run-1",
        state: "ROLLED_BACK",
        rollbackAvailable: false,
      },
    })
    expect(mocks.tx.discoveryAutoReviewDecision.updateMany).not.toHaveBeenCalled()
  })

  it("refuses rollback after the recorded window expires", async () => {
    mocks.tx.discoveryAutoReviewRun.findFirst.mockResolvedValueOnce(runRecord({
      rollbackUntil: new Date("2026-07-23T11:59:59.000Z"),
    }))

    await expect(rollbackDiscoveryAutoReviewRun(rollbackInput)).rejects.toMatchObject({
      code: "review_apply_rollback_expired",
      status: 409,
    })
    expect(mocks.tx.discoveryAutoReviewDecision.findMany).not.toHaveBeenCalled()
  })

  it("rolls back every suppressed row and leaves envelopes untouched", async () => {
    mocks.tx.discoveryAutoReviewRun.findFirst.mockResolvedValueOnce(runRecord())
    mocks.tx.discoveryAutoReviewDecision.findMany.mockResolvedValueOnce([{
      id: "decision-1",
      groupKeyHmac: "group-key-hmac",
    }])
    mocks.tx.discoveryAutoReviewRun.update.mockResolvedValueOnce(runRecord({
      state: "ROLLED_BACK",
      rolledBackAt: now,
    }))

    const result = await rollbackDiscoveryAutoReviewRun(rollbackInput)

    expect(result).toMatchObject({
      idempotent: false,
      run: { state: "ROLLED_BACK", rollbackAvailable: false },
    })
    expect(mocks.tx.discoveryAutoReviewDecision.updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        runId: "run-1",
        state: "SUPPRESSED",
      },
      data: { state: "ROLLED_BACK", rolledBackAt: now },
    })
    expect(mocks.tx.discoveryAutoReviewRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: "ROLLED_BACK",
          rolledBackGroupCount: 1,
          rolledBackRowCount: 1,
        }),
      }),
    )
    expect(mocks.tx.ingestEnvelope.updateMany).not.toHaveBeenCalled()
  })

  it("rolls back mixed SAFE_RESOLVE actions during the full 24-hour window", async () => {
    mocks.tx.discoveryAutoReviewRun.findFirst.mockResolvedValueOnce(runRecord({
      mode: "SAFE_RESOLVE",
      appliedGroupCount: 2,
      appliedRowCount: 2,
    }))
    mocks.tx.discoveryAutoReviewDecision.findMany.mockResolvedValueOnce([
      { id: "decision-reject", groupKeyHmac: "group-reject" },
      { id: "decision-release", groupKeyHmac: "group-release" },
    ])
    mocks.tx.discoveryAutoReviewDecision.updateMany.mockResolvedValueOnce({
      count: 2,
    })
    mocks.tx.discoveryAutoReviewRun.update.mockResolvedValueOnce(runRecord({
      mode: "SAFE_RESOLVE",
      state: "ROLLED_BACK",
      appliedGroupCount: 2,
      appliedRowCount: 2,
      rolledBackAt: now,
    }))

    await expect(rollbackDiscoveryAutoReviewRun(rollbackInput)).resolves.toMatchObject({
      idempotent: false,
      run: {
        mode: "SAFE_RESOLVE",
        state: "ROLLED_BACK",
        rollbackAvailable: false,
      },
    })

    expect(mocks.tx.discoveryAutoReviewDecision.updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        runId: "run-1",
        state: "SUPPRESSED",
      },
      data: { state: "ROLLED_BACK", rolledBackAt: now },
    })
    expect(mocks.tx.discoveryAutoReviewRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: "ROLLED_BACK",
          rolledBackGroupCount: 2,
          rolledBackRowCount: 2,
        }),
      }),
    )
    expect(mocks.replayIngestEnvelope).not.toHaveBeenCalled()
    expect(mocks.tx.discoveryAutoReviewEvent.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          eventType: "DECISION_ROLLED_BACK",
          payload: expect.objectContaining({ groupCount: 2, rowCount: 2 }),
        }),
        expect.objectContaining({
          eventType: "RUN_ROLLED_BACK",
          payload: expect.objectContaining({ groupCount: 2, rowCount: 2 }),
        }),
      ],
    })
  })

  it("aborts rollback if the ledger row count no longer matches the run", async () => {
    mocks.tx.discoveryAutoReviewRun.findFirst.mockResolvedValueOnce(runRecord({
      appliedRowCount: 2,
    }))
    mocks.tx.discoveryAutoReviewDecision.findMany.mockResolvedValueOnce([{
      id: "decision-1",
      groupKeyHmac: "group-key-hmac",
    }])

    await expect(rollbackDiscoveryAutoReviewRun(rollbackInput)).rejects.toMatchObject({
      code: "review_apply_rollback_state_changed",
      status: 409,
    })
    expect(mocks.tx.discoveryAutoReviewDecision.updateMany).not.toHaveBeenCalled()
  })
})

describe("finalizeDueDiscoveryAutoReviewRuns", () => {
  function dueRun(
    options: number | {
      appliedRowCount?: number
      appliedGroupCount?: number
      mode?: "REJECT_ONLY" | "SAFE_RESOLVE"
    } = 1,
  ) {
    const appliedRowCount = typeof options === "number"
      ? options
      : options.appliedRowCount ?? 1
    const appliedGroupCount = typeof options === "number"
      ? 1
      : options.appliedGroupCount ?? 1
    const mode = typeof options === "number"
      ? "REJECT_ONLY"
      : options.mode ?? "REJECT_ONLY"
    mocks.tx.discoveryAutoReviewRun.findMany.mockResolvedValueOnce([{
      id: "run-1",
      organizationId: "org-1",
    }])
    mocks.tx.discoveryAutoReviewRun.findFirst
      .mockResolvedValueOnce({
        id: "run-1",
        subjectId: "subject-1",
        resolverVersion: "discovery_auto_review_v1",
        mode,
        rollbackUntil: new Date("2026-07-23T11:00:00.000Z"),
        appliedGroupCount,
        appliedRowCount,
      })
      .mockResolvedValueOnce({
        id: "run-1",
        subjectId: "subject-1",
        resolverVersion: "discovery_auto_review_v1",
        mode,
        appliedGroupCount,
        appliedRowCount,
      })
  }

  function decision(
    id = "decision-1",
    envelopeId = "envelope-1",
    overrides: Record<string, unknown> = {},
  ) {
    return {
      id,
      envelopeId,
      action: "REJECT",
      state: "SUPPRESSED",
      reason: "discovery_auto_review_outside_provider_window",
      groupKeyHmac: "group-key-hmac",
      beforeContentHmac: "content-hmac-1",
      beforeUpdatedAt: candidateUpdatedAt,
      beforePurgeAt: candidatePurgeAt,
      ...overrides,
    }
  }

  function finalizedDecision(
    action = "REJECT",
    groupKeyHmac = "group-key-hmac",
  ) {
    return {
      state: "FINALIZED",
      action,
      groupKeyHmac,
    }
  }

  it("finalizes an unchanged suppressed row only after the rollback deadline", async () => {
    dueRun()
    mocks.tx.discoveryAutoReviewDecision.findMany.mockResolvedValueOnce([
      decision(),
    ]).mockResolvedValueOnce([finalizedDecision()])
    mocks.tx.$queryRaw.mockResolvedValueOnce([{
      id: "envelope-1",
      sourceId: "source-1",
      adapterKey: "APIFY",
      providerKey: "web",
      contentHmac: "content-hmac-1",
    }])

    const result = await finalizeDueDiscoveryAutoReviewRuns({
      organizationId: "org-1",
      now,
      limit: 10,
    })

    expect(result).toEqual({
      runsFinalized: 1,
      rowsFinalized: 1,
      rowsSuperseded: 0,
      failures: 0,
    })
    const finalizeQuery = sqlParts(mocks.tx.$queryRaw.mock.calls[0])
    expect(finalizeQuery.text).toContain("UPDATE ingest_envelopes AS envelope")
    expect(finalizeQuery.text).toContain('"reviewMutationUntil"')
    expect(finalizeQuery.text).toContain("RETURNING")
    expect(mocks.tx.discoveryAutoReviewDecision.updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        runId: "run-1",
        id: { in: ["decision-1"] },
        action: "REJECT",
        state: "SUPPRESSED",
      },
      data: { state: "FINALIZED", finalizedAt: now },
    })
    expect(mocks.tx.discoveryAutoReviewRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { state: "FINALIZED", finalizedAt: now },
      }),
    )
    expect(mocks.tx.$executeRaw).toHaveBeenCalledTimes(1)
    const fingerprintInsert = sqlParts(mocks.tx.$executeRaw.mock.calls[0])
    expect(fingerprintInsert.text).toContain(
      "INSERT INTO rejected_observation_fingerprints",
    )
    expect(fingerprintInsert.text).toContain(
      'ON CONFLICT ("organizationId", "adapterKey", "fingerprintHmac")',
    )
  })

  it("finalizes mixed SAFE_RESOLVE actions with provider-free release replay", async () => {
    dueRun({
      mode: "SAFE_RESOLVE",
      appliedGroupCount: 2,
      appliedRowCount: 2,
    })
    mocks.tx.discoveryAutoReviewDecision.findMany
      .mockResolvedValueOnce([
        decision("decision-reject", "envelope-reject", {
          groupKeyHmac: "group-reject",
        }),
        decision("decision-release", "envelope-release", {
          action: "RELEASE_TO_NORMAL_PIPELINE",
          reason: "discovery_auto_review_fresh_independent_identity",
          groupKeyHmac: "group-release",
          beforeContentHmac: "content-hmac-release",
        }),
      ])
      .mockResolvedValueOnce([
        finalizedDecision("REJECT", "group-reject"),
        finalizedDecision("RELEASE_TO_NORMAL_PIPELINE", "group-release"),
      ])
    mocks.tx.$queryRaw.mockResolvedValueOnce([{
      id: "envelope-reject",
      sourceId: "source-reject",
      adapterKey: "APIFY",
      providerKey: "web",
      contentHmac: "content-hmac-1",
    }])

    await expect(finalizeDueDiscoveryAutoReviewRuns({
      organizationId: "org-1",
      now,
    })).resolves.toEqual({
      runsFinalized: 1,
      rowsFinalized: 2,
      rowsSuperseded: 0,
      failures: 0,
    })

    expect(mocks.replayIngestEnvelope).toHaveBeenCalledOnce()
    expect(mocks.replayIngestEnvelope).toHaveBeenCalledWith(
      "org-1",
      "envelope-release",
      {
        autoReviewDecision: {
          runId: "run-1",
          decisionId: "decision-release",
          subjectId: "subject-1",
          expectedContentHmac: "content-hmac-release",
          expectedUpdatedAt: candidateUpdatedAt,
          expectedPurgeAt: candidatePurgeAt,
        },
        suppressWorkflows: true,
        suppressMediaScheduling: true,
      },
    )
    expect(mocks.tx.discoveryAutoReviewDecision.updateMany).toHaveBeenNthCalledWith(
      2,
      {
        where: {
          organizationId: "org-1",
          runId: "run-1",
          id: "decision-release",
          action: "RELEASE_TO_NORMAL_PIPELINE",
          state: "SUPPRESSED",
        },
        data: { state: "FINALIZED", finalizedAt: now },
      },
    )
    expect(mocks.tx.discoveryAutoReviewEvent.createMany).toHaveBeenLastCalledWith({
      data: [
        expect.objectContaining({
          eventType: "RUN_FINALIZED",
          payload: expect.objectContaining({
            finalizedRowCount: 2,
            supersededRowCount: 0,
            rejectRowCount: 1,
            releaseRowCount: 1,
          }),
        }),
        expect.objectContaining({
          eventType: "DECISION_FINALIZED",
          payload: { rowCount: 2 },
        }),
      ],
    })
  })

  it.each([
    "REJECTED_BY_CURRENT_RELEVANCE",
    "SUPERSEDED",
  ] as const)("marks a release SUPERSEDED for terminal replay result %s", async (status) => {
    dueRun({ mode: "SAFE_RESOLVE" })
    mocks.tx.discoveryAutoReviewDecision.findMany
      .mockResolvedValueOnce([
        decision("decision-release", "envelope-release", {
          action: "RELEASE_TO_NORMAL_PIPELINE",
          reason: "discovery_auto_review_fresh_independent_identity",
          groupKeyHmac: "group-release",
          beforeContentHmac: "content-hmac-release",
        }),
      ])
      .mockResolvedValueOnce([{
        state: "SUPERSEDED",
        action: "RELEASE_TO_NORMAL_PIPELINE",
        groupKeyHmac: "group-release",
      }])
    mocks.replayIngestEnvelope.mockResolvedValueOnce({
      status,
      envelopeId: "envelope-release",
      mentionId: null,
      created: false,
    })

    await expect(finalizeDueDiscoveryAutoReviewRuns({
      organizationId: "org-1",
      now,
    })).resolves.toEqual({
      runsFinalized: 1,
      rowsFinalized: 0,
      rowsSuperseded: 1,
      failures: 0,
    })
    expect(mocks.tx.discoveryAutoReviewDecision.updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        runId: "run-1",
        id: "decision-release",
        action: "RELEASE_TO_NORMAL_PIPELINE",
        state: "SUPPRESSED",
      },
      data: { state: "SUPERSEDED", supersededAt: now },
    })
    expect(mocks.tx.$queryRaw).not.toHaveBeenCalled()
    expect(mocks.tx.$executeRaw).not.toHaveBeenCalled()
  })

  it("finishes cleanly when another worker already superseded the release decision", async () => {
    dueRun({ mode: "SAFE_RESOLVE" })
    mocks.tx.discoveryAutoReviewDecision.findMany
      .mockResolvedValueOnce([
        decision("decision-release", "envelope-release", {
          action: "RELEASE_TO_NORMAL_PIPELINE",
          reason: "discovery_auto_review_fresh_independent_identity",
          groupKeyHmac: "group-release",
          beforeContentHmac: "content-hmac-release",
        }),
      ])
      .mockResolvedValueOnce([{
        state: "SUPERSEDED",
        action: "RELEASE_TO_NORMAL_PIPELINE",
        groupKeyHmac: "group-release",
      }])
    mocks.replayIngestEnvelope.mockResolvedValueOnce({
      status: "SUPERSEDED",
      envelopeId: "envelope-release",
      mentionId: null,
      created: false,
    })
    mocks.tx.discoveryAutoReviewDecision.updateMany.mockResolvedValueOnce({
      count: 0,
    })
    mocks.tx.discoveryAutoReviewDecision.findFirst.mockResolvedValueOnce({
      state: "SUPERSEDED",
    })

    await expect(finalizeDueDiscoveryAutoReviewRuns({
      organizationId: "org-1",
      now,
    })).resolves.toEqual({
      runsFinalized: 1,
      rowsFinalized: 0,
      rowsSuperseded: 0,
      failures: 0,
    })

    expect(mocks.tx.discoveryAutoReviewDecision.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        runId: "run-1",
        id: "decision-release",
      },
      select: { state: true },
    })
    expect(mocks.tx.discoveryAutoReviewRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { state: "FINALIZED", finalizedAt: now },
      }),
    )
    expect(mocks.tx.discoveryAutoReviewRun.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          finalizeAttemptCount: expect.anything(),
        }),
      }),
    )
  })

  it("resumes a partial retry without replaying an already finalized release", async () => {
    dueRun({ mode: "SAFE_RESOLVE" })
    const alreadyFinalized = decision("decision-release", "envelope-release", {
      action: "RELEASE_TO_NORMAL_PIPELINE",
      state: "FINALIZED",
      groupKeyHmac: "group-release",
      beforeContentHmac: "content-hmac-release",
    })
    mocks.tx.discoveryAutoReviewDecision.findMany
      .mockResolvedValueOnce([alreadyFinalized])
      .mockResolvedValueOnce([{
        state: "FINALIZED",
        action: "RELEASE_TO_NORMAL_PIPELINE",
        groupKeyHmac: "group-release",
      }])

    await expect(finalizeDueDiscoveryAutoReviewRuns({
      organizationId: "org-1",
      now,
    })).resolves.toEqual({
      runsFinalized: 1,
      rowsFinalized: 0,
      rowsSuperseded: 0,
      failures: 0,
    })
    expect(mocks.replayIngestEnvelope).not.toHaveBeenCalled()
    expect(mocks.tx.discoveryAutoReviewDecision.updateMany).not.toHaveBeenCalled()
    expect(mocks.tx.discoveryAutoReviewRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { state: "FINALIZED", finalizedAt: now },
      }),
    )
  })

  it("marks changed source rows superseded instead of overwriting operator work", async () => {
    dueRun()
    mocks.tx.discoveryAutoReviewDecision.findMany.mockResolvedValueOnce([
      decision(),
    ]).mockResolvedValueOnce([{
      state: "SUPERSEDED",
      action: "REJECT",
      groupKeyHmac: "group-key-hmac",
    }])
    mocks.tx.$queryRaw.mockResolvedValueOnce([])

    const result = await finalizeDueDiscoveryAutoReviewRuns({
      organizationId: "org-1",
      now,
      limit: 10,
    })

    expect(result).toEqual({
      runsFinalized: 1,
      rowsFinalized: 0,
      rowsSuperseded: 1,
      failures: 0,
    })
    expect(mocks.tx.discoveryAutoReviewDecision.updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        runId: "run-1",
        id: { in: ["decision-1"] },
        action: "REJECT",
        state: "SUPPRESSED",
      },
      data: { state: "SUPERSEDED", supersededAt: now },
    })
    expect(mocks.tx.ingestEnvelope.updateMany).not.toHaveBeenCalled()
    expect(mocks.tx.$executeRaw).not.toHaveBeenCalled()
  })

  it("aggregates duplicate adapter and content fingerprints into one bulk upsert", async () => {
    dueRun(2)
    mocks.tx.discoveryAutoReviewDecision.findMany.mockResolvedValueOnce([
      decision("decision-1", "envelope-1"),
      decision("decision-2", "envelope-2"),
    ]).mockResolvedValueOnce([
      finalizedDecision(),
      finalizedDecision(),
    ])
    mocks.tx.$queryRaw.mockResolvedValueOnce([
      {
        id: "envelope-1",
        sourceId: "source-1",
        adapterKey: "APIFY",
        providerKey: "web",
        contentHmac: "content-hmac-1",
      },
      {
        id: "envelope-2",
        sourceId: "source-2",
        adapterKey: "APIFY",
        providerKey: "web",
        contentHmac: "content-hmac-1",
      },
    ])
    mocks.tx.discoveryAutoReviewDecision.updateMany.mockResolvedValueOnce({
      count: 2,
    })

    await expect(finalizeDueDiscoveryAutoReviewRuns({
      organizationId: "org-1",
      now,
    })).resolves.toEqual({
      runsFinalized: 1,
      rowsFinalized: 2,
      rowsSuperseded: 0,
      failures: 0,
    })

    expect(mocks.tx.$executeRaw).toHaveBeenCalledTimes(1)
    const insert = sqlParts(mocks.tx.$executeRaw.mock.calls[0])
    expect(insert.values.filter(value => value === "content-hmac-1")).toHaveLength(1)
    expect(insert.values).toContain(2)
  })

  it("counts a decision ledger mismatch as a failed run without bulk mutation", async () => {
    dueRun(2)
    mocks.tx.discoveryAutoReviewDecision.findMany.mockResolvedValueOnce([
      decision(),
    ])

    await expect(finalizeDueDiscoveryAutoReviewRuns({
      organizationId: "org-1",
      now,
    })).resolves.toEqual({
      runsFinalized: 0,
      rowsFinalized: 0,
      rowsSuperseded: 0,
      failures: 1,
    })
    expect(mocks.tx.$queryRaw).not.toHaveBeenCalled()
    expect(mocks.tx.$executeRaw).not.toHaveBeenCalled()
    expect(mocks.tx.discoveryAutoReviewRun.updateMany).toHaveBeenCalledOnce()
    expect(mocks.tx.discoveryAutoReviewRun.updateMany).toHaveBeenCalledWith({
      where: {
        id: "run-1",
        organizationId: "org-1",
        state: "APPLIED",
      },
      data: {
        finalizeAttemptCount: { increment: 1 },
        finalizeLastAttemptAt: now,
        finalizeNextAttemptAt: new Date("2026-07-23T12:05:00.000Z"),
        finalizeLastError:
          "review_apply_finalize_decision_count_mismatch",
      },
    })
    expect(mocks.logError).toHaveBeenCalledWith(
      "[social-discovery-review-finalize] review_apply_finalize_decision_count_mismatch",
      undefined,
      expect.objectContaining({ request_id: "run-1" }),
    )
  })

  it("counts a compare-and-set decision update mismatch as a failed run", async () => {
    dueRun()
    mocks.tx.discoveryAutoReviewDecision.findMany.mockResolvedValueOnce([
      decision(),
    ])
    mocks.tx.$queryRaw.mockResolvedValueOnce([{
      id: "envelope-1",
      sourceId: "source-1",
      adapterKey: "APIFY",
      providerKey: "web",
      contentHmac: "content-hmac-1",
    }])
    mocks.tx.discoveryAutoReviewDecision.updateMany.mockResolvedValueOnce({
      count: 0,
    })

    const result = await finalizeDueDiscoveryAutoReviewRuns({
      organizationId: "org-1",
      now,
    })
    expect(result).toMatchObject({
      runsFinalized: 0,
      rowsFinalized: 0,
      failures: 1,
    })
    expect(mocks.tx.discoveryAutoReviewRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          finalizeAttemptCount: { increment: 1 },
          finalizeLastAttemptAt: now,
          finalizeNextAttemptAt: new Date("2026-07-23T12:05:00.000Z"),
          finalizeLastError: "review_apply_finalize_state_changed",
        }),
      }),
    )
    expect(mocks.tx.$executeRaw).not.toHaveBeenCalled()
  })

  it("excludes future retry windows from the due-run query", async () => {
    const result = await finalizeDueDiscoveryAutoReviewRuns({ now })

    expect(result).toEqual({
      runsFinalized: 0,
      rowsFinalized: 0,
      rowsSuperseded: 0,
      failures: 0,
    })
    expect(mocks.tx.discoveryAutoReviewRun.findMany).toHaveBeenCalledWith({
      where: {
        state: "APPLIED",
        rollbackUntil: { lte: now },
        AND: [
          {
            OR: [
              { finalizeNextAttemptAt: null },
              { finalizeNextAttemptAt: { lte: now } },
            ],
          },
        ],
      },
      orderBy: [
        { finalizeAttemptCount: "asc" },
        { rollbackUntil: "asc" },
        { id: "asc" },
      ],
      take: 100,
      select: { id: true, organizationId: true },
    })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("continues past a failing prefix and finalizes a later healthy run", async () => {
    mocks.tx.discoveryAutoReviewRun.findMany.mockResolvedValueOnce([
      { id: "run-failing", organizationId: "org-1" },
      { id: "run-healthy", organizationId: "org-1" },
    ])
    mocks.tx.discoveryAutoReviewRun.findFirst
      .mockResolvedValueOnce({
        id: "run-failing",
        subjectId: "subject-failing",
        resolverVersion: "discovery_auto_review_v1",
        mode: "REJECT_ONLY",
        rollbackUntil: new Date("2026-07-23T10:00:00.000Z"),
        appliedGroupCount: 1,
        appliedRowCount: 2,
      })
      .mockResolvedValueOnce({
        id: "run-healthy",
        subjectId: "subject-healthy",
        resolverVersion: "discovery_auto_review_v1",
        mode: "REJECT_ONLY",
        rollbackUntil: new Date("2026-07-23T11:00:00.000Z"),
        appliedGroupCount: 1,
        appliedRowCount: 1,
      })
      .mockResolvedValueOnce({
        id: "run-healthy",
        subjectId: "subject-healthy",
        resolverVersion: "discovery_auto_review_v1",
        mode: "REJECT_ONLY",
        appliedGroupCount: 1,
        appliedRowCount: 1,
      })
    mocks.tx.discoveryAutoReviewDecision.findMany
      .mockResolvedValueOnce([
        decision("decision-failing", "envelope-failing"),
      ])
      .mockResolvedValueOnce([
        decision("decision-healthy", "envelope-healthy"),
      ])
      .mockResolvedValueOnce([finalizedDecision()])
    mocks.tx.$queryRaw.mockResolvedValueOnce([{
      id: "envelope-healthy",
      sourceId: "source-healthy",
      adapterKey: "APIFY",
      providerKey: "web",
      contentHmac: "content-hmac-1",
    }])

    await expect(finalizeDueDiscoveryAutoReviewRuns({
      organizationId: "org-1",
      now,
      limit: 2,
    })).resolves.toEqual({
      runsFinalized: 1,
      rowsFinalized: 1,
      rowsSuperseded: 0,
      failures: 1,
    })

    expect(mocks.tx.discoveryAutoReviewRun.updateMany).toHaveBeenCalledTimes(2)
    expect(mocks.tx.discoveryAutoReviewRun.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ id: "run-failing" }),
        data: expect.objectContaining({
          finalizeAttemptCount: { increment: 1 },
          finalizeLastError:
            "review_apply_finalize_decision_count_mismatch",
        }),
      }),
    )
    expect(mocks.tx.discoveryAutoReviewRun.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ id: "run-healthy" }),
        data: { state: "FINALIZED", finalizedAt: now },
      }),
    )
  })
})

describe("DiscoveryAutoReviewApplyError", () => {
  it("retains a stable machine code and HTTP status", () => {
    const error = new DiscoveryAutoReviewApplyError("review_apply_preview_stale", 409)
    expect(error).toMatchObject({
      name: "DiscoveryAutoReviewApplyError",
      message: "review_apply_preview_stale",
      code: "review_apply_preview_stale",
      status: 409,
    })
  })
})
