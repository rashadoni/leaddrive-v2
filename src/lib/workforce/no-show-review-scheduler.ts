import { Prisma } from "@prisma/client";
import { withJobLease, type JobLeaseStore } from "@/lib/cron/job-lease";
import { addDateKeyDays, isDateKey } from "@/lib/mtm/mobile-week";
import { prisma } from "@/lib/prisma";
import { runWithRlsBypass } from "@/lib/rls-context";
import { isTenantCapabilityEnabled } from "@/lib/tenant-capabilities";
import {
  materializeAuthorizedWorkforceNoShowReviewCaseInTransaction,
  type WorkforceNoShowCaseMaterializerDb,
} from "@/lib/workforce/no-show-case-materializer";
import { readWorkforceNoShowCandidateBatch } from "@/lib/workforce/no-show-candidate-batch";
import { workforceNoShowReviewEnabled } from "@/lib/workforce/no-show-review-rollout";

export const WORKFORCE_NO_SHOW_REVIEW_SCHEDULER_JOB_NAME =
  "workforce-no-show-review";
export const WORKFORCE_NO_SHOW_REVIEW_SCHEDULER_LEASE_MS = 60_000;
export const WORKFORCE_NO_SHOW_REVIEW_SCHEDULER_AGENT_BATCH = 20;

const SCHEDULED_NO_SHOW_TRANSACTION_TIMEOUT_MS = 20_000;

type CursorState = {
  activeWorkDate: string | null;
  lastCompletedWorkDate: string | null;
  lastOrganizationId: string | null;
  lastAgentId: string | null;
};

type CursorLockRow = {
  cursor: string | null;
  version: number;
};

type WorkforceNoShowReviewOrganization = {
  id: string;
  isActive: boolean;
  plan: string;
  addons: string[];
  features: unknown;
  modules: unknown;
};

export type WorkforceScheduledNoShowReviewResult = {
  skipped: "already_running" | null;
  cursorBusy: boolean;
  notDue: boolean;
  workDate: string | null;
  tenantsConsidered: number;
  workforceTenantsConsidered: number;
  reviewEnabledTenantsScanned: number;
  candidatesEvaluated: number;
  reviewCandidates: number;
  reviewCasesRecorded: number;
  idempotentCases: number;
  morePending: boolean;
};

type SchedulerDatabase = Pick<typeof prisma, "$transaction">;

function utcDateKey(now: Date): string {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new RangeError("now must be a valid timestamp");
  }
  return now.toISOString().slice(0, 10);
}

function scheduledWorkDate(now: Date): string {
  // The scan intentionally waits for the prior UTC date to be fully elapsed.
  // Each candidate re-resolves its own immutable schedule timezone, published
  // start and grace; this avoids inferring an organization-wide timezone or
  // declaring a still-current local day absent. A later scan is review-only.
  return addDateKeyDays(utcDateKey(now), -1);
}

function emptyResult(
  input: {
    cursorBusy?: boolean;
    notDue?: boolean;
    workDate?: string | null;
  } = {},
): Omit<WorkforceScheduledNoShowReviewResult, "skipped"> {
  return {
    cursorBusy: input.cursorBusy ?? false,
    notDue: input.notDue ?? false,
    workDate: input.workDate ?? null,
    tenantsConsidered: 0,
    workforceTenantsConsidered: 0,
    reviewEnabledTenantsScanned: 0,
    candidatesEvaluated: 0,
    reviewCandidates: 0,
    reviewCasesRecorded: 0,
    idempotentCases: 0,
    morePending: false,
  };
}

function workforceEnabled(
  organization: WorkforceNoShowReviewOrganization,
): boolean {
  try {
    return isTenantCapabilityEnabled("workforce-hrm", organization);
  } catch {
    // A malformed entitlement must not become permission for a global worker
    // to inspect an employee's missed-start state.
    return false;
  }
}

function reviewEnabled(
  organization: WorkforceNoShowReviewOrganization,
): boolean {
  try {
    return (
      workforceEnabled(organization) &&
      workforceNoShowReviewEnabled(organization.features)
    );
  } catch {
    return false;
  }
}

function hasValidCursorDate(value: string | null): boolean {
  return value == null || isDateKey(value);
}

function parseCursor(value: string | null): CursorState {
  if (value == null) {
    return {
      activeWorkDate: null,
      lastCompletedWorkDate: null,
      lastOrganizationId: null,
      lastAgentId: null,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("WORKFORCE_NO_SHOW_REVIEW_CURSOR_INVALID");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("WORKFORCE_NO_SHOW_REVIEW_CURSOR_INVALID");
  }
  const record = parsed as Record<string, unknown>;
  const stringOrNull = (field: string): string | null => {
    const candidate = record[field];
    if (candidate === null) return null;
    if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > 191) {
      throw new Error("WORKFORCE_NO_SHOW_REVIEW_CURSOR_INVALID");
    }
    return candidate;
  };
  const cursor = {
    activeWorkDate: stringOrNull("activeWorkDate"),
    lastCompletedWorkDate: stringOrNull("lastCompletedWorkDate"),
    lastOrganizationId: stringOrNull("lastOrganizationId"),
    lastAgentId: stringOrNull("lastAgentId"),
  };
  if (!hasValidCursorDate(cursor.activeWorkDate) || !hasValidCursorDate(cursor.lastCompletedWorkDate)) {
    throw new Error("WORKFORCE_NO_SHOW_REVIEW_CURSOR_INVALID");
  }
  if (cursor.lastAgentId != null && cursor.lastOrganizationId == null) {
    throw new Error("WORKFORCE_NO_SHOW_REVIEW_CURSOR_INVALID");
  }
  return cursor;
}

function serializeCursor(cursor: CursorState): string {
  const serialized = JSON.stringify(cursor);
  if (serialized.length > 512) throw new Error("WORKFORCE_NO_SHOW_REVIEW_CURSOR_INVALID");
  return serialized;
}

async function nextActiveOrganization(
  tx: Prisma.TransactionClient,
  cursor: CursorState,
): Promise<WorkforceNoShowReviewOrganization | null> {
  const select = {
    id: true,
    isActive: true,
    plan: true,
    addons: true,
    features: true,
    modules: true,
  };
  if (cursor.lastAgentId != null) {
    if (!cursor.lastOrganizationId) {
      throw new Error("WORKFORCE_NO_SHOW_REVIEW_CURSOR_INVALID");
    }
    return tx.organization.findUnique({
      where: { id: cursor.lastOrganizationId },
      select,
    });
  }
  return tx.organization.findFirst({
    where: {
      isActive: true,
      ...(cursor.lastOrganizationId
        ? { id: { gt: cursor.lastOrganizationId } }
        : {}),
    },
    orderBy: { id: "asc" },
    select,
  });
}

async function hasNextActiveOrganization(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<boolean> {
  const next = await tx.organization.findFirst({
    where: { isActive: true, id: { gt: organizationId } },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  return next != null;
}

async function runOneScheduledNoShowReview(
  db: SchedulerDatabase,
  now: Date,
): Promise<Omit<WorkforceScheduledNoShowReviewResult, "skipped">> {
  const targetWorkDate = scheduledWorkDate(now);
  return db.$transaction(
    async (tx: Prisma.TransactionClient) => {
      // Reuse the global bounded scheduler cursor table. The row is opaque and
      // contains no employee or proof data; creating it is safe and
      // idempotent. A missing migration fails here before tenant inspection.
      await tx.systemJobCursor.upsert({
        where: { name: WORKFORCE_NO_SHOW_REVIEW_SCHEDULER_JOB_NAME },
        create: { name: WORKFORCE_NO_SHOW_REVIEW_SCHEDULER_JOB_NAME, cursor: null },
        update: {},
      });
      const lockedRows = await tx.$queryRaw<CursorLockRow[]>(Prisma.sql`
        SELECT "cursor", "version"
        FROM "system_job_cursors"
        WHERE "name" = ${WORKFORCE_NO_SHOW_REVIEW_SCHEDULER_JOB_NAME}
        FOR UPDATE SKIP LOCKED
      `);
      const locked = lockedRows[0];
      if (!locked) return emptyResult({ cursorBusy: true });
      if (!Number.isSafeInteger(locked.version) || locked.version < 1) {
        throw new Error("WORKFORCE_NO_SHOW_REVIEW_CURSOR_INVALID");
      }
      const cursor = parseCursor(locked.cursor);

      const updateCursor = async (next: CursorState): Promise<void> => {
        await tx.systemJobCursor.update({
          where: { name: WORKFORCE_NO_SHOW_REVIEW_SCHEDULER_JOB_NAME },
          data: { cursor: serializeCursor(next), version: { increment: 1 } },
        });
      };

      // Do not backfill a long period merely because the worker first becomes
      // available. A controlled tenant rollout begins with the immediately
      // preceding completed UTC day. Once a day starts, however, it is fully
      // drained through the durable cursor before a newer day can replace it.
      const workDate =
        cursor.activeWorkDate ??
        (cursor.lastCompletedWorkDate != null &&
        cursor.lastCompletedWorkDate >= targetWorkDate
          ? null
          : targetWorkDate);
      if (workDate == null) return emptyResult({ notDue: true });

      const organization = await nextActiveOrganization(tx, cursor);
      if (!organization) {
        await updateCursor({
          activeWorkDate: null,
          lastCompletedWorkDate: workDate,
          lastOrganizationId: null,
          lastAgentId: null,
        });
        return emptyResult({ workDate });
      }

      // A disabled/deleted tenant cannot retain a partially scanned employee
      // cursor. Move past it without opening a Workforce candidate or case.
      if (!organization.isActive) {
        await updateCursor({
          activeWorkDate: workDate,
          lastCompletedWorkDate: cursor.lastCompletedWorkDate,
          lastOrganizationId: organization.id,
          lastAgentId: null,
        });
        return {
          ...emptyResult({ workDate }),
          tenantsConsidered: 1,
          morePending: true,
        };
      }

      const isWorkforceTenant = workforceEnabled(organization);
      if (!reviewEnabled(organization)) {
        const morePending = await hasNextActiveOrganization(
          tx,
          organization.id,
        );
        await updateCursor(morePending
          ? {
              activeWorkDate: workDate,
              lastCompletedWorkDate: cursor.lastCompletedWorkDate,
              lastOrganizationId: organization.id,
              lastAgentId: null,
            }
          : {
              activeWorkDate: null,
              lastCompletedWorkDate: workDate,
              lastOrganizationId: null,
              lastAgentId: null,
            },
        );
        return {
          ...emptyResult({ workDate }),
          tenantsConsidered: 1,
          workforceTenantsConsidered: isWorkforceTenant ? 1 : 0,
          morePending,
        };
      }

      const batch = await readWorkforceNoShowCandidateBatch(tx, {
        organizationId: organization.id,
        workDate,
        asOf: now,
        afterAgentId: cursor.lastAgentId,
        limit: WORKFORCE_NO_SHOW_REVIEW_SCHEDULER_AGENT_BATCH,
      });
      const reviewCandidateRows = batch.candidates.filter(
        (candidate) => candidate.result.outcome === "REVIEW_CANDIDATE",
      );
      let reviewCasesRecorded = 0;
      let idempotentCases = 0;
      for (const candidate of reviewCandidateRows) {
        const materialized =
          await materializeAuthorizedWorkforceNoShowReviewCaseInTransaction({
            // Prisma's generic delegate signatures are wider than the narrow
            // structural facade used by the materializer tests. The active
            // transaction supplies every required delegate and remains the
            // only transaction boundary here.
            tx: tx as unknown as WorkforceNoShowCaseMaterializerDb,
            organizationId: organization.id,
            agentId: candidate.agentId,
            workDate,
            asOf: now,
            // The Cron secret plus RLS-bypass maintenance route is the service
            // identity. This narrow callback grants only the exact current
            // tenant/employee CASE_CREATE operation; it cannot append a human
            // decision, alter attendance, notify or write another tenant.
            authorize: async (request) =>
              request.operation === "CASE_CREATE" &&
              request.organizationId === organization.id &&
              request.agentId === candidate.agentId,
          });
        if (materialized.outcome === "REVIEW_CASE_RECORDED") {
          reviewCasesRecorded += 1;
          if (materialized.idempotent) idempotentCases += 1;
        }
      }

      // Aggregate operational audit only: the immutable case writer records
      // its own case event. This summary intentionally contains no employee,
      // schedule, workday, proof, location, QR, device or explanation data.
      await tx.mtmAuditLog.create({
        data: {
          organizationId: organization.id,
          agentId: null,
          action: "WORKFORCE_NO_SHOW_REVIEW_SCHEDULED",
          entity: "workforce_no_show_review",
          entityId: workDate,
          metadataKind: "workforce_exception_lifecycle",
          newData: {
            source: "SCHEDULED_REVIEW_ONLY",
            workDate,
            candidatesEvaluated: batch.candidates.length,
            reviewCandidates: reviewCandidateRows.length,
            reviewCasesRecorded,
            idempotentCases,
          },
          ipAddress: null,
          userAgent: null,
        },
      });

      const moreOrganizations = batch.morePending
        ? true
        : await hasNextActiveOrganization(tx, organization.id);
      await updateCursor(batch.morePending
        ? {
            activeWorkDate: workDate,
            lastCompletedWorkDate: cursor.lastCompletedWorkDate,
            lastOrganizationId: organization.id,
            lastAgentId: batch.nextCursorAgentId,
          }
        : moreOrganizations
          ? {
              activeWorkDate: workDate,
              lastCompletedWorkDate: cursor.lastCompletedWorkDate,
              lastOrganizationId: organization.id,
              lastAgentId: null,
            }
          : {
              activeWorkDate: null,
              lastCompletedWorkDate: workDate,
              lastOrganizationId: null,
              lastAgentId: null,
            },
      );
      return {
        ...emptyResult({ workDate }),
        tenantsConsidered: 1,
        workforceTenantsConsidered: 1,
        reviewEnabledTenantsScanned: 1,
        candidatesEvaluated: batch.candidates.length,
        reviewCandidates: reviewCandidateRows.length,
        reviewCasesRecorded,
        idempotentCases,
        morePending: moreOrganizations,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: SCHEDULED_NO_SHOW_TRANSACTION_TIMEOUT_MS,
    },
  );
}

/**
 * Runs one tenant-local bounded slice under a lease and a durable cursor. The
 * CRON endpoint is deliberately not installed in deployment scheduling; a
 * tenant must additionally opt in to `workforce-no-show-review-v1` before a
 * review-only case can be materialized.
 */
export async function runScheduledWorkforceNoShowReview(
  input: {
    now?: Date;
    db?: SchedulerDatabase;
    leaseStore?: JobLeaseStore;
  } = {},
): Promise<WorkforceScheduledNoShowReviewResult> {
  const db = input.db ?? prisma;
  const now = input.now ?? new Date();
  return runWithRlsBypass(async () => {
    const lease = await withJobLease(
      {
        name: WORKFORCE_NO_SHOW_REVIEW_SCHEDULER_JOB_NAME,
        ttlMs: WORKFORCE_NO_SHOW_REVIEW_SCHEDULER_LEASE_MS,
      },
      () => runOneScheduledNoShowReview(db, now),
      input.leaseStore,
    );
    if (lease.status === "skipped") {
      return { skipped: lease.reason, ...emptyResult() };
    }
    return { skipped: null, ...lease.value };
  });
}
