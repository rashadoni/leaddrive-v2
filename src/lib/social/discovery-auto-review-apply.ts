import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { logError } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { hmacToken } from "@/lib/secure-token";
import {
  DISCOVERY_AUTO_REVIEW_RELEASE_RETENTION_SAFETY_MARGIN_MS,
  DISCOVERY_AUTO_REVIEW_RETENTION_SAFETY_MARGIN_MS,
  DISCOVERY_AUTO_REVIEW_VERSION,
} from "@/lib/social/discovery-auto-review";
import {
  loadDiscoveryAutoReviewPlan,
  type DiscoveryAutoReviewCandidateDecision,
} from "@/lib/social/discovery-auto-review-report";
import { checkSocialMonitoringTenantCollectionFence } from "@/lib/social/monitoring-import-fence";

type ReplayIngestEnvelope = typeof import("@/lib/social/ingest-envelope-replay")["replayIngestEnvelope"];

async function loadReplayIngestEnvelope(): Promise<ReplayIngestEnvelope> {
  // Keep the provider-free replay path outside the ordinary apply/rollback
  // import graph. REJECT_ONLY batches never need the heavier ingest runtime,
  // and unit tests for the ledger should not have to initialize Next/Auth.
  return (await import("@/lib/social/ingest-envelope-replay")).replayIngestEnvelope;
}

const REJECTED_FINGERPRINT_RETENTION_MS = 14 * 86_400_000;
const REJECTED_ENVELOPE_RETENTION_MS = 24 * 3_600_000;
const FINALIZE_RETRY_DELAY_MS = 5 * 60_000;
const SERIALIZABLE_ATTEMPTS = 3;
const SQL_BATCH_SIZE = 500;
const INTERACTIVE_TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 10_000,
  timeout: 120_000,
} as const;

type ReviewRunRecord = {
  id: string;
  mode: string;
  state: string;
  requestFingerprint: string;
  appliedGroupCount: number;
  appliedRowCount: number;
  rollbackUntil: Date;
  createdAt: Date;
  rolledBackAt: Date | null;
  finalizedAt: Date | null;
};

type LiveCandidateSnapshot = {
  id: string;
  contentHmac: string;
  updatedAt: Date;
  relevanceStatus: string;
  relevanceReason: string | null;
  relevanceConfidence: number | null;
  decidedAt: Date | null;
  purgeAt: Date;
};

type FinalizeDecisionSnapshot = {
  id: string;
  envelopeId: string;
  action: string;
  state: string;
  reason: string;
  beforeContentHmac: string;
  beforeUpdatedAt: Date;
  beforePurgeAt: Date;
};

type FinalizedEnvelopeSnapshot = {
  id: string;
  sourceId: string | null;
  adapterKey: string;
  providerKey: string | null;
  contentHmac: string;
};

export type DiscoveryAutoReviewRunSummary = {
  id: string;
  mode: string;
  state: string;
  appliedGroupCount: number;
  appliedRowCount: number;
  rollbackUntil: string;
  createdAt: string;
  rolledBackAt: string | null;
  finalizedAt: string | null;
  rollbackAvailable: boolean;
};

export type ApplyDiscoveryAutoReviewInput = {
  organizationId: string;
  subjectId: string;
  requestedBy: string;
  idempotencyKey: string;
  mode: "REJECT_ONLY" | "SAFE_RESOLVE";
  resolverVersion: string;
  planFingerprint: string;
  expectedLinks: number;
  expectedRows: number;
};

export class DiscoveryAutoReviewApplyError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
    this.name = "DiscoveryAutoReviewApplyError";
  }
}

function summarizeRun(
  run: ReviewRunRecord,
  now = new Date(),
): DiscoveryAutoReviewRunSummary {
  return {
    id: run.id,
    mode: run.mode,
    state: run.state,
    appliedGroupCount: run.appliedGroupCount,
    appliedRowCount: run.appliedRowCount,
    rollbackUntil: run.rollbackUntil.toISOString(),
    createdAt: run.createdAt.toISOString(),
    rolledBackAt: run.rolledBackAt?.toISOString() ?? null,
    finalizedAt: run.finalizedAt?.toISOString() ?? null,
    rollbackAvailable:
      run.state === "APPLIED" && run.rollbackUntil.getTime() > now.getTime(),
  };
}

function requestFingerprint(input: ApplyDiscoveryAutoReviewInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        organizationId: input.organizationId,
        subjectId: input.subjectId,
        requestedBy: input.requestedBy,
        idempotencyKey: input.idempotencyKey,
        mode: input.mode,
        resolverVersion: input.resolverVersion,
        planFingerprint: input.planFingerprint,
        expectedLinks: input.expectedLinks,
        expectedRows: input.expectedRows,
      }),
    )
    .digest("hex");
}

function isPrismaError(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

function chunksOf<T>(values: readonly T[], size = SQL_BATCH_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function withSerializableRetry<T>(
  operation: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (isPrismaError(error, "P2034") && attempt < SERIALIZABLE_ATTEMPTS) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 20 * attempt));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

function safeEvidence(
  decision: DiscoveryAutoReviewCandidateDecision["decision"],
): Prisma.InputJsonObject {
  const evidence = decision.evidence;
  return {
    policyVersion: evidence.policyVersion,
    reviewReason: evidence.reviewReason,
    locationClassification: evidence.urlClassification,
    locationHost: evidence.urlHost,
    matchedOfficialHost: evidence.matchedOfficialHost,
    resolvedPublishedAt: evidence.resolvedPublishedAt,
    publishedAtSource: evidence.publishedAtSource,
    freshness: evidence.freshness,
    titleIdentityMatchCount: evidence.titleIdentityTerms.length,
    locationIdentityMatchCount: evidence.urlIdentityTerms.length,
  };
}

function eligibleGroups(
  plan: Awaited<ReturnType<typeof loadDiscoveryAutoReviewPlan>>,
  mode: ApplyDiscoveryAutoReviewInput["mode"],
) {
  return (
    plan?.groups.filter(
      (group) =>
        mode === "REJECT_ONLY"
          ? (
              group.applyEligibility === "ELIGIBLE"
              && group.decision.action === "REJECT"
              && Boolean(group.rollbackUntil)
            )
          : (
              group.safeApplyEligibility === "ELIGIBLE"
              && ["REJECT", "RELEASE_TO_NORMAL_PIPELINE"].includes(group.decision.action)
              && Boolean(group.safeRollbackUntil)
            ),
    ) ?? []
  );
}

function applyPreview(
  plan: NonNullable<Awaited<ReturnType<typeof loadDiscoveryAutoReviewPlan>>>,
  mode: ApplyDiscoveryAutoReviewInput["mode"],
) {
  return mode === "REJECT_ONLY" ? plan.report.apply : plan.report.safeApply;
}

async function findIdempotentRun(
  organizationId: string,
  idempotencyKey: string,
): Promise<ReviewRunRecord | null> {
  return prisma.discoveryAutoReviewRun.findFirst({
    where: { organizationId, idempotencyKey },
    select: {
      id: true,
      mode: true,
      state: true,
      requestFingerprint: true,
      appliedGroupCount: true,
      appliedRowCount: true,
      rollbackUntil: true,
      createdAt: true,
      rolledBackAt: true,
      finalizedAt: true,
    },
  });
}

export async function loadLatestDiscoveryAutoReviewRun(
  organizationId: string,
  subjectId: string,
): Promise<DiscoveryAutoReviewRunSummary | null> {
  const run: ReviewRunRecord | null =
    await prisma.discoveryAutoReviewRun.findFirst({
      where: { organizationId, subjectId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        mode: true,
        state: true,
        requestFingerprint: true,
        appliedGroupCount: true,
        appliedRowCount: true,
        rollbackUntil: true,
        createdAt: true,
        rolledBackAt: true,
        finalizedAt: true,
      },
    });
  return run ? summarizeRun(run) : null;
}

/**
 * Suppresses only deterministic REJECT candidates. The source envelope remains
 * byte-for-byte unchanged until the rollback window closes, so this operation
 * is reversible and never calls a discovery provider or replay pipeline.
 */
export async function applyDiscoveryAutoReviewPlan(
  input: ApplyDiscoveryAutoReviewInput,
): Promise<{ run: DiscoveryAutoReviewRunSummary; idempotent: boolean }> {
  const fingerprint = requestFingerprint(input);
  const existing = await findIdempotentRun(
    input.organizationId,
    input.idempotencyKey,
  );
  if (existing) {
    if (existing.requestFingerprint !== fingerprint) {
      throw new DiscoveryAutoReviewApplyError(
        "review_apply_idempotency_conflict",
        409,
      );
    }
    return { run: summarizeRun(existing), idempotent: true };
  }

  try {
    const run = await withSerializableRetry<ReviewRunRecord>(() =>
      prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const collectionGate = await checkSocialMonitoringTenantCollectionFence(
          tx,
          input.organizationId,
        );
        if (!collectionGate.allowed) {
          throw new DiscoveryAutoReviewApplyError(
            collectionGate.reason,
            409,
          );
        }
        const duplicate = await tx.discoveryAutoReviewRun.findFirst({
          where: {
            organizationId: input.organizationId,
            idempotencyKey: input.idempotencyKey,
          },
          select: {
            id: true,
            mode: true,
            state: true,
            requestFingerprint: true,
            appliedGroupCount: true,
            appliedRowCount: true,
            rollbackUntil: true,
            createdAt: true,
            rolledBackAt: true,
            finalizedAt: true,
          },
        });
        if (duplicate) {
          if (duplicate.requestFingerprint !== fingerprint) {
            throw new DiscoveryAutoReviewApplyError(
              "review_apply_idempotency_conflict",
              409,
            );
          }
          return duplicate;
        }

        const plan = await loadDiscoveryAutoReviewPlan(
          input.organizationId,
          input.subjectId,
          tx as unknown as Pick<
            typeof prisma,
            "monitoringSubject" | "$queryRaw"
          >,
        );
        if (!plan) {
          throw new DiscoveryAutoReviewApplyError(
            "monitoring_subject_not_found",
            404,
          );
        }
        if (
          !["REJECT_ONLY", "SAFE_RESOLVE"].includes(input.mode)
          || input.resolverVersion !== DISCOVERY_AUTO_REVIEW_VERSION
        ) {
          throw new DiscoveryAutoReviewApplyError(
            "review_apply_unsupported_mode",
            400,
          );
        }
        const preview = applyPreview(plan, input.mode);
        if (
          preview.planFingerprint !== input.planFingerprint ||
          preview.eligibleLinks !== input.expectedLinks ||
          preview.eligibleRows !== input.expectedRows
        ) {
          throw new DiscoveryAutoReviewApplyError(
            "review_apply_preview_stale",
            409,
          );
        }

        const groups = eligibleGroups(plan, input.mode);
        const rows = groups.flatMap((group) =>
          group.rows.map((row) => ({ group, row })),
        );
        if (groups.length === 0 || rows.length === 0) {
          throw new DiscoveryAutoReviewApplyError(
            "review_apply_nothing_eligible",
            409,
          );
        }
        const rollbackUntil = preview.rollbackUntil
          ? new Date(preview.rollbackUntil)
          : null;
        if (!rollbackUntil || !Number.isFinite(rollbackUntil.getTime())) {
          throw new DiscoveryAutoReviewApplyError(
            "review_apply_rollback_unavailable",
            409,
          );
        }

        const now = new Date();
        if (
          rollbackUntil.getTime() <=
          now.getTime() + DISCOVERY_AUTO_REVIEW_RETENTION_SAFETY_MARGIN_MS
        ) {
          throw new DiscoveryAutoReviewApplyError(
            "review_apply_preview_stale",
            409,
          );
        }

        const candidateIds = rows.map(({ row }) => row.candidate.id).sort();
        // Serialize suppression against operator accept/reject and retention
        // writes. The envelopes are not changed here; row locks live only for
        // this transaction and make the subsequent snapshot check authoritative.
        const minimumPurgeAt = new Date(
          rollbackUntil.getTime() +
            (input.mode === "SAFE_RESOLVE"
              ? DISCOVERY_AUTO_REVIEW_RELEASE_RETENTION_SAFETY_MARGIN_MS
              : DISCOVERY_AUTO_REVIEW_RETENTION_SAFETY_MARGIN_MS),
        );
        const liveCandidates: LiveCandidateSnapshot[] = [];
        for (const candidateIdBatch of chunksOf(candidateIds)) {
          const locked = await tx.$queryRaw<LiveCandidateSnapshot[]>`
          SELECT
            envelope.id,
            envelope."contentHmac",
            envelope."updatedAt",
            envelope."relevanceStatus",
            envelope."relevanceReason",
            envelope."relevanceConfidence",
            envelope."decidedAt",
            envelope."purgeAt"
          FROM ingest_envelopes envelope
          WHERE envelope."organizationId" = ${input.organizationId}
            AND envelope.id IN (${Prisma.join(candidateIdBatch)})
            AND envelope."relevanceStatus" = 'REVIEW'
            AND envelope."acceptedMentionId" IS NULL
            AND envelope."purgedAt" IS NULL
            AND envelope."purgeAt" >= ${minimumPurgeAt}
            AND (
              envelope."reviewMutationUntil" IS NULL
              OR envelope."reviewMutationUntil" <= ${now}
            )
          ORDER BY envelope.id
          FOR UPDATE
        `;
          liveCandidates.push(...locked);
        }
        const liveById = new Map(
          liveCandidates.map(
            (candidate: LiveCandidateSnapshot) =>
              [candidate.id, candidate] as const,
          ),
        );
        const snapshotsMatch = rows.every(({ row }) => {
          const live = liveById.get(row.candidate.id);
          return Boolean(
            live &&
            live.contentHmac === row.candidate.contentHmac &&
            live.updatedAt.getTime() ===
              new Date(row.candidate.updatedAt).getTime() &&
            live.purgeAt.getTime() ===
              new Date(row.candidate.purgeAt).getTime(),
          );
        });
        if (!snapshotsMatch || liveCandidates.length !== candidateIds.length) {
          throw new DiscoveryAutoReviewApplyError(
            "review_apply_preview_stale",
            409,
          );
        }

        const created = await tx.discoveryAutoReviewRun.create({
          data: {
            organizationId: input.organizationId,
            subjectId: input.subjectId,
            idempotencyKey: input.idempotencyKey,
            requestFingerprint: fingerprint,
            resolverVersion: input.resolverVersion,
            mode: input.mode,
            state: "APPLIED",
            requestedBy: input.requestedBy,
            plannedGroupCount: plan.groups.length,
            plannedRowCount: plan.report.totalRows,
            appliedGroupCount: groups.length,
            appliedRowCount: rows.length,
            skippedGroupCount: plan.groups.length - groups.length,
            skippedRowCount: plan.report.totalRows - rows.length,
            rollbackUntil,
            completedAt: now,
          },
          select: {
            id: true,
            mode: true,
            state: true,
            requestFingerprint: true,
            appliedGroupCount: true,
            appliedRowCount: true,
            rollbackUntil: true,
            createdAt: true,
            rolledBackAt: true,
            finalizedAt: true,
          },
        });

        const decisionData = rows.map(({ group, row }) => {
          const before = liveById.get(row.candidate.id)!;
          return {
            organizationId: input.organizationId,
            runId: created.id,
            envelopeId: row.candidate.id,
            resolverVersion: input.resolverVersion,
            action: row.decision.action,
            state: "SUPPRESSED",
            reason: row.decision.reason,
            groupKeyHmac: hmacToken(
              group.key,
              `social-discovery-review-group:${input.organizationId}`,
            ),
            beforeStatus: before.relevanceStatus,
            beforeReason: before.relevanceReason,
            beforeConfidence: before.relevanceConfidence,
            beforeDecidedAt: before.decidedAt,
            beforePurgeAt: before.purgeAt,
            beforeContentHmac: before.contentHmac,
            beforeUpdatedAt: before.updatedAt,
            evidence: safeEvidence(row.decision),
            rollbackUntil,
            appliedAt: now,
          };
        });
        for (const decisionBatch of chunksOf(decisionData)) {
          await tx.discoveryAutoReviewDecision.createMany({
            data: decisionBatch,
          });
        }
        await tx.discoveryAutoReviewEvent.createMany({
          data: [
            {
              organizationId: input.organizationId,
              runId: created.id,
              eventType: "DECISION_SUPPRESSED",
              actorType: "USER",
              actorId: input.requestedBy,
              payload: {
                groupCount: groups.length,
                rowCount: rows.length,
                resolverVersion: input.resolverVersion,
                rejectGroupCount: groups.filter(
                  group => group.decision.action === "REJECT",
                ).length,
                rejectRowCount: rows.filter(
                  ({ row }) => row.decision.action === "REJECT",
                ).length,
                releaseGroupCount: groups.filter(
                  group => group.decision.action === "RELEASE_TO_NORMAL_PIPELINE",
                ).length,
                releaseRowCount: rows.filter(
                  ({ row }) => row.decision.action === "RELEASE_TO_NORMAL_PIPELINE",
                ).length,
              },
            },
            {
              organizationId: input.organizationId,
              runId: created.id,
              eventType: "RUN_APPLIED",
              actorType: "USER",
              actorId: input.requestedBy,
              payload: {
                mode: input.mode,
                groupCount: groups.length,
                rowCount: rows.length,
                rejectGroupCount: groups.filter(
                  group => group.decision.action === "REJECT",
                ).length,
                rejectRowCount: rows.filter(
                  ({ row }) => row.decision.action === "REJECT",
                ).length,
                releaseGroupCount: groups.filter(
                  group => group.decision.action === "RELEASE_TO_NORMAL_PIPELINE",
                ).length,
                releaseRowCount: rows.filter(
                  ({ row }) => row.decision.action === "RELEASE_TO_NORMAL_PIPELINE",
                ).length,
                skippedGroupCount: plan.groups.length - groups.length,
                skippedRowCount: plan.report.totalRows - rows.length,
                planFingerprint: input.planFingerprint,
              },
            },
          ],
        });
        await tx.auditLog.create({
          data: {
            organizationId: input.organizationId,
            userId: input.requestedBy,
            action: "social_discovery_review_apply",
            entityType: "monitoring_subject",
            entityId: input.subjectId,
            entityName: input.mode,
            newValue: {
              runId: created.id,
              groupCount: groups.length,
              rowCount: rows.length,
              resolverVersion: input.resolverVersion,
              rollbackUntil: rollbackUntil.toISOString(),
            },
          },
        });
        return created;
      }, INTERACTIVE_TRANSACTION_OPTIONS),
    );

    return { run: summarizeRun(run), idempotent: false };
  } catch (error) {
    if (error instanceof DiscoveryAutoReviewApplyError) throw error;
    if (isPrismaError(error, "P2002")) {
      const raced = await findIdempotentRun(
        input.organizationId,
        input.idempotencyKey,
      );
      if (raced) {
        if (raced.requestFingerprint !== fingerprint) {
          throw new DiscoveryAutoReviewApplyError(
            "review_apply_idempotency_conflict",
            409,
          );
        }
        return { run: summarizeRun(raced), idempotent: true };
      }
      throw new DiscoveryAutoReviewApplyError(
        "review_apply_already_active",
        409,
      );
    }
    throw error;
  }
}

export async function rollbackDiscoveryAutoReviewRun(input: {
  organizationId: string;
  subjectId: string;
  runId: string;
  requestedBy: string;
  idempotencyKey: string;
}): Promise<{ run: DiscoveryAutoReviewRunSummary; idempotent: boolean }> {
  return withSerializableRetry<{
    run: DiscoveryAutoReviewRunSummary;
    idempotent: boolean;
  }>(() =>
    prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const run = await tx.discoveryAutoReviewRun.findFirst({
        where: {
          organizationId: input.organizationId,
          subjectId: input.subjectId,
          id: input.runId,
        },
        select: {
          id: true,
          mode: true,
          state: true,
          requestFingerprint: true,
          appliedGroupCount: true,
          appliedRowCount: true,
          rollbackUntil: true,
          createdAt: true,
          rolledBackAt: true,
          finalizedAt: true,
        },
      });
      if (!run) {
        throw new DiscoveryAutoReviewApplyError(
          "review_apply_run_not_found",
          404,
        );
      }
      if (run.state === "ROLLED_BACK") {
        return { run: summarizeRun(run), idempotent: true };
      }
      if (run.state !== "APPLIED") {
        throw new DiscoveryAutoReviewApplyError(
          "review_apply_rollback_unavailable",
          409,
        );
      }

      const now = new Date();
      if (run.rollbackUntil.getTime() <= now.getTime()) {
        throw new DiscoveryAutoReviewApplyError(
          "review_apply_rollback_expired",
          409,
        );
      }
      const decisions: Array<{ id: string; groupKeyHmac: string }> =
        await tx.discoveryAutoReviewDecision.findMany({
          where: {
            organizationId: input.organizationId,
            runId: input.runId,
            state: "SUPPRESSED",
          },
          select: { id: true, groupKeyHmac: true },
        });
      if (decisions.length !== run.appliedRowCount) {
        throw new DiscoveryAutoReviewApplyError(
          "review_apply_rollback_state_changed",
          409,
        );
      }
      const rolledBack = await tx.discoveryAutoReviewDecision.updateMany({
        where: {
          organizationId: input.organizationId,
          runId: input.runId,
          state: "SUPPRESSED",
        },
        data: { state: "ROLLED_BACK", rolledBackAt: now },
      });
      if (rolledBack.count !== run.appliedRowCount) {
        throw new DiscoveryAutoReviewApplyError(
          "review_apply_rollback_state_changed",
          409,
        );
      }

      const groupCount = new Set(
        decisions.map(
          (decision: { id: string; groupKeyHmac: string }) =>
            decision.groupKeyHmac,
        ),
      ).size;
      if (groupCount !== run.appliedGroupCount) {
        throw new DiscoveryAutoReviewApplyError(
          "review_apply_rollback_state_changed",
          409,
        );
      }
      const updated = await tx.discoveryAutoReviewRun.update({
        where: {
          organizationId_id: {
            organizationId: input.organizationId,
            id: input.runId,
          },
        },
        data: {
          state: "ROLLED_BACK",
          rolledBackAt: now,
          rolledBackGroupCount: groupCount,
          rolledBackRowCount: rolledBack.count,
        },
        select: {
          id: true,
          mode: true,
          state: true,
          requestFingerprint: true,
          appliedGroupCount: true,
          appliedRowCount: true,
          rollbackUntil: true,
          createdAt: true,
          rolledBackAt: true,
          finalizedAt: true,
        },
      });
      await tx.discoveryAutoReviewEvent.createMany({
        data: [
          {
            organizationId: input.organizationId,
            runId: input.runId,
            eventType: "DECISION_ROLLED_BACK",
            actorType: "USER",
            actorId: input.requestedBy,
            payload: {
              groupCount,
              rowCount: rolledBack.count,
              rollbackRequestId: input.idempotencyKey,
            },
          },
          {
            organizationId: input.organizationId,
            runId: input.runId,
            eventType: "RUN_ROLLED_BACK",
            actorType: "USER",
            actorId: input.requestedBy,
            payload: {
              groupCount,
              rowCount: rolledBack.count,
              rollbackRequestId: input.idempotencyKey,
            },
          },
        ],
      });
      await tx.auditLog.create({
        data: {
          organizationId: input.organizationId,
          userId: input.requestedBy,
          action: "social_discovery_review_rollback",
          entityType: "monitoring_subject",
          entityId: input.subjectId,
          entityName: run.mode,
          newValue: {
            runId: input.runId,
            groupCount,
            rowCount: rolledBack.count,
            rollbackRequestId: input.idempotencyKey,
          },
        },
      });
      return { run: summarizeRun(updated, now), idempotent: false };
    }, INTERACTIVE_TRANSACTION_OPTIONS),
  );
}

export type FinalizeDiscoveryAutoReviewResult = {
  runsFinalized: number;
  rowsFinalized: number;
  rowsSuperseded: number;
  failures: number;
};

type DueReviewRun = {
  id: string;
  organizationId: string;
};

type PreparedReviewRun = {
  run: {
    id: string;
    subjectId: string;
    resolverVersion: string;
    mode: string;
    rollbackUntil: Date;
    appliedGroupCount: number;
    appliedRowCount: number;
  };
  releaseDecisions: FinalizeDecisionSnapshot[];
  finalizedRows: number;
  supersededRows: number;
};

async function prepareDiscoveryAutoReviewRun(
  due: DueReviewRun,
  now: Date,
): Promise<PreparedReviewRun | null> {
  return withSerializableRetry<PreparedReviewRun | null>(() =>
    prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const run = await tx.discoveryAutoReviewRun.findFirst({
        where: {
          id: due.id,
          organizationId: due.organizationId,
          state: "APPLIED",
          rollbackUntil: { lte: now },
        },
        select: {
          id: true,
          subjectId: true,
          resolverVersion: true,
          mode: true,
          rollbackUntil: true,
          appliedGroupCount: true,
          appliedRowCount: true,
        },
      });
      if (!run) return null;

      const decisions: FinalizeDecisionSnapshot[] =
        await tx.discoveryAutoReviewDecision.findMany({
          where: {
            organizationId: due.organizationId,
            runId: due.id,
          },
          orderBy: { id: "asc" },
          select: {
            id: true,
            envelopeId: true,
            action: true,
            state: true,
            reason: true,
            beforeContentHmac: true,
            beforeUpdatedAt: true,
            beforePurgeAt: true,
          },
        });
      if (decisions.length !== run.appliedRowCount) {
        throw new Error("review_apply_finalize_decision_count_mismatch");
      }
      if (
        decisions.some(decision =>
          !["REJECT", "RELEASE_TO_NORMAL_PIPELINE"].includes(decision.action)
          || !["SUPPRESSED", "FINALIZED", "SUPERSEDED"].includes(decision.state),
        )
      ) {
        throw new Error("review_apply_finalize_state_changed");
      }
      if (
        run.mode === "REJECT_ONLY"
        && decisions.some(decision => decision.action !== "REJECT")
      ) {
        throw new Error("review_apply_finalize_state_changed");
      }

      const pendingRejects = decisions.filter(
        decision => decision.state === "SUPPRESSED" && decision.action === "REJECT",
      );
      let finalizedRows = 0;
      let supersededRows = 0;
      if (pendingRejects.length > 0) {
        // One compare-and-set UPDATE per bounded batch serializes rejection
        // against operator review, retention, and a concurrent finalizer.
        const finalizedEnvelopes: FinalizedEnvelopeSnapshot[] = [];
        const rejectedPurgeAt = new Date(
          now.getTime() + REJECTED_ENVELOPE_RETENTION_MS,
        );
        for (const decisionBatch of chunksOf(pendingRejects)) {
          const snapshots = decisionBatch.map(
            decision => Prisma.sql`(
              ${decision.envelopeId},
              ${decision.beforeContentHmac},
              ${decision.beforeUpdatedAt},
              ${decision.beforePurgeAt},
              ${decision.reason}
            )`,
          );
          const updated = await tx.$queryRaw<FinalizedEnvelopeSnapshot[]>(
            Prisma.sql`
              UPDATE ingest_envelopes AS envelope
              SET
                "relevanceStatus" = 'REJECTED',
                "relevanceReason" = snapshot.reason,
                "relevanceConfidence" = 1,
                "decidedAt" = ${now},
                "purgeAt" = LEAST(envelope."purgeAt", ${rejectedPurgeAt}),
                text = NULL,
                "authorName" = NULL,
                "authorHandle" = NULL,
                "authorAvatar" = NULL,
                url = NULL,
                "canonicalUrl" = NULL,
                "parentPostUrl" = NULL,
                "rawPayload" = '{}'::jsonb,
                "updatedAt" = ${now}
              FROM (VALUES ${Prisma.join(snapshots)}) AS snapshot(
                id,
                "contentHmac",
                "updatedAt",
                "purgeAt",
                reason
              )
              WHERE envelope."organizationId" = ${due.organizationId}
                AND envelope.id = snapshot.id
                AND envelope."relevanceStatus" = 'REVIEW'
                AND envelope."acceptedMentionId" IS NULL
                AND envelope."purgedAt" IS NULL
                AND envelope."purgeAt" > ${now}
                AND envelope."contentHmac" = snapshot."contentHmac"
                AND envelope."updatedAt" = snapshot."updatedAt"
                AND envelope."purgeAt" = snapshot."purgeAt"
                AND (
                  envelope."reviewMutationUntil" IS NULL
                  OR envelope."reviewMutationUntil" <= ${now}
                )
              RETURNING
                envelope.id,
                envelope."sourceId",
                envelope."adapterKey",
                envelope."providerKey",
                envelope."contentHmac"
            `,
          );
          finalizedEnvelopes.push(...updated);
        }

        const finalizedEnvelopeIds = new Set(
          finalizedEnvelopes.map(envelope => envelope.id),
        );
        const finalizedDecisionIds = pendingRejects
          .filter(decision => finalizedEnvelopeIds.has(decision.envelopeId))
          .map(decision => decision.id);
        const supersededDecisionIds = pendingRejects
          .filter(decision => !finalizedEnvelopeIds.has(decision.envelopeId))
          .map(decision => decision.id);
        finalizedRows = finalizedDecisionIds.length;
        supersededRows = supersededDecisionIds.length;
        if (finalizedRows + supersededRows !== pendingRejects.length) {
          throw new Error("review_apply_finalize_classification_mismatch");
        }

        for (const decisionIdBatch of chunksOf(finalizedDecisionIds)) {
          const updated = await tx.discoveryAutoReviewDecision.updateMany({
            where: {
              organizationId: due.organizationId,
              runId: due.id,
              id: { in: decisionIdBatch },
              action: "REJECT",
              state: "SUPPRESSED",
            },
            data: { state: "FINALIZED", finalizedAt: now },
          });
          if (updated.count !== decisionIdBatch.length) {
            throw new Error("review_apply_finalize_state_changed");
          }
        }
        for (const decisionIdBatch of chunksOf(supersededDecisionIds)) {
          const updated = await tx.discoveryAutoReviewDecision.updateMany({
            where: {
              organizationId: due.organizationId,
              runId: due.id,
              id: { in: decisionIdBatch },
              action: "REJECT",
              state: "SUPPRESSED",
            },
            data: { state: "SUPERSEDED", supersededAt: now },
          });
          if (updated.count !== decisionIdBatch.length) {
            throw new Error("review_apply_finalize_state_changed");
          }
        }

        const decisionByEnvelopeId = new Map(
          pendingRejects.map(decision => [decision.envelopeId, decision] as const),
        );
        const fingerprintExpiresAt = new Date(
          now.getTime() + REJECTED_FINGERPRINT_RETENTION_MS,
        );
        const fingerprintByKey = new Map<
          string,
          {
            envelope: FinalizedEnvelopeSnapshot;
            reason: string;
            duplicateCount: number;
          }
        >();
        for (const envelope of [...finalizedEnvelopes].sort((left, right) =>
          left.id.localeCompare(right.id),
        )) {
          const decision = decisionByEnvelopeId.get(envelope.id);
          if (!decision) {
            throw new Error("review_apply_finalize_decision_missing");
          }
          const key = JSON.stringify([envelope.adapterKey, envelope.contentHmac]);
          const existing = fingerprintByKey.get(key);
          if (existing) {
            existing.duplicateCount += 1;
          } else {
            fingerprintByKey.set(key, {
              envelope,
              reason: decision.reason,
              duplicateCount: 1,
            });
          }
        }
        for (const fingerprintBatch of chunksOf([...fingerprintByKey.values()])) {
          const fingerprints = fingerprintBatch.map(
            ({ envelope, reason, duplicateCount }) => Prisma.sql`(
              ${randomUUID()},
              ${due.organizationId},
              ${envelope.sourceId},
              ${envelope.adapterKey},
              ${envelope.providerKey},
              ${envelope.contentHmac},
              ${reason},
              ${duplicateCount},
              ${now},
              ${now},
              ${fingerprintExpiresAt}
            )`,
          );
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO rejected_observation_fingerprints (
              id,
              "organizationId",
              "sourceId",
              "adapterKey",
              "providerKey",
              "fingerprintHmac",
              "reasonCode",
              "duplicateCount",
              "firstSeenAt",
              "lastSeenAt",
              "expiresAt"
            )
            VALUES ${Prisma.join(fingerprints)}
            ON CONFLICT ("organizationId", "adapterKey", "fingerprintHmac")
            DO UPDATE SET
              "duplicateCount" =
                rejected_observation_fingerprints."duplicateCount"
                + EXCLUDED."duplicateCount",
              "lastSeenAt" = EXCLUDED."lastSeenAt",
              "expiresAt" = EXCLUDED."expiresAt",
              "reasonCode" = EXCLUDED."reasonCode"
          `);
        }
      }

      return {
        run,
        releaseDecisions: decisions.filter(
          decision =>
            decision.state === "SUPPRESSED"
            && decision.action === "RELEASE_TO_NORMAL_PIPELINE",
        ),
        finalizedRows,
        supersededRows,
      };
    }, INTERACTIVE_TRANSACTION_OPTIONS),
  );
}

async function finishDiscoveryAutoReviewRun(
  due: DueReviewRun,
  now: Date,
): Promise<boolean> {
  return withSerializableRetry<boolean>(() =>
    prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const run = await tx.discoveryAutoReviewRun.findFirst({
        where: {
          id: due.id,
          organizationId: due.organizationId,
          state: "APPLIED",
          rollbackUntil: { lte: now },
        },
        select: {
          id: true,
          subjectId: true,
          mode: true,
          resolverVersion: true,
          appliedGroupCount: true,
          appliedRowCount: true,
        },
      });
      if (!run) return false;
      const decisions = await tx.discoveryAutoReviewDecision.findMany({
        where: {
          organizationId: due.organizationId,
          runId: due.id,
        },
        select: {
          state: true,
          action: true,
          groupKeyHmac: true,
        },
      });
      if (decisions.length !== run.appliedRowCount) {
        throw new Error("review_apply_finalize_decision_count_mismatch");
      }
      if (decisions.some(decision => decision.state === "SUPPRESSED")) {
        return false;
      }
      if (
        decisions.some(decision =>
          !["FINALIZED", "SUPERSEDED"].includes(decision.state),
        )
      ) {
        throw new Error("review_apply_finalize_state_changed");
      }
      const groupCount = new Set(decisions.map(decision => decision.groupKeyHmac)).size;
      if (groupCount !== run.appliedGroupCount) {
        throw new Error("review_apply_finalize_decision_count_mismatch");
      }
      const finalizedRowCount = decisions.filter(
        decision => decision.state === "FINALIZED",
      ).length;
      const supersededRowCount = decisions.length - finalizedRowCount;
      const rejectRowCount = decisions.filter(
        decision => decision.action === "REJECT",
      ).length;
      const releaseRowCount = decisions.length - rejectRowCount;

      const runUpdated = await tx.discoveryAutoReviewRun.updateMany({
        where: {
          organizationId: due.organizationId,
          id: due.id,
          state: "APPLIED",
          rollbackUntil: { lte: now },
        },
        data: { state: "FINALIZED", finalizedAt: now },
      });
      if (runUpdated.count !== 1) return false;

      const events: Prisma.DiscoveryAutoReviewEventCreateManyInput[] = [
        {
          organizationId: due.organizationId,
          runId: due.id,
          eventType: "RUN_FINALIZED",
          actorType: "WORKER",
          payload: {
            finalizedRowCount,
            supersededRowCount,
            rejectRowCount,
            releaseRowCount,
            resolverVersion: run.resolverVersion,
          },
        },
      ];
      if (finalizedRowCount > 0) {
        events.push({
          organizationId: due.organizationId,
          runId: due.id,
          eventType: "DECISION_FINALIZED",
          actorType: "WORKER",
          payload: { rowCount: finalizedRowCount },
        });
      }
      if (supersededRowCount > 0) {
        events.push({
          organizationId: due.organizationId,
          runId: due.id,
          eventType: "DECISION_SUPERSEDED",
          actorType: "WORKER",
          payload: { rowCount: supersededRowCount },
        });
      }
      await tx.discoveryAutoReviewEvent.createMany({ data: events });
      await tx.auditLog.create({
        data: {
          organizationId: due.organizationId,
          action: "social_discovery_review_finalize",
          entityType: "monitoring_subject",
          entityId: run.subjectId,
          entityName: run.mode,
          newValue: {
            runId: due.id,
            finalizedRowCount,
            supersededRowCount,
            rejectRowCount,
            releaseRowCount,
          },
        },
      });
      return true;
    }, INTERACTIVE_TRANSACTION_OPTIONS),
  );
}

async function finalizeReleaseDecision(
  due: DueReviewRun,
  decision: FinalizeDecisionSnapshot,
  subjectId: string,
  now: Date,
): Promise<"FINALIZED" | "SUPERSEDED" | "UNCHANGED"> {
  const replayIngestEnvelope = await loadReplayIngestEnvelope();
  const replay = await replayIngestEnvelope(
    due.organizationId,
    decision.envelopeId,
    {
      autoReviewDecision: {
        runId: due.id,
        decisionId: decision.id,
        subjectId,
        expectedContentHmac: decision.beforeContentHmac,
        expectedUpdatedAt: decision.beforeUpdatedAt,
        expectedPurgeAt: decision.beforePurgeAt,
      },
      // Auto-resolution is a local normalization step. It must not emit
      // workflow messages or queue media/provider work.
      suppressWorkflows: true,
      suppressMediaScheduling: true,
    },
  );
  const nextState = (
    replay.status === "REJECTED_BY_CURRENT_RELEVANCE"
    || replay.status === "SUPERSEDED"
  )
    ? "SUPERSEDED" as const
    : "FINALIZED" as const;
  const transitioned = await prisma.discoveryAutoReviewDecision.updateMany({
    where: {
      organizationId: due.organizationId,
      runId: due.id,
      id: decision.id,
      action: "RELEASE_TO_NORMAL_PIPELINE",
      state: "SUPPRESSED",
    },
    data: nextState === "FINALIZED"
      ? { state: "FINALIZED", finalizedAt: now }
      : { state: "SUPERSEDED", supersededAt: now },
  });
  if (transitioned.count === 1) return nextState;
  const current = await prisma.discoveryAutoReviewDecision.findFirst({
    where: {
      organizationId: due.organizationId,
      runId: due.id,
      id: decision.id,
    },
    select: { state: true },
  });
  if (
    current?.state === nextState
    || ["FINALIZED", "SUPERSEDED", "ROLLED_BACK"].includes(current?.state ?? "")
  ) return "UNCHANGED";
  throw new Error("review_apply_finalize_state_changed");
}

/**
 * Finalizes expired suppression runs without provider/API calls. It uses the
 * apply-time snapshots as a compare-and-set boundary; changed rows are marked
 * SUPERSEDED and remain in their current state rather than being overwritten.
 * RELEASE decisions replay only the stored envelope, with workflow/media
 * side-effects disabled, after the rollback deadline has passed.
 */
export async function finalizeDueDiscoveryAutoReviewRuns(
  options: {
    organizationId?: string;
    now?: Date;
    limit?: number;
  } = {},
): Promise<FinalizeDiscoveryAutoReviewResult> {
  const now = options.now ?? new Date();
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
  const result: FinalizeDiscoveryAutoReviewResult = {
    runsFinalized: 0,
    rowsFinalized: 0,
    rowsSuperseded: 0,
    failures: 0,
  };
  const dueRuns: DueReviewRun[] =
    await prisma.discoveryAutoReviewRun.findMany({
      where: {
        ...(options.organizationId
          ? { organizationId: options.organizationId }
          : {}),
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
      // Untouched runs always precede retries. A permanently malformed prefix
      // therefore cannot consume the daily worker limit forever; failed runs
      // rotate behind healthy attemptCount=0 work, then fairly among retries.
      orderBy: [
        { finalizeAttemptCount: "asc" },
        { rollbackUntil: "asc" },
        { id: "asc" },
      ],
      take: limit,
      select: { id: true, organizationId: true },
    });

  for (const due of dueRuns) {
    try {
      const prepared = await prepareDiscoveryAutoReviewRun(due, now);
      if (!prepared) continue;
      result.rowsFinalized += prepared.finalizedRows;
      result.rowsSuperseded += prepared.supersededRows;

      // Bound one tick without losing durable progress. Remaining SUPPRESSED
      // rows are picked up idempotently by the next retention pass.
      for (const decision of prepared.releaseDecisions.slice(0, SQL_BATCH_SIZE)) {
        const state = await finalizeReleaseDecision(
          due,
          decision,
          prepared.run.subjectId,
          now,
        );
        if (state === "FINALIZED") result.rowsFinalized += 1;
        else if (state === "SUPERSEDED") result.rowsSuperseded += 1;
      }
      if (await finishDiscoveryAutoReviewRun(due, now)) {
        result.runsFinalized += 1;
      }
    } catch (error) {
      result.failures += 1;
      const safeCode =
        error instanceof Error &&
        /^review_apply_[a-z0-9_]+$/.test(error.message)
          ? error.message
          : "review_apply_finalize_failed";
      await prisma.discoveryAutoReviewRun
        .updateMany({
          where: {
            id: due.id,
            organizationId: due.organizationId,
            state: "APPLIED",
          },
          data: {
            finalizeAttemptCount: { increment: 1 },
            finalizeLastAttemptAt: now,
            finalizeNextAttemptAt: new Date(
              now.getTime() + FINALIZE_RETRY_DELAY_MS,
            ),
            finalizeLastError: safeCode,
          },
        })
        .catch(() => {});
      logError(`[social-discovery-review-finalize] ${safeCode}`, undefined, {
        org_id: due.organizationId,
        module: "social-discovery-review-finalize",
        request_id: due.id,
      });
    }
  }
  return result;
}
